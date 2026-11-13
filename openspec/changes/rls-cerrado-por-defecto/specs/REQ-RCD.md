# Spec — RLS Cerrado por Defecto (REQ-RCD)

**Change**: `rls-cerrado-por-defecto` · **Requisitos**: `REQ-RCD-01…08` · **Decisiones**: `D-RCD-01…03`

---

## 1. Requisitos

### REQ-RCD-01 — Revocación de Privilegios a `anon` en Schema `public`
Ningún actor no autenticado (rol `anon` de PostgreSQL) MUST tener acceso de lectura ni de mutación sobre ninguna tabla o secuencia del schema `public`.

- **Feliz**: Peticiones autenticadas con JWT legítimo acceden a las tablas según su RLS y grants.
- **N1**: Petición anónima (con `anon` key y sin JWT) intenta `SELECT` en cualquier tabla de dominio (`cliente`, `venta`, `producto`, etc.) → Error `42501` (permission denied) o `PGRST301`.
- **N2**: Petición anónima intenta `INSERT`, `UPDATE` o `DELETE` en cualquier tabla → Error `42501` inmediato.
- **N3**: Intento de uso de secuencias (`producto_sku_seq`) por `anon` → Error `42501`.

---

### REQ-RCD-02 — Protección Restrictiva de Datos Personales y Clientes (`cliente`, `proveedor`)
Las tablas que almacenan información de personas físicas o contactos comerciales (`cliente`, `proveedor`) MUST estar protegidas por policies restrictivas vinculadas a permisos funcionales. Ningún usuario del tenant MUST poder leerlas sin el permiso correspondiente.

- **Feliz**:
  - Operador con `ventas.ver` o `ventas.crear` consulta `cliente` vía PostgREST o DAL y obtiene las filas de su propio tenant.
  - Operador con `inventario.ver` consulta `proveedor` y obtiene los proveedores activos.
- **N1**: Operador autenticado sin `ventas.ver` ni `ventas.crear` (ej. rol solo `gastos`) intenta `SELECT * FROM cliente` → Obtiene **0 filas** (sin error, RLS restrictiva devuelve conjunto vacío).
- **N2**: Operador autenticado sin `ventas.crear` intenta `INSERT INTO cliente` vía PostgREST → Rechazo con código `42501` o 0 filas insertadas.
- **N3**: Operador autenticado sin `ventas.editar` intenta `UPDATE cliente` vía PostgREST → 0 filas actualizadas.
- **N4**: Operador de otro tenant con `ventas.ver` intenta consultar clientes → Obtiene **0 filas** (aislamiento tenant inquebrantable).
- **N5**: Revendedora autenticada consulta `cliente` → Obtiene **0 filas** (bloqueada por `auth_revendedora_id() is null`).

---

### REQ-RCD-03 — Protección Restrictiva de Tablas Financieras y Dinero (`venta`, `pago_venta`, `cuota_financiada`, `cuenta_destino`, `arancel_cobro`, `reintegro_cliente`)
Toda tabla representativa de dinero, cobranzas, cuentas bancarias o saldo financiado MUST estar protegida por policies restrictivas. Ningún usuario del tenant sin permiso explícito de ventas, finanzas/reportes o administración MUST poder leer filas ni totales.

- **Feliz**:
  - Operador con `ventas.ver` o `reportes.ver` consulta `venta`, `pago_venta`, `cuota_financiada` y lee el historial financiero.
  - Operador con `administracion.ver` o `ventas.ver` consulta `cuenta_destino` para seleccionar el medio de cobro.
- **N1**: Operador con rol limitado (ej. solo `inventario.ver` o `gastos.ver`) intenta `SELECT * FROM venta` o `pago_venta` → Obtiene **0 filas**.
- **N2**: Operador sin `ventas.crear` intenta `INSERT INTO venta` o `pago_venta` vía PostgREST → Error `42501`.
- **N3**: Operador sin `administracion.editar` intenta mutar un `CBU/Alias` en `cuenta_destino` vía PostgREST o DAL → 0 filas actualizadas o `42501`.
- **N4**: Operador sin `ventas.eliminar` intenta mutar el estado de una `venta` o `cuota_financiada` → 0 filas actualizadas.
- **N5**: Consulta desde otro tenant → **0 filas**.

---

### REQ-RCD-04 — Stock Operativo y Concurrencia por Flujo en `item_producto` (Decisión D-RCD-02 = B)
La tabla `item_producto` MUST contar con policy restrictiva de `SELECT` gobernada por el `OR` de todos los permisos operativos que interactúan con stock en los escritores y lectores INVOKER:
`(inventario.ver OR inventario.crear OR inventario.editar OR ventas.ver OR ventas.crear OR ventas.editar OR consignaciones.ver OR consignaciones.crear OR consignaciones.editar OR consignaciones.eliminar OR revendedoras.ver OR revendedoras.crear OR revendedoras.editar OR rendiciones.ver)`.

#### Casos Positivos por Flujo Operativo (rol limitado con SOLO ese permiso):
- **P1 (Flujo Venta en Mostrador — `ventas.crear`)**:
  - *Dado*: Un usuario autenticado con un rol que posee **únicamente** el permiso `ventas.crear`.
  - *Cuando*: Ejecuta `sp_registrar_venta` pasando el ID de un ítem disponible.
  - *Entonces*: El SP ejecuta `SELECT ... FOR UPDATE` sobre `item_producto`, completa la venta y la transacción finaliza con éxito (`{ ok: true }`).
- **P2 (Flujo Cambio de Mercadería — `ventas.crear`)**:
  - *Dado*: Un rol con **únicamente** `ventas.crear`.
  - *Cuando*: Ejecuta `sp_registrar_cambio` entregando un ítem de stock y recibiendo el devuelto.
  - *Entonces*: El SP realiza `FOR UPDATE` sobre `item_producto` sin ser bloqueado por RLS.
- **P3 (Flujo Devolución de Cliente — `ventas.editar`)**:
  - *Dado*: Un rol con **únicamente** `ventas.editar`.
  - *Cuando*: Ejecuta `sp_registrar_devolucion_cliente` y reingresa el ítem al inventario.
  - *Entonces*: El `FOR UPDATE` sobre `item_producto` se autoriza con éxito.
- **P4 (Flujo Reserva de Mostrador — `ventas.crear`)**:
  - *Dado*: Un rol con **únicamente** `ventas.crear`.
  - *Cuando*: Ejecuta `sp_crear_reserva` para apartar un ítem.
  - *Entonces*: El SP bloquea el ítem con `FOR UPDATE` y crea la reserva exitosamente.
- **P5 (Flujo Consignación a Proveedor — `consignaciones.crear`)**:
  - *Dado*: Un rol con **únicamente** `consignaciones.crear`.
  - *Cuando*: Ejecuta `sp_agregar_item_consignacion` asociando un ítem disponible.
  - *Entonces*: El `FOR UPDATE` en `item_producto` tiene éxito y el ítem se vincula al remito.
- **P6 (Flujo Consignación a Revendedora — `revendedoras.crear`)**:
  - *Dado*: Un rol con **únicamente** `revendedoras.crear`.
  - *Cuando*: Ejecuta `sp_crear_consignacion_revendedora_con_items`.
  - *Entonces*: El SP bloquea los ítems solicitados vía `FOR UPDATE` y los entrega en consignación.
- **P7 (Flujo Devolución de Revendedora — `revendedoras.editar`)**:
  - *Dado*: Un rol con **únicamente** `revendedoras.editar`.
  - *Cuando*: Ejecuta `sp_registrar_devolucion_revendedora`.
  - *Entonces*: El `FOR UPDATE` sobre `item_producto` transiciona el estado de 'consignado' a 'disponible' sin error.
- **P8 (Flujo Ingreso de Mercadería — `inventario.crear`)**:
  - *Dado*: Un rol con **únicamente** `inventario.crear`.
  - *Cuando*: Ejecuta `sp_confirmar_ingreso`.
  - *Entonces*: El `INSERT INTO item_producto ... RETURNING id_item` evalúa satisfactoriamente el SELECT de `item_producto` y retorna los IDs creados.
- **P9 (Flujo Stock Directo — `inventario.crear`)**:
  - *Dado*: Un rol con **únicamente** `inventario.crear`.
  - *Cuando*: Ejecuta `sp_crear_stock_directo`.
  - *Entonces*: El `RETURNING` sobre `item_producto` se ejecuta exitosamente.
- **P10 (Flujo Ajuste de Inventario — `inventario.editar`)**:
  - *Dado*: Un rol con **únicamente** `inventario.editar`.
  - *Cuando*: Ejecuta `sp_registrar_ajuste_inventario` dando de baja un ítem por rotura o extravío.
  - *Entonces*: El `FOR UPDATE` sobre `item_producto` se ejecuta exitosamente.
- **P11 (Flujo Rendición de Proveedor — `rendiciones.ver`)**:
  - *Dado*: Un rol con **únicamente** `rendiciones.ver`.
  - *Cuando*: Consulta el detalle de ítems de consignación vendidos pendientes de rendir en `lib/dal/rendiciones/rendicion.ts`.
  - *Entonces*: La consulta sobre `item_producto` devuelve las filas correspondientes sin bloqueo.

#### Casos Negativos de `item_producto`:
- **N1**: Operador autenticado sin ningún permiso de stock ni comercial (ej. rol con **únicamente** `gastos.ver`) intenta `SELECT * FROM item_producto` vía PostgREST → Obtiene **0 filas**.
- **N2**: Operador autenticado intenta `UPDATE item_producto SET estado_item = 'disponible'` directamente vía PostgREST sin pasar por un `sp_*` → 0 filas actualizadas o `42501`.
- **N3**: Operador intenta `INSERT INTO item_producto` directamente sin `inventario.crear` → Rechazo `42501`.

---

### REQ-RCD-05 — Cierre de Mutaciones en Tablas Parcialmente Protegidas (`costo_producto`, `regla_precio`)
Las tablas con policy restrictiva de SELECT (`costo_producto`, `regla_precio`) MUST incorporar policies restrictivas de INSERT, UPDATE y DELETE para evitar que cualquier usuario del tenant altere costos vigentes o márgenes comerciales.

- **Feliz**:
  - Operador con `inventario.cargar_costos` e `inventario.ver_costos` actualiza costos mediante `sp_aplicar_ultimo_costo`.
  - Operador con `precios.crear` crea una regla de precios mediante `sp_create_regla_precio`.
- **N1**: Operador con rol "Vendedora-Local" (sin `cargar_costos`) intenta `INSERT INTO costo_producto` vía PostgREST → Rechazo `42501`.
- **N2**: Operador sin `precios.editar` intenta `UPDATE regla_precio` vía PostgREST → 0 filas modificadas o `42501`.
- **N3**: Operador sin `inventario.eliminar` intenta `DELETE FROM costo_producto` → Rechazo `42501`.

---

### REQ-RCD-06 — Protección de Integridad del Tenant (`tenant`, `tenant_modulo`) (Decisión D-RCD-03 = A)
La fila de la entidad `tenant` MUST ser legible por los usuarios de ese tenant para resolver la sesión y branding, pero MUST NOT ser editable salvo por quien posea `administracion.editar`.

- **Feliz**: Cualquier usuario autenticado del tenant consulta `tenant` y obtiene su nombre y subdominio.
- **N1**: Operador sin `administracion.editar` (ej. cajero o vendedor) intenta `UPDATE tenant SET nombre = 'Hacked'` → 0 filas actualizadas (bloqueado por RLS restrictiva de UPDATE).
- **N2**: Operador de cualquier rol intenta `DELETE FROM tenant` vía PostgREST → Rechazo `42501` o 0 filas.
- **N3**: Operador intenta mutar `tenant_modulo` directamente → Rechazo `42501` o 0 filas (solo gestionable por service role o `sp_toggle_tenant_modulo`).

---

### REQ-RCD-07 — Preservación Estricta de Flujos Operativos y Roles Limitados del Seed
El cierre por defecto de RLS MUST NOT romper ninguno de los flujos de negocio existentes para los roles estándar creados en el seed:
1. `Administrador`: Acceso pleno a todas las operaciones.
2. `Vendedora-Local` (`ventas.ver`, `ventas.crear`, `ventas.editar`): Puede registrar ventas, buscar clientes, crear clientes, cobrar cuotas, emitir comprobantes y realizar cambios.
3. `Encargada` (`inventario.*`, `precios.ver`, `precios.editar`): Puede importar remitos, confirmar ingresos, ajustar stock y actualizar precios.
4. `Revendedora`: Acceso exclusivo a su portal (`rvp_*`) y sus declaraciones de venta.
5. Sesión de usuario (`lib/dal/session.ts`): Carga de datos de perfil, tenant y módulos sin errores ni bloqueos.

---

### REQ-RCD-08 — Test Guardián Automatizado (`tests/db/rls-guardian.test.ts`)
Debe existir una suite de tests automatizada que verifique mecánicamente la invariante de cierre por defecto contra la base de datos real.

- **Feliz**: Todas las tablas de `public` cumplen las 6 condiciones de seguridad del guardián. El test pasa en verde.
- **N1**: Se agrega una nueva tabla en una migración futura sin registrarla en `lib/seguridad/permisos-tablas.ts` → El guardián falla indicando: `Tabla <nueva_tabla> no está declarada en el catálogo de seguridad`.
- **N2**: Una tabla en `public` tiene `rowsecurity = false` → Falla indicando falta de RLS.
- **N3**: Una tabla tiene privilegios otorgados a `anon` → Falla indicando grants indebidos.
- **N4**: Una vista de `public` no tiene `security_invoker = true/on` → Falla inmediatamente.

---

## 2. Matriz de Permisos por Tabla (Alineada con Invocadores INVOKER y DAL)

| Tabla / Entidad | SELECT (OR de Permisos) | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `cliente` | `ventas.ver` O `ventas.crear` | `ventas.crear` | `ventas.editar` | `ventas.eliminar` |
| `proveedor` | `inventario.ver` O `consignaciones.ver` O `rendiciones.ver` | `inventario.crear` | `inventario.editar` | `inventario.eliminar` |
| `venta` | `ventas.ver` O `ventas.crear` O `ventas.editar` O `ventas.eliminar` O `reportes.ver` O `revendedoras.ver` | `ventas.crear` | `ventas.eliminar` | *solo DEFINER* |
| `pago_venta` | `ventas.ver` O `ventas.crear` O `ventas.editar` O `reportes.ver` | `ventas.crear` O `ventas.editar` | `ventas.eliminar` | *solo DEFINER* |
| `cuota_financiada` | `ventas.ver` O `ventas.crear` O `ventas.editar` O `ventas.eliminar` O `reportes.ver` | `ventas.crear` | `ventas.editar` O `ventas.eliminar` | *solo DEFINER* |
| `cuenta_destino` | `ventas.ver` O `ventas.crear` O `gastos.ver` O `administracion.ver` | `administracion.crear` | `administracion.editar` | `administracion.eliminar` |
| `arancel_cobro` | `ventas.ver` O `ventas.crear` O `administracion.ver` | `administracion.crear` | `administracion.editar` | `administracion.eliminar` |
| `item_producto` | `inventario.ver` O `inventario.crear` O `inventario.editar` O `ventas.ver` O `ventas.crear` O `ventas.editar` O `consignaciones.ver` O `consignaciones.crear` O `consignaciones.editar` O `consignaciones.eliminar` O `revendedoras.ver` O `revendedoras.crear` O `revendedoras.editar` O `rendiciones.ver` | `inventario.crear` | `inventario.editar` O `ventas.crear` O `ventas.editar` O `consignaciones.crear` O `consignaciones.editar` O `revendedoras.crear` O `revendedoras.editar` | `inventario.eliminar` |
| `movimiento_item` | `inventario.ver` O `inventario.editar` | `inventario.crear` O `inventario.editar` O `ventas.crear` O `ventas.eliminar` O `consignaciones.crear` O `revendedoras.crear` | *inmutable* | *inmutable* |
| `detalle_venta` | `ventas.ver` O `ventas.crear` O `ventas.editar` O `ventas.eliminar` O `rendiciones.ver` O `rendiciones.editar` O `reportes.ver` O `revendedoras.liquidar` | `ventas.crear` | `ventas.eliminar` O `rendiciones.crear` O `revendedoras.liquidar` | *inmutable* |
| `cambio_venta` | `ventas.ver` O `ventas.crear` O `reportes.ver` | `ventas.crear` | *inmutable* | *inmutable* |
| `devolucion_venta` | `ventas.ver` O `ventas.crear` O `ventas.editar` O `reportes.ver` | `ventas.crear` O `ventas.editar` | *inmutable* | *inmutable* |
| `reserva` | `ventas.ver` O `ventas.crear` O `ventas.editar` | `ventas.crear` | `ventas.crear` O `ventas.editar` | `ventas.eliminar` |
| `detalle_reserva` | `ventas.ver` O `ventas.crear` O `ventas.editar` | `ventas.crear` | `ventas.crear` O `ventas.editar` | `ventas.eliminar` |
| `comprobante` | `ventas.ver` O `ventas.crear` | `ventas.crear` | *solo DEFINER* | *solo DEFINER* |
| `ingreso_mercaderia` | `inventario.ver` O `inventario.crear` O `inventario.editar` O `inventario.cargar_costos` | `inventario.crear` | `inventario.editar` O `inventario.crear` | `inventario.eliminar` |
| `ingreso_mercaderia_detalle` | `inventario.ver` O `inventario.crear` O `reportes.ver` | `inventario.crear` | *solo DEFINER* | `inventario.editar` O `inventario.eliminar` |
| `ingreso_detalle_costo` | `inventario.ver_costos` | `inventario.cargar_costos` | *solo DEFINER* | `inventario.editar` O `inventario.eliminar` |
| `categoria_gasto` | `gastos.ver` O `gastos.editar` O `reportes.ver` | `gastos.crear` | `gastos.editar` | `gastos.editar` |
| `gasto_negocio` | `gastos.ver` O `gastos.crear` O `reportes.ver` | `gastos.crear` | *inmutable* | `gastos.editar` |
| `consignacion` | `consignaciones.ver` O `consignaciones.crear` O `consignaciones.editar` O `consignaciones.eliminar` | `consignaciones.crear` | `consignaciones.editar` | `consignaciones.eliminar` |
| `consignacion_detalle` | `consignaciones.ver` O `consignaciones.crear` O `consignaciones.editar` | `consignaciones.crear` | `consignaciones.editar` | `consignaciones.eliminar` |
| `consignacion_revendedora` | `revendedoras.ver` O `revendedoras.crear` O `revendedoras.editar` O `revendedoras.eliminar` | `revendedoras.crear` | `revendedoras.editar` | `revendedoras.eliminar` |
| `consignacion_revendedora_detalle` | `revendedoras.ver` O `revendedoras.crear` O `revendedoras.editar` O `ventas.crear` | `revendedoras.crear` | `revendedoras.editar` O `ventas.crear` | `revendedoras.eliminar` |
| `declaracion_venta_revendedora` | `revendedoras.ver` O `revendedoras.crear` O `revendedoras.declarar` | `revendedoras.declarar` | `revendedoras.editar` | `revendedoras.editar` O `revendedoras.declarar` |
| `liquidacion_revendedora` | `revendedoras.ver` O `revendedoras.liquidar` | `revendedoras.liquidar` | `revendedoras.liquidar` | `revendedoras.eliminar` |
| `revendedora` | `revendedoras.ver` O `revendedoras.crear` O `revendedoras.editar` O `revendedoras.eliminar` O `revendedoras.liquidar` O `ventas.crear` | `revendedoras.crear` | `revendedoras.editar` | `revendedoras.eliminar` |
| `regla_comision` | `revendedoras.ver` O `revendedoras.editar` | `revendedoras.crear` | `revendedoras.editar` | `revendedoras.eliminar` |
| `producto` | `todo_el_tenant` | `inventario.crear` | `inventario.editar` | `inventario.eliminar` |
| `categoria` | `todo_el_tenant` | `inventario.crear` | `inventario.editar` | `inventario.eliminar` |
| `plan_cuotas` | `todo_el_tenant` | `precios.crear` | `precios.editar` | `precios.eliminar` |
| `recargo_cuotas` | `todo_el_tenant` | `precios.crear` | `precios.editar` | `precios.eliminar` |
| `configuracion` | `todo_el_tenant` | `administracion.crear` | `administracion.editar` | *solo DEFINER* |
| `tenant` | `todo_el_tenant` | *solo DEFINER* | `administracion.editar` | *solo DEFINER* |
| `costo_producto` | `inventario.ver_costos` | `inventario.cargar_costos` | `inventario.cargar_costos` | `inventario.eliminar` |
| `regla_precio` | `(tipo <> 'margen' O precios.ver_margenes) Y (precios.ver O precios.crear O precios.editar)` | `precios.crear` | `precios.editar` | `precios.eliminar` |

---

## 3. Cifras Financieras
Este cambio de seguridad **NO** modifica fórmulas financieras, montos devengados, percibidos ni criterios de redondeo. Todas las cifras de ventas, saldos, costos y rendiciones conservan su fuente de verdad actual (`specs/golden.md` permanece intacto).

---

## 4. INVOKER contra RLS Restrictiva

En PostgreSQL, `RETURNING` y `SELECT ... FOR UPDATE` ejecutados por funciones `SECURITY INVOKER` evalúan la policy de `SELECT` de la tabla destino con las credenciales de quien llama. La matriz anterior garantiza matemáticamente que todo permiso exigido por un SP INVOKER para interactuar con una tabla forma parte del OR de SELECT de dicha tabla.

---

## 5. Migraciones

- Las migraciones se aplicarán en orden secuencial comenzando por el siguiente número libre en `supabase/migrations/` al momento de la implementación.
- Cada archivo de migración llevará su bloque reversible `-- DOWN:` con validación completa en `pnpm gate:db`.
- No se editarán migraciones históricas en `main`.

---

## 6. Ubicación del Código

| Archivo | Quién lo consume | Por qué va ahí |
| --- | --- | --- |
| `lib/seguridad/permisos-tablas.ts` | Test guardián, DAL y documentación | Catálogo canónico de políticas RLS por tabla y comando tipado en TypeScript. |
| `tests/db/rls-guardian.test.ts` | Suite de tests de arquitectura (`pnpm gate:db`) | Test guardián que audita `pg_tables`, `pg_policies`, `has_table_privilege` y `security_invoker`. |
| `tests/db/rls-cerrado-por-defecto.test.ts` | Suite de integración en base de datos | Casos negativos y positivos por flujo para roles limitados del seed. |
| `supabase/migrations/NNNNN_*.sql` | Motor de base de datos | Migraciones incrementales con policies restrictivas y revocación de grants. |
