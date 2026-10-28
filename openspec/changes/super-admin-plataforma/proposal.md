# Propuesta — super-admin-plataforma

**Change**: `super-admin-plataforma` · **Spec**: `specs/REQ-SA.md` · **Tareas**: `tasks.md`

## Problema

Utopía es un SaaS multi-tenant donde cada cliente opera en su propio subdominio y con aislamiento RLS estricto basado en `tenant_id`. Sin embargo, el dueño de la plataforma (super admin) no tiene forma de operar sobre el SaaS desde la aplicación web:

1. **Gestión de módulos a ciegas**: `tenant_modulo` es de solo lectura para usuarios autenticados desde la migración `00117_tenant_modulo_solo_operador.sql`. La asignación de módulos se realiza exclusivamente por scripts de consola (`provision-tenant.mts`) o SQL directo. No hay interfaz para dar de alta o baja módulos cuando un cliente contrata o cancela un servicio.
2. **Sin control de cuenta corriente de tenants**: No existe registro de cargos (abonos mensuales, servicios extra) ni de pagos efectuados por los tenants, ni vista de saldo deudor/acreedor. La gestión financiera entre el SaaS y los clientes se lleva por fuera del sistema.
3. **Inexistencia de identidad de plataforma**: La autenticación actual asume que todo usuario pertenece a un tenant (`usuario.id_tenant`) o es revendedora (`revendedora.id_revendedora`). Un usuario de autenticación (`auth.users`) que no pertenezca a ningún tenant no puede ingresar al sistema (entra en un bucle de redirección en `/login`).

El objetivo es proveer un panel de administración de plataforma para el dueño del SaaS con alcance simple y robusto ("nada extravagante"): sin cargos automáticos, sin tarifarios por módulo y sin bloqueo automático de tenants suspendidos.

## Contexto verificado

- **`tenant_modulo` es de solo lectura para `authenticated` desde `00117`**: se escribe únicamente con service-role (`supabase/migrations/00117_tenant_modulo_solo_operador.sql:20-27`). `sp_toggle_tenant_modulo` existe y fue revocado para `authenticated, anon, public`.
- **`tenant.estado_tenant` (activo/suspendido/archivado) existe en base de datos (`00001_extensions_and_enums.sql:18`)**, pero hoy ningún flujo ni guard del sistema valida o bloquea accesos en función de este estado.
- **El subdominio `'admin'` ya está reservado** en la lista inmutable `RESERVED_SUBDOMINIOS` de `lib/tenant/subdominio.ts:21`.
- **RLS filtra exclusivamente por el claim `tenant_id`** inyectado en el JWT mediante el Auth Hook `custom_access_token_hook` (`supabase/migrations/00080_hook_seguridad_revendedora.sql:47`).

### Hallazgo técnico verificado: `sp_toggle_tenant_modulo`

Al inspeccionar la última definición con `pnpm sp:last sp_toggle_tenant_modulo` (`supabase/migrations/00086_comisiones.sql:224-269`), se observa:

```sql
create or replace function sp_toggle_tenant_modulo(
  p_id_modulo   uuid,
  p_habilitado  boolean,
  p_ip          inet default null
) returns void language plpgsql as $$
declare
  v_tenant   uuid := auth_tenant_id();
  ...
begin
  if v_tenant is null then
    raise exception 'no-tenant' using errcode = '42501';
  end if;
  ...
```

**Evidencia**: La función fue concebida en `00029` y actualizada en `00086` para que el admin del *propio* tenant alternara sus módulos tomando el contexto de `auth_tenant_id()`. No acepta un parámetro `p_id_tenant`. Si un super admin (o el service-role sin JWT de tenant) invoca este SP tal cual está, `auth_tenant_id()` retorna `NULL` y el SP falla con la excepción `'no-tenant'`.
Para reusar la lógica de siembra de reglas locales de comisión (`00086:241-260`) y auditoría sin duplicar comportamiento, se requiere o bien una sobrecarga `sp_toggle_tenant_modulo(p_id_tenant uuid, p_id_modulo uuid, p_habilitado boolean, p_ip inet)` o que el DAL de plataforma con service-role encapsule la mutación informando el tenant. Esto se documenta y resuelve en `DR-SA-05`.

## Investigación de autenticación y ruteo

### 1. Comportamiento actual ante un auth user sin fila en `usuario`

Se analizó la traza completa de autenticación y autorización en los archivos del sistema:

1. **`custom_access_token_hook`** (`supabase/migrations/00080_hook_seguridad_revendedora.sql:47-81`):
   El hook busca al usuario en `public.usuario` (`line 55`). Al no existir fila, `v_tenant` y `v_rol_nombre` resultan `NULL`. En las líneas 70-74 ejecuta `claims := claims - 'tenant_id'`, por lo que retorna el token de acceso verificado exitosamente pero **sin** el claim `tenant_id`. No explota ni arroja error.
2. **`loginAction`** (`app/(auth)/login/actions.ts:21-41`):
   `signInWithPassword` (`line 33`) autentica contra Supabase Auth y devuelve `ok`. Inmediatamente la acción ejecuta en la línea 40:
   ```ts
   redirect('/ventas')
   ```
3. **`proxy.ts`** (`proxy.ts:43-57`):
   El proxy evalúa el Host. Si la petición proviene del dominio raíz o de un subdominio reservado como `admin` (`line 50`), `isTenant` es `false`, por lo que **no** inyecta el header `x-utopia-tenant-subdomain`. Refresca la sesión sin problemas (`line 91`).
4. **`AppShellLayout`** (`app/(app)/layout.tsx:27-33`):
   La ruta `/ventas` está dentro del grupo `app/(app)/**`. Su layout invoca `session = await verifySession()` (`line 29`).
5. **`verifySession()`** (`lib/dal/session.ts:100-112`):
   En las líneas 109-112, verifica los claims:
   ```ts
   const tenantId = claims.tenant_id ?? claims.app_metadata?.tenant_id
   if (!tenantId) {
     throw new AuthorizationError('no-session')
   }
   ```
   Al no tener `tenant_id`, lanza `AuthorizationError('no-session')`.
6. **Rebote a login**:
   `AppShellLayout` captura `AuthorizationError` en la línea 31 y ejecuta:
   ```ts
   if (error instanceof AuthorizationError) redirect('/login')
   ```
   **Diagnóstico**: El usuario queda autenticado en cookies pero no puede ingresar a ninguna ruta de `app/(app)/**`; es redirigido en bucle a `/login`.

### Propuesta: menor cambio posible para el ingreso del super admin

Para no tocar el Auth Hook ni alterar el comportamiento de los usuarios normales de tenant:
1. En `app/(auth)/login/actions.ts`, tras el éxito de `signInWithPassword`, verificar si el usuario autenticado tiene el claim `tenant_id`.
2. Si **no** tiene `tenant_id`, consultar mediante un helper ligero si su `id_usuario` existe en la tabla `superadmin`.
   - Si es superadmin: redirigir a `/plataforma`.
   - Si no es superadmin: cerrar la sesión en Supabase y retornar `{ ok: false, error: 'Credenciales inválidas' }` (falla cerrado, sin revelar información).
3. Si **tiene** `tenant_id`: continuar con el flujo habitual `redirect('/ventas')`.

### 2. Dónde servir el panel: root domain vs `admin.<root>`

- **Recomendación**: Servir el panel en `admin.<root>` (con fallback a `<root>/plataforma` en entornos locales donde no se configure subdominio).
- **Tradeoff**: `admin.<root>` aísla de raíz la superficie administrativa del SaaS y deja el dominio principal limpio para la futura landing institucional/marketing, a cambio de requerir resolución de subdominio o wildcard DNS en el entorno de despliegue.

## Alcance del cambio

1. **Base de datos (migración y SPs)**:
   - Tabla `superadmin`: allowlist de IDs de usuarios (`id_auth_user uuid pk -> auth.users(id)`). RLS habilitado, 0 policies, privilegios revocados para `authenticated, anon, public`.
   - Tabla `tenant_cargo`: registro append-only de cargos (`id`, `id_tenant`, `periodo`, `monto > 0`, `concepto`, `created_by`, `created_at`, `anulado_at`, `anulado_por`).
   - Tabla `tenant_pago`: registro append-only de pagos (`id`, `id_tenant`, `fecha`, `monto > 0`, `medio`, `nota`, `created_by`, `created_at`, `anulado_at`, `anulado_por`).
   - Vista `tenant_saldo`: vista dinámica que calcula por tenant $\Sigma \text{cargos no anulados} - \Sigma \text{pagos no anulados}$. Nunca se persiste el saldo.
   - Procedimientos almacenados:
     - `sp_registrar_cargo_tenant`
     - `sp_registrar_pago_tenant`
     - `sp_anular_movimiento_tenant` (unificado para cargo o pago, idempotentemente)
     - `sp_toggle_tenant_modulo_admin` (o delegación parametrizada por `id_tenant`)
2. **Capa DAL (`lib/dal/plataforma/`)**:
   - Acceso con service-role condicionado detrás de la guarda `requireSuperAdmin()`.
   - `listarTenants`: consulta consolidada (en una sola query) de tenants, estado, módulos habilitados y saldo de cuenta corriente (Design for N).
   - `obtenerTenantDetalle`: información general, módulos y cuenta corriente con historial cronológico de movimientos.
   - Operaciones de mutación: registrar cargo, registrar pago, anular movimiento, toggle módulo.
3. **Validación y Server Actions**:
   - `lib/validation/plataforma.ts`: schemas Zod con `strictObject` para cargos, pagos, anulaciones y toggle.
   - Acciones de servidor en `app/(plataforma)/plataforma/actions.ts` con 3 compuertas (Authorize -> Validate -> DAL).
   - Slugs de error en `lib/errores/mensajes.ts` y cobertura en `lib/errores/mensajes.test.ts`.
4. **Interfaz de usuario**:
   - Grupo de rutas `app/(plataforma)/layout.tsx` con verificación de super admin y shell propio (desconectado del shell de tenant).
   - Pantalla principal `app/(plataforma)/plataforma/page.tsx`: tabla de tenants con búsqueda, estado, módulos y saldo.
   - Pantalla de detalle `app/(plataforma)/plataforma/[id]/page.tsx`: switches de módulos opcionales, resumen de saldo, historial de movimientos y diálogos para nuevo cargo, nuevo pago y anulación.

## Fuera de alcance

- **Aplicación del estado de tenant (`tenant.estado_tenant`)**: la columna existe pero ningún módulo la respeta actualmente. Bloquear accesos a tenants suspendidos o archivados se define formalmente como el **siguiente cambio** tras este módulo.
- **Cargos automáticos o facturación recurrente programada**: no se implementan cron jobs ni tareas automáticas de facturación mensual.
- **Precios por módulo o tarifarios automáticos**: los montos de los cargos se ingresan manualmente por el super admin.
- **Integración con pasarelas de pago**: el registro de pagos es puramente declarativo administrativo.
- **Edición física de movimientos**: corregir un error exige anular el movimiento y generar uno nuevo (append-only estricto).

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Fuga de datos de facturación hacia usuarios de tenants | Crítico | Las tablas `superadmin`, `tenant_cargo`, `tenant_pago` y la vista `tenant_saldo` tienen RLS habilitado sin ninguna policy y se aplica `REVOKE ALL` explícito a `authenticated` y `anon`. |
| Uso indebido de service-role en el DAL | Crítico | Todo el módulo `lib/dal/plataforma/` está estrictamente encapsulado detrás de `requireSuperAdmin()`. Ninguna función DAL ejecuta sin validar previamente la identidad del llamador contra `superadmin`. |
| Inconsistencia de saldos por concurrencia | Alto | El saldo nunca se almacena como columna; se deriva en tiempo de consulta mediante la vista `tenant_saldo` sumando y restando movimientos válidos. |
