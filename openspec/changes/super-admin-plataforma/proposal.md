# Propuesta — super-admin-plataforma

**Change**: `super-admin-plataforma` · **Spec**: `specs/REQ-SA.md` · **Tareas**: `tasks.md`

## Problema

Utopía es un SaaS multi-tenant donde cada cliente opera en su propio subdominio y con aislamiento RLS estricto basado en `tenant_id`. Sin embargo, el dueño de la plataforma (super admin) no tiene forma de operar sobre el SaaS desde la aplicación web:

1. **Gestión de módulos a ciegas**: `tenant_modulo` es de solo lectura para usuarios autenticados desde la migración `00117_tenant_modulo_solo_operador.sql`. La asignación de módulos se realiza exclusivamente por scripts de consola (`provision-tenant.mts`) o SQL directo. No hay interfaz para habilitar o deshabilitar módulos cuando un cliente contrata o cancela un servicio.
2. **Sin control de cuenta corriente de tenants**: No existe registro de cargos (abonos mensuales, servicios extra) ni de pagos efectuados por los tenants, ni vista de saldo deudor/acreedor. La gestión financiera entre el SaaS y los clientes se lleva por fuera del sistema.
3. **Inexistencia de identidad de plataforma**: La autenticación actual asume que todo usuario pertenece a un tenant (`usuario.id_tenant`) o es revendedora (`revendedora.id_revendedora`). Un usuario de autenticación (`auth.users`) que no pertenezca a ningún tenant no puede ingresar al sistema (entra en un bucle de redirección en `/login`).

El objetivo es proveer un panel de administración de plataforma para el dueño del SaaS con alcance simple y robusto ("nada extravagante"): sin cargos automáticos, sin tarifarios por módulo y sin bloqueo automático de tenants suspendidos.

## Contexto verificado

- **`tenant_modulo` es de solo lectura para `authenticated` desde `00117`**: se escribe únicamente con service-role (`supabase/migrations/00117_tenant_modulo_solo_operador.sql:20-27`). `sp_toggle_tenant_modulo` existe y fue revocado para `authenticated, anon, public`.
- **`tenant.estado_tenant` (activo/suspendido/archivado) existe en base de datos (`00001_extensions_and_enums.sql:18`)**, pero hoy ningún flujo ni guard del sistema valida o bloquea accesos en función de este estado.
- **El subdominio `'admin'` ya está reservado** en la lista inmutable `RESERVED_SUBDOMINIOS` de `lib/tenant/subdominio.ts:21`.
- **RLS filtra exclusivamente por el claim `tenant_id`** inyectado en el JWT mediante el Auth Hook `custom_access_token_hook` (`supabase/migrations/00080_hook_seguridad_revendedora.sql:47`).

### Habilitación por paquetes y SP de toggle

La última definición de `sp_toggle_tenant_modulo` (`supabase/migrations/00086_comisiones.sql:224-269`) resuelve el tenant llamando a `v_tenant := auth_tenant_id();` y recibe `p_id_modulo`. Como con service-role `auth_tenant_id()` es `NULL` y los módulos se gestionan por paquetes funcionales según la especificación de `modulos-opcionales`:

1. Se introduce `sp_toggle_tenant_modulo_admin(p_id_tenant, p_paquete, p_habilitado, p_ip, p_actor)` para alternar paquetes opcionales completos (`revendedoras`, `consignacionProveedor`) en una sola transacción atómica.
2. La siembra de la regla local de comisión (0%) y la auditoría se copian fielmente de `00086_comisiones.sql:241-267`.
3. **Prerrequisito**: Este cambio asume el PR 1 de `modulos-opcionales` mergeado. Las guardas de integridad (núcleo inmutable, consistencia de a par del paquete consignación, y prohibición de apagar módulos con estado vivo) las imponen los triggers de `modulos-opcionales`; este cambio no las duplica.

## Investigación de autenticación y ruteo

### 1. Comportamiento actual ante un auth user sin fila en `usuario`

Se analizó la traza completa de autenticación y autorización en los archivos del sistema:

1. **`custom_access_token_hook`** (`supabase/migrations/00080_hook_seguridad_revendedora.sql:47-81`):
   El hook busca al usuario en `public.usuario` (`line 55`). Al no existir fila, `v_tenant` y `v_rol_nombre` resultan `NULL`. En las líneas 70-74 ejecuta `claims := claims - 'tenant_id'`, por lo que retorna el token de acceso verificado exitosamente pero **sin** el claim `tenant_id`. No arroja error.
2. **`loginAction`** (`app/(auth)/login/actions.ts:21-41`):
   `signInWithPassword` (`line 33`) autentica contra Supabase Auth y devuelve `ok`. Inmediatamente la acción ejecuta en la línea 40 `redirect('/ventas')`.
3. **`proxy.ts`** (`proxy.ts:43-57`):
   El proxy no inyecta `x-utopia-tenant-subdomain` en la raíz ni en subdominios reservados. Refresca la sesión sin problemas (`line 91`). No requiere modificaciones.
4. **`AppShellLayout`** (`app/(app)/layout.tsx:27-33`):
   La ruta `/ventas` está dentro del grupo `app/(app)/**`. Su layout invoca `session = await verifySession()` (`line 29`).
5. **`verifySession()`** (`lib/dal/session.ts:100-112`):
   En las líneas 109-112 verifica los claims:
   ```ts
   const tenantId = claims.tenant_id ?? claims.app_metadata?.tenant_id
   if (!tenantId) {
     throw new AuthorizationError('no-session')
   }
   ```
   Al no tener `tenant_id`, lanza `AuthorizationError('no-session')`.
6. **Rebote a login**:
   `AppShellLayout` captura `AuthorizationError` en la línea 31 y ejecuta `if (error instanceof AuthorizationError) redirect('/login')`.
   **Diagnóstico**: El usuario queda autenticado en cookies pero no puede ingresar a ninguna ruta de `app/(app)/**`; es redirigido en bucle a `/login`.

### Solución acordada para ingreso y ruteo del super admin

1. **Helper `esSuperAdmin(idUsuario: string)`** en `lib/dal/plataforma/guard.ts`:
   Consulta con service-role la existencia del ID en la tabla `superadmin`.
2. **Desvío en `loginAction` (`app/(auth)/login/actions.ts`)**:
   Tras el éxito de `signInWithPassword`, si el token no contiene `tenant_id`, se invoca `esSuperAdmin(user.id)`.
   - Si es superadmin: `redirect('/plataforma')`.
   - Si no es superadmin ni tiene `tenant_id`: se cierra la sesión y se devuelve `{ ok: false, error: 'Credenciales inválidas' }` (falla cerrado, sin revelar información).
   - Si tiene `tenant_id`: continúa con el flujo normal `redirect('/ventas')`.
3. **Desvío en `AppShellLayout` (`app/(app)/layout.tsx`)**:
   Si un superadmin intenta ingresar directamente a cualquier URL del shell de tenant (`app/(app)/**`), el layout detecta mediante `esSuperAdmin` que se trata de un super admin y lo redirige a `/plataforma` en lugar de rebotarlo en bucle a `/login`.
4. **Ruta sin dependencia de host**:
   El panel se sirve directamente en `/plataforma`, sobre el mismo host, sin requerir subdominios dedicados (`admin.<root>`) ni cambios en `proxy.ts`.

## Alcance del cambio

1. **Base de datos (migración y SPs)**:
   - Tabla `superadmin`: allowlist de IDs de usuarios (`id_auth_user uuid pk -> auth.users(id)`). RLS habilitado, 0 policies, privilegios revocados para `authenticated, anon, public`.
   - Tabla `tenant_cargo`: registro append-only de cargos (`id`, `id_tenant`, `periodo` con check de primer día de mes, `monto > 0`, `concepto`, `created_by not null`, `created_at`, `anulado_at`, `anulado_por`).
   - Tabla `tenant_pago`: registro append-only de pagos (`id`, `id_tenant`, `fecha <= current_date`, `monto > 0`, `medio` catálogo cerrado, `nota`, `created_by not null`, `created_at`, `anulado_at`, `anulado_por`).
   - Vista `tenant_saldo`: vista dinámica `with (security_invoker = on)` que calcula por tenant $\Sigma \text{cargos no anulados} - \Sigma \text{pagos no anulados}$. Nunca se persiste el saldo.
   - Procedimientos almacenados (todos validan que el actor sea superadmin y reciben actor por parámetro explícito, ya que `auth.uid()` con service-role es NULL):
     - `sp_registrar_cargo_tenant(p_id_tenant, p_periodo, p_monto, p_concepto, p_created_by)`
     - `sp_registrar_pago_tenant(p_id_tenant, p_fecha, p_monto, p_medio, p_nota, p_created_by)`
     - `sp_anular_movimiento_tenant(p_tipo, p_id_movimiento, p_anulado_por)`
     - `sp_toggle_tenant_modulo_admin(p_id_tenant, p_paquete, p_habilitado, p_ip, p_actor)`
2. **Capa DAL (`lib/dal/plataforma/`)**:
   - Acceso con service-role condicionado detrás de la guarda `requireSuperAdmin()`.
   - `listarTenants`: consulta consolidada (en una sola query) de tenants, estado, paquetes de módulos habilitados y saldo de cuenta corriente (Design for N).
   - `obtenerTenantDetalle`: información general, módulos y cuenta corriente con historial cronológico de movimientos.
   - Operaciones de mutación: registrar cargo, registrar pago, anular movimiento, toggle de paquete de módulos.
3. **Validación y Server Actions**:
   - `lib/validation/plataforma.ts`: schemas Zod con `strictObject` para cargos, pagos, anulaciones y toggle.
   - Constante de medios de pago en `lib/types/plataforma.ts` sincronizada con CHECK de base de datos.
   - Acciones de servidor en `app/(plataforma)/plataforma/actions.ts` con 3 compuertas (Authorize -> Validate -> DAL).
   - Slugs de error en `lib/errores/mensajes.ts` y cobertura en `lib/errores/mensajes.test.ts`.
4. **Interfaz de usuario**:
   - Grupo de rutas `app/(plataforma)/layout.tsx` con verificación de super admin y shell propio (desconectado del shell de tenant).
   - Pantalla principal `app/(plataforma)/plataforma/page.tsx`: tabla de tenants con búsqueda, estado, paquetes opcionales activos y saldo.
   - Pantalla de detalle `app/(plataforma)/plataforma/[id]/page.tsx`: switches para paquetes opcionales (el núcleo no aparece), resumen de saldo, historial de movimientos y diálogos para nuevo cargo, nuevo pago y anulación.

## Fuera de alcance

- **Alta y baja de usuarios super admin**: La gestión de la allowlist `superadmin` se realiza manualmente por SQL o scripts de consola de infraestructura; no se expone interfaz de usuario ni endpoint para crearse a sí mismo como superadmin.
- **Ruta dedicada `admin.<root>`**: El panel se aloja en `/plataforma` sobre el mismo dominio. La segregación por subdominio exclusivo queda fuera de alcance para no requerir configuración DNS compleja ni tocar `proxy.ts`.
- **Actualización de `AGENTS.md`**: El texto actual de `AGENTS.md` restringe service-role nominalmente a `lib/dal/supabase*.ts`, pero en la práctica el proyecto ya lo utiliza en `lib/dal/administracion`, `lib/dal/session.ts` y `lib/dal/revendedoras`. La sincronización de dicho documento queda como deuda de documentación global para no mezclarla con este cambio.
- **Aplicación del estado de tenant (`tenant.estado_tenant`)**: La columna existe pero ningún módulo la respeta actualmente. Bloquear accesos a tenants suspendidos o archivados se define formalmente como el **siguiente cambio** tras este módulo.
- **Cargos automáticos o facturación recurrente programada**: No se implementan cron jobs ni tareas automáticas de facturación mensual.
- **Precios por módulo o tarifarios automáticos**: Los montos de los cargos se ingresan manualmente por el super admin.
- **Edición física de movimientos**: Corregir un error exige anular el movimiento y generar uno nuevo (append-only estricto).

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Fuga de datos de facturación hacia usuarios de tenants | Crítico | Las tablas `superadmin`, `tenant_cargo`, `tenant_pago` y la vista `tenant_saldo` tienen RLS habilitado sin policies, `security_invoker = on` en la vista, y `REVOKE ALL` explícito a `authenticated` y `anon`. |
| Uso indebido de service-role en el DAL | Crítico | Todo el módulo `lib/dal/plataforma/` está estrictamente encapsulado detrás de `requireSuperAdmin()`. Además, cada SP verifica a nivel base de datos que `p_created_by` / `p_anulado_por` / `p_actor` pertenezca a `superadmin`. |
| Desincronización de paquetes de módulos | Alto | La mutación se realiza exclusivamente por paquete funcional (`sp_toggle_tenant_modulo_admin`) delegando en los triggers de `modulos-opcionales` (PR 1). |
| Inconsistencia de saldos por concurrencia | Alto | El saldo nunca se almacena como columna; se deriva en tiempo de consulta mediante la vista `tenant_saldo` sumando y restando movimientos válidos. |
