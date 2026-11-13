# Propuesta — RLS Cerrado por Defecto (rls-cerrado-por-defecto)

**Change**: `rls-cerrado-por-defecto` · **Spec**: `proposal.md` + `specs/REQ-RCD.md` · **Tareas**: `tasks.md`

---

## 1. Problema y Diagnóstico

### El Incidente del 2026-11-13
En pruebas locales de seguridad con usuarios autenticados, se reprodujo una vulnerabilidad crítica:
1. **Escalada de privilegios**: Un JWT con un `tenant_id` válido pero sin ningún permiso asignado (rol vacío) pudo ejecutar un `UPDATE` sobre la tabla `rol` vía PostgREST y otorgarse a sí mismo permisos de `Administrador`.
2. **Exposición masiva de datos**: El mismo usuario pudo ejecutar un `SELECT * FROM cliente` vía PostgREST y obtener todos los nombres, DNI, teléfonos y direcciones de los clientes del tenant.

### Causa Raíz
Las migraciones `00159` y `00160` sellaron `rol` y `usuario` aplicando policies restrictivas por permiso e implementando `auth_tiene_permiso` como `SECURITY DEFINER` para evitar recursión. Sin embargo, el resto de la base de datos permanece vulnerable:
- **42 tablas base de dominio** en `public` solo cuentan con la policy permisiva de aislamiento `*_all_own_tenant` (`using (id_tenant = auth_tenant_id())`) y la policy restrictiva de revendedoras (`auth_revendedora_id() is null`). No tienen ninguna policy restrictiva que valide permisos del módulo (`auth_tiene_permiso`).
- **6 tablas adicionales** tienen blindaje parcial (solo en `SELECT`, ej. `costo_producto`, `regla_precio`), pero sus operaciones de `INSERT`, `UPDATE` y `DELETE` siguen cubiertas por `ALL` permisivo para cualquier usuario del tenant.
- **51 de 56 tablas** conservan privilegios `GRANT SELECT` a favor del rol `anon`.
- **48 tablas** conservan privilegios `GRANT INSERT, UPDATE, DELETE` a favor del rol `anon`.
- **53 tablas** conservan `GRANT INSERT, UPDATE, DELETE` a favor de `authenticated`, permitiendo mutaciones directas vía PostgREST omitiendo los `sp_*` de negocio.

La frontera de seguridad hoy depende excesivamente de las Server Actions (`requireModuleRole`), pero la API PostgREST y el SDK cliente (`supabase-js`) están expuestos a la red con la publishable/anon key y un JWT válido.

---

## 2. Registro de Permisos por Tabla: Arquitectura y Tradeoffs

Para que el modelo sea auditable, mantenible y mecánicamente verificable en CI/gate, el sistema requiere un **Registro Único de Políticas de Acceso por Tabla y Comando**.

### Dónde vive el registro: Análisis de Tradeoffs

| Alternativa | Ventajas | Desventajas | Veredicto |
| --- | --- | --- | --- |
| **Opción A: Catálogo TS en `lib/seguridad/permisos-tablas.ts`** | - Verificado en build time y TDD.<br>- Tipeado estricto contra `CATALOGO_PERMISOS`.<br>- Cero overhead en runtime de PostgreSQL.<br>- Consumible directamente por el test guardián (`tests/db/rls-guardian.test.ts`).<br>- Mismo patrón que `CATALOGO_PERMISOS` y `modulos.md`. | No consultable desde funciones PL/pgSQL puras. | **Recomendada** |
| **Opción B: Tabla en PostgreSQL (`seguridad_tabla_permiso`)** | - Consultable desde SQL.<br>- Podría dinamizar policies. | - Overhead por consulta en cada initplan/query de RLS.<br>- Riesgo de recursión RLS si se consulta en policies.<br>- Requiere migración y sincronización de datos con el código TS.<br>- Más lenta la verificación en CI. | Descartada |
| **Opción C: Comentarios estructurados (`COMMENT ON TABLE`)** | - Vive en metadatos de PostgreSQL. | - Frágil, difícil de tipar y validar con TypeScript.<br>- Parser propenso a errores. | Descartada |

**Recomendación**: **Opción A**. El catálogo vive en `lib/seguridad/permisos-tablas.ts` (en TypeScript) y define formalmente las expectativas de seguridad para cada tabla. El test guardián en `tests/db` lee este catálogo, consulta `pg_tables`, `pg_policies` y `information_schema`, y falla si la base de datos real difiere del catálogo.

### Estructura y Tipado del Registro
Cada tabla se declara con sus 4 comandos (`select`, `insert`, `update`, `delete`):
```ts
export type ReglaAccesoComando =
  | { tipo: 'permiso'; or: Permiso[] }
  | { tipo: 'solo_definer' }
  | { tipo: 'todo_el_tenant'; razon: string }
  | { tipo: 'solo_lectura' } // para update/delete prohibidos en tablas inmutables

export interface PermisosTabla {
  modulo: ModuloPermiso | 'nucleo' | 'plataforma'
  select: ReglaAccesoComando
  insert: ReglaAccesoComando
  update: ReglaAccesoComando
  delete: ReglaAccesoComando
}
```

---

## 3. Clasificación Propuesta de las 43 Tablas Abiertas/Parciales

> **Regla Inflexible**: Los datos personales (`cliente`, `usuario`) y el dinero (`venta`, `pago_venta`, `cuota_financiada`, `cuenta_destino`, `gasto_negocio`, `categoria_gasto`, `reintegro_cliente`, `arancel_cobro`) **NUNCA** quedan con regla `todo_el_tenant`.

A continuación, la clasificación exhaustiva de las 43 tablas que hoy carecen de cierre RLS completo (37 abiertas + 6 parciales):

### Grupo 1: Dinero y Transacciones Financieras (6 tablas)
1. **`venta`**:
   - `select`: `['ventas.ver', 'reportes.ver', 'revendedoras.ver']` (la revendedora además está filtrada a lo suyo por `rvp_*`).
   - `insert`: `['ventas.crear']` (usado por `sp_registrar_venta`).
   - `update`: `['ventas.eliminar']` (solo para anulación vía `sp_anular_venta`).
   - `delete`: `{ tipo: 'solo_definer' }` (las ventas nunca se borran físicamente).
2. **`pago_venta`**:
   - `select`: `['ventas.ver', 'reportes.ver']`.
   - `insert`: `['ventas.crear', 'ventas.editar']` (creado en venta o al cobrar cuota).
   - `update`: `['ventas.eliminar']` (reversas en anulación).
   - `delete`: `{ tipo: 'solo_definer' }`.
3. **`cuota_financiada`**:
   - `select`: `['ventas.ver', 'reportes.ver']`.
   - `insert`: `['ventas.crear']` (en venta financiada).
   - `update`: `['ventas.editar', 'ventas.eliminar']` (cobro de cuotas o anulación).
   - `delete`: `{ tipo: 'solo_definer' }`.
4. **`cuenta_destino`**:
   - `select`: `['ventas.ver', 'ventas.crear', 'gastos.ver', 'administracion.ver']` (requerida al cobrar o pagar).
   - `insert`: `['administracion.crear']`.
   - `update`: `['administracion.editar']`.
   - `delete`: `['administracion.eliminar']`.
5. **`arancel_cobro`**:
   - `select`: `['ventas.ver', 'ventas.crear', 'administracion.ver']`.
   - `insert`: `['administracion.crear']`.
   - `update`: `['administracion.editar']`.
   - `delete`: `['administracion.eliminar']`.
6. **`reintegro_cliente`**:
   - `select`: `['ventas.ver', 'reportes.ver']`.
   - `insert`: `['ventas.crear']` (en cambios de mercadería con saldo a favor).
   - `update`: `['ventas.editar']`.
   - `delete`: `{ tipo: 'solo_definer' }`.

### Grupo 2: Datos Personales y Entidades Comerciales (4 tablas)
7. **`cliente`**:
   - `select`: `['ventas.ver', 'ventas.crear']`.
   - `insert`: `['ventas.crear']`.
   - `update`: `['ventas.editar']`.
   - `delete`: `['ventas.eliminar']`.
8. **`proveedor`**:
   - `select`: `['inventario.ver', 'consignaciones.ver', 'rendiciones.ver', 'reportes.ver']`.
   - `insert`: `['inventario.crear']`.
   - `update`: `['inventario.editar']`.
   - `delete`: `['inventario.eliminar']`.
9. **`revendedora`**:
   - `select`: `['revendedoras.ver', 'ventas.crear']` (la revendedora lee su propia fila vía `revendedora_propia`).
   - `insert`: `['revendedoras.crear']`.
   - `update`: `['revendedoras.editar']`.
   - `delete`: `['revendedoras.eliminar']`.
10. **`pago_revendedora`**:
    - `select`: `['revendedoras.ver', 'reportes.ver']`.
    - `insert`: `['revendedoras.liquidar']`.
    - `update`: `{ tipo: 'solo_definer' }`.
    - `delete`: `{ tipo: 'solo_definer' }`.

### Grupo 3: Stock y Movimientos Operativos (9 tablas)
11. **`item_producto`**:
    - `select`: `{ tipo: 'todo_el_tenant', razon: 'El stock disponible de la tienda es necesario para escanear y vender (ventas), auditar inventario (inventario), consignar mercadería y mostrar catálogo operativo. Los costos están segregados en item_costo.' }`.
    - `insert`: `['inventario.crear']` (vía `sp_confirmar_ingreso`, `sp_crear_stock_directo`).
    - `update`: `['inventario.editar', 'ventas.crear', 'ventas.eliminar', 'consignaciones.crear', 'consignaciones.editar', 'revendedoras.crear', 'revendedoras.editar']` (mutación de estado_item en ventas, consignaciones y ajustes).
    - `delete`: `['inventario.eliminar']`.
12. **`movimiento_item`**:
    - `select`: `['inventario.ver']`.
    - `insert`: `['inventario.crear', 'inventario.editar', 'ventas.crear', 'ventas.eliminar', 'consignaciones.crear', 'revendedoras.crear']`.
    - `update`: `{ tipo: 'solo_definer' }` (inmutable por trigger).
    - `delete`: `{ tipo: 'solo_definer' }`.
13. **`detalle_venta`**:
    - `select`: `['ventas.ver', 'rendiciones.ver', 'reportes.ver', 'revendedoras.liquidar']`.
    - `insert`: `['ventas.crear']`.
    - `update`: `['ventas.eliminar', 'rendiciones.crear', 'revendedoras.liquidar']` (anulación o liquidación).
    - `delete`: `{ tipo: 'solo_definer' }` (inmutable por trigger).
14. **`cambio_venta`**:
    - `select`: `['ventas.ver', 'reportes.ver']`.
    - `insert`: `['ventas.crear']`.
    - `update`: `{ tipo: 'solo_definer' }`.
    - `delete`: `{ tipo: 'solo_definer' }`.
15. **`devolucion_venta`**:
    - `select`: `['ventas.ver', 'reportes.ver']`.
    - `insert`: `['ventas.crear', 'ventas.editar']`.
    - `update`: `{ tipo: 'solo_definer' }`.
    - `delete`: `{ tipo: 'solo_definer' }`.
16. **`reserva`**:
    - `select`: `['ventas.ver', 'ventas.crear']`.
    - `insert`: `['ventas.crear']`.
    - `update`: `['ventas.crear', 'ventas.editar']`.
    - `delete`: `['ventas.eliminar']`.
17. **`detalle_reserva`**:
    - `select`: `['ventas.ver', 'ventas.crear']`.
    - `insert`: `['ventas.crear']`.
    - `update`: `['ventas.crear', 'ventas.editar']`.
    - `delete`: `['ventas.eliminar']`.
18. **`comprobante`**:
    - `select`: `['ventas.ver']`.
    - `insert`: `['ventas.crear']`.
    - `update`: `{ tipo: 'solo_definer' }`.
    - `delete`: `{ tipo: 'solo_definer' }`.
19. **`ingreso_mercaderia`**:
    - `select`: `['inventario.ver']`.
    - `insert`: `['inventario.crear']`.
    - `update`: `['inventario.editar', 'inventario.crear']` (confirmar remito).
    - `delete`: `['inventario.eliminar']`.

### Grupo 4: Consignaciones y Canal Revendedoras (6 tablas)
20. **`consignacion`**:
    - `select`: `['consignaciones.ver']`.
    - `insert`: `['consignaciones.crear']`.
    - `update`: `['consignaciones.editar']`.
    - `delete`: `['consignaciones.eliminar']`.
21. **`consignacion_detalle`**:
    - `select`: `['consignaciones.ver']`.
    - `insert`: `['consignaciones.crear']`.
    - `update`: `['consignaciones.editar']`.
    - `delete`: `['consignaciones.eliminar']`.
22. **`consignacion_revendedora`**:
    - `select`: `['revendedoras.ver']`.
    - `insert`: `['revendedoras.crear']`.
    - `update`: `['revendedoras.editar']`.
    - `delete`: `['revendedoras.eliminar']`.
23. **`consignacion_revendedora_detalle`**:
    - `select`: `['revendedoras.ver', 'ventas.crear']` (evaluado en venta para transferir stock en consignación).
    - `insert`: `['revendedoras.crear']`.
    - `update`: `['revendedoras.editar', 'ventas.crear']`.
    - `delete`: `['revendedoras.eliminar']`.
24. **`declaracion_venta_revendedora`**:
    - `select`: `['revendedoras.ver']`.
    - `insert`: `['revendedoras.declarar']`.
    - `update`: `['revendedoras.editar']`.
    - `delete`: `['revendedoras.editar', 'revendedoras.declarar']`.
25. **`liquidacion_revendedora`**:
    - `select`: `['revendedoras.ver']`.
    - `insert`: `['revendedoras.liquidar']`.
    - `update`: `['revendedoras.liquidar']`.
    - `delete`: `['revendedoras.eliminar']`.

### Grupo 5: Catálogo, Artículos y Reglas de Precios (7 tablas)
26. **`producto`**:
    - `select`: `{ tipo: 'todo_el_tenant', razon: 'El catálogo de productos (nombres, descripciones, talles, precios de venta) es de consulta indispensable para cualquier empleado de la tienda para venta, inventario y etiquetado.' }`.
    - `insert`: `['inventario.crear']`.
    - `update`: `['inventario.editar']`.
    - `delete`: `['inventario.eliminar']`.
27. **`categoria`**:
    - `select`: `{ tipo: 'todo_el_tenant', razon: 'Estructura de navegación del catálogo requerida por filtros de venta, inventario y reportes.' }`.
    - `insert`: `['inventario.crear']`.
    - `update`: `['inventario.editar']`.
    - `delete`: `['inventario.eliminar']`.
28. **`producto_sku_seq`**:
    - `select`: `{ tipo: 'todo_el_tenant', razon: 'Generador de secuencias de SKU invocado por sp_gen_sku durante el alta de productos.' }`.
    - `insert`: `['inventario.crear']`.
    - `update`: `['inventario.crear']`.
    - `delete`: `{ tipo: 'solo_definer' }`.
29. **`plan_cuotas`**:
    - `select`: `{ tipo: 'todo_el_tenant', razon: 'Planes de financiación ofrecidos al público en el mostrador de ventas.' }`.
    - `insert`: `['precios.crear']`.
    - `update`: `['precios.editar']`.
    - `delete`: `['precios.eliminar']`.
30. **`recargo_cuotas`**:
    - `select`: `{ tipo: 'todo_el_tenant', razon: 'Coeficientes de recargo aplicados automáticamente al momento de cobrar ventas en cuotas.' }`.
    - `insert`: `['precios.crear']`.
    - `update`: `['precios.editar']`.
    - `delete`: `['precios.eliminar']`.
31. **`escala_comision`**:
    - `select`: `['revendedoras.ver']`.
    - `insert`: `['revendedoras.crear']`.
    - `update`: `['revendedoras.editar']`.
    - `delete`: `['revendedoras.eliminar']`.
32. **`regla_comision`**:
    - `select`: `['revendedoras.ver']`.
    - `insert`: `['revendedoras.crear']`.
    - `update`: `['revendedoras.editar']`.
    - `delete`: `['revendedoras.eliminar']`.

### Grupo 6: Configuración, Cotización y Asistente (4 tablas)
33. **`configuracion`**:
    - `select`: `{ tipo: 'todo_el_tenant', razon: 'Configuración general de la tienda (nombre de fantasía, moneda, formato de ticket, impresoras).' }`.
    - `insert`: `['administracion.crear']`.
    - `update`: `['administracion.editar']`.
    - `delete`: `{ tipo: 'solo_definer' }`.
34. **`cotizacion_config`**:
    - `select`: `['precios.ver', 'inventario.ver']`.
    - `insert`: `['precios.editar_cotizacion']`.
    - `update`: `['precios.editar_cotizacion']`.
    - `delete`: `{ tipo: 'solo_definer' }`.
35. **`cotizacion_dolar`**:
    - `select`: `['precios.ver', 'inventario.ver']`.
    - `insert`: `['precios.editar_cotizacion']`.
    - `update`: `{ tipo: 'solo_definer' }`.
    - `delete`: `{ tipo: 'solo_definer' }`.
36. **`consulta_ayuda`**:
    - `select`: `['ayuda.consultar', 'administracion.ver']`.
    - `insert`: `['ayuda.consultar']`.
    - `update`: `{ tipo: 'solo_definer' }`.
    - `delete`: `{ tipo: 'solo_definer' }`.

### Grupo 7: Tablas Parciales y Plataforma (7 tablas)
37. **`auditoria`**:
    - `select`: `rlsp_auditoria_select` ya existe (`administracion.ver` AND `inventario.ver_costos`).
    - `insert`: `{ tipo: 'todo_el_tenant', razon: 'Cualquier mutación de negocio en el tenant registra eventos de auditoría.' }`.
    - `update`: `{ tipo: 'solo_definer' }` (inmutable).
    - `delete`: `{ tipo: 'solo_definer' }` (inmutable).
38. **`costo_producto`**:
    - `select`: `rlsp_costo_producto_select` ya existe (`inventario.ver_costos`).
    - `insert`: `['inventario.cargar_costos']` (hoy abierto a todo el tenant).
    - `update`: `['inventario.cargar_costos']` (hoy abierto a todo el tenant).
    - `delete`: `['inventario.eliminar']` (hoy abierto a todo el tenant).
39. **`regla_precio`**:
    - `select`: `rlsp_regla_precio_select` ya existe (reglas margen filtradas por `precios.ver_margenes`).
    - `insert`: `['precios.crear']` (hoy abierto a todo el tenant).
    - `update`: `['precios.editar']` (hoy abierto a todo el tenant).
    - `delete`: `['precios.eliminar']` (hoy abierto a todo el tenant).
40. **`modulo`**:
    - `select`: `{ tipo: 'todo_el_tenant', razon: 'Catálogo inmutable de módulos disponibles del sistema.' }`.
    - `insert`: `{ tipo: 'solo_definer' }`.
    - `update`: `{ tipo: 'solo_definer' }`.
    - `delete`: `{ tipo: 'solo_definer' }`.
41. **`tenant`**:
    - `select`: `{ tipo: 'todo_el_tenant', razon: 'Datos de la empresa y suscripción básica para los usuarios del propio tenant.' }`.
    - `insert`: `{ tipo: 'solo_definer' }` (provisión de tenant).
    - `update`: `['administracion.editar']` (hoy cualquier usuario autenticado podía mutar el nombre/datos del tenant).
    - `delete`: `{ tipo: 'solo_definer' }`.
42. **`tenant_modulo`**:
    - `select`: `{ tipo: 'todo_el_tenant', razon: 'Consulta de módulos habilitados en la sesión del tenant.' }`.
    - `insert`: `{ tipo: 'solo_definer' }`.
    - `update`: `{ tipo: 'solo_definer' }`.
    - `delete`: `{ tipo: 'solo_definer' }`.
43. **Satélites de Costo** (`detalle_venta_costo`, `detalle_venta_rendicion`, `devolucion_venta_costo`):
    - `select`: `rlsp_*_select` ya existen.
    - `insert/update/delete`: `{ tipo: 'solo_definer' }` (selladores `fn_sellar_costo_*`). Se debe remover la policy permisiva `ALL` y dejar solo `SELECT`.

---

## 4. Estrategia de Grants

### A. Revocación a `anon`
El rol `anon` jamás debe tener privilegios de acceso a las tablas de dominio en una aplicación SaaS donde toda operación requiere autenticación de sesión:
```sql
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
```
*(Nota: Las funciones de autenticación y hook como `custom_access_token_hook` residen con grants específicos, pero las tablas de datos quedan 100% inaccesibles a anon).*

### B. Revocación de Escrituras Directas a `authenticated`
En las tablas donde toda mutación ocurre exclusivamente a través de procedimientos almacenados `sp_*`:
- Revocar `INSERT, UPDATE, DELETE` a `authenticated`.
- Mantener únicamente `GRANT SELECT` a `authenticated` (controlado por RLS).
- En las tablas donde `lib/dal` realiza escrituras directas (ej. `cliente`, `proveedor`, `categoria`), existen dos caminos (ver decisión abierta **D-RCD-01**).

---

## 5. Test Guardián en `tests/db/rls-guardian.test.ts`

El test guardián es la garantía automatizada e indeleble que evita regresiones futuras. Falla inmediatamente si:
1. **Tabla sin registrar**: Existe una tabla base en `public` que no figure en `lib/seguridad/permisos-tablas.ts`.
2. **Tabla sin RLS**: Cualquier tabla en `public` tiene `rowsecurity = false`.
3. **Falta de Policy Restrictiva**: Si el catálogo define permisos para un comando (`select`, `insert`, `update`, `delete`) y no existe una policy `as restrictive` en `pg_policies` asociada a `auth_tiene_permiso`.
4. **Permisos en `anon`**: Si `has_table_privilege('anon', oid, 'SELECT/INSERT/UPDATE/DELETE')` es `true` para cualquier tabla base.
5. **Policies para `public` o `anon`**: Si alguna policy en `pg_policies` tiene en `roles` a `{public}` o `{anon}`.
6. **Vistas sin `security_invoker`**: Si alguna vista en `public` no tiene `security_invoker = true/on`.

---

## 6. Reglas para Documentación

### A. Compactación de `AGENTS.md` (≤150 líneas)
`AGENTS.md` se encuentra exactamente en el límite máximo de **150 líneas**. Para agregar la regla de RLS cerrado sin exceder las 150 líneas, se propone compactar líneas redundantes en la sección de Comandos:
- Fusionar las filas de `gate:db` y `gate:full` de la tabla de comandos en una sola fila compacta (libera 1 línea).
- Compactar la explicación de `INVOKER / DEFINER` y `Regla de satélites` eliminando duplicaciones de texto (libera 2 líneas).
- **Nueva regla a insertar**:
  > - **RLS cerrado por defecto**: Toda tabla de dominio en `public` tiene RLS activada, grants revocados a `anon`, y policy restrictiva por comando ligada a `auth_tiene_permiso`. Dinero y datos personales nunca son legibles por todo el tenant. Enforced by `tests/db/rls-guardian.test.ts`.

### B. Regla para `supabase/README.md`
En la sección de seguridad de `supabase/README.md`, incorporar:
> ### RLS cerrado por defecto y catálogo de seguridad
> Toda nueva tabla creada en `public` debe registrarse obligatoriamente en `lib/seguridad/permisos-tablas.ts` definiendo la matriz de permisos para los 4 comandos (`select`, `insert`, `update`, `delete`). Si la tabla almacena dinero o datos personales, el acceso no puede ser `todo_el_tenant`. Cada migración que cree una tabla debe incluir sus policies restrictivas y revocar privilegios a `anon`. El test guardián `tests/db/rls-guardian.test.ts` romperá el gate si una tabla nueva no cumple estos requisitos.

---

## 7. Decisiones Abiertas Numeradas

### D-RCD-01 — Estrategia ante escrituras directas en `lib/dal` (`cliente`, `proveedor`, `categoria`, etc.)
- **Problema**: `lib/dal` realiza mutaciones directas (`supabase.from('cliente').insert(...)`, `.update(...)`, `proveedor`, `categoria`, `producto`, `cuenta_destino`, `arancel_cobro`, `plan_cuotas`, `recargo_cuotas`). Si se revoca `INSERT/UPDATE` a `authenticated`, estas llamadas fallan inmediatamente.
- **Opción A (Conservar escrituras directas con policy restrictiva de INSERT/UPDATE)**: Mantener los grants en `authenticated` sobre esas tablas específicas y crear policies restrictivas de INSERT/UPDATE (`with check (auth_tiene_permiso('ventas', 'crear'))`, etc.).
- **Opción B (Migrar escrituras directas a `sp_*` nuevos y revocar todo INSERT/UPDATE a `authenticated`)**: Crear `sp_create_cliente`, `sp_update_cliente`, etc., cumpliendo al 100% la regla estricta de `AGENTS.md` ("Writes go through sp_* stored procedures").
- **Recomendación**: **Opción A en Fase 1..6, convergiendo a Opción B**. Para este cambio de RLS, crear las policies restrictivas de INSERT/UPDATE en esas tablas garantiza que nadie pueda mutarlas sin el permiso correspondiente, sin necesidad de reescribir la capa DAL completa en este PR.

### D-RCD-02 — Alcance del SELECT en `item_producto`
- **Problema**: `sp_registrar_venta` es INVOKER y hace `SELECT ... FOR UPDATE` sobre `item_producto`. Si la policy restrictiva de SELECT de `item_producto` exige `inventario.ver`, un cajero o vendedora sin permiso de inventario no puede vender.
- **Opción A (`item_producto` legible por todo el tenant)**: Dado que los costos fueron segregados a `item_costo` en `00156`, las columnas de `item_producto` solo contienen datos de stock operativo (talle, qr, estado). Se declara `todo_el_tenant`.
- **Opción B (Policy restrictiva con OR amplio)**: Exigir `(auth_tiene_permiso('inventario', 'ver') OR auth_tiene_permiso('ventas', 'crear') OR auth_tiene_permiso('ventas', 'ver'))`.
- **Recomendación**: **Opción B**. Mantiene el principio de que los roles ajenos al circuito comercial o de inventario (por ejemplo, un operador con solo `gastos`) no tienen por qué leer el listado de ítems.

### D-RCD-03 — Política de lectura para la tabla `tenant`
- **Problema**: La tabla `tenant` contiene nombre del comercio, subdominio y configuración. Hoy cualquier usuario autenticado puede leerla e incluso editarla (`tenant_update_own`).
- **Opción A (`todo_el_tenant` en SELECT, `administracion.editar` en UPDATE)**: Todo usuario del tenant puede leer los datos de su propio tenant (necesario para el header/sesión), pero solo un administrador puede editarlo.
- **Opción B (Restringir SELECT a `administracion.ver`)**: Obligaría a que la lectura del tenant en el login/sesión se haga con service role (`createServiceClient`).
- **Recomendación**: **Opción A**. Es natural que el empleado vea el nombre del negocio en el que trabaja, pero nadie excepto quien tenga `administracion.editar` debe poder modificar la fila.
