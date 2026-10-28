# Spec — super-admin-plataforma / plataforma

**Change**: `super-admin-plataforma` · **Requisitos**: `REQ-SA-01…08` · **Decisiones**: `DR-SA-01…05`

## Decisiones de diseño

### DR-SA-01 — DAL de plataforma con service-role vs SPs DEFINER `[REQUIERE OK HUMANO]`

Para las operaciones del módulo de plataforma, el usuario super admin no pertenece a ningún tenant y gestiona entidades globales (`tenant`, `tenant_cargo`, `tenant_pago`, `superadmin`).

- **Opción A (Recomendada): `lib/dal/plataforma/` utiliza `service-role` detrás de `requireSuperAdmin()`.**
  - *Tradeoffs*: Requiere una excepción explícita a la regla de `AGENTS.md` (que hoy restringe service-role a `lib/dal/supabase*.ts`, scripts y tests). A cambio, permite componer consultas agregadas eficientes para el listado global (unir `tenant`, `tenant_modulo` y `tenant_saldo` en una sola query de PostgREST, cumpliendo "Design for N") sin necesidad de crear vistas o funciones DEFINER adicionales para cada variante de lectura. La barrera de seguridad reside en la compuerta Server-Side `requireSuperAdmin()`.
- **Opción B: Funciones y vistas en base de datos con `SECURITY DEFINER` y validación interna de `superadmin`.**
  - *Tradeoffs*: Mantiene la restricción estricta de `AGENTS.md` utilizando el cliente autenticado regular. La seguridad se valida dentro de cada SP (`if not exists (select 1 from superadmin where id_auth_user = auth.uid()) then raise exception 'no-permission'`). Sin embargo, obliga a escribir vistas o funciones DEFINER específicas para cada consulta de lectura y reporte, aumentando la superficie de código PL/pgSQL con privilegios elevados.
- **Recomendación**: Adoptar la **Opción A**. Es el mismo patrón utilizado en `scripts/provision-tenant.mts` y en las lecturas de contexto en `lib/dal/session.ts:134-155`. La verificación obligatoria de `requireSuperAdmin()` al inicio de cada función del DAL garantiza que ninguna llamada no autorizada ejecute operaciones con service-role.

### DR-SA-02 — Mecanismo de autenticación e ingreso del super admin `[REQUIERE OK HUMANO]`

El análisis del flujo actual reveló que un usuario en `auth.users` sin fila en `public.usuario` obtiene un JWT válido pero sin el claim `tenant_id`, lo que hace que `AppShellLayout` falle cerrado y lo redirija en bucle a `/login`.

- **Decisión**: Modificar `app/(auth)/login/actions.ts` con el menor cambio posible:
  1. Si `signInWithPassword` es exitoso pero el token no contiene `tenant_id`, se consulta si el `user.id` existe en la tabla `superadmin`.
  2. Si existe en `superadmin`, se redirige inmediatamente a `/plataforma`.
  3. Si no existe en `superadmin` ni tiene `tenant_id`, se cierra la sesión y se devuelve un error genérico (`Credenciales inválidas`), previniendo fugas sobre la existencia del usuario.
  4. Los usuarios normales de tenant con `tenant_id` continúan con su redirección habitual a `/ventas`.

### DR-SA-03 — Cuenta corriente append-only (anulación sin UPDATE/DELETE)

- **Decisión**: Las tablas `tenant_cargo` y `tenant_pago` son de registro inmutable. Un cargo o pago registrado erróneamente no se edita ni se elimina físicamente; se anula mediante `sp_anular_movimiento_tenant`, registrando `anulado_at` (marca de tiempo) y `anulado_por` (identificador del super admin).
- *Motivación*: Preserva la trazabilidad y la integridad de auditoría contable.

### DR-SA-04 — Saldo derivado en vista dinámica `tenant_saldo`

- **Decisión**: El saldo de cada tenant nunca se almacena en una columna persistida. Se calcula en tiempo de consulta mediante la vista SQL `tenant_saldo`:
  $$\text{saldo} = \sum(\text{cargos activos}) - \sum(\text{pagos activos})$$
- *Motivación*: Elimina por completo condiciones de carrera, bloqueos y desincronizaciones de saldo ante registros o anulaciones concurrentes.

### DR-SA-05 — Alternar módulos para un tenant específico (`sp_toggle_tenant_modulo_admin`)

- **Decisión**: Dado que `sp_toggle_tenant_modulo` (00086:224) resuelve el tenant desde el JWT (`auth_tenant_id()`) y carece de parámetro `p_id_tenant`, para el super admin se creará el procedimiento `sp_toggle_tenant_modulo_admin(p_id_tenant uuid, p_id_modulo uuid, p_habilitado boolean, p_ip inet default null)`.
- *Comportamiento*: Reutiliza la misma lógica de negocio: upsert en `tenant_modulo`, siembra de la regla local 0% al activar `revendedoras` si no existía, y registro en `auditoria` con el `id_tenant` destino y el `id_usuario` del super admin.

---

## 1. Requisitos

### REQ-SA-01 — Identidad y autorización de super admin

El sistema MUST identificar fehacientemente al super admin mediante la tabla `superadmin(id_auth_user)` y bloquear cualquier acceso al panel de plataforma o sus acciones a usuarios que no figuren en dicha lista.

- **Feliz**: Usuario autenticado cuyo `auth.uid()` existe en `superadmin` llama a `requireSuperAdmin()` → validación exitosa, retorna identidad `{ id, email }`.
- **N1**: Usuario no autenticado (sin sesión ni JWT) → rechazo con error/slug `no-session`.
- **N2**: Usuario autenticado perteneciente a un tenant (operador o administrador de tenant) intenta acceder → rechazo con slug `no-permission`.
- **N3**: Usuario con rol revendedora intenta acceder → rechazo con slug `no-permission`.
- **N4**: Usuario autenticado en Supabase Auth pero que no existe en `usuario` ni en `superadmin` → rechazo con slug `no-permission`.

### REQ-SA-02 — Listado consolidado de tenants

El sistema MUST listar todos los tenants registrados en la plataforma con su nombre, subdominio, estado, módulos habilitados agregados y saldo actual de cuenta corriente, resolviendo la información en una única consulta de base de datos ("Design for N").

- **Feliz**: Super admin accede a `/plataforma` → se muestra la tabla completa de tenants con módulos activos y saldo calculado correctamente.
- **N1**: Actor sin privilegios de super admin invoca el listado → rechazo con slug `no-permission`.
- **N2**: Tenant sin movimientos de cuenta corriente → se lista con saldo `$0.00`.

### REQ-SA-03 — Habilitación y deshabilitación de módulos de un tenant

El super admin MUST poder activar o desactivar módulos opcionales para un tenant determinado. La operación MUST actualizar `tenant_modulo`, sembrar configuraciones iniciales requeridas y registrar auditoría.

- **Feliz**: Super admin activa el módulo `revendedoras` para el Tenant A → `tenant_modulo` queda con `habilitado = true`, se siembra la regla local de comisión (0%) y se registra la auditoría.
- **N1**: Actor sin privilegios de super admin intenta modificar módulos → rechazo con slug `no-permission`.
- **N2**: Tenant inexistente (`p_id_tenant` no encontrado en tabla `tenant`) → rechazo con slug `tenant-inexistente`.
- **N3**: Módulo inexistente (`p_id_modulo` no encontrado en tabla `modulo`) → rechazo con slug `modulo-invalido`.
- **N4**: Intento de deshabilitar un módulo del núcleo del sistema (si las restricciones de `modulos-opcionales` aplican) → rechazo con slug `modulo-nucleo`.

### REQ-SA-04 — Registro de cargo a tenant

El sistema MUST permitir registrar un cargo en la cuenta corriente de un tenant indicando período, monto estrictamente positivo y concepto.

- **Feliz**: Super admin registra un cargo de `$25,000.00` para el período `2026-11-01` con concepto "Abono mensual Plan Base" para el Tenant A → se inserta en `tenant_cargo`, y el saldo deudor del tenant aumenta en `$25,000.00`.
- **N1**: Monto menor o igual a cero (`monto <= 0`) → rechazo con slug `monto-invalido`.
- **N2**: Tenant inexistente → rechazo con slug `tenant-inexistente`.
- **N3**: Concepto vacío o compuesto solo por espacios en blanco → rechazo con slug `concepto-invalido`.
- **N4**: Período con formato de fecha inválido → rechazo con slug `fecha-invalida`.
- **N5**: Actor sin privilegios de super admin → rechazo con slug `no-permission`.

### REQ-SA-05 — Registro de pago de tenant

El sistema MUST permitir registrar un pago efectuado por un tenant indicando fecha de cobro, monto estrictamente positivo, medio de pago y nota opcional.

- **Feliz**: Super admin registra un pago de `$25,000.00` con fecha `2026-11-05`, medio "transferencia" y nota "Comprobante 44912" para el Tenant A → se inserta en `tenant_pago`, y el saldo deudor del tenant disminuye en `$25,000.00`.
- **N1**: Monto menor o igual a cero (`monto <= 0`) → rechazo con slug `monto-invalido`.
- **N2**: Tenant inexistente → rechazo con slug `tenant-inexistente`.
- **N3**: Medio de pago vacío o no reconocido → rechazo con slug `medio-pago-invalido`.
- **N4**: Fecha con formato inválido o futura no razonable → rechazo con slug `fecha-invalida`.
- **N5**: Actor sin privilegios de super admin → rechazo con slug `no-permission`.

### REQ-SA-06 — Anulación de movimiento de cuenta corriente

El sistema MUST permitir anular un cargo o un pago previamente registrado, estampando la fecha de anulación y el usuario que anuló, sin alterar importes históricos ni eliminar registros.

- **Feliz**: Super admin anula el cargo con ID `X` → el movimiento pasa a tener `anulado_at = now()` y `anulado_por = auth.uid()`. El saldo del tenant se recalcula instantáneamente restando el cargo anulado.
- **N1**: Movimiento inexistente en `tenant_cargo` o `tenant_pago` → rechazo con slug `movimiento-inexistente`.
- **N2**: Movimiento que ya se encontraba anulado previamente → rechazo con slug `movimiento-ya-anulado`.
- **N3**: Tipo de movimiento no admitido (distinto de `'cargo'` o `'pago'`) → rechazo con slug `tipo-movimiento-invalido`.
- **N4**: Actor sin privilegios de super admin → rechazo con slug `no-permission`.

### REQ-SA-07 — Historial de cuenta corriente y saldo

El sistema MUST presentar en la ficha del tenant el historial cronológico unificado de cargos y pagos (ordenados descendentemente por fecha/período), indicando su estado (vigente o anulado) y el saldo consolidado neto.

- **Feliz**: Consulta de detalle del Tenant A que posee un cargo de `$20,000.00` (vigente), un cargo de `$5,000.00` (anulado) y un pago de `$15,000.00` (vigente) → muestra los 3 movimientos en el historial y un saldo neto deudor de `$5,000.00`.
- **N1**: Tenant inexistente → rechazo con slug `tenant-inexistente`.
- **N2**: Actor sin privilegios de super admin → rechazo con slug `no-permission`.

### REQ-SA-08 — Aislamiento estricto de plataforma

Ningún usuario autenticado perteneciente a un tenant (`authenticated`), ni revendedora, ni usuario anónimo (`anon`) MUST poder leer, insertar, modificar o eliminar registros en las tablas de plataforma (`superadmin`, `tenant_cargo`, `tenant_pago`), ni consultar la vista `tenant_saldo`, ni ejecutar los procedimientos almacenados de plataforma.

- **Feliz**: Consulta o mutación ejecutada desde el DAL de plataforma con credenciales de service-role tras validar `requireSuperAdmin()` → operación permitida.
- **N1**: Usuario autenticado del Tenant A intenta hacer `SELECT` o `INSERT` en `tenant_cargo` vía PostgREST con su token JWT → rechazo con código `42501` o retorno de 0 filas (RLS activa sin policies y privilegios revocados).
- **N2**: Usuario autenticado del Tenant A intenta ejecutar `sp_registrar_cargo_tenant` vía RPC con su token JWT → rechazo `permission denied for function sp_registrar_cargo_tenant`.
- **N3**: Usuario anónimo intenta consultar `superadmin` o `tenant_saldo` → rechazo de permisos.
- **N4**: Revendedora intenta acceder a cualquier tabla o función de plataforma → rechazo de permisos.

---

## 2. Matriz de permisos

| Objeto / Función | Super Admin (Service Role) | Operador del tenant | Revendedora | Anon / Público |
| --- | --- | --- | --- | --- |
| `tabla superadmin` | select / insert / delete | 0 filas / denegado | 0 filas / denegado | denegado |
| `tabla tenant_cargo` | select / insert / update | 0 filas / denegado | 0 filas / denegado | denegado |
| `tabla tenant_pago` | select / insert / update | 0 filas / denegado | 0 filas / denegado | denegado |
| `vista tenant_saldo` | select | 0 filas / denegado | 0 filas / denegado | denegado |
| `sp_registrar_cargo_tenant` | execute | denegado (revoke) | denegado (revoke) | denegado (revoke) |
| `sp_registrar_pago_tenant` | execute | denegado (revoke) | denegado (revoke) | denegado (revoke) |
| `sp_anular_movimiento_tenant` | execute | denegado (revoke) | denegado (revoke) | denegado (revoke) |
| `sp_toggle_tenant_modulo_admin` | execute | denegado (revoke) | denegado (revoke) | denegado (revoke) |

---

## 3. Cifras financieras

| Cifra | Fecha del evento que la imputa | Criterio | Fuente |
| --- | --- | --- | --- |
| `monto_cargo` | `periodo` (fecha del mes de facturación del servicio) | Devengado. Suma a la deuda del tenant. Solo cargos con `anulado_at IS NULL`. | `tenant_cargo` |
| `monto_pago` | `fecha` (fecha de cobro efectivo registrado) | Percibido. Resta a la deuda del tenant. Solo pagos con `anulado_at IS NULL`. | `tenant_pago` |
| `saldo` (deuda del tenant) | Dinámica (al momento de la consulta) | $\sum(\text{cargos vigentes}) - \sum(\text{pagos vigentes})$. Saldo $> 0$: deuda exigible. Saldo $= 0$: al día. Saldo $< 0$: saldo a favor del tenant. | `vista tenant_saldo` |

---

## 4. INVOKER contra RLS restrictiva

Las tablas de plataforma no pertenecen a ningún tenant (`id_tenant` es una clave foránea que apunta a `tenant.id_tenant`, pero las tablas no están particionadas por el JWT del usuario de la sesión).

- **Aislamiento por diseño**:
  - `superadmin`, `tenant_cargo` y `tenant_pago` tienen `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
  - **No** se crea ninguna policy para `authenticated` ni para `anon`. Por definición de Postgres, RLS habilitado sin policies deniega todo acceso por defecto a usuarios no-superusuarios.
  - Adicionalmente, se ejecuta `REVOKE ALL ON ... FROM authenticated, anon, public` para cortar el acceso a nivel privilegio antes de evaluar RLS.
- **Acceso exclusivo**:
  - Las lecturas y escrituras del módulo se realizan a través de `lib/dal/plataforma/` utilizando el cliente administrativo `createServiceClient()` (service-role), el cual bypasses RLS por diseño.
  - La protección de acceso está 100% garantizada en la capa de aplicación por `requireSuperAdmin()`, ejecutada obligatoriamente en Server Components y Server Actions.

---

## 5. Migraciones

- Número: siguiente libre al momento de aplicar (`supabase/migrations/00118_super_admin_plataforma.sql`).
- Contenido:
  1. Tabla `superadmin` (`id_auth_user uuid primary key references auth.users(id) on delete cascade`, `created_at timestamptz not null default now()`).
  2. Tabla `tenant_cargo` (`id uuid primary key default gen_random_uuid()`, `id_tenant uuid not null references tenant(id_tenant) on delete cascade`, `periodo date not null`, `monto numeric(12,2) not null check (monto > 0)`, `concepto text not null`, `created_by uuid references auth.users(id)`, `created_at timestamptz not null default now()`, `anulado_at timestamptz`, `anulado_por uuid references auth.users(id)`, check de anulación coherente).
  3. Tabla `tenant_pago` (`id uuid primary key default gen_random_uuid()`, `id_tenant uuid not null references tenant(id_tenant) on delete cascade`, `fecha date not null`, `monto numeric(12,2) not null check (monto > 0)`, `medio text not null`, `nota text`, `created_by uuid references auth.users(id)`, `created_at timestamptz not null default now()`, `anulado_at timestamptz`, `anulado_por uuid references auth.users(id)`, check de anulación coherente).
  4. Vista `tenant_saldo`:
     ```sql
     create or replace view tenant_saldo as
     select
       t.id_tenant,
       coalesce(c.total_cargos, 0) - coalesce(p.total_pagos, 0) as saldo,
       coalesce(c.total_cargos, 0) as total_cargos,
       coalesce(p.total_pagos, 0) as total_pagos
     from tenant t
     left join (
       select id_tenant, sum(monto) as total_cargos
       from tenant_cargo
       where anulado_at is null
       group by id_tenant
     ) c on c.id_tenant = t.id_tenant
     left join (
       select id_tenant, sum(monto) as total_pagos
       from tenant_pago
       where anulado_at is null
       group by id_tenant
     ) p on p.id_tenant = t.id_tenant;
     ```
  5. SPs:
     - `sp_registrar_cargo_tenant(p_id_tenant, p_periodo, p_monto, p_concepto, p_created_by)`
     - `sp_registrar_pago_tenant(p_id_tenant, p_fecha, p_monto, p_medio, p_nota, p_created_by)`
     - `sp_anular_movimiento_tenant(p_tipo, p_id_movimiento, p_anulado_por)`
     - `sp_toggle_tenant_modulo_admin(p_id_tenant, p_id_modulo, p_habilitado, p_ip)`
  6. RLS habilitado en las tres tablas.
  7. `REVOKE ALL` de tablas, vista y funciones para `authenticated, anon, public`.
- Bloque `-- DOWN:` ejecutable completo con `drop function`, `drop view` y `drop table` en orden inverso de dependencias.
