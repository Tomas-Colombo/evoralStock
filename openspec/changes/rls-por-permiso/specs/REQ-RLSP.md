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
