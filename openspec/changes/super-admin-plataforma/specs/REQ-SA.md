# Spec — super-admin-plataforma / plataforma

**Change**: `super-admin-plataforma` · **Requisitos**: `REQ-SA-01…08` · **Decisiones**: `DR-SA-01…05`

## Decisiones de diseño

### DR-SA-01 — DAL de plataforma con service-role vs SPs DEFINER
**Estado**: aprobada por la persona el 2026-10-28 (Opción A).

Para las operaciones del módulo de plataforma, el usuario super admin no pertenece a ningún tenant y gestiona entidades globales (`tenant`, `tenant_cargo`, `tenant_pago`, `superadmin`).

- **Decisión adoptada (Opción A)**: `lib/dal/plataforma/` utiliza el cliente con `service-role` (`createServiceClient()`) detrás de la compuerta Server-Side `requireSuperAdmin()`.
- **Justificación**: Se constató que el uso de `createServiceClient()` dentro de `lib/dal/` no constituye una excepción inédita: la base de código ya lo utiliza legítimamente en `lib/dal/administracion/acceso.ts`, `lib/dal/session.ts:134` (resolución de permisos de revendedoras ante RLS restrictiva) y `lib/dal/revendedoras/`. La regla de `AGENTS.md` que nominalmente lo limita a `lib/dal/supabase*.ts` está desactualizada en el repositorio y se registrará para futura corrección.
- **Seguridad**: Se aplica defensa en profundidad: la compuerta de aplicación `requireSuperAdmin()` valida la sesión antes de acceder al DAL, y cada procedimiento almacenado valida a nivel base de datos que el actor recibido por parámetro figure en la tabla `superadmin`.

### DR-SA-02 — Mecanismo de autenticación e ingreso del super admin
**Estado**: aprobada por la persona el 2026-10-28 (con helper `esSuperAdmin` y desvío de rutas).

El análisis del flujo actual reveló que un usuario en `auth.users` sin fila en `public.usuario` obtiene un JWT válido pero sin el claim `tenant_id`, lo que hace que `AppShellLayout` falle cerrado y lo redirija en bucle a `/login`.

- **Decisión**:
  1. Se implementa el helper `esSuperAdmin(idUsuario: string): Promise<boolean>` en `lib/dal/plataforma/guard.ts` que consulta la tabla `superadmin` mediante service-role.
  2. En `app/(auth)/login/actions.ts`, tras el éxito de `signInWithPassword`, si el token no contiene `tenant_id`:
     - Se invoca `esSuperAdmin(user.id)`.
     - Si es superadmin: `redirect('/plataforma')`.
     - Si no es superadmin ni tiene `tenant_id`: se cierra la sesión en Supabase Auth y se retorna `{ ok: false, error: 'Credenciales inválidas' }` (falla cerrado, sin filtrar existencia).
     - Si tiene `tenant_id`: continúa con el flujo habitual `redirect('/ventas')`.
  3. En `app/(app)/layout.tsx`, si un usuario autenticado carece de `tenant_id`, antes de expulsarlo a `/login` se verifica con `esSuperAdmin`: si es super admin, se redirige a `/plataforma` (REQ-SA-01 N5).

### DR-SA-03 — Cuenta corriente append-only (anulación sin UPDATE/DELETE)
**Estado**: aprobada por la persona el 2026-10-28.

- **Decisión**: Las tablas `tenant_cargo` y `tenant_pago` son de registro inmutable. Un cargo o pago registrado erróneamente no se edita ni se elimina físicamente; se anula mediante `sp_anular_movimiento_tenant`.
- **Identidad**: Dado que las operaciones corren con `service-role` donde `auth.uid()` es `NULL`, las columnas de auditoría `created_by` y `anulado_por` son `NOT NULL` (para filas anuladas) y se reciben como parámetros obligatorios (`p_created_by`, `p_anulado_por`). Cada SP verifica que dicho identificador pertenezca a la allowlist `superadmin`.

### DR-SA-04 — Saldo derivado en vista dinámica `tenant_saldo` con `security_invoker = on`
**Estado**: aprobada por la persona el 2026-10-28.

- **Decisión**: El saldo de cada tenant nunca se almacena en una columna persistida. Se calcula en tiempo de consulta mediante la vista SQL `tenant_saldo`:
  $$\text{saldo} = \sum(\text{cargos vigentes}) - \sum(\text{pagos vigentes})$$
  La vista se define explícitamente `with (security_invoker = on)` (siguiendo el estándar de `00028_reportes.sql:18`) para que respete las políticas de RLS del caller y no se ejecute con privilegios de definidor.

### DR-SA-05 — Habilitación de módulos por paquete funcional
**Estado**: aprobada por la persona el 2026-10-28.

- **Decisión**: Los módulos se habilitan o deshabilitan por **paquete completo** mediante el procedimiento:
  `sp_toggle_tenant_modulo_admin(p_id_tenant, p_paquete, p_habilitado, p_ip, p_actor)`
- **Paquetes admitidos**: Los definidos en `REQ-MODOP`:
  - `'revendedoras'`: código `'revendedoras'`.
  - `'consignacionProveedor'`: códigos `'consignaciones'` y `'rendiciones'` en conjunto.
- **Comportamiento**:
  - Habilita o deshabilita todos los códigos del paquete en una única transacción atómica.
  - La siembra de la regla local de comisión (0%) al activar revendedoras y el registro de auditoría se copian de `supabase/migrations/00086_comisiones.sql:241-267`.
  - Delega en los triggers de `modulos-opcionales` (PR 1) las restricciones de integridad (núcleo inmutable, consistencia de a par y bloqueo por estado vivo). La UI del super admin no expone los módulos del núcleo como toggles.

---

## 1. Requisitos

### REQ-SA-01 — Identidad y autorización de super admin

El sistema MUST identificar fehacientemente al super admin mediante la tabla `superadmin(id_auth_user)` y bloquear cualquier acceso al panel de plataforma o sus acciones a usuarios que no figuren en dicha lista.

- **Feliz**: Usuario autenticado cuyo `id` existe en `superadmin` llama a `requireSuperAdmin()` → validación exitosa, retorna identidad `{ id, email }`.
- **N1**: Usuario no autenticado (sin sesión ni JWT) → rechazo con slug `no-session`.
- **N2**: Usuario autenticado perteneciente a un tenant (operador o administrador) intenta acceder a `/plataforma/**` → rechazo con slug `no-permission`.
- **N3**: Usuario con rol revendedora intenta acceder a `/plataforma/**` → rechazo con slug `no-permission`.
- **N4**: Usuario autenticado en Supabase Auth pero que no existe en `usuario` ni en `superadmin` → rechazo con slug `no-permission`.
- **N5**: Super admin autenticado que navega a cualquier ruta de tenant (`app/(app)/**`) → `AppShellLayout` lo detecta mediante `esSuperAdmin` y lo redirige a `/plataforma` en lugar de generar un bucle hacia `/login`.

### REQ-SA-02 — Listado consolidado de tenants

El sistema MUST listar todos los tenants registrados en la plataforma con su nombre, subdominio, estado, paquetes de módulos habilitados y saldo actual de cuenta corriente, resolviendo la información en una única consulta de base de datos ("Design for N").

- **Feliz**: Super admin accede a `/plataforma` → se muestra la tabla completa de tenants con módulos activos y saldo calculado correctamente.
- **N1**: Actor sin privilegios de super admin invoca el listado → rechazo con slug `no-permission`.
- **N2**: Tenant sin movimientos de cuenta corriente → se lista con saldo `$0.00`.

### REQ-SA-03 — Toggle de módulos por paquete funcional

El super admin MUST poder activar o desactivar paquetes opcionales completos para un tenant determinado. La operación MUST actualizar `tenant_modulo` para todos los códigos del paquete atómicamente, sembrar configuraciones requeridas si aplica, y registrar auditoría.

- **Feliz**: Super admin activa el paquete `'revendedoras'` para el Tenant A pasando `p_actor` válido → `tenant_modulo` actualiza el código `'revendedoras'` a `habilitado = true`, se siembra la regla local de comisión (0%) según `00086_comisiones.sql:241-260` y se registra la auditoría.
- **N1**: Actor `p_actor` no pertenece a `superadmin` o es inválido → rechazo con slug `no-permission`.
- **N2**: Tenant inexistente (`p_id_tenant` no encontrado en `tenant`) → rechazo con slug `tenant-inexistente`.
- **N3**: Paquete inexistente (valor no admitido en el catálogo de paquetes opcionales) → rechazo con slug `paquete-invalido`.
- **N4**: Intento de alterar un módulo perteneciente al núcleo del sistema → rechazo con slug `modulo-nucleo` (disparado por trigger de `modulos-opcionales`).
- **N5**: Intento de apagar un paquete opcional que posee estado vivo (ítems en consignación, deuda de terceros o liquidaciones abiertas) → rechazo con slug `modulo-con-estado-vivo` (disparado por trigger de `modulos-opcionales`).

### REQ-SA-04 — Registro de cargo a tenant

El sistema MUST permitir registrar un cargo en la cuenta corriente de un tenant indicando período (truncado estrictamente a primer día de mes), monto positivo, concepto y actor responsable.

- **Feliz**: Super admin registra un cargo de `$25,000.00` para el período `2026-11-01` con concepto "Abono mensual Plan Base" indicando `p_created_by` válido → se inserta en `tenant_cargo`, y el saldo deudor del tenant aumenta en `$25,000.00`.
- **N1**: Monto menor o igual a cero (`monto <= 0`) → rechazo con slug `monto-invalido`.
- **N2**: Tenant inexistente → rechazo con slug `tenant-inexistente`.
- **N3**: Concepto vacío o compuesto solo por espacios en blanco → rechazo con slug `concepto-invalido`.
- **N4**: Período que no coincide con el primer día del mes (`periodo != date_trunc('month', periodo)::date`) o fecha inválida → rechazo con slug `periodo-invalido`.
- **N5**: Actor `p_created_by` ausente en `superadmin` → rechazo con slug `no-permission`.

### REQ-SA-05 — Registro de pago de tenant

El sistema MUST permitir registrar un pago efectuado por un tenant indicando fecha (menor o igual a la fecha actual), monto positivo, medio de pago perteneciente al catálogo cerrado, nota opcional y actor responsable.

- **Feliz**: Super admin registra un pago de `$25,000.00` con fecha `2026-10-28` (`<= current_date`), medio `'transferencia'`, nota "Comprobante 44912" y `p_created_by` válido para el Tenant A → se inserta en `tenant_pago`, y el saldo deudor disminuye en `$25,000.00`.
- **N1**: Monto menor o igual a cero (`monto <= 0`) → rechazo con slug `monto-invalido`.
- **N2**: Tenant inexistente → rechazo con slug `tenant-inexistente`.
- **N3**: Medio de pago fuera del catálogo cerrado (`'transferencia'`, `'efectivo'`, `'mercadopago'`, `'otro'`) → rechazo con slug `medio-pago-invalido`.
- **N4**: Fecha futura (`fecha > current_date`) o formato inválido → rechazo con slug `fecha-invalida`.
- **N5**: Actor `p_created_by` ausente en `superadmin` → rechazo con slug `no-permission`.

### REQ-SA-06 — Anulación de movimiento de cuenta corriente

El sistema MUST permitir anular un cargo o un pago previamente registrado, estampando la fecha de anulación y el usuario responsable (`anulado_por NOT NULL`), sin alterar importes históricos ni eliminar registros.

- **Feliz**: Super admin anula el cargo con ID `X` pasando `p_anulado_por` válido → el registro se actualiza con `anulado_at = now()` y `anulado_por = p_anulado_por`. El saldo del tenant se recalcula instantáneamente excluyendo el movimiento.
- **N1**: Movimiento inexistente en `tenant_cargo` o `tenant_pago` → rechazo con slug `movimiento-inexistente`.
- **N2**: Movimiento que ya se encontraba anulado previamente → rechazo con slug `movimiento-ya-anulado`.
- **N3**: Tipo de movimiento no admitido (distinto de `'cargo'` o `'pago'`) → rechazo con slug `tipo-movimiento-invalido`.
- **N4**: Actor `p_anulado_por` ausente en `superadmin` → rechazo con slug `no-permission`.

### REQ-SA-07 — Historial de cuenta corriente y saldo

El sistema MUST presentar en la ficha del tenant el historial cronológico unificado de cargos y pagos (ordenados descendentemente por fecha/período), indicando su estado (vigente o anulado) y el saldo consolidado neto.

- **Feliz**: Consulta de detalle del Tenant A que posee un cargo vigente de `$20,000.00`, un cargo anulado de `$5,000.00` y un pago vigente de `$15,000.00` → muestra los 3 movimientos en el historial y un saldo neto deudor de `$5,000.00`.
- **N1**: Tenant inexistente → rechazo con slug `tenant-inexistente`.
- **N2**: Actor sin privilegios de super admin → rechazo con slug `no-permission`.

### REQ-SA-08 — Aislamiento estricto de plataforma

Ningún usuario autenticado perteneciente a un tenant (`authenticated`), ni revendedora, ni usuario anónimo (`anon`) MUST poder leer, insertar, modificar o eliminar registros en las tablas de plataforma (`superadmin`, `tenant_cargo`, `tenant_pago`), ni consultar la vista `tenant_saldo`, ni ejecutar los procedimientos almacenados de plataforma.

- **Feliz**: Operación ejecutada desde el DAL de plataforma con credenciales de service-role tras validar `requireSuperAdmin()` → permitida.
- **N1**: Usuario autenticado del Tenant A intenta hacer `SELECT` o `INSERT` en `tenant_cargo` vía PostgREST con su JWT → denegado por RLS (0 filas) y privilegios revocados (`permission denied`).
- **N2**: Usuario autenticado del Tenant A intenta ejecutar `sp_registrar_cargo_tenant` vía RPC con su JWT → rechazo `permission denied for function sp_registrar_cargo_tenant`.
- **N3**: Usuario anónimo intenta consultar `superadmin` o `tenant_saldo` → denegado.
- **N4**: Revendedora intenta acceder a cualquier tabla, vista o SP de plataforma → denegado.

---

## 2. Matriz de permisos

| Objeto / Función | Super Admin (Service Role) | Operador del tenant | Revendedora | Anon / Público |
| --- | --- | --- | --- | --- |
| `tabla superadmin` | select / insert / delete | 0 filas / denegado | 0 filas / denegado | denegado |
| `tabla tenant_cargo` | select / insert / update | 0 filas / denegado | 0 filas / denegado | denegado |
| `tabla tenant_pago` | select / insert / update | 0 filas / denegado | 0 filas / denegado | denegado |
| `vista tenant_saldo` (`security_invoker = on`) | select | 0 filas / denegado | 0 filas / denegado | denegado |
| `sp_registrar_cargo_tenant` | execute | denegado (revoke) | denegado (revoke) | denegado (revoke) |
| `sp_registrar_pago_tenant` | execute | denegado (revoke) | denegado (revoke) | denegado (revoke) |
| `sp_anular_movimiento_tenant` | execute | denegado (revoke) | denegado (revoke) | denegado (revoke) |
| `sp_toggle_tenant_modulo_admin` | execute | denegado (revoke) | denegado (revoke) | denegado (revoke) |

---

## 3. Cifras financieras

| Cifra | Fecha del evento que la imputa | Criterio | Fuente |
| --- | --- | --- | --- |
| `monto_cargo` | `periodo` (truncado a primer día de mes `date_trunc('month', periodo)::date`) | Devengado. Suma a la deuda del tenant. Solo cargos con `anulado_at IS NULL`. | `tenant_cargo` |
| `monto_pago` | `fecha` (fecha efectiva `<= current_date`) | Percibido. Resta a la deuda del tenant. Solo pagos con `anulado_at IS NULL`. | `tenant_pago` |
| `saldo` (deuda del tenant) | Dinámica (al momento de la consulta) | $\sum(\text{cargos vigentes}) - \sum(\text{pagos vigentes})$. Saldo $> 0$: deuda exigible. Saldo $= 0$: al día. Saldo $< 0$: saldo a favor del tenant. | `vista tenant_saldo` |

---

## 4. INVOKER contra RLS restrictiva y seguridad de vistas

Las tablas de plataforma no pertenecen a ningún tenant (`id_tenant` es una clave foránea referencial hacia `tenant`, pero no se aíslan por claim de sesión de tenant).

### Por qué la vista `tenant_saldo` requiere `with (security_invoker = on)`
Por defecto en PostgreSQL, las vistas se ejecutan con los privilegios de su creador/propietario (`security_definer` implícito). Si `tenant_saldo` se creara sin `security_invoker = on`, cualquier usuario con permiso de lectura sobre la vista podría consultar indirectamente los saldos de todos los tenants, salteándose por completo las restricciones RLS de las tablas subyacentes `tenant_cargo` y `tenant_pago`.

Al declarar explícitamente `with (security_invoker = on)` (como se implementó en `00028_reportes.sql:18`):
1. Cada `SELECT` sobre `tenant_saldo` evalúa las políticas de RLS utilizando la identidad y permisos del invocador (`caller`).
2. Dado que `tenant_cargo` y `tenant_pago` tienen RLS activado sin ninguna policy para `authenticated` ni `anon`, cualquier invocación proveniente de un usuario regular o revendedora devuelve 0 filas o es denegada en las tablas base.
3. Se agrega `REVOKE ALL ON tenant_saldo FROM authenticated, anon, public` para cortar el acceso a nivel privilegio.

---

## 5. Migraciones

- Número: siguiente libre al momento de aplicar (`supabase/migrations/00118_super_admin_plataforma.sql`).
- Contenido:
  1. Tabla `superadmin` (`id_auth_user uuid primary key references auth.users(id) on delete cascade`, `created_at timestamptz not null default now()`).
  2. Tabla `tenant_cargo`:
     - `id uuid primary key default gen_random_uuid()`
     - `id_tenant uuid not null references tenant(id_tenant) on delete cascade`
     - `periodo date not null check (periodo = date_trunc('month', periodo)::date)`
     - `monto numeric(12,2) not null check (monto > 0)`
     - `concepto text not null check (trim(concepto) <> '')`
     - `created_by uuid not null references auth.users(id)`
     - `created_at timestamptz not null default now()`
     - `anulado_at timestamptz`
     - `anulado_por uuid references auth.users(id)`
     - `check ((anulado_at is null and anulado_por is null) or (anulado_at is not null and anulado_por is not null))`
  3. Tabla `tenant_pago`:
     - `id uuid primary key default gen_random_uuid()`
     - `id_tenant uuid not null references tenant(id_tenant) on delete cascade`
     - `fecha date not null check (fecha <= current_date)`
     - `monto numeric(12,2) not null check (monto > 0)`
     - `medio text not null check (medio in ('transferencia', 'efectivo', 'mercadopago', 'otro'))`
     - `nota text`
     - `created_by uuid not null references auth.users(id)`
     - `created_at timestamptz not null default now()`
     - `anulado_at timestamptz`
     - `anulado_por uuid references auth.users(id)`
     - `check ((anulado_at is null and anulado_por is null) or (anulado_at is not null and anulado_por is not null))`
  4. Vista `tenant_saldo`:
     ```sql
     create or replace view tenant_saldo
     with (security_invoker = on) as
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
     - `sp_registrar_cargo_tenant(p_id_tenant uuid, p_periodo date, p_monto numeric, p_concepto text, p_created_by uuid)`
     - `sp_registrar_pago_tenant(p_id_tenant uuid, p_fecha date, p_monto numeric, p_medio text, p_nota text, p_created_by uuid)`
     - `sp_anular_movimiento_tenant(p_tipo text, p_id_movimiento uuid, p_anulado_por uuid)`
     - `sp_toggle_tenant_modulo_admin(p_id_tenant uuid, p_paquete text, p_habilitado boolean, p_ip inet default null, p_actor uuid default null)`
  6. RLS habilitado en `superadmin`, `tenant_cargo`, `tenant_pago`.
  7. `REVOKE ALL` de tablas, vista y funciones para `authenticated, anon, public`.
- Bloque `-- DOWN:` ejecutable completo con `drop function`, `drop view` y `drop table` en orden inverso de dependencias.
