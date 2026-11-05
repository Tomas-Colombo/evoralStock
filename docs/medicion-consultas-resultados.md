# Resultados de Medición de Consultas a la Base de Datos

Documento generado según `docs/plan-medicion-consultas.md`.

## Fase 2 — Recorrido de Pantallas y Round Trips

Medición ejecutada con `pnpm build && pnpm start` con instrumentación `DAL_TRACE=1`.
Volumen Chico: ~20 productos, clientes, revendedoras, ventas y cuotas.
Volumen Grande: ~200 productos, clientes, revendedoras, ventas y cuotas.

| Pantalla | Round trips (chico) | Round trips (grande) | Llamadas auth | Consultas duplicadas en mismo req | ¿Crece con N? | p50 ms (chico / grande) |
| --- | --- | --- | --- | --- | --- | --- |
| Inicio (`/`) | 1 | 1 | 0 | - | No | 6.5 ms / 11.5 ms |
| Inventario (`/inventario`) | 10 | 10 | 0 | `proveedor` (+49 en alerta/kpi) | No | 14 ms / 14 ms |
| Productos (`/inventario/productos`) | 1 | 1 | 0 | - | No | 20 ms / 6 ms |
| Precios (`/precios`) | 1 | 1 | 0 | - | No | 7 ms / 6 ms |
| Ventas lista (`/ventas`) | 1 | 1 | 0 | `venta` (+22 en periodo) | No | 6 ms / 6 ms |
| Ventas detalle (`/ventas/[id]`) | 4 | 4 | 0 | - | No | 14.5 ms / 5.5 ms |
| Reservas (`/ventas/reservas`) | 2 | 2 | 0 | - | No | 7.5 ms / 5.5 ms |
| Clientes (`/clientes`) | 1 | 1 | 0 | - | No | 7 ms / 7 ms |
| Cuotas (`/cuotas`) | 2 | 2 | 0 | - | No | 6 ms / 9 ms |
| Consignaciones (`/consignaciones`) | 1 | 1 | 0 | - | No | 8 ms / 7 ms |
| Rendiciones (`/rendiciones`) | 1 | 1 | 0 | - | No | 7 ms / 6 ms |
| Revendedoras lista (`/revendedoras`) | 2 | 2 | 0 | - | No | 14 ms / 14 ms |
| Revendedoras detalle (`/revendedoras/[id]`) | 4 | 4 | 0 | - | No | 5.5 ms / 4.5 ms |
| Gastos (`/gastos`) | 1 | 1 | 0 | `categoria_gasto`, `gasto_negocio` | No | 7 ms / 6 ms |
| Reportes (`/reportes`) | 1 | 1 | 0 | - | No | 25 ms / 25 ms |
| Administración (`/administracion`) | 6 | 6 | 0 | `auditoria` (+3/+4) | No | 6 ms / 5.5 ms |
| Plataforma (`/plataforma`) | 6 | 6 | 4 | `user` (+2), `superadmin` (+2) | No | 8 ms / 4.5 ms |
| Portal mi-cuenta (`/mi-cuenta`) | no verificado | no verificado | no verificado | no verificado | no verificado | no verificado |

*Nota: `/mi-cuenta` no verificado al requerir sesión dedicada con rol revendedora y credencial enlazada.*

## Fase 3 — Lado Base (pg_stat_statements)

Medición tras ejecución de recorrido de Fase 2 y `pnpm test:e2e` en ambos volúmenes luego de `select pg_stat_statements_reset();`.

### Top 20 por Calls (Volumen Grande)

| Calls | Total ms | Mean ms | Rows | Query (extracto) |
| --- | --- | --- | --- | --- |
| 2652 | 69.99 | 0.03 | 2652 | `select set_config('search_path', $1, true), set_config($2, $3, true)...` |
| 1221 | 796.85 | 0.65 | 1221 | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM ... sp_session_context)` |
| 128 | 1318.51 | 10.30 | 128 | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM ... sp_registrar_venta)` |
| 112 | 25.02 | 0.22 | 112 | `WITH pgrst_source AS ( SELECT "public"."proveedor".* FROM "public"."proveedor" ...)` |
| 106 | 60.56 | 0.57 | 106 | `WITH pgrst_source AS ( SELECT "public"."categoria".* FROM "public"."categoria" ...)` |
| 65 | 0.09 | 0.00 | 0 | `deallocate $1` |
| 50 | 182.49 | 3.65 | 50 | `WITH pgrst_source AS ( SELECT "public"."producto"."id_producto" ...)` |
| 49 | 741.36 | 15.13 | 49 | `WITH pgrst_source AS ( SELECT "public"."v_alerta_reposicion"."id_producto" ...)` |
| 49 | 19.05 | 0.39 | 49 | `WITH pgrst_source AS ( SELECT "public"."proveedor"."id_proveedor" ...)` |
| 49 | 255.22 | 5.21 | 49 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM "public"."sp_inventario_resumen" ...)` |
| 49 | 209.91 | 4.28 | 49 | `WITH pgrst_source AS ( SELECT "public"."v_alerta_rotacion_vencida"."id_item" ...)` |
| 48 | 231.88 | 4.83 | 48 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM ... sp_stock_por_talle)` |
| 45 | 1.47 | 0.03 | 45 | `select set_config('search_path', $1, true), set_config('role', $2, true)...` |
| 37 | 0.65 | 0.02 | 37 | `WITH pgrst_source AS ( SELECT "public"."reserva".* ...)` |
| 33 | 412.34 | 12.50 | 33 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM "public"."sp_control_de_precios" ...)` |
| 31 | 1.76 | 0.06 | 31 | `WITH pgrst_source AS ( SELECT "public"."revendedora".* ...)` |
| 31 | 5.68 | 0.18 | 31 | `WITH pgrst_source AS ( SELECT "public"."cuenta_destino".* ...)` |
| 29 | 5.22 | 0.18 | 29 | `INSERT INTO "audit_log_entries" ...` |
| 28 | 0.19 | 0.01 | 0 | `begin` |
| 27 | 0.59 | 0.02 | 27 | `SELECT identities.created_at, identities.email, identities.id ...` |

### Top 20 por Total Exec Time (Volumen Grande)

| Calls | Total ms | Mean ms | Rows | Query (extracto) |
| --- | --- | --- | --- | --- |
| 12 | 1550.94 | 129.24 | 12 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM ... sp_anular_venta)` |
| 128 | 1318.51 | 10.30 | 128 | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM ... sp_registrar_venta)` |
| 7 | 1081.12 | 154.45 | 7 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM ... sp_confirmar_ingreso)` |
| 1221 | 796.85 | 0.65 | 1221 | `WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM ... sp_session_context)` |
| 49 | 741.36 | 15.13 | 49 | `WITH pgrst_source AS ( SELECT "public"."v_alerta_reposicion"."id_producto" ...)` |
| 33 | 412.34 | 12.50 | 33 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM "public"."sp_control_de_precios" ...)` |
| 14 | 393.95 | 28.14 | 14 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM ... sp_crear_reserva)` |
| 49 | 255.22 | 5.21 | 49 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM "public"."sp_inventario_resumen" ...)` |
| 48 | 231.88 | 4.83 | 48 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM ... sp_stock_por_talle)` |
| 49 | 209.91 | 4.28 | 49 | `WITH pgrst_source AS ( SELECT "public"."v_alerta_rotacion_vencida"."id_item" ...)` |
| 50 | 182.49 | 3.65 | 50 | `WITH pgrst_source AS ( SELECT "public"."producto"."id_producto" ...)` |
| 22 | 136.16 | 6.19 | 22 | `WITH pgrst_source AS ( SELECT "public"."venta".* ...)` |
| 7 | 129.16 | 18.45 | 7 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM "public"."rf_finanzas_posicion" ...)` |
| 6 | 111.23 | 18.54 | 6 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM ... sp_recalcular_precios_batch)` |
| 7 | 97.83 | 13.98 | 7 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM ... sp_vencer_reservas)` |
| 6 | 78.34 | 13.06 | 6 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM ... rf_totales_panel_revendedoras)` |
| 2652 | 69.99 | 0.03 | 2652 | `select set_config('search_path', $1, true)...` |
| 22 | 66.40 | 3.02 | 22 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM ... sp_calcular_precio_venta_snapshot)` |
| 14 | 64.23 | 4.59 | 14 | `WITH pgrst_source AS ( SELECT "public"."cliente".* ORDER BY ...)` |
| 6 | 63.68 | 10.61 | 6 | `WITH pgrst_source AS (SELECT "pgrst_call".* FROM ... rf_cuenta_corriente_revendedora)` |

*Comparativa clave Chico vs Grande*:
- Las vistas de alerta (`v_alerta_reposicion`, `v_alerta_rotacion_vencida`) y `sp_inventario_resumen` incrementaron su tiempo de ejecución total entre 3× y 4× (ej: reposición pasó de 199.4 ms a 741.36 ms), escalando con el volumen de ítems y productos en base de datos.
- Las consultas paginadas (`cliente`, `venta`, `producto`) mantuvieron tiempos estables por request.

## Fase 4 — N+1 estático

Revisión exhaustiva del código fuente (`app/**`, `lib/dal/**`) y procedimientos almacenados vigentes (`supabase/migrations/**` validados con `pnpm sp:last`) para identificar patrones donde la cantidad de consultas o mutaciones escala con $N$.

Se descartaron iteraciones sobre listas constantes/chicas de configuración o catálogos fijos (`CATALOGO_PERMISOS`, `modulo`, `paquete`).

| archivo:línea | función que itera | qué consulta repite | de dónde sale N (URL/input/datos) | serie o paralelo | ¿tiene tope? |
| --- | --- | --- | --- | --- | --- |
| `app/(app)/inventario/actions.ts:319` | `createProductoAction` | `addIngresoDetalle` (`INSERT INTO ingreso_detalle`) por cada talle cuando `input.idProveedor` está presente | Input (`input.stock`, talles del producto) | Serie (`for...of` con `await`) | `totalUnidades <= 500` por validación previa, pero la cantidad de talles/filas no tiene tope explícito |
| `app/(app)/precios/actions.ts:264` | `crearCuentaDestinoAction` | `createArancelCobro` (`INSERT INTO arancel_cobro`) | Input (`input.aranceles`, aranceles de la cuenta) | Serie (`for...of` con `await`) | No formal en schema (acotado en UI por medios de pago, ~4–8) |
| `app/(app)/revendedoras/[id]/consignaciones/nueva/NuevaConsignacionRevendedoraForm.tsx:203` | `confirmarSelectorTalle` | `agregarPorProductoYTalle` -> `fetch('/api/revendedoras/lookup-item')` (1 query a `item_producto` por cada unidad física solicitada) | Input (talles y cantidades solicitadas en selector) | Serie (doble loop anidado `for...of` / `for` con `await`) | Limitado por stock disponible visible en selector |
| `app/(app)/ventas/nueva/NuevaVentaView.tsx:400` | `useEffect` (recalculo líneas) | `fetch('/api/ventas/lookup-item')` por cada línea del carrito al cambiar `forma_pago`, `descuentos` o `id_reserva` | Input / Estado (líneas cargadas en el carrito) | Serie (`for...of` con `await`) | No formal (tamaño del carrito) |
| `app/(app)/ventas/nueva/NuevaVentaView.tsx:588` | `useEffect` (precarga reserva) | `fetch('/api/ventas/lookup-item')` por cada QR de la reserva a cargar | Datos (`precargaReserva.qrs`, ítems de la reserva) | Serie (`for...of` con `await`) | No formal (cantidad de ítems en la reserva) |
| `app/(app)/ventas/nueva/NuevaVentaView.tsx:1001` | `confirmarSelectorTalle` | `agregarPorProducto` -> `fetch('/api/ventas/lookup-item')` por cada talle elegido en el modal | Input (talles elegidos en modal) | Serie (`for...of` con `await`) | Limitado por cantidad de talles del producto |
| `app/(app)/ventas/reservas/nueva/NuevaReservaView.tsx:296` | `confirmarSelectorTalle` | `agregarPorProducto` -> `fetch('/api/ventas/lookup-item')` por cada talle elegido en el modal | Input (talles elegidos en modal) | Serie (`for...of` con `await`) | Limitado por cantidad de talles del producto |
| `lib/dal/cuotas/cuota.ts:351` | `listDeudores` | `supabase.from('cuota_financiada').select(...).range(...)` en chunks de 1000 filas | Datos (total de cuotas financiadas en la base) | Serie (`for` con paginación secuencial) | **NO** (itera hasta agotar todas las filas coincidentes) |
| `lib/dal/inventario/item.ts:404` | `contarDisponiblesMultiplesProductos` | `contarDisponiblesPorTalle` (`rpc('sp_stock_por_talle')`) por cada id de producto | URL / Parámetro (`?productos=id1,id2,...` en `/api/ventas/stock-disponible`) | Paralelo (`Promise.all(... .map)`) | Sí (`MAX_PRODUCTOS_STOCK_DISPONIBLE = 50`) |
| `lib/dal/ventas/venta.ts:87` | `recorrerPeriodo` (en `resumenVentasPeriodo`) | `supabase.from('venta').select(...).range(...)` en chunks de 1000 filas | Datos (total de ventas registradas en el período) | Serie (`for` con paginación secuencial) | **NO** (recorre todas las ventas del período para sumarizar) |
| `supabase/migrations/00032_talles.sql:39` | `sp_confirmar_ingreso` | `INSERT INTO item_producto` e `INSERT INTO movimiento_item` ejecutados 1 a 1 por cada unidad de cada línea | Datos (`ingreso_mercaderia_detalle`, suma de `cantidad` por línea) | Serie (`for` anidado por unidad física) | No en DB (la app valida `<= 500` en alta directa, pero en ingreso estándar no) |
| `supabase/migrations/00064_precio_por_financiador.sql:55` | `sp_calcular_precio_venta_snapshot` | `SELECT * FROM regla_precio WHERE id_regla = v_id ...` por cada descuento | Input (`p_ids_descuentos`, array de UUIDs de reglas de descuento) | Serie (`foreach ... in array`) | No en DB (en UI suele haber < 5) |
| `supabase/migrations/00048_fix_sp_crear_reserva_ambiguo.sql:21` | `sp_crear_reserva` | `SELECT item_producto ... FOR UPDATE`, `SELECT EXISTS detalle_reserva`, `INSERT INTO detalle_reserva` por cada ítem | Input (`p_items`, array de UUIDs de ítems) | Serie (`foreach ... in array`) | No en DB |
| `supabase/migrations/00023_ventas_reservas_functions.sql:147` | `sp_vencer_reservas` | `UPDATE reserva` y `UPDATE detalle_reserva` individuales por cada reserva vencida | Datos (reservas vencidas acumuladas en `reserva`) | Serie (`for r_id in select ... for update`) | **NO** |
| `supabase/migrations/00093_venta_revendedora_pago.sql:66` | `sp_registrar_venta` | Loop 1: `SELECT item_producto FOR UPDATE`, `SELECT producto`, `sp_transicion_item_producto`, `sp_calcular_precio_venta_snapshot`. Loop 2: `INSERT detalle_venta`. Loop 3: `SELECT cuenta_destino`, `sp_calcular_costo_cobro`, `INSERT pago_venta`. Loop 4: `INSERT cuota_financiada`. | Input (`p_lineas`, `p_pagos`, cuotas) | Serie (`for ... in select jsonb_array_elements(...)`) | Cuotas hasta 24, pagos ~1–3, líneas sin tope en DB |
| `supabase/migrations/00110_finanzas_cambio_diferencia.sql:418` | `sp_anular_venta` | Loop 1: `sp_transicion_item_producto` y `UPDATE consignacion_revendedora_detalle`. Loop 2: `SELECT SUM(monto) FROM reintegro_cliente` e `INSERT INTO reintegro_cliente`. | Datos (`detalle_venta` y `pago_venta` de la venta) | Serie (`for ... in select ... loop`) | No en DB (tamaño de la venta) |
| `supabase/migrations/00033_sp_crear_stock_directo.sql:11` | `sp_crear_stock_directo` | `INSERT INTO item_producto` e `INSERT INTO movimiento_item` ejecutados 1 a 1 por cada unidad física | Input (`p_items`, suma de cantidades por talle) | Serie (`for` anidado por unidad física) | No en DB (app valida `<= 500`) |
| `supabase/migrations/00036_sku_autogen.sql:149` | `sp_importar_remito` | Loop líneas: `sp_gen_sku`, `INSERT producto`, `INSERT costo_producto`, `INSERT auditoria`. Loop partes: `INSERT ingreso_mercaderia_detalle`. | Input (`p_lineas` y sus `partes`) | Serie (`for` anidado) | **NO** |
| `supabase/migrations/00040_precios_batch.sql:130` | `sp_recalcular_precios_batch` | `sp_recalcular_precio_venta(v_id)` (SELECTs de costo, reglas y UPDATE producto) por cada ID | Input (`p_ids`, array de UUIDs de productos) | Serie (`foreach ... in array`) | **NO** |
| `supabase/migrations/00045_fix_asignar_talles_referencia_id.sql:11` | `sp_asignar_talles_a_producto` | `UPDATE item_producto SET talle = ...` e `INSERT INTO movimiento_item` por cada unidad física | Input (`p_distribucion`, suma de cantidades pedidas) | Serie (`for` anidado por unidad física) | Limitado por stock sin talle disponible |
| `supabase/migrations/00125_consignacion_modulo_grupo_b.sql:224` | `sp_crear_consignacion_con_items` | `sp_agregar_item_consignacion` (SELECT FOR UPDATE, validaciones, INSERT detalle, INSERT movimiento, INSERT auditoria) | Input (`p_items`, array de UUIDs de ítems) | Serie (`foreach ... in array`) | **NO** |
| `supabase/migrations/00125_consignacion_modulo_grupo_b.sql:345` | `sp_confirmar_consignacion` | `sp_confirmar_salida_item` (SELECT detalle, transicion_item UPDATE + INSERT, UPDATE detalle, INSERT auditoria) | Datos (`consignacion_detalle` pendientes del lote) | Serie (`for ... in select ... for update`) | **NO** |
| `supabase/migrations/00125_consignacion_modulo_grupo_b.sql:404` | `sp_eliminar_consignacion` | `sp_transicion_item_producto` (UPDATE item_producto, INSERT movimiento_item) por cada ítem devuelto | Datos (`consignacion_detalle` devueltos) | Serie (`for ... in select ... loop`) | **NO** |
| `supabase/migrations/00085_consignacion_revendedora_functions.sql:103` | `sp_crear_consignacion_revendedora_con_items` | 4 SELECTs (FOR UPDATE + checks reserva/consignaciones), `INSERT consignacion_revendedora_detalle`, `INSERT movimiento_item` | Input (`p_items`, array de UUIDs de ítems) | Serie (`foreach ... in array`) | **NO** |
| `supabase/migrations/00085_consignacion_revendedora_functions.sql:322` | `sp_confirmar_consignacion_revendedora` | `SELECT item_producto FOR UPDATE`, `sp_transicion_item_producto`, `UPDATE consignacion_revendedora_detalle` | Datos (`consignacion_revendedora_detalle` pendientes) | Serie (`for ... in select ... for update`) | **NO** |
| `supabase/migrations/00085_consignacion_revendedora_functions.sql:419` | `sp_registrar_devolucion_revendedora` | 2 SELECTs FOR UPDATE, `sp_transicion_item_producto`, `UPDATE consignacion_revendedora_detalle` | Input (`p_items`, array de UUIDs de ítems a devolver) | Serie (`foreach ... in array`) | **NO** |
| `supabase/migrations/00115_entrega_y_devolucion_revendedora.sql:47` | `sp_devolver_items_revendedora` | `sp_registrar_devolucion_revendedora` (que internamente itera sobre cada ítem del grupo) | Input (`p_items` agrupados por consignación) | Serie (`for ... in select ... loop`) | **NO** |

## Revisión de fases 2 y 3 (recalculado desde `trace-*.log`)

**Corrección de la tabla de la fase 2.** La columna "Round trips" toma la
mediana de todos los requests de cada ruta, y la mayoría son renders que solo
ejecutan el layout (una única llamada: `sp_session_context`). Un render
completo de `/ventas` hace 5 viajes (`sp_session_context`, `reserva`,
`rf_alertas_cuotas_vencidas`, `venta` ×2), no 1. Volumen grande: 100 requests
de 1 llamada y 22 de 5. La conclusión "no crece con N" se mantiene: chico y
grande dan la misma cantidad de llamadas en todas las rutas.

**Hallazgo principal.** 827 de los 1221 `sp_session_context` vienen de renders
que solo ejecutan el layout. Hipótesis (sin verificar, el log no registra el
header `next-router-prefetch`): son prefetches de los links del menú. Cada uno
cuesta ~0,65 ms en la base. No se cachea entre requests (permisos viejos tras
un cambio de rol) y el prefetch es lo que da la navegación instantánea: no se
toca.

**Descartado.**
- Las APIs `lookup-item` hacen 1 llamada a la base por request; no
  re-verifican la sesión contra la DB. El costo del N+1 de consignaciones y
  carrito es el viaje HTTP en serie, no la sesión.
- `/reportes`: `rf_finanzas_*` ×2 son período actual y anterior
  (`app/(app)/reportes/page.tsx:79-82`), no duplicados.
- `/ventas`: `venta` ×2 son la página y el resumen del período.

**No verificado.**
- `recorrerPeriodo` y `listDeudores`: con 200 filas el chunk de 1000 da 1
  request; el volumen grande no alcanza para ver el crecimiento.
- `/mi-cuenta` (portal revendedora).

**Duplicados a confirmar (mismos argumentos → `cache()` de React):**
`/inventario` `proveedor` ×2, `/plataforma` `superadmin` ×2 y `auth/user` ×2,
`/proveedores/[id]` `rendicion_proveedor` ×3, `/administracion` `auditoria` ×2.

**Lado base.** Lo más caro son escrituras puntuales (`sp_confirmar_ingreso`
154 ms, `sp_anular_venta` 129 ms de media) y `v_alerta_reposicion`
(15 ms de media, ×3,7 de chico a grande, se consulta en cada render de
`/inventario`). Arreglarlos requiere SQL: queda bloqueado hasta que se
autorice.

**Caché entre requests.** Ningún candidato pasa el checklist del plan.
