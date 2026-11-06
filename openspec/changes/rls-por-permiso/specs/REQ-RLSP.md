# Spec — rls-por-permiso / rls-policies-por-permiso

**Change**: `rls-por-permiso` · **Requisitos**: `REQ-RLSP-01…06` · **Decisiones**: `DR-RLSP-01…03` (Cerradas)

Este documento especifica la infraestructura de autorización en base de datos para Utopía (Fase 2 de `rls-por-permiso`), estableciendo policies `restrictive` por módulo/permiso y el helper `auth_tiene_permiso`, complementando las policies existentes de tenant y revendedoras sin alterarlas.

---

## 1. Requisitos

### REQ-RLSP-01 — Helper `auth_tiene_permiso`

La base de datos debe proveer una función `auth_tiene_permiso(p_modulo text, p_accion text) returns boolean` (`stable`, `security invoker`) que determine si el usuario autenticado posee el permiso indicado en el tenant activo, evaluando `usuario.id_rol → rol.permisos`.

- **Feliz**: Dado un usuario autenticado cuyo rol posee `p_accion` dentro del array del módulo `p_modulo` en `rol.permisos`, cuando se invoca `auth_tiene_permiso(p_modulo, p_accion)`, entonces retorna `true`. El rol Administrador pasa en todas las acciones en virtud de tener todos los permisos de `CATALOGO_PERMISOS` asignados en su rol.
- **N1**: Usuario autenticado cuyo rol carece del permiso solicitado (o permiso revocado en `rol.permisos`) → retorna `false` inmediatamente en la consulta siguiente sin depender de la expiración del JWT.
- **N2**: Usuario de otro tenant (su `usuario.id_tenant` difiere de `auth_tenant_id()`) → retorna `false`.
- **N3**: Sin JWT / sesión anónima (`auth.uid() is null` o `auth_tenant_id() is null`) → retorna `false`.
- **N4**: Usuario con rol `'Revendedora'` (`auth_revendedora_id() is not null`) → retorna `false` para permisos operativos no asignados a su rol. El helper no realiza short-circuit por `auth_revendedora_id()`; retorna `false` por carecer de la clave en `rol.permisos`, y la policy restrictiva preexistente (`00078_rls_revendedoras.sql`) ya bloquea su acceso a tablas de dominio.
- **N5**: Módulo o acción no existente en `CATALOGO_PERMISOS` o nulo → retorna `false`.
- **N6**: Usuario inactivo (`usuario.estado_usuario = 'inactivo'`) → retorna `false`.

---

### REQ-RLSP-02 — Aislamiento y control de acceso a `gasto_negocio`

La tabla `gasto_negocio` debe contar con policies RLS `restrictive` que impidan el acceso en lectura y escritura a cualquier actor que no cuente con el permiso de gastos o reportes (según `DR-RLSP-02`).

- **Feliz**:
  - Un usuario con `gastos.ver` o `reportes.ver` puede consultar (`SELECT`) los gastos de su tenant.
  - Un usuario con `gastos.crear` puede registrar gastos vía `sp_registrar_gasto` (`INSERT`).
  - Un usuario con `gastos.editar` puede eliminar gastos mal cargados vía `sp_eliminar_gasto` (`DELETE`).
- **N1**: Usuario autenticado del mismo tenant sin `gastos.ver` ni `reportes.ver` → `SELECT` devuelve 0 filas.
- **N2**: Usuario autenticado del mismo tenant sin `gastos.crear` o `gastos.editar` intentando mutar directamente → rechazo por violación de policy RLS (o 0 filas afectadas).
- **N3**: Usuario de otro tenant → no ve ni modifica ninguna fila (0 filas / rechazo).
- **N4**: Sin JWT / anónimo → 0 filas en `SELECT`, rechazo en mutación.
- **N5**: Usuario revendedora (`auth_revendedora_id() is not null`) → 0 filas en `SELECT`, rechazo en mutación (aislado por policy restrictiva previa y por falta de permiso).

---

### REQ-RLSP-03 — Aislamiento y control de acceso a `categoria_gasto`

La tabla `categoria_gasto` debe contar con policies RLS `restrictive` que limiten su lectura a usuarios con `gastos.ver` o `reportes.ver`, y sus mutaciones a usuarios con `gastos.crear` o `gastos.editar`.

- **Feliz**:
  - Un usuario con `gastos.ver` o `reportes.ver` puede listar (`SELECT`) las categorías de gasto del tenant.
  - Un usuario con `gastos.crear` puede crear categorías (`INSERT`).
  - Un usuario con `gastos.editar` puede renombrar, presupuestar, dar de baja o reactivar categorías (`UPDATE` / `DELETE`).
- **N1**: Usuario autenticado sin permiso `gastos.ver` ni `reportes.ver` → `SELECT` devuelve 0 filas.
- **N2**: Usuario autenticado sin permiso de escritura intentando `INSERT`/`UPDATE`/`DELETE` en `categoria_gasto` → rechazo por policy RLS.
- **N3**: Usuario de otro tenant → 0 filas visibles, 0 filas afectadas.
- **N4**: Sin JWT / anónimo → 0 filas en `SELECT`, rechazo en mutación.
- **N5**: Usuario revendedora → 0 filas en `SELECT`, rechazo en mutación.

---

### REQ-RLSP-04 — Aislamiento y control de acceso a `rendicion_proveedor`

La tabla `rendicion_proveedor` debe contar con policies RLS `restrictive` que limiten su lectura a usuarios con `rendiciones.ver`, `inventario.ver` o `reportes.ver`, y sus mutaciones a usuarios con `rendiciones.crear` o `rendiciones.editar`.

- **Feliz**:
  - Un usuario con `rendiciones.ver`, `inventario.ver` (perfil proveedor) o `reportes.ver` puede consultar (`SELECT`) las rendiciones del tenant.
  - Un usuario con `rendiciones.crear` puede generar rendiciones vía `sp_generar_rendicion` (`INSERT` y `UPDATE` de cierre).
  - Un usuario con `rendiciones.editar` puede marcar rendiciones pagadas vía `sp_marcar_rendicion_pagada` (`UPDATE`).
- **N1**: Usuario autenticado sin `rendiciones.ver`, `inventario.ver` ni `reportes.ver` → `SELECT` devuelve 0 filas.
- **N2**: Usuario autenticado sin `rendiciones.crear` ni `rendiciones.editar` intentando mutar `rendicion_proveedor` → rechazo por policy RLS.
- **N3**: Usuario de otro tenant → 0 filas visibles, rechazo en mutaciones.
- **N4**: Sin JWT / anónimo → 0 filas en `SELECT`, rechazo en mutación.
- **N5**: Usuario revendedora → 0 filas en `SELECT`, rechazo en mutación.

---

### REQ-RLSP-05 — Aislamiento y control de acceso a `ingreso_mercaderia_detalle`

La tabla `ingreso_mercaderia_detalle` debe contar con policies RLS `restrictive` que limiten su lectura a usuarios con `inventario.ver` o `reportes.ver`, y sus mutaciones a usuarios con `inventario.crear`, `inventario.editar` o `inventario.eliminar`.

- **Feliz**:
  - Un usuario con `inventario.ver` o `reportes.ver` (en `rf_finanzas_flujo` / `rf_finanzas_posicion`) puede consultar (`SELECT`) las líneas de detalle de un ingreso.
  - Un usuario con `inventario.crear` puede insertar líneas de detalle vía `sp_importar_remito` o DAL (`INSERT`).
  - Un usuario con `inventario.editar` puede remover líneas individuales de detalle antes de la confirmación vía DAL (`DELETE`).
  - Un usuario con `inventario.eliminar` puede borrar los detalles al cancelar el remito vía `sp_cancelar_ingreso` (`DELETE`).
- **N1**: Usuario autenticado sin `inventario.ver` ni `reportes.ver` → `SELECT` devuelve 0 filas.
- **N2**: Usuario autenticado sin permiso de inventario intentando mutar líneas de detalle → rechazo por policy RLS.
- **N3**: Usuario de otro tenant → 0 filas visibles, 0 filas afectadas.
- **N4**: Sin JWT / anónimo → 0 filas en `SELECT`, rechazo en mutación.
- **N5**: Usuario revendedora → 0 filas en `SELECT`, rechazo en mutación.

---

### REQ-RLSP-06 — Composición aditiva y no interferencia con RLS preexistentes

Las nuevas policies por permiso deben declararse como `as restrictive`. De acuerdo con la semántica de PostgreSQL:

1. Se combinan mediante un operador lógico `AND` con las policies preexistentes de tenant (`id_tenant = auth_tenant_id()`).
2. Se combinan mediante un operador lógico `AND` con las policies restrictivas preexistentes de revendedoras (`auth_revendedora_id() is null`).
3. Bajo ninguna circunstancia una policy restrictiva puede ampliar el acceso fuera del tenant o hacia datos de revendedoras ajenos.
4. El rol `'Administrador'` accede a todas las operaciones sobre los datos de su tenant en virtud de poseer todos los permisos del catálogo en `rol.permisos` (garantizado por el provisionamiento y los backfills de migraciones `00108`, `00127`, `00128`, `00131`), y no por un bypass especial de nombre en el helper.

---

## 2. Matriz de permisos

La siguiente matriz define el comportamiento esperado para cada función y tabla cubierta en las Fases 3 y 4. Cada celda representa un caso de prueba verificable en `tests/db/rls-por-permiso.test.ts`.

| Función / Tabla | Operador con permiso | Operador sin permiso | Administrador | Revendedora | Otro tenant | Sin JWT |
| --- | --- | --- | --- | --- | --- | --- |
| `auth_tiene_permiso(m, a)` | `true` | `false` | `true` | `false` | `false` | `false` |
| `gasto_negocio` (SELECT) | Filas del tenant | 0 filas | Filas del tenant | 0 filas | 0 filas | 0 filas |
| `gasto_negocio` (INSERT) | OK (`gastos.crear`) | Rechazo RLS | OK | Rechazo RLS | Rechazo / 0 filas | Rechazo |
| `gasto_negocio` (DELETE) | OK (`gastos.editar`) | Rechazo RLS | OK | Rechazo RLS | Rechazo / 0 filas | Rechazo |
| `categoria_gasto` (SELECT) | Filas del tenant | 0 filas | Filas del tenant | 0 filas | 0 filas | 0 filas |
| `categoria_gasto` (INSERT/UPDATE/DELETE) | OK (`gastos.crear`/`editar`) | Rechazo RLS | OK | Rechazo RLS | Rechazo / 0 filas | Rechazo |
| `rendicion_proveedor` (SELECT) | Filas del tenant | 0 filas | Filas del tenant | 0 filas | 0 filas | 0 filas |
| `rendicion_proveedor` (INSERT/UPDATE) | OK (`rendiciones.crear`/`editar`) | Rechazo RLS | OK | Rechazo RLS | Rechazo / 0 filas | Rechazo |
| `ingreso_mercaderia_detalle` (SELECT) | Filas del tenant | 0 filas | Filas del tenant | 0 filas | 0 filas | 0 filas |
| `ingreso_mercaderia_detalle` (INSERT/DELETE) | OK (`inventario.crear`/`editar`/`eliminar`) | Rechazo RLS | OK | Rechazo RLS | Rechazo / 0 filas | Rechazo |

---

## 3. Cifras financieras

**No aplica**: Este cambio no crea, recalcula ni altera cifras financieras, devengamientos, percepciones ni fórmulas contables. Únicamente implementa compuertas de seguridad a nivel de motor de base de datos (PostgreSQL RLS) para gobernar qué usuarios pueden leer o modificar registros existentes según su rol.

---

## 4. INVOKER contra RLS restrictiva

### 4.1. Alcance de la Fase 4: Confirmación y justificación de tablas

El objetivo de la Fase 4 es proteger tablas cuyo acceso en `SELECT` **no requiera ningún permiso de ventas ni de revendedoras**. Tras auditar las candidatas de `tasks.md §Fase 4`, el alcance final de tablas protegidas en Fase 4 queda delimitado a **4 tablas**:

#### Tablas Incluidas en Fase 4 (4 tablas):
1. **`gasto_negocio` (INCLUIDA)**:
   - *Justificación*: Su SELECT es exclusivo del módulo `gastos` (`gastos.ver`) y reportes financieros (`reportes.ver`). Ningún flujo operativo de `ventas` ni de `revendedoras` consulta gastos.
2. **`categoria_gasto` (INCLUIDA)**:
   - *Justificación*: Su SELECT es exclusivo de `gastos` (`gastos.ver`) y del reporte de presupuesto mensual (`reportes.ver`). No es consultada por ventas ni revendedoras.
3. **`rendicion_proveedor` (INCLUIDA)**:
   - *Justificación*: Su SELECT se circunscribe a `rendiciones.ver`, al perfil de proveedor en `/proveedores/[id]` (`inventario.ver`) y reportes de flujo/posición (`reportes.ver`). Ningún flujo de `ventas` ni de `revendedoras` lee rendiciones.
4. **`ingreso_mercaderia_detalle` (INCLUIDA)**:
   - *Justificación*: Su SELECT corresponde a `inventario.ver` (inspección de ítems de remito en `/inventario/ingresos/[id]`) y a reportes financieros (`reportes.ver` en `rf_finanzas_flujo` y `rf_finanzas_posicion`). Nadie fuera de inventario y reportes lee esta tabla (verificado mecánicamente con `rg` en `lib/dal` y `app`).

#### Tablas Excluidas de Fase 4 (3 tablas):
1. **`costo_producto` (EXCLUIDA)**:
   - *Justificación*: Aunque es una tabla de costos, `sp_registrar_venta` (`ventas.crear`) y `sp_confirmar_declaracion_venta` (`revendedoras.editar`) son `SECURITY INVOKER` y realizan `SELECT costo FROM costo_producto` para registrar el `costo_snapshot` inmutable en `detalle_venta`. Además, `precios` la muta masivamente (`sp_revaluar_costos_usd_vigentes`). Según `proposal.md §4`, el tratamiento de costos y márgenes se difiere al cambio específico `costos-por-columna`.
2. **`proveedor` (EXCLUIDA)**:
   - *Justificación*: Es una tabla compartida leída transversalmente por 5 módulos distintos: `inventario.ver` (catálogo y compras), `precios.ver` (filtros en control de precios), `consignaciones.ver` (selección de consignatario), `rendiciones.ver` (liquidación a proveedores) y `reportes.ver` (perfil proveedor). No pertenece exclusivamente a un módulo y requiere una policy multi-permiso en una fase posterior.
3. **`ingreso_mercaderia` (EXCLUIDA — cruces críticos detectados)**:
   - *Justificación*: La cabecera de ingreso no puede aislarse con permiso exclusivo de `inventario.ver` debido a lecturas cruzadas esenciales en procedimientos INVOKER de otros módulos:
     - `sp_registrar_venta` (`supabase/migrations/00093_venta_revendedora_pago.sql:296`): lee `i.id_proveedor` de `ingreso_mercaderia` bajo permiso `ventas.crear`; si RLS la bloquea, devuelve `null` y la venta de mercadería consignada se graba sin proveedor, quedando huérfana de rendición para siempre.
     - `sp_agregar_item_consignacion` (`supabase/migrations/00124_consignacion_modulo_grupo_a.sql:260`): lee `ingreso_mercaderia` bajo `consignaciones.crear` para verificar proveedor; ante RLS restrictiva lanza excepción `item-otro-proveedor`.
     - `app/api/consignaciones/lookup-item/route.ts:62`: consulta `ingreso_mercaderia` bajo `consignaciones.ver`.
     - `lib/dal/inventario/item.ts:38`: embed de `ingreso:ingreso_mercaderia(id_ingreso, comprobante_ref)` en la ficha de ítem leída por múltiples módulos.

---

### 4.2. Análisis de funciones INVOKER y lecturas cruzadas

Dado que todas las funciones de dominio son `SECURITY INVOKER`, las lecturas y escrituras cruzadas se resuelven puramente dentro de la semántica de RLS sin necesidad de privilegios elevados:

1. **Funciones de reporte `rf_*` (`reportes.ver`) sobre tablas de Fase 4**:
   - `rf_finanzas_resultados`, `rf_finanzas_flujo`, `rf_finanzas_posicion`, `rf_finanzas_gastos_presupuesto`, `rf_dashboard_kpis`, `rf_reporte_caja` leen `gasto_negocio`, `categoria_gasto`, `rendicion_proveedor` e `ingreso_mercaderia_detalle`.
   - *Resolución*: Se incluye `OR (select auth_tiene_permiso('reportes', 'ver'))` en el predicado de `SELECT` de cada una de estas 4 tablas (`DR-RLSP-02 = B1`).
2. **Perfil de proveedor en inventario (`inventario.ver`) sobre `rendicion_proveedor`**:
   - `lib/dal/inventario/proveedor.ts:125-133` consulta `rendicion_proveedor` al mostrar `/proveedores/[id]`.
   - *Resolución*: Se incluye `OR (select auth_tiene_permiso('inventario', 'ver'))` en la policy de `SELECT` de `rendicion_proveedor`.
3. **Escrituras y actualizaciones en rendiciones**:
   - `sp_generar_rendicion` (`rendiciones.crear`) no solo hace `INSERT` sino también `UPDATE rendicion_proveedor set total_a_pagar = ...` (`00138:173`).
   - `sp_marcar_rendicion_pagada` (`rendiciones.editar`) hace `UPDATE rendicion_proveedor set estado = 'pagada'` (`00126:484`).
   - *Resolución*: La policy de `UPDATE` sobre `rendicion_proveedor` admite `rendiciones.crear OR rendiciones.editar`.
4. **Mutación de categorías de gasto**:
   - `createCategoriaGasto` (`lib/dal/gastos/gasto.ts:98`) ejecuta `.insert().select('*')`. Requiere `INSERT` (`gastos.crear`) y visibilidad de `SELECT` (`gastos.ver`).
   - `bajaCategoriaGasto` (`lib/dal/gastos/gasto.ts:136, 144`) ejecuta `DELETE` o `UPDATE` bajo `gastos.editar`.

> [!IMPORTANT]
> **Dictamen de DEFINER**: **Ninguna función requiere `SECURITY DEFINER`.** Todas las lecturas cruzadas se resuelven con disyunciones explícitas de permisos en las policies RLS INVOKER.

---

### 4.3. Predicados exactos por tabla y operación (Tabla × Operación → Predicado)

A continuación se define la matriz canónica de policies RLS restrictivas para las 4 tablas de la Fase 4.

| Tabla | Operación | Predicado SQL Exacto | Justificación / Acción / SP | Notas de Visibilidad |
| --- | --- | --- | --- | --- |
| `gasto_negocio` | `SELECT` | `(select auth_tiene_permiso('gastos', 'ver')) or (select auth_tiene_permiso('reportes', 'ver'))` | `listGastos`, `listGastosPresupuesto` (`lib/dal/gastos/gasto.ts`); `rf_finanzas_resultados`, `rf_finanzas_flujo`, `rf_reporte_caja`, `rf_dashboard_kpis` (`reportes.ver`). | Requiere SELECT visible para reportes. |
| `gasto_negocio` | `INSERT` | `(select auth_tiene_permiso('gastos', 'crear'))` | `sp_registrar_gasto` (`registrarGastoAction` en `rendiciones/actions.ts:117`, gated `gastos.crear`). | `with check`. |
| `gasto_negocio` | `UPDATE` | `false` | Inmutable: no existe acción ni SP que modifique gastos registrados. | Bloqueo total. |
| `gasto_negocio` | `DELETE` | `(select auth_tiene_permiso('gastos', 'editar'))` | `sp_eliminar_gasto` (`eliminarGastoAction` en `rendiciones/actions.ts:148`, gated `gastos.editar`). | Requiere además visibilidad de `SELECT` (`using`). |
| `categoria_gasto` | `SELECT` | `(select auth_tiene_permiso('gastos', 'ver')) or (select auth_tiene_permiso('reportes', 'ver'))` | `listCategoriasGasto`, `listPresupuestoMes` (`lib/dal/gastos/gasto.ts`, `gastos.ver`); `rf_finanzas_gastos_presupuesto` (`reportes.ver`). | Visibilidad para pantallas y balances. |
| `categoria_gasto` | `INSERT` | `(select auth_tiene_permiso('gastos', 'crear'))` | `createCategoriaGasto` (`lib/dal/gastos/gasto.ts:98`, `createCategoriaGastoAction`, gated `gastos.crear`). | Requiere visibilidad de `SELECT` por `.insert().select('*')`. |
| `categoria_gasto` | `UPDATE` | `(select auth_tiene_permiso('gastos', 'editar'))` | `renameCategoriaGasto` (`lib/dal:113`), `sp_set_presupuesto_categoria_gasto` (`rendiciones/actions:163`), soft-delete / reactivar (`lib/dal:144, 154`, gated `gastos.editar`). | `using` + `with check`. |
| `categoria_gasto` | `DELETE` | `(select auth_tiene_permiso('gastos', 'editar'))` | `bajaCategoriaGasto` hard-delete (`lib/dal/gastos/gasto.ts:136`, `bajaCategoriaGastoAction`, gated `gastos.editar`). | Requiere visibilidad de `SELECT`. |
| `rendicion_proveedor` | `SELECT` | `(select auth_tiene_permiso('rendiciones', 'ver')) or (select auth_tiene_permiso('inventario', 'ver')) or (select auth_tiene_permiso('reportes', 'ver'))` | `listRendiciones` (`rendiciones.ver`); perfil proveedor en `/proveedores/[id]` (`lib/dal/inventario/proveedor.ts:125-133`, `inventario.ver`); `rf_finanzas_flujo`, `rf_finanzas_posicion` (`reportes.ver`). | Admite inventario para ficha proveedor. |
| `rendicion_proveedor` | `INSERT` | `(select auth_tiene_permiso('rendiciones', 'crear'))` | `sp_generar_rendicion` (`generarRendicionAction` en `rendiciones/actions.ts:25`, gated `rendiciones.crear`). | `with check`. |
| `rendicion_proveedor` | `UPDATE` | `(select auth_tiene_permiso('rendiciones', 'crear')) or (select auth_tiene_permiso('rendiciones', 'editar'))` | `sp_generar_rendicion` hace UPDATE a total (`rendiciones.crear`); `sp_marcar_rendicion_pagada` hace UPDATE a pagada (`rendiciones.editar`). | `using` + `with check`. Requiere visibilidad de `SELECT`. |
| `rendicion_proveedor` | `DELETE` | `false` | Inmutable: las liquidaciones históricas no se borran. | Bloqueo total. |
| `ingreso_mercaderia_detalle` | `SELECT` | `(select auth_tiene_permiso('inventario', 'ver')) or (select auth_tiene_permiso('reportes', 'ver'))` | `listDetallesByIngresoId` (`inventario.ver`); `rf_finanzas_flujo` (`00095:1021`) y `rf_finanzas_posicion` (`00111:483`) (`reportes.ver`). | Coherencia en flujo y posición. |
| `ingreso_mercaderia_detalle` | `INSERT` | `(select auth_tiene_permiso('inventario', 'crear'))` | `crearIngresoDetalle` (`lib/dal/inventario/ingreso.ts:211`), `sp_importar_remito` (`importarRemitoAction`, gated `inventario.crear`). | `with check`. |
| `ingreso_mercaderia_detalle` | `UPDATE` | `false` | Inmutable: los detalles no se modifican; se eliminan o insertan previo a la confirmación. | Bloqueo total. |
| `ingreso_mercaderia_detalle` | `DELETE` | `(select auth_tiene_permiso('inventario', 'editar')) or (select auth_tiene_permiso('inventario', 'eliminar'))` | `removeIngresoDetalle` (`lib/dal/inventario/ingreso.ts:320`, gated `inventario.editar`); `sp_cancelar_ingreso` (`cancelarIngresoAction`, gated `inventario.eliminar`). | Requiere visibilidad de `SELECT`. |

---

## 5. Migraciones

- Las migraciones asociadas a este cambio se numerarán con **el siguiente número libre** en `supabase/migrations/` al momento de su creación efectiva en las Fases 3 y 4 (`ls supabase/migrations | tail -1`).
- Cada migración debe incluir un bloque `-- DOWN:` ejecutable completo (con líneas descriptivas precedidas por `-- NOTE:`) verificado contra `pnpm gate:db`.
- No se editará ninguna migración preexistente en la rama `main`; cualquier ajuste se realizará hacia adelante (*fix-forward*).

---

## 6. Decisiones de arquitectura (Cerradas)

Las siguientes decisiones fueron resueltas y aprobadas por la persona:

### DR-RLSP-01 — Opción A2: RLS no evalúa `tenant_modulo`
- **Decisión**: La policy RLS evalúa únicamente el permiso del usuario (`auth_tiene_permiso`). La habilitación de módulos por tenant permanece gobernada exclusivamente por las Server Actions (`requireModuleRole`), los layouts de frontend y los triggers de integridad preexistentes (`00118_guarda_tenant_modulo.sql`).
- **Motivo**: Evita sobrecarga de joins innecesarios por fila en PostgreSQL, maximiza el rendimiento y mantiene separadas las responsabilidades (autorización de usuario vs facturación/paquete contratado).

---

### DR-RLSP-02 — Opción B1: `reportes.ver` alcanza para leer gastos, rendiciones y detalle de ingresos
- **Decisión**: Las policies de `SELECT` de `gasto_negocio`, `categoria_gasto`, `rendicion_proveedor` e `ingreso_mercaderia_detalle` admiten `OR (select auth_tiene_permiso('reportes', 'ver'))`.
- **Motivo**: Dado que las funciones financieras de reporte (`rf_*`) son `SECURITY INVOKER`, un usuario con permiso de reportes (contador, auditor o socio) debe poder calcular balances íntegros sin requerir permisos operativos de carga en `gastos`, `rendiciones` ni `inventario`, evitando balances distorsionados con gastos o compras en $0.

---

### DR-RLSP-03 — Opción C1 + Sem-1: Firma `(p_modulo, p_accion)` sin bypass por `rol.nombre`
- **Decisión**:
  - Firma: `auth_tiene_permiso(p_modulo text, p_accion text) returns boolean` (`stable`).
  - Semántica: Evalúa que el usuario no esté inactivo (`usuario.estado_usuario <> 'inactivo'`), coincidencia de tenant (`usuario.id_tenant = auth_tenant_id()`) y pertenencia en `rol.permisos -> p_modulo ? p_accion`.
  - Sin bypass por nombre de rol: No existe cláusula especial `OR rol.nombre = 'Administrador'`. El Administrador pasa en todas las verificaciones porque posee el conjunto íntegro de permisos del catálogo en `rol.permisos` (garantizado por `provision-tenant.mts` y backfills de migraciones `00108`, `00127`, `00128`, `00131`).
- **Motivo**: `lib/dal/guard.ts:40` opera exclusivamente contra `permisos`; el nombre del rol no está protegido contra renombrado o modificaciones, por lo que acoplar la seguridad en base de datos a un string de nombre vulneraría la consistencia del modelo.

---

## Apéndice A — Evidencia mecánica de escrituras reales

A continuación se transcribe la salida exacta, mecánica e inalterada de las búsquedas ejecutadas en el repositorio:
1. Sobre las definiciones vigentes de procedimientos almacenados `sp_*` (`pnpm sp:last` trazado a `supabase/migrations/<archivo>:<línea>`):
   `rg -n -i "(insert into|update|delete from)\s+<tabla>\b"`
2. Sobre la capa de acceso a datos (`lib/dal`):
   `rg -n "from\('<tabla>'\)\.(insert|update|upsert|delete)" lib/dal`
   `rg -U -n "from\('<tabla>'\)\s*\.(insert|update|upsert|delete)" lib/dal`

```text
============================================================
TABLA: gasto_negocio
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+gasto_negocio\b" ---
supabase/migrations/00053_gasto_descripcion_opcional_y_delete.sql:92:  delete from gasto_negocio where id_gasto = p_id_gasto;
supabase/migrations/00053_gasto_descripcion_opcional_y_delete.sql:52:  insert into gasto_negocio(id_tenant, id_categoria_gasto, id_usuario_alta,

--- Comando DAL (single-line): rg -n "from\('gasto_negocio'\)\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

--- Comando DAL (multiline): rg -U -n "from\('gasto_negocio'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

============================================================
TABLA: categoria_gasto
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+categoria_gasto\b" ---
supabase/migrations/00069_incobrables_sin_gasto.sql:249:  insert into categoria_gasto(id_tenant, nombre, descripcion)
supabase/migrations/00027_rendicion_gasto_functions.sql:319:  update categoria_gasto

--- Comando DAL (single-line): rg -n "from\('categoria_gasto'\)\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

--- Comando DAL (multiline): rg -U -n "from\('categoria_gasto'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
lib/dal\gastos\gasto.ts:98:    .from('categoria_gasto')
lib/dal\gastos\gasto.ts:99:    .insert({
lib/dal\gastos\gasto.ts:113:    .from('categoria_gasto')
lib/dal\gastos\gasto.ts:114:    .update({ nombre })
lib/dal\gastos\gasto.ts:136:      .from('categoria_gasto')
lib/dal\gastos\gasto.ts:137:      .delete()
lib/dal\gastos\gasto.ts:144:    .from('categoria_gasto')
lib/dal\gastos\gasto.ts:145:    .update({ activa: false, fecha_baja: new Date().toISOString() })
lib/dal\gastos\gasto.ts:154:    .from('categoria_gasto')
lib/dal\gastos\gasto.ts:155:    .update({ activa: true, fecha_baja: null })

============================================================
TABLA: rendicion_proveedor
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+rendicion_proveedor\b" ---
supabase/migrations/00138_fix_sp_generar_rendicion_update.sql:145:  insert into rendicion_proveedor(
supabase/migrations/00138_fix_sp_generar_rendicion_update.sql:173:  update rendicion_proveedor
supabase/migrations/00126_rendicion_modulo.sql:484:  update rendicion_proveedor

--- Comando DAL (single-line): rg -n "from\('rendicion_proveedor'\)\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

--- Comando DAL (multiline): rg -U -n "from\('rendicion_proveedor'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

============================================================
TABLA: ingreso_mercaderia
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+ingreso_mercaderia\b" ---
supabase/migrations/00039_cancelar_ingreso_borra_stock.sql:91:  delete from ingreso_mercaderia
supabase/migrations/00032_talles.sql:96:  update ingreso_mercaderia

--- Comando DAL (single-line): rg -n "from\('ingreso_mercaderia'\)\.(insert|update|upsert|delete)" lib/dal ---
lib/dal\inventario\ingreso.ts:168:    .from('ingreso_mercaderia').insert(payload).select('id_ingreso').single()

--- Comando DAL (multiline): rg -U -n "from\('ingreso_mercaderia'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
lib/dal\inventario\ingreso.ts:168:    .from('ingreso_mercaderia').insert(payload).select('id_ingreso').single()

============================================================
TABLA: ingreso_mercaderia_detalle
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+ingreso_mercaderia_detalle\b" ---
supabase/migrations/00039_cancelar_ingreso_borra_stock.sql:72:  delete from ingreso_mercaderia_detalle
supabase/migrations/00136_conversion_costo_usd.sql:385:      insert into ingreso_mercaderia_detalle(

--- Comando DAL (single-line): rg -n "from\('ingreso_mercaderia_detalle'\)\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

--- Comando DAL (multiline): rg -U -n "from\('ingreso_mercaderia_detalle'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
lib/dal\inventario\ingreso.ts:211:    .from('ingreso_mercaderia_detalle')
lib/dal\inventario\ingreso.ts:212:    .insert({
lib/dal\inventario\ingreso.ts:320:    .from('ingreso_mercaderia_detalle')
lib/dal\inventario\ingreso.ts:321:    .delete({ count: 'exact' })

============================================================
TABLA: costo_producto
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+costo_producto\b" ---
supabase/migrations/00136_conversion_costo_usd.sql:341:        insert into costo_producto(
supabase/migrations/00137_revaluar_costos_usd_vigentes.sql:70:    update costo_producto
supabase/migrations/00137_revaluar_costos_usd_vigentes.sql:75:    insert into costo_producto (
supabase/migrations/00136_conversion_costo_usd.sql:217:  update costo_producto
supabase/migrations/00136_conversion_costo_usd.sql:223:  insert into costo_producto(

--- Comando DAL (single-line): rg -n "from\('costo_producto'\)\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

--- Comando DAL (multiline): rg -U -n "from\('costo_producto'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

============================================================
TABLA: proveedor
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+proveedor\b" ---
(sin coincidencias)

--- Comando DAL (single-line): rg -n "from\('proveedor'\)\.(insert|update|upsert|delete)" lib/dal ---
lib/dal\inventario\proveedor.ts:43:    .from('proveedor').insert(input).select('*').single()
lib/dal\inventario\proveedor.ts:54:    .from('proveedor').update(patch).eq('id_proveedor', id)

--- Comando DAL (multiline): rg -U -n "from\('proveedor'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
lib/dal\inventario\proveedor.ts:43:    .from('proveedor').insert(input).select('*').single()
lib/dal\inventario\proveedor.ts:54:    .from('proveedor').update(patch).eq('id_proveedor', id)
```

*(Nota sobre `sp_marcar_cuota_incobrable`: la búsqueda en `supabase/migrations/00069_incobrables_sin_gasto.sql:249` corresponde al bloque `/* -- DOWN: */` de dicha migración. La definición vigente UP en `00069:111` eliminó la inserción en `categoria_gasto` y la llamada a `sp_registrar_gasto`, por lo que en producción ninguna función de ventas escribe en tablas de gastos).*


---

## 7. Fase 5 — permiso por sp_* de escritura

Esta sección define el mapa canónico de procedimientos almacenados (`sp_*`) de mutación/escritura llamados vía RPC desde el cliente Supabase (`lib/dal` y `app`), trazando su compuerta de autorización requerida a nivel de base de datos para complementar las validaciones de las Server Actions.

### 7.1. Exclusión de funciones de solo lectura
Se excluyen expresamente de esta fase las siguientes 10 funciones de solo lectura o cálculo puro sin efectos colaterales (listadas aquí para constancia):
`sp_calcular_precio_venta_snapshot`, `sp_control_de_precios`, `sp_descuentos_disponibles_venta`, `sp_get_cotizacion_vigente`, `sp_inventario_resumen`, `sp_listar_productos`, `sp_perdida_incobrable_venta`, `sp_precios_resumen`, `sp_session_context`, `sp_stock_por_talle`.

---

### 7.2. Tabla de correspondencia: SP de escritura × Permiso requerido (82 sp_*)

| sp | Server Action(s) que lo llaman | Permiso de su requireModuleRole / guarded* (módulo.acción, citado archivo:línea) | Definición vigente (pnpm sp:last) | ¿Lo llaman otros sp por dentro? (cuáles) |
| --- | --- | --- | --- | --- |
| `sp_agregar_item_consignacion` | agregarItemConsignacionAction | consignaciones.crear (app/(app)/consignaciones/actions.ts:125) | `supabase/migrations/00124_consignacion_modulo_grupo_a.sql:203` | `sp_crear_consignacion_con_items` |
| `sp_alta_tenant` | altaTenantAction | Superadmin plataforma: requireSuperAdmin() (app/(plataforma)/plataforma/actions.ts:126) | `supabase/migrations/00120_alta_baja_tenant.sql:119` | Ninguno |
| `sp_anular_movimiento_tenant` | anularMovimientoTenantAction | Superadmin plataforma: requireSuperAdmin() (app/(plataforma)/plataforma/actions.ts:96) | `supabase/migrations/00119_super_admin_plataforma.sql:300` | Ninguno |
| `sp_anular_venta` | anularVentaAction | ventas.editar (app/(app)/ventas/actions.ts:120) | `supabase/migrations/00110_finanzas_cambio_diferencia.sql:418` | Ninguno |
| `sp_asignar_talles_a_producto` | asignarTallesProductoAction | inventario.editar (app/(app)/inventario/actions.ts:459) | `supabase/migrations/00045_fix_asignar_talles_referencia_id.sql:11` | Ninguno |
| `sp_baja_regla_precio` | bajaReglaAction | precios.eliminar (app/(app)/precios/actions.ts:97) | `supabase/migrations/00019_precios_functions.sql:463` | Ninguno |
| `sp_baja_revendedora` | bajaRevendedoraAction<br>crearRevendedoraUnificadaAction (en rollback) | revendedoras.eliminar (app/(app)/revendedoras/actions.ts:150)<br>revendedoras.editar (app/(app)/revendedoras/actions.ts:47) | `supabase/migrations/00085_consignacion_revendedora_functions.sql:47` | Ninguno |
| `sp_calificar_consulta_ayuda` | calificarConsultaAyudaAction | ayuda.consultar (app/(app)/ayuda/actions.ts:123) | `supabase/migrations/00127_ayuda.sql:160` | Ninguno |
| `sp_cambiar_estado_tenant` | cambiarEstadoTenantAction | Superadmin plataforma: requireSuperAdmin() (app/(plataforma)/plataforma/actions.ts:159) | `supabase/migrations/00120_alta_baja_tenant.sql:263` | Ninguno |
| `sp_cancelar_ingreso` | cancelarIngresoAction | inventario.eliminar (app/(app)/inventario/actions.ts:365) | `supabase/migrations/00039_cancelar_ingreso_borra_stock.sql:18` | Ninguno |
| `sp_cancelar_item_consignacion` | cancelarItemConsignacionAction | consignaciones.editar (app/(app)/consignaciones/actions.ts:145) | `supabase/migrations/00124_consignacion_modulo_grupo_a.sql:310` | Ninguno |
| `sp_cancelar_reserva` | cancelarReservaAction | ventas.editar (app/(app)/ventas/actions.ts:245) | `supabase/migrations/00023_ventas_reservas_functions.sql:107` | Ninguno |
| `sp_cerrar_consignacion` | cerrarConsignacionAction | consignaciones.editar (app/(app)/consignaciones/actions.ts:185) | `supabase/migrations/00124_consignacion_modulo_grupo_a.sql:407` | `sp_confirmar_consignacion` |
| `sp_cerrar_consignacion_revendedora` | cerrarConsignacionRevendedoraAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:314) | `supabase/migrations/00085_consignacion_revendedora_functions.sql:546` | Ninguno |
| `sp_change_password_user` | cambiarMiPasswordAction<br>changePasswordAction | administracion.ver (app/(app)/administracion/actions.ts:270)<br>Sesión autenticada (app/(auth)/settings/password-actions.ts:50, auth.uid() = p_id_usuario) | `supabase/migrations/00009_seed_setup_functions.sql:36` | Ninguno |
| `sp_cobrar_cuota` | cobrarCuotaAction | ventas.editar (app/(app)/cuotas/actions.ts:25) | `supabase/migrations/00069_incobrables_sin_gasto.sql:298` | Ninguno |
| `sp_confirmar_consignacion` | confirmarConsignacionAction | consignaciones.editar (app/(app)/consignaciones/actions.ts:85) | `supabase/migrations/00125_consignacion_modulo_grupo_b.sql:345` | Ninguno |
| `sp_confirmar_consignacion_revendedora` | confirmarConsignacionRevendedoraAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:254) | `supabase/migrations/00085_consignacion_revendedora_functions.sql:322` | `sp_entregar_consignacion_revendedora` |
| `sp_confirmar_declaracion_venta` | confirmarDeclaracionAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:354) | `supabase/migrations/00104_declaracion_venta_functions.sql:170` | Ninguno |
| `sp_confirmar_ingreso` | confirmarIngresoAction | inventario.crear (app/(app)/inventario/actions.ts:340) | `supabase/migrations/00143_costo_unico.sql:117` | Ninguno |
| `sp_confirmar_salida_item` | confirmarSalidaItemAction | consignaciones.editar (app/(app)/consignaciones/actions.ts:165) | `supabase/migrations/00124_consignacion_modulo_grupo_a.sql:358` | `sp_confirmar_consignacion` |
| `sp_crear_consignacion_con_items` | crearConsignacionAction | consignaciones.crear (app/(app)/consignaciones/actions.ts:45) | `supabase/migrations/00125_consignacion_modulo_grupo_b.sql:224` | Ninguno |
| `sp_crear_regla_comision` | crearReglaComisionAction | revendedoras.crear (app/(app)/revendedoras/actions.ts:174) | `supabase/migrations/00087_comisiones_functions.sql:8` | Ninguno |
| `sp_crear_reserva` | crearReservaAction | ventas.crear (app/(app)/ventas/actions.ts:213) | `supabase/migrations/00048_fix_sp_crear_reserva_ambiguo.sql:21` | Ninguno |
| `sp_crear_revendedora` | crearRevendedoraAction<br>crearRevendedoraUnificadaAction | revendedoras.crear (app/(app)/revendedoras/actions.ts:16)<br>administracion.crear (app/(app)/revendedoras/actions.ts:35) | `supabase/migrations/00097_panel_revendedoras.sql:488` | Ninguno |
| `sp_crear_stock_directo` | crearStockDirectoAction | inventario.crear (app/(app)/inventario/actions.ts:153) | `supabase/migrations/00143_costo_unico.sql:442` | Ninguno |
| `sp_create_producto` | createProductoAction | inventario.crear (app/(app)/inventario/actions.ts:96) | `supabase/migrations/00036_sku_autogen.sql:106` | Ninguno |
| `sp_create_regla_precio` | createReglaAction | precios.crear (app/(app)/precios/actions.ts:76) | `supabase/migrations/00046_descuentos_seleccionables.sql:217` | Ninguno |
| `sp_create_rol` | createRolAction | administracion.crear (app/(app)/administracion/actions.ts:104) | `supabase/migrations/00029_administracion_functions.sql:19` | Ninguno |
| `sp_declarar_venta_revendedora` | declararVentaRevendedoraAction | Portal revendedora: auth_revendedora_id() is not null (app/(portal)/mi-cuenta/actions.ts:20) | `supabase/migrations/00105_declaracion_venta_invoker.sql:114` | Ninguno |
| `sp_delete_rol` | deleteRolAction | administracion.eliminar (app/(app)/administracion/actions.ts:146) | `supabase/migrations/00029_administracion_functions.sql:80` | Ninguno |
| `sp_devolver_items_revendedora` | devolverItemsRevendedoraAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:294) | `supabase/migrations/00115_entrega_y_devolucion_revendedora.sql:47` | Ninguno |
| `sp_editar_consignacion` | editarConsignacionAction | consignaciones.editar (app/(app)/consignaciones/actions.ts:65) | `supabase/migrations/00125_consignacion_modulo_grupo_b.sql:280` | Ninguno |
| `sp_editar_consignacion_revendedora` | editarConsignacionRevendedoraAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:234) | `supabase/migrations/00085_consignacion_revendedora_functions.sql:250` | Ninguno |
| `sp_editar_revendedora` | editarRevendedoraAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:126) | `supabase/migrations/00076_revendedora.sql:75` | Ninguno |
| `sp_eliminar_consignacion` | eliminarConsignacionAction | consignaciones.eliminar (app/(app)/consignaciones/actions.ts:105) | `supabase/migrations/00125_consignacion_modulo_grupo_b.sql:404` | Ninguno |
| `sp_eliminar_consignacion_revendedora` | eliminarConsignacionRevendedoraAction | revendedoras.eliminar (app/(app)/revendedoras/actions.ts:334) | `supabase/migrations/00085_consignacion_revendedora_functions.sql:609` | Ninguno |
| `sp_eliminar_gasto` | eliminarGastoAction | gastos.editar (app/(app)/rendiciones/actions.ts:147) | `supabase/migrations/00053_gasto_descripcion_opcional_y_delete.sql:71` | Ninguno |
| `sp_emitir_comprobante` | emitirComprobanteAction | ventas.crear (app/(app)/ventas/actions.ts:92) | `supabase/migrations/00023_ventas_reservas_functions.sql:463` | Ninguno |
| `sp_enlazar_revendedora_usuario` | crearRevendedoraUnificadaAction | administracion.crear OR revendedoras.crear (app/(app)/revendedoras/actions.ts:35, 36) | `supabase/migrations/00079_rol_revendedora.sql:99` | Ninguno |
| `sp_entregar_consignacion_revendedora` | entregarConsignacionRevendedoraAction | revendedoras.crear (app/(app)/revendedoras/actions.ts:214) | `supabase/migrations/00115_entrega_y_devolucion_revendedora.sql:27` | Ninguno |
| `sp_excluir_detalle_liquidacion` | excluirDetalleLiquidacionAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:414) | `supabase/migrations/00095_liquidacion_functions.sql:424` | Ninguno |
| `sp_excluir_detalle_rendicion` | excluirDetalleRendicionAction | rendiciones.editar (app/(app)/rendiciones/actions.ts:88) | `supabase/migrations/00126_rendicion_modulo.sql:373` | Ninguno |
| `sp_extender_vigencia_regla` | extenderVigenciaReglaAction | precios.editar (app/(app)/precios/actions.ts:117) | `supabase/migrations/00019_precios_functions.sql:495` | Ninguno |
| `sp_generar_liquidacion` | generarLiquidacionAction | revendedoras.crear (app/(app)/revendedoras/actions.ts:394) | `supabase/migrations/00095_liquidacion_functions.sql:266` | Ninguno |
| `sp_generar_rendicion` | generarRendicionAction | rendiciones.crear (app/(app)/rendiciones/actions.ts:47) | `supabase/migrations/00138_fix_sp_generar_rendicion_update.sql:99` | Ninguno |
| `sp_importar_remito` | importarRemitoAction | inventario.crear (app/(app)/inventario/actions.ts:316) | `supabase/migrations/00143_costo_unico.sql:245` | Ninguno |
| `sp_marcar_cuota_incobrable` | marcarCuotaIncobrableAction | ventas.editar (app/(app)/cuotas/actions.ts:54) | `supabase/migrations/00069_incobrables_sin_gasto.sql:193` | Ninguno |
| `sp_marcar_liquidacion_pagada` | marcarLiquidacionPagadaAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:454) | `supabase/migrations/00095_liquidacion_functions.sql:551` | Ninguno |
| `sp_marcar_rendicion_pagada` | marcarRendicionPagadaAction | rendiciones.editar (app/(app)/rendiciones/actions.ts:68) | `supabase/migrations/00126_rendicion_modulo.sql:457` | Ninguno |
| `sp_reactivar_acceso_revendedora` | crearRevendedoraAction (vía crearRevendedora fallback 422) | revendedoras.crear (app/(app)/revendedoras/actions.ts:16) | `supabase/migrations/00112_reactivar_acceso_revendedora.sql:17` | Ninguno |
| `sp_recalcular_precio_venta` | recalcularPrecioAction | precios.editar (app/(app)/precios/actions.ts:137) | `supabase/migrations/00019_precios_functions.sql:149` | `sp_recalcular_precios_batch` |
| `sp_recalcular_precios_batch` | recalcularPreciosBatchAction | precios.editar (app/(app)/precios/actions.ts:157) | `supabase/migrations/00040_precios_batch.sql:130` | Ninguno |
| `sp_rechazar_declaracion_venta` | rechazarDeclaracionAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:374) | `supabase/migrations/00104_declaracion_venta_functions.sql:238` | Ninguno |
| `sp_registrar_ajuste_inventario` | registrarAjusteInventarioAction | consignaciones.editar (app/(app)/consignaciones/actions.ts:205) | `supabase/migrations/00025_consignacion_functions.sql:281` | Ninguno |
| `sp_registrar_cambio` | registrarCambioAction | ventas.editar (app/(app)/ventas/actions.ts:176) | `supabase/migrations/00099_sp_registrar_cambio.sql:7` | Ninguno |
| `sp_registrar_cargo_tenant` | registrarCargoTenantAction | Superadmin plataforma: requireSuperAdmin() (app/(plataforma)/plataforma/actions.ts:32) | `supabase/migrations/00119_super_admin_plataforma.sql:169` | Ninguno |
| `sp_registrar_consulta_ayuda` | consultarAyudaAction | ayuda.consultar (app/(app)/ayuda/actions.ts:41) | `supabase/migrations/00127_ayuda.sql:110` | Ninguno |
| `sp_registrar_cotizacion_bcra` | sincronizarCotizacionBcraAction | precios.editar (app/(app)/precios/actions.ts:220) | `supabase/migrations/00133_sp_registrar_cotizacion_bcra_hoy.sql:68` | Ninguno |
| `sp_registrar_devolucion_cliente` | registrarDevolucionAction | ventas.editar (app/(app)/ventas/actions.ts:145) | `supabase/migrations/00110_finanzas_cambio_diferencia.sql:263` | Ninguno |
| `sp_registrar_devolucion_revendedora` | registrarDevolucionRevendedoraAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:274) | `supabase/migrations/00085_consignacion_revendedora_functions.sql:419` | `sp_devolver_items_revendedora` |
| `sp_registrar_gasto` | registrarGastoAction | gastos.crear (app/(app)/rendiciones/actions.ts:127) | `supabase/migrations/00053_gasto_descripcion_opcional_y_delete.sql:31` | Ninguno |
| `sp_registrar_pago_tenant` | registrarPagoTenantAction | Superadmin plataforma: requireSuperAdmin() (app/(plataforma)/plataforma/actions.ts:60) | `supabase/migrations/00119_super_admin_plataforma.sql:233` | Ninguno |
| `sp_registrar_venta` | registrarVentaAction | ventas.crear (app/(app)/ventas/actions.ts:60) | `supabase/migrations/00093_venta_revendedora_pago.sql:66` | `sp_confirmar_declaracion_venta` |
| `sp_reincluir_detalle_liquidacion` | reincluirDetalleLiquidacionAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:434) | `supabase/migrations/00095_liquidacion_functions.sql:488` | Ninguno |
| `sp_reincluir_detalle_rendicion` | reincluirDetalleRendicionAction | rendiciones.editar (app/(app)/rendiciones/actions.ts:107) | `supabase/migrations/00126_rendicion_modulo.sql:416` | Ninguno |
| `sp_retirar_declaracion` | retirarDeclaracionAction | Portal revendedora: auth_revendedora_id() is not null (app/(portal)/mi-cuenta/actions.ts:45) | `supabase/migrations/00105_declaracion_venta_invoker.sql:170` | Ninguno |
| `sp_revaluar_costos_usd_vigentes` | revaluarCostosUsdVigentesAction | precios.editar (app/(app)/precios/actions.ts:241) | `supabase/migrations/00143_costo_unico.sql:573` | Ninguno |
| `sp_set_configuracion_impresora` | setConfiguracionImpresoraAction | administracion.editar (app/(app)/administracion/actions.ts:188) | `supabase/migrations/00139_configuracion_impresora_etiquetas.sql:10` | Ninguno |
| `sp_set_configuracion_qr_lado_mm` | setConfiguracionQrLadoMmAction | administracion.editar (app/(app)/administracion/actions.ts:167) | `supabase/migrations/00113_configuracion_etiquetas_qr.sql:9` | Ninguno |
| `sp_set_costo_producto` | setCostoAction | inventario.editar (app/(app)/inventario/actions.ts:192) | `supabase/migrations/00143_costo_unico.sql:532` | Ninguno |
| `sp_set_cotizacion_manual` | setCotizacionManualAction | precios.editar (app/(app)/precios/actions.ts:178) | `supabase/migrations/00130_cotizacion_usd.sql:195` | Ninguno |
| `sp_set_modo_cotizacion` | setModoCotizacionAction | precios.editar (app/(app)/precios/actions.ts:199) | `supabase/migrations/00130_cotizacion_usd.sql:281` | Ninguno |
| `sp_set_presupuesto_categoria_gasto` | setPresupuestoCategoriaGastoAction | gastos.editar (app/(app)/rendiciones/actions.ts:167) | `supabase/migrations/00027_rendicion_gasto_functions.sql:301` | Ninguno |
| `sp_set_tenant_logo` | subirLogoAction<br>quitarLogoAction | administracion.editar (app/(app)/administracion/actions.ts:233, 255) | `supabase/migrations/00116_logo_tenant_storage.sql:102` | Ninguno |
| `sp_terminar_regla_comision` | terminarReglaComisionAction | revendedoras.editar (app/(app)/revendedoras/actions.ts:194) | `supabase/migrations/00087_comisiones_functions.sql:111` | Ninguno |
| `sp_toggle_tenant_modulo_admin` | togglePaqueteTenantAction | Superadmin plataforma: requireSuperAdmin() (app/(plataforma)/plataforma/actions.ts:93) | `supabase/migrations/00119_super_admin_plataforma.sql:368` | Ninguno |
| `sp_toggle_usuario_activo` | toggleUsuarioActivoAction | administracion.editar (app/(app)/administracion/actions.ts:62) | `supabase/migrations/00029_administracion_functions.sql:134` | Ninguno |
| `sp_transicion_item_producto` | transicionarItemAction | inventario.editar (app/(app)/inventario/actions.ts:394) | `supabase/migrations/00016_inventario_functions.sql:126` | `sp_anular_venta`, `sp_confirmar_consignacion_revendedora`, `sp_confirmar_salida_item`, `sp_eliminar_consignacion`, `sp_registrar_ajuste_inventario`, `sp_registrar_cambio`, `sp_registrar_devolucion_cliente`, `sp_registrar_devolucion_revendedora`, `sp_registrar_venta` |
| `sp_update_rol_permisos` | updateRolPermisosAction | administracion.editar (app/(app)/administracion/actions.ts:125) | `supabase/migrations/00029_administracion_functions.sql:46` | Ninguno |
| `sp_update_usuario` | updateUsuarioAction | administracion.editar (app/(app)/administracion/actions.ts:83) | `supabase/migrations/00009_seed_setup_functions.sql:12` | Ninguno |
| `sp_vencer_reservas` | vencerReservasAction | ventas.editar (app/(app)/ventas/actions.ts:267) | `supabase/migrations/00023_ventas_reservas_functions.sql:147` | Ninguno |

---

### 7.3. Procedimientos de uso doble (RPC + llamadas internas en SQL) — Decisión DR-RLSP-04

Existen procedimientos que son invocados tanto de forma directa vía `.rpc()` como internamente desde otros procedimientos almacenados de otros módulos. Para cada caso se identifican los tradeoffs de las tres alternativas de diseño arquitectónico:
- **(a) Sin chequeo**: No se incluye compuerta interna de permiso en el SP secundario, asumiendo que el SP principal o la Server Action que lo invoca ya validó la autorización.
- **(b) Entrada pública con chequeo + helper interno sin chequeo**: Se bifurca la función creando un helper interno (e.g. `fn_*_interna`) sin chequeo para las llamadas inter-SP, y una entrada pública `sp_*` con compuerta de permiso para las llamadas RPC del DAL. Implica adaptar llamadores.
- **(c) Revocar EXECUTE a `authenticated`**: Si ningún flujo de cliente requiere llamar la función por RPC, se elimina el privilegio de ejecución directa (`REVOKE EXECUTE ON FUNCTION ... FROM authenticated`), cerrando la superficie de ataque y permitiendo que sólo sea invocada por otros SPs en el servidor.

#### Casos identificados y análisis de opciones:

1. **`sp_transicion_item_producto`**
   - **Contexto**: Expuesto vía RPC en `lib/dal/inventario/item.ts:425` (`transicionarItemAction`, gated `inventario.editar`). Internamente es invocado por 9 procedimientos de múltiples módulos: `sp_registrar_venta`, `sp_anular_venta`, `sp_registrar_cambio`, `sp_registrar_devolucion_cliente` (Ventas); `sp_confirmar_consignacion_revendedora`, `sp_registrar_devolucion_revendedora` (Revendedoras); `sp_confirmar_salida_item`, `sp_eliminar_consignacion`, `sp_registrar_ajuste_inventario` (Consignaciones).
   - **Tradeoffs**:
     - *(a) Sin chequeo en el SP*:
       - *Pros*: Cero cambios en las 9 funciones llamadoras de otros módulos ni en el DAL.
       - *Contras*: Un usuario autenticado sin permiso de inventario pero con acceso al cliente RPC podría forzar transiciones de estado de ítems si conoce el ID.
     - *(b) Entrada pública + helper interno sin chequeo*:
       - *Pros*: Máxima seguridad y aislamiento estricto. La llamada directa desde inventario exige `inventario.editar`, mientras que las ventas y consignaciones llaman al helper interno sin fricción.
       - *Contras*: Requiere refactorizar la migración de los 9 SPs llamadores para invocar el nuevo helper.
     - *(c) Revocar EXECUTE a authenticated*:
       - *Inviable*: La UI en `/inventario/items` permite transiciones manuales de ítems (`transicionarItemAction`), por lo que el DAL necesita ejecutarla.
   - **Propuesta / Recomendación**: Opción (b) si se asume la migración de llamadores, u Opción (a) si se prioriza no alterar procedimientos vigentes de ventas y consignaciones en esta fase.

2. **`sp_calcular_costo_cobro`**
   - **Contexto**: Invocado internamente por `sp_registrar_venta` y `sp_cobrar_cuota` (ambos en Ventas). En la migración `00066_zona_horaria_tenant.sql:502` posee `GRANT EXECUTE ... TO authenticated`, pero **ningún archivo de `lib/dal` ni `app` lo llama vía RPC** (la interfaz de usuario utiliza una función equivalente en TypeScript en `lib/cobros/calcular-costo.ts`).
   - **Tradeoffs**:
     - *(a) Sin chequeo*: Funciona, pero mantiene un endpoint RPC innecesariamente expuesto a clientes autenticados.
     - *(b) Entrada pública + helper interno*: Innecesario ya que no existe llamada RPC desde el frontend ni el backend.
     - *(c) Revocar EXECUTE a authenticated*:
       - *Pros*: Solución limpia, canónica y de costo cero. Elimina exposición innecesaria ejecutando `REVOKE EXECUTE ON FUNCTION sp_calcular_costo_cobro(...) FROM authenticated`.
       - *Contras*: Ninguno.
   - **Propuesta / Recomendación**: Opción (c).

3. **`sp_gen_sku`**
   - **Contexto**: Invocado internamente por `sp_create_producto` e `sp_importar_remito` (Inventario). En `00036_sku_autogen.sql:42` posee `GRANT EXECUTE ... TO authenticated`, pero **ningún archivo de `lib/dal` ni `app` lo llama vía RPC**.
   - **Tradeoffs**:
     - *(a) Sin chequeo*: Inofensivo al ser un generador de secuencias de SKU, pero expone un procedimiento innecesario.
     - *(b) Entrada pública + helper interno*: Innecesario.
     - *(c) Revocar EXECUTE a authenticated*:
       - *Pros*: Cierra la superficie pública ejecutando `REVOKE EXECUTE ON FUNCTION sp_gen_sku(uuid) FROM authenticated`.
       - *Contras*: Ninguno.
   - **Propuesta / Recomendación**: Opción (c).

4. **`sp_registrar_gasto`**
   - **Contexto**: Expuesto vía RPC en `lib/dal/gastos/gasto.ts:238` (`registrarGastoAction`, gated `gastos.crear`). Históricamente (migración `00059`) fue invocado por `sp_marcar_cuota_incobrable`, pero dicha dependencia cruzada fue **completamente eliminada** en la definición vigente UP de `00069_incobrables_sin_gasto.sql:111`. Actualmente ningún otro SP lo llama por dentro en UP.
   - **Tradeoffs**:
     - Al no tener llamadores internos vigentes entre módulos, no sufre conflicto de doble uso: puede recibir chequeo directo y estricto de `auth_tiene_permiso('gastos', 'crear')`.

5. **`sp_registrar_venta`**
   - **Contexto**: Expuesto vía RPC en `lib/dal/ventas/venta.ts:176` (`registrarVentaAction`, gated `ventas.crear`). Internamente es invocado por `sp_confirmar_declaracion_venta` (`00085:463`) en el módulo Revendedoras (`revendedoras.editar`).
   - **Tradeoffs**:
     - *(a) Chequeo con disyunción OR*:
       - Predicado: `auth_tiene_permiso('ventas', 'crear') OR auth_tiene_permiso('revendedoras', 'editar')`.
       - *Pros*: Permite que ambos flujos convivan sin bifurcar funciones en la base de datos.
       - *Contras*: Acopla el SP de ventas con el permiso de revendedoras.
     - *(b) Helper interno sin chequeo + wrappers públicos*:
       - *Pros*: Desacopla permisos a nivel de base de datos.
       - *Contras*: Requiere tocar la migración de `sp_confirmar_declaracion_venta` y `sp_registrar_venta`.

> [!NOTE]
> La persona debe confirmar en **DR-RLSP-04** la elección de estrategia para estos 5 procedimientos previo a la generación de las migraciones de la Fase 5b.

---

### 7.4. Propuesta de partición de migraciones por módulo (Orden y Tamaño)

Se propone partir la aplicación de chequeos en **7 migraciones sucesivas e independientes**, ordenadas de mayor a menor riesgo de negocio (impacto financiero directo, existencias físicas y configuración crítica):

1. **Migración 1 — Módulo Ventas, Cuotas y Reservas (10 SPs · Riesgo Crítico / Máximo)**:
   - SPs: `sp_registrar_venta`, `sp_anular_venta`, `sp_registrar_devolucion_cliente`, `sp_registrar_cambio`, `sp_emitir_comprobante`, `sp_cobrar_cuota`, `sp_marcar_cuota_incobrable`, `sp_crear_reserva`, `sp_cancelar_reserva`, `sp_vencer_reservas`.
   - *Justificación*: Protege las entradas y salidas de dinero de la caja, devengamiento de intereses, cobranzas y la integridad de los comprobantes fiscales/comerciales.
2. **Migración 2 — Módulo Inventario (8 SPs · Riesgo Alto)**:
   - SPs: `sp_create_producto`, `sp_crear_stock_directo`, `sp_set_costo_producto`, `sp_asignar_talles_a_producto`, `sp_transicion_item_producto`, `sp_importar_remito`, `sp_confirmar_ingreso`, `sp_cancelar_ingreso`.
   - *Justificación*: Protege el stock físico del comercio, la valuación de existencias y las altas de mercadería.
3. **Migración 3 — Módulo Precios (9 SPs · Riesgo Medio-Alto)**:
   - SPs: `sp_create_regla_precio`, `sp_baja_regla_precio`, `sp_extender_vigencia_regla`, `sp_recalcular_precio_venta`, `sp_recalcular_precios_batch`, `sp_set_cotizacion_manual`, `sp_set_modo_cotizacion`, `sp_registrar_cotizacion_bcra`, `sp_revaluar_costos_usd_vigentes`.
   - *Justificación*: Protege los márgenes comerciales, reglas de descuento/recargo masivas y cotizaciones de moneda extranjera.
4. **Migración 4 — Módulos Consignaciones y Rendiciones de Proveedores (13 SPs · Riesgo Medio-Alto)**:
   - SPs Consignaciones (9): `sp_crear_consignacion_con_items`, `sp_editar_consignacion`, `sp_confirmar_consignacion`, `sp_eliminar_consignacion`, `sp_agregar_item_consignacion`, `sp_cancelar_item_consignacion`, `sp_confirmar_salida_item`, `sp_cerrar_consignacion`, `sp_registrar_ajuste_inventario`.
   - SPs Rendiciones (4): `sp_generar_rendicion`, `sp_marcar_rendicion_pagada`, `sp_excluir_detalle_rendicion`, `sp_reincluir_detalle_rendicion`.
   - *Justificación*: Protege la cuenta corriente con proveedores consignatarios y los pagos de liquidación.
5. **Migración 5 — Módulo Revendedoras (20 SPs · Riesgo Medio)**:
   - SPs Gestión (18): `sp_crear_revendedora`, `sp_editar_revendedora`, `sp_baja_revendedora`, `sp_enlazar_revendedora_usuario`, `sp_reactivar_acceso_revendedora`, `sp_crear_regla_comision`, `sp_terminar_regla_comision`, `sp_entregar_consignacion_revendedora`, `sp_editar_consignacion_revendedora`, `sp_confirmar_consignacion_revendedora`, `sp_registrar_devolucion_revendedora`, `sp_devolver_items_revendedora`, `sp_cerrar_consignacion_revendedora`, `sp_eliminar_consignacion_revendedora`, `sp_confirmar_declaracion_venta`, `sp_rechazar_declaracion_venta`, `sp_generar_liquidacion`, `sp_excluir_detalle_liquidacion`, `sp_reincluir_detalle_liquidacion`, `sp_marcar_liquidacion_pagada`.
   - SPs Portal (2): `sp_declarar_venta_revendedora`, `sp_retirar_declaracion`.
   - *Justificación*: Circuito cerrado de mercadería en poder de revendedoras externas y rendiciones de comisión.
6. **Migración 6 — Módulos Gastos y Administración (12 SPs · Riesgo Operativo)**:
   - SPs Gastos (3): `sp_registrar_gasto`, `sp_eliminar_gasto`, `sp_set_presupuesto_categoria_gasto`.
   - SPs Administración (9): `sp_toggle_usuario_activo`, `sp_update_usuario`, `sp_create_rol`, `sp_update_rol_permisos`, `sp_delete_rol`, `sp_set_configuracion_qr_lado_mm`, `sp_set_configuracion_impresora`, `sp_set_tenant_logo`, `sp_change_password_user`.
   - *Justificación*: Configuración de parámetros de la aplicación, roles de usuario y gastos menores del negocio.
7. **Migración 7 — Módulos Ayuda, Plataforma y Revocaciones de Funciones Internas (8 SPs · Riesgo Bajo / Aislado)**:
   - SPs Ayuda (2): `sp_registrar_consulta_ayuda`, `sp_calificar_consulta_ayuda`.
   - SPs Plataforma (6): `sp_alta_tenant`, `sp_cambiar_estado_tenant`, `sp_toggle_tenant_modulo_admin`, `sp_registrar_cargo_tenant`, `sp_registrar_pago_tenant`, `sp_anular_movimiento_tenant`.
   - Directivas `REVOKE EXECUTE`: `sp_calcular_costo_cobro`, `sp_gen_sku`.
   - *Justificación*: Procedimientos de auditoría de IA y funciones de super-administrador de plataforma (ya protegidas por comprobación de claim super-admin en DB).

---

### 7.5. Propagación de excepciones y compatibilidad con el catálogo de errores

Para garantizar que un rechazo de autorización en base de datos se traduzca de forma limpia e inteligible para el usuario:

1. **Excepción canónica en PostgreSQL**:
   Todo procedimiento de escritura que detecte falta de autorización lanzará la excepción estandarizada:
   ```sql
   if not auth_tiene_permiso('<modulo>', '<accion>') then
     raise exception 'no-permission' using errcode = '42501';
   end if;
   ```
2. **Propagación en la capa DAL (`extraerSlugRpc`)**:
   En el DAL, los clientes ejecutan `supabase.rpc('sp_*', ...)`. Ante un error devuelto por PostgreSQL con código `42501`, funciones como `extraerSlugRpc` (`lib/dal/ventas/venta.ts:159`, `lib/dal/precios/cotizacion.ts:31`) y `extraerSlugError` (`lib/dal/plataforma/index.ts:36`) limpian el prefijo del procedimiento (e.g. `sp_registrar_venta: no-permission` → `'no-permission'`).
3. **Traducción en UI (`lib/errores/mensajes.ts`)**:
   El catálogo centralizado de errores ya posee registrado el slug:
   - `lib/errores/mensajes.ts:66`:
     ```typescript
     'no-permission': 'Tu rol no te permite hacer esto.'
     ```
   - Además, la función unificada `mensajeDeError(reason, ctx)` (`lib/errores/mensajes.ts:526`) admite el contexto `ctx.accion` devolviendo `'Tu rol no te permite ' + ctx.accion + '.'`, y el escáner fallback de `MATCHERS` (`lib/errores/mensajes.ts:544`) detecta `no-permission` incluso si el mensaje de error preservase el prefijo del SP.
