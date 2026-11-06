# Spec — rls-por-permiso / rls-policies-por-permiso

**Change**: `rls-por-permiso` · **Requisitos**: `REQ-RLSP-01…07` · **Decisiones**: `DR-RLSP-01…03`

Este documento especifica la infraestructura de autorización en base de datos para Utopía (Fase 2 de `rls-por-permiso`), estableciendo policies `restrictive` por módulo/permiso y el helper `auth_tiene_permiso`, complementando las policies existentes de tenant y revendedoras sin alterarlas.

---

## 1. Requisitos

### REQ-RLSP-01 — Helper `auth_tiene_permiso`

La base de datos debe proveer una función `auth_tiene_permiso(p_modulo text, p_accion text) returns boolean` (`stable`, `security invoker`) que determine si el usuario autenticado posee el permiso indicado en el tenant activo, evaluando `usuario.id_rol → rol.permisos`.

- **Feliz**: Dado un usuario autenticado cuyo rol posee `p_accion` dentro del array del módulo `p_modulo` en `rol.permisos` (o cuyo rol es `'Administrador'`), cuando se invoca `auth_tiene_permiso(p_modulo, p_accion)`, entonces retorna `true`.
- **N1**: Usuario autenticado cuyo rol carece del permiso solicitado (o permiso revocado en `rol.permisos`) → retorna `false` inmediatamente en la consulta siguiente sin depender de la expiración del JWT.
- **N2**: Usuario de otro tenant (su `usuario.id_tenant` difiere de `auth_tenant_id()`) → retorna `false`.
- **N3**: Sin JWT / sesión anónima (`auth.uid() is null` o `auth_tenant_id() is null`) → retorna `false`.
- **N4**: Usuario con rol `'Revendedora'` (`auth_revendedora_id() is not null`) solicitando permisos de tenant estándar → retorna `false`.
- **N5**: Módulo o acción no existente en `CATALOGO_PERMISOS` o nulo → retorna `false`.
- **N6**: Usuario inactivo (`usuario.activo = false`) → retorna `false`.
- **N7**: Módulo no contratado o inactivo en el tenant (`tenant_modulo.activo = false`, sujeto a `DR-RLSP-01`) → retorna `false`.

---

### REQ-RLSP-02 — Aislamiento y control de acceso a `gasto_negocio`

La tabla `gasto_negocio` debe contar con una policy RLS `restrictive` que impida el acceso en lectura y escritura a cualquier actor que no cuente con el permiso de gastos (o reportes según `DR-RLSP-02`), o rol Administrador.

- **Feliz**:
  - Un usuario con `gastos.ver` (o `reportes.ver` según `DR-RLSP-02`) o `'Administrador'` puede consultar (`SELECT`) los gastos de su tenant.
  - Un usuario con `gastos.crear` o `'Administrador'` puede registrar gastos vía `sp_registrar_gasto` (`INSERT`).
  - Un usuario con `gastos.editar` o `'Administrador'` puede eliminar gastos vía `sp_eliminar_gasto` (`DELETE`).
- **N1**: Usuario autenticado del mismo tenant sin `gastos.ver` (ni `reportes.ver`) → `SELECT` devuelve 0 filas.
- **N2**: Usuario autenticado del mismo tenant sin `gastos.crear` o `gastos.editar` intentando mutar directamente → rechazo por violación de policy RLS (o 0 filas afectadas).
- **N3**: Usuario de otro tenant → no ve ni modifica ninguna fila (0 filas / rechazo).
- **N4**: Sin JWT / anónimo → 0 filas en `SELECT`, rechazo en mutación.
- **N5**: Usuario revendedora (`auth_revendedora_id() is not null`) → 0 filas en `SELECT`, rechazo en mutación (aislado por policy restrictiva previa y por falta de permiso).
- **N6**: Módulo `gastos` inactivo en el tenant (`tenant_modulo.activo = false`, según `DR-RLSP-01`) → 0 filas en `SELECT`, rechazo en mutación.

---

### REQ-RLSP-03 — Aislamiento y control de acceso a `categoria_gasto`

La tabla `categoria_gasto` debe contar con una policy RLS `restrictive` que limite su lectura a usuarios con `gastos.ver` (o `reportes.ver` según `DR-RLSP-02`) y sus mutaciones a usuarios con `gastos.crear`, `gastos.editar` o rol Administrador.

- **Feliz**:
  - Un usuario con `gastos.ver` (o `reportes.ver`) o `'Administrador'` puede listar (`SELECT`) las categorías de gasto del tenant.
  - Un usuario con `gastos.crear` o `'Administrador'` puede crear categorías (`INSERT`).
  - Un usuario con `gastos.editar` o `'Administrador'` puede renombrar, presupuestar, dar de baja o reactivar categorías (`UPDATE` / `DELETE`).
- **N1**: Usuario autenticado sin permiso `gastos.ver` (ni `reportes.ver`) → `SELECT` devuelve 0 filas.
- **N2**: Usuario autenticado sin permiso de escritura intentando `INSERT`/`UPDATE`/`DELETE` en `categoria_gasto` → rechazo por policy RLS.
- **N3**: Usuario de otro tenant → 0 filas visibles, 0 filas afectadas.
- **N4**: Sin JWT / anónimo → 0 filas en `SELECT`, rechazo en mutación.
- **N5**: Usuario revendedora → 0 filas en `SELECT`, rechazo en mutación.
- **N6**: Módulo `gastos` inactivo en el tenant (`DR-RLSP-01`) → 0 filas en `SELECT`, rechazo en mutación.

---

### REQ-RLSP-04 — Aislamiento y control de acceso a `rendicion_proveedor`

La tabla `rendicion_proveedor` debe contar con una policy RLS `restrictive` que limite su lectura a usuarios con `rendiciones.ver` (o `reportes.ver` según `DR-RLSP-02`) y sus mutaciones a usuarios con `rendiciones.crear`, `rendiciones.editar` o rol Administrador.

- **Feliz**:
  - Un usuario con `rendiciones.ver` (o `reportes.ver`) o `'Administrador'` puede consultar (`SELECT`) las rendiciones del tenant.
  - Un usuario con `rendiciones.crear` o `'Administrador'` puede generar rendiciones vía `sp_generar_rendicion` (`INSERT` y `UPDATE`).
  - Un usuario con `rendiciones.editar` o `'Administrador'` puede marcar rendiciones pagadas vía `sp_marcar_rendicion_pagada` (`UPDATE`).
- **N1**: Usuario autenticado sin `rendiciones.ver` (ni `reportes.ver`) → `SELECT` devuelve 0 filas.
- **N2**: Usuario autenticado sin `rendiciones.crear` ni `rendiciones.editar` intentando mutar `rendicion_proveedor` → rechazo por policy RLS.
- **N3**: Usuario de otro tenant → 0 filas visibles, rechazo en mutaciones.
- **N4**: Sin JWT / anónimo → 0 filas en `SELECT`, rechazo en mutación.
- **N5**: Usuario revendedora → 0 filas en `SELECT`, rechazo en mutación.
- **N6**: Módulo `rendiciones` inactivo en el tenant (`DR-RLSP-01`) → 0 filas en `SELECT`, rechazo en mutación.

---

### REQ-RLSP-05 — Aislamiento y control de acceso a `ingreso_mercaderia`

La tabla `ingreso_mercaderia` debe contar con una policy RLS `restrictive` que limite su lectura a usuarios con `inventario.ver` (o `reportes.ver` según `DR-RLSP-02`) y sus mutaciones a usuarios con `inventario.crear`, `inventario.eliminar` o rol Administrador.

- **Feliz**:
  - Un usuario con `inventario.ver` (o `reportes.ver`) o `'Administrador'` puede consultar (`SELECT`) remitos e ingresos de mercadería del tenant.
  - Un usuario con `inventario.crear` o `'Administrador'` puede registrar remitos borrador (`INSERT`) y confirmarlos vía `sp_confirmar_ingreso` (`UPDATE`).
  - Un usuario con `inventario.eliminar` o `'Administrador'` puede cancelar ingresos borrador vía `sp_cancelar_ingreso` (`DELETE`).
- **N1**: Usuario autenticado sin `inventario.ver` (ni `reportes.ver`) → `SELECT` devuelve 0 filas.
- **N2**: Usuario autenticado sin `inventario.crear` ni `inventario.eliminar` intentando insertar, actualizar o borrar ingresos → rechazo por policy RLS.
- **N3**: Usuario de otro tenant → 0 filas visibles, 0 filas modificadas.
- **N4**: Sin JWT / anónimo → 0 filas en `SELECT`, rechazo en mutación.
- **N5**: Usuario revendedora → 0 filas en `SELECT`, rechazo en mutación.
- **N6**: Módulo `inventario` inactivo en el tenant (`DR-RLSP-01`) → 0 filas en `SELECT`, rechazo en mutación.

---

### REQ-RLSP-06 — Aislamiento y control de acceso a `ingreso_mercaderia_detalle`

La tabla `ingreso_mercaderia_detalle` debe contar con una policy RLS `restrictive` que limite su lectura a usuarios con `inventario.ver` y sus mutaciones a usuarios con `inventario.crear`, `inventario.editar`, `inventario.eliminar` o rol Administrador.

- **Feliz**:
  - Un usuario con `inventario.ver` o `'Administrador'` puede consultar (`SELECT`) las líneas de detalle de un ingreso.
  - Un usuario con `inventario.crear` o `'Administrador'` puede insertar líneas de detalle vía `sp_importar_remito` o DAL (`INSERT`).
  - Un usuario con `inventario.editar` o `'Administrador'` puede remover líneas individuales de detalle antes de la confirmación vía DAL (`DELETE`).
  - Un usuario con `inventario.eliminar` o `'Administrador'` puede borrar los detalles al cancelar el remito vía `sp_cancelar_ingreso` (`DELETE`).
- **N1**: Usuario autenticado sin `inventario.ver` → `SELECT` devuelve 0 filas.
- **N2**: Usuario autenticado sin permiso de inventario intentando mutar líneas de detalle → rechazo por policy RLS.
- **N3**: Usuario de otro tenant → 0 filas visibles, 0 filas afectadas.
- **N4**: Sin JWT / anónimo → 0 filas en `SELECT`, rechazo en mutación.
- **N5**: Usuario revendedora → 0 filas en `SELECT`, rechazo en mutación.
- **N6**: Módulo `inventario` inactivo en el tenant (`DR-RLSP-01`) → 0 filas en `SELECT`, rechazo en mutación.

---

### REQ-RLSP-07 — Composición aditiva y no interferencia con RLS preexistentes

Las nuevas policies por permiso deben declararse como `as restrictive`. De acuerdo con la semántica de PostgreSQL:

1. Se combinan mediante un operador lógico `AND` con las policies preexistentes de tenant (`id_tenant = auth_tenant_id()`).
2. Se combinan mediante un operador lógico `AND` con las policies restrictivas preexistentes de revendedoras (`auth_revendedora_id() is null`).
3. Bajo ninguna circunstancia una policy restrictiva puede ampliar el acceso fuera del tenant o hacia datos de revendedoras ajenos.
4. El rol `'Administrador'` mantiene acceso completo a todas las operaciones sobre los datos pertenecientes a su tenant.

---

## 2. Matriz de permisos

La siguiente matriz define el comportamiento esperado para cada función y tabla cubierta en las Fases 3 y 4. Cada celda representa un caso de prueba verificable en `tests/db/rls-por-permiso.test.ts`.

| Función / Tabla | Operador con permiso | Operador sin permiso | Administrador | Revendedora | Módulo apagado (`DR-RLSP-01`) | Otro tenant | Sin JWT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `auth_tiene_permiso(m, a)` | `true` | `false` | `true` | `false` | `false` (si A1) / `true` (si A2) | `false` | `false` |
| `gasto_negocio` (SELECT) | Filas del tenant | 0 filas | Filas del tenant | 0 filas | 0 filas (si A1) | 0 filas | 0 filas |
| `gasto_negocio` (INSERT) | OK (`gastos.crear`) | Rechazo RLS | OK | Rechazo RLS | Rechazo RLS (si A1) | Rechazo / 0 filas | Rechazo |
| `gasto_negocio` (DELETE) | OK (`gastos.editar`) | Rechazo RLS | OK | Rechazo RLS | Rechazo RLS (si A1) | Rechazo / 0 filas | Rechazo |
| `categoria_gasto` (SELECT) | Filas del tenant | 0 filas | Filas del tenant | 0 filas | 0 filas (si A1) | 0 filas | 0 filas |
| `categoria_gasto` (INSERT/UPDATE/DELETE) | OK (`gastos.crear`/`editar`) | Rechazo RLS | OK | Rechazo RLS | Rechazo RLS (si A1) | Rechazo / 0 filas | Rechazo |
| `rendicion_proveedor` (SELECT) | Filas del tenant | 0 filas | Filas del tenant | 0 filas | 0 filas (si A1) | 0 filas | 0 filas |
| `rendicion_proveedor` (INSERT/UPDATE) | OK (`rendiciones.crear`/`editar`) | Rechazo RLS | OK | Rechazo RLS | Rechazo RLS (si A1) | Rechazo / 0 filas | Rechazo |
| `ingreso_mercaderia` (SELECT) | Filas del tenant | 0 filas | Filas del tenant | 0 filas | 0 filas (si A1) | 0 filas | 0 filas |
| `ingreso_mercaderia` (INSERT/UPDATE/DELETE) | OK (`inventario.crear`/`eliminar`) | Rechazo RLS | OK | Rechazo RLS | Rechazo RLS (si A1) | Rechazo / 0 filas | Rechazo |
| `ingreso_mercaderia_detalle` (SELECT) | Filas del tenant | 0 filas | Filas del tenant | 0 filas | 0 filas (si A1) | 0 filas | 0 filas |
| `ingreso_mercaderia_detalle` (INSERT/DELETE) | OK (`inventario.crear`/`editar`/`eliminar`) | Rechazo RLS | OK | Rechazo RLS | Rechazo RLS (si A1) | Rechazo / 0 filas | Rechazo |

---

## 3. Cifras financieras

**No aplica**: Este cambio no crea, recalcula ni altera cifras financieras, devengamientos, percepciones ni fórmulas contables. Únicamente implementa compuertas de seguridad a nivel de motor de base de datos (PostgreSQL RLS) para gobernar qué usuarios pueden leer o modificar registros existentes según su rol.

---

## 4. INVOKER contra RLS restrictiva

### 4.1. Alcance de la Fase 4: Confirmación y justificación de tablas

El objetivo de la Fase 4 es proteger las tablas cuyo acceso en `SELECT` **no requiere ningún permiso de ventas ni de revendedoras**. Se auditaron las candidatas de `tasks.md §Fase 4`:

#### Tablas Incluidas en Fase 4 (5 tablas):
1. **`gasto_negocio` (INCLUIDA)**:
   - *Justificación*: Su SELECT es exclusivo del módulo `gastos` (`gastos.ver`) y reportes financieros (`reportes.ver`). Ningún flujo operativo de `ventas` ni de `revendedoras` consulta gastos.
2. **`categoria_gasto` (INCLUIDA)**:
   - *Justificación*: Su SELECT es exclusivo del módulo `gastos` (`gastos.ver`) y del reporte de presupuesto mensual (`reportes.ver`). No es consultada por ventas ni revendedoras.
3. **`rendicion_proveedor` (INCLUIDA)**:
   - *Justificación*: Su SELECT es exclusivo del módulo `rendiciones` (`rendiciones.ver`) y de reportes de flujo/posición (`reportes.ver`). No interviene en checkout, preventa ni canal revendedora.
4. **`ingreso_mercaderia` (INCLUIDA)**:
   - *Justificación*: Su SELECT es exclusivo de `inventario` (`inventario.ver`) y del reporte de flujo de fondos (`reportes.ver`). Ni ventas ni revendedoras leen remitos ni cabeceras de ingreso.
5. **`ingreso_mercaderia_detalle` (INCLUIDA)**:
   - *Justificación*: Su SELECT es 100% exclusivo de `inventario` (`inventario.ver`) para visualizar los ítems del remito. No tiene lecturas cruzadas en ningún otro módulo.

#### Tablas Excluidas de Fase 4 (2 tablas):
1. **`costo_producto` (EXCLUIDA)**:
   - *Justificación*: Aunque es una tabla central de costos, los procedimientos almacenados de venta (`sp_registrar_venta`, con permiso `ventas.crear`) y confirmación de ventas de revendedora (`sp_confirmar_declaracion_venta`, con permiso `revendedoras.editar`) son `SECURITY INVOKER` y realizan `SELECT costo FROM costo_producto` para registrar el `costo_snapshot` inmutable en `detalle_venta`. Si se aplicara una policy restrictiva exigiendo solo `inventario.ver` o `precios.ver`, los vendedores y revendedoras no podrían registrar ventas o registrarían costos nulos. Además, `precios` la muta masivamente (`sp_revaluar_costos_usd_vigentes`). Según `proposal.md §4`, el tratamiento de costos y márgenes se difiere al cambio específico `costos-por-columna`.
2. **`proveedor` (EXCLUIDA)**:
   - *Justificación*: Es una tabla compartida leída transversalmente por 5 módulos distintos: `inventario.ver` (catálogo y compras), `precios.ver` (filtros en control de precios), `consignaciones.ver` (selección de consignatario), `rendiciones.ver` (liquidación a proveedores) y `reportes.ver` (perfil proveedor). No pertenece exclusivamente a un módulo y requiere una policy multi-permiso que se abordará en una fase posterior.

---

### 4.2. Análisis de funciones INVOKER y lecturas cruzadas

Dado que todas las funciones de dominio son `SECURITY INVOKER`, se ejecutó una auditoría exhaustiva sobre los procedimientos y vistas que cruzan las 5 tablas de Fase 4:

1. **`rf_finanzas_resultados`, `rf_finanzas_flujo`, `rf_finanzas_posicion`, `rf_finanzas_gastos_presupuesto`, `rf_dashboard_kpis`, `rf_reporte_caja`**:
   - *Origen*: Módulo `reportes`, invocadas bajo permiso `reportes.ver`.
   - *Tablas cruzadas*: Leen `gasto_negocio`, `categoria_gasto`, `rendicion_proveedor`, `ingreso_mercaderia`.
   - *Resolución sin DEFINER*: No requiere `SECURITY DEFINER`. Se resuelve directamente en la definición de la policy RLS restrictiva de cada tabla mediante la disyunción:
     ```sql
     using (
       (select auth_tiene_permiso('gastos', 'ver'))
       or (select auth_tiene_permiso('reportes', 'ver'))
     )
     ```
     (Ver Decisión Abierta `DR-RLSP-02`). De este modo, la función INVOKER corre con el contexto del usuario autenticado con permiso `reportes.ver` y lee legítimamente los registros necesarios para el balance sin violar RLS.
2. **`sp_marcar_cuota_incobrable` (Módulo `ventas`, permiso `ventas.eliminar`)**:
   - *Auditoría*: En la migración histórica `00059` y en el bloque DOWN de `00069`, esta función insertaba una fila en `categoria_gasto` y llamaba a `sp_registrar_gasto`.
   - *Definición vigente en producción (`00069_incobrables_sin_gasto.sql:111`)*: La definición activa **removió por completo** la creación de gastos e interacción con `categoria_gasto`. Su alcance se limita a actualizar `cuota_financiada` a estado `'incobrable'` e insertar en `auditoria`.
   - *Conclusión*: No existe cruce activo entre `ventas` y `categoria_gasto` en producción.
3. **Procedimientos de mutación de ingresos y rendiciones (`sp_confirmar_ingreso`, `sp_cancelar_ingreso`, `sp_importar_remito`, `sp_generar_rendicion`, `sp_marcar_rendicion_pagada`)**:
   - Todos corresponden a sus módulos naturales (`inventario` y `rendiciones`) y son ejecutados por Server Actions con las compuertas `inventario.crear`/`eliminar` y `rendiciones.crear`/`editar`. No cruzan tablas de Fase 4 bajo permisos ajenos.

> [!IMPORTANT]
> **Dictamen de DEFINER**: **Ninguna función de dominio requiere elevar privilegios a `SECURITY DEFINER`.** Todas las lecturas y mutaciones operan de manera determinista bajo `SECURITY INVOKER`.

---

## 5. Migraciones

- Las migraciones asociadas a este cambio se numerarán con **el siguiente número libre** en `supabase/migrations/` al momento de su creación efectiva en las Fases 3 y 4 (`ls supabase/migrations | tail -1`).
- Cada migración debe incluir un bloque `-- DOWN:` ejecutable completo (con líneas descriptivas precedidas por `-- NOTE:`) verificado contra `pnpm gate:db`.
- No se editará ninguna migración preexistente en la rama `main`; cualquier ajuste se realizará hacia adelante (*fix-forward*).

---

## 6. Decisiones abiertas para la persona

A continuación se presentan las tres decisiones de arquitectura pendientes de resolución por parte de la persona, junto a su análisis técnico, recomendación y tradeoffs.

### DR-RLSP-01 — ¿La policy RLS exige además el módulo habilitado (`tenant_modulo`)?

- **Pregunta**: Al evaluar el acceso a una tabla mediante `auth_tiene_permiso` o en la policy RLS, ¿se debe verificar si el módulo está habilitado en `tenant_modulo.activo = true` para el tenant actual?
- **Opciones**:
  - **Opción A1 (Doble validación en DB)**: La policy RLS o el helper `auth_tiene_permiso` verifica tanto el permiso del usuario como `exists (select 1 from tenant_modulo where id_tenant = auth_tenant_id() and modulo = p_modulo and activo = true)`.
  - **Opción A2 (Recomendada — Separación de responsabilidades)**: La policy RLS evalúa únicamente el permiso del usuario (`auth_tiene_permiso`). La habilitación de módulos por tenant permanece gobernada por las Server Actions (`requireModuleRole`), los layouts y los triggers de integridad preexistentes (`00118_guarda_tenant_modulo.sql`).
- **Tradeoffs**:
  - *Opción A1*: Garantiza hermetismo total en PostgREST si un tenant da de baja un módulo. Sin embargo, agrega un lookup adicional por consulta en una tabla dinámica (`tenant_modulo`), introduce penalizaciones de rendimiento y bloquearía la lectura de auditoría o históricos de datos preexistentes si un módulo se desactiva temporalmente.
  - *Opción A2 (Recomendada)*: Máxima performance (un único lookup indexado `usuario → rol`), simpleza arquitectónica y respeta los dominios: RLS modela la autorización y el aislamiento de datos del actor; la suscripción a módulos gobierna el acceso funcional a la aplicación.

---

### DR-RLSP-02 — ¿`reportes.ver` alcanza para leer gastos y rendiciones?

- **Pregunta**: Las funciones de reportes financieros (`rf_finanzas_resultados`, `rf_finanzas_flujo`, `rf_reporte_caja`, `rf_dashboard_kpis`) son `SECURITY INVOKER` y consultan directamente `gasto_negocio`, `categoria_gasto`, `rendicion_proveedor` e `ingreso_mercaderia`. ¿La policy de `SELECT` de estas tablas debe incluir el permiso `reportes.ver`?
- **Opciones**:
  - **Opción B1 (Recomendada — Reportes autocontenidos)**: La policy de lectura de estas tablas admite `auth_tiene_permiso('<modulo>', 'ver') OR auth_tiene_permiso('reportes', 'ver')`.
  - **Opción B2 (Aislamiento estricto por módulo)**: La policy exige estrictamente el permiso del módulo respectivo (`gastos.ver`, `rendiciones.ver`, `inventario.ver`).
- **Tradeoffs**:
  - *Opción B1 (Recomendada)*: Un usuario con rol de "Contador", "Auditor" o "Socio" con permiso `reportes.ver` puede visualizar reportes consolidados fidedignos sin necesidad de que se le otorguen permisos operativos de carga en `gastos` o `rendiciones`. Evita reportes mutilados donde los gastos figuren en $0. Como contrapartida, permite que quien tiene `reportes.ver` pueda consultar las filas individuales de gastos por PostgREST directo (información que de todas formas ya visualiza agregada en las pantallas de reportes).
  - *Opción B2*: Aislamiento estricto a nivel de tabla. Sin embargo, si a un analista financiero no se le asigna `gastos.ver`, los reportes no fallan sino que devuelven resultados silenciosamente incompletos y financieramente engañosos (EBITDA distorsionado), rompiendo la confiabilidad del sistema contable.

---

### DR-RLSP-03 — Firma y semántica de `auth_tiene_permiso`

- **Pregunta**: ¿Cuál es la firma exacta, tratamiento del Administrador y validación de estado que debe implementar la función `auth_tiene_permiso`?
- **Opciones de Firma**:
  - **C1 (Recomendada)**: `auth_tiene_permiso(p_modulo text, p_accion text) returns boolean`.
  - **C2**: `auth_tiene_permiso(p_permiso text) returns boolean` (ej. `'gastos.ver'`).
- **Opciones de Semántica**:
  - **Tratamiento del Administrador**:
    - *Opción Sem-1*: Chequeo directo en JSONB `rol.permisos -> p_modulo ? p_accion` (el aprovisionamiento le otorga todos los permisos al Administrador).
    - *Opción Sem-2 (Recomendada)*: `(rol.permisos -> p_modulo ? p_accion) OR (rol.nombre = 'Administrador')`. Garantiza inmunidad ante desincronizaciones de catálogo al agregar nuevos módulos/acciones.
  - **Estado del usuario**:
    - Debe exigir estrictamente `usuario.activo = true` y coincidencia de tenant (`usuario.id_tenant = auth_tenant_id()`).
  - **Estabilidad**:
    - Función declarada como `stable` y `parallel safe` para permitir que el planificador de consultas de Postgres la evalúe una única vez por consulta (`InitPlan`) cuando se utiliza como `(select auth_tiene_permiso(...))`.
- **Tradeoffs**:
  - La firma de dos argumentos (`p_modulo, p_accion`) coincide exactamente con el contrato en TypeScript `requireModuleRole(session, modulo, accion)` de `lib/dal/guard.ts`, evitando manipulación de strings en SQL (`split_part`).

---

## Apéndice A — Evidencia mecánica de escrituras reales

A continuación se transcribe la salida exacta, mecánica e inalterada de las búsquedas ejecutadas en el repositorio:
1. Sobre las definiciones vigentes de procedimientos almacenados `sp_*` (`pnpm sp:last` extraído de `supabase/migrations/`):
   `rg -n -i "(insert into|update|delete from)\s+<tabla>\b"`
2. Sobre la capa de acceso a datos (`lib/dal`):
   `rg -n "from\('<tabla>'\)\.(insert|update|upsert|delete)" lib/dal`
   `rg -U -n "from\('<tabla>'\)\s*\.(insert|update|upsert|delete)" lib/dal`

```text
============================================================
TABLA: gasto_negocio
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+gasto_negocio\b" <sp_vigentes> ---
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_eliminar_gasto.sql:23:  delete from gasto_negocio where id_gasto = p_id_gasto;
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_registrar_gasto.sql:23:  insert into gasto_negocio(id_tenant, id_categoria_gasto, id_usuario_alta,

--- Comando DAL (single-line): rg -n "from\('gasto_negocio'\)\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

--- Comando DAL (multiline): rg -U -n "from\('gasto_negocio'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

============================================================
TABLA: categoria_gasto
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+categoria_gasto\b" <sp_vigentes> ---
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_marcar_cuota_incobrable.sql:58:  insert into categoria_gasto(id_tenant, nombre, descripcion)
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_set_presupuesto_categoria_gasto.sql:20:  update categoria_gasto

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

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+rendicion_proveedor\b" <sp_vigentes> ---
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_generar_rendicion.sql:48:  insert into rendicion_proveedor(
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_generar_rendicion.sql:76:  update rendicion_proveedor
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_marcar_rendicion_pagada.sql:29:  update rendicion_proveedor

--- Comando DAL (single-line): rg -n "from\('rendicion_proveedor'\)\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

--- Comando DAL (multiline): rg -U -n "from\('rendicion_proveedor'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

============================================================
TABLA: ingreso_mercaderia
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+ingreso_mercaderia\b" <sp_vigentes> ---
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_cancelar_ingreso.sql:75:  delete from ingreso_mercaderia
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_confirmar_ingreso.sql:59:  update ingreso_mercaderia

--- Comando DAL (single-line): rg -n "from\('ingreso_mercaderia'\)\.(insert|update|upsert|delete)" lib/dal ---
lib/dal\inventario\ingreso.ts:168:    .from('ingreso_mercaderia').insert(payload).select('id_ingreso').single()

--- Comando DAL (multiline): rg -U -n "from\('ingreso_mercaderia'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
lib/dal\inventario\ingreso.ts:168:    .from('ingreso_mercaderia').insert(payload).select('id_ingreso').single()

============================================================
TABLA: ingreso_mercaderia_detalle
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+ingreso_mercaderia_detalle\b" <sp_vigentes> ---
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_cancelar_ingreso.sql:56:  delete from ingreso_mercaderia_detalle
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_importar_remito.sql:129:      insert into ingreso_mercaderia_detalle(

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

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+costo_producto\b" <sp_vigentes> ---
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_importar_remito.sql:85:        insert into costo_producto(
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_revaluar_costos_usd_vigentes.sql:68:    update costo_producto
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_revaluar_costos_usd_vigentes.sql:73:    insert into costo_producto (
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_set_costo_producto.sql:26:  update costo_producto
C:/Users/tomyc/.gemini/antigravity/brain/b8208245-f7e1-469e-a43b-3441d4d71574/scratch/sp_vigentes\sp_set_costo_producto.sql:32:  insert into costo_producto(

--- Comando DAL (single-line): rg -n "from\('costo_producto'\)\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

--- Comando DAL (multiline): rg -U -n "from\('costo_producto'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
(sin coincidencias)

============================================================
TABLA: proveedor
============================================================

--- Comando SP: rg -n -i "(insert into|update|delete from)\s+proveedor\b" <sp_vigentes> ---
(sin coincidencias)

--- Comando DAL (single-line): rg -n "from\('proveedor'\)\.(insert|update|upsert|delete)" lib/dal ---
lib/dal\inventario\proveedor.ts:43:    .from('proveedor').insert(input).select('*').single()
lib/dal\inventario\proveedor.ts:54:    .from('proveedor').update(patch).eq('id_proveedor', id)

--- Comando DAL (multiline): rg -U -n "from\('proveedor'\)\s*\.(insert|update|upsert|delete)" lib/dal ---
lib/dal\inventario\proveedor.ts:43:    .from('proveedor').insert(input).select('*').single()
lib/dal\inventario\proveedor.ts:54:    .from('proveedor').update(patch).eq('id_proveedor', id)
```

*(Nota sobre `sp_marcar_cuota_incobrable`: la búsqueda en `sp_vigentes` extrajo el bloque `/* -- DOWN: */` de la migración `00069_incobrables_sin_gasto.sql` debido al anidamiento en comentarios de bloque. La definición vigente UP en `00069:111` eliminó la inserción en `categoria_gasto` y la llamada a `sp_registrar_gasto`, por lo que en producción ninguna función de ventas escribe en tablas de gastos).*
