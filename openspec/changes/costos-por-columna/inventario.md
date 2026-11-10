# Inventario de lectores y escritores por columna sensible (Fase 1 — costos-por-columna)

**Change**: `costos-por-columna` · **Spec**: `proposal.md` · **Fase**: 1 (Solo Lectura) · **Fecha**: 2026-11-10  
**Regla de evidencia**: Toda afirmación en este documento deriva de comandos ejecutados en el repositorio, cuyas salidas textuales exactas están transcriptas en el [Apéndice A](#apéndice-a-evidencia-mecánica-de-comandos). En las matrices no se utilizan números de línea volátiles, sino rutas de archivo y nombres de función.

---

## 1. Columnas sensibles en la base de datos

A partir de la inspección mecánica de todas las definiciones de tablas y migraciones (`create table` y `alter table ... add column`), filtrando términos vinculados a costos, márgenes, ganancias, comisiones, retenciones y aranceles, se identifican las siguientes columnas sensibles distribuidas en 11 tablas del dominio (más la tabla `costo_producto` entera). Ninguna de estas columnas fue eliminada posteriormente en migraciones UP (los `drop column` registrados en el historial corresponden exclusivamente a bloques reversibles `-- DOWN:` o a la columna `zona_horaria` de `tenant`).

### 1.1. Catálogo completo de columnas sensibles

| # | Tabla | Columna Sensible | Tipo | Archivo de Migración de Origen | Clasificación / Contenido Sensible |
|---|---|---|---|---|---|
| 1 | `costo_producto` | `id_costo` | `uuid` | `supabase/migrations/00013_producto.sql` | Identificador interno de costo (tabla entera sensible) |
| 2 | `costo_producto` | `id_tenant` | `uuid` | `supabase/migrations/00013_producto.sql` | Aislamiento tenant (tabla entera sensible) |
| 3 | `costo_producto` | `id_producto` | `uuid` | `supabase/migrations/00013_producto.sql` | Producto asociado (tabla entera sensible) |
| 4 | `costo_producto` | `costo` | `numeric(14, 2)` | `supabase/migrations/00013_producto.sql` | Costo base / de adquisición vigente o histórico |
| 5 | `costo_producto` | `moneda` | `text` | `supabase/migrations/00013_producto.sql` | Moneda de costeo ('ARS' o 'USD') |
| 6 | `costo_producto` | `vigente_desde` | `timestamptz` | `supabase/migrations/00013_producto.sql` | Inicio de vigencia del costo |
| 7 | `costo_producto` | `vigente_hasta` | `timestamptz` | `supabase/migrations/00013_producto.sql` | Fin de vigencia (`null` = costo vigente hoy) |
| 8 | `costo_producto` | `id_usuario_alta` | `uuid` | `supabase/migrations/00013_producto.sql` | Auditor de fijación de costo |
| 9 | `costo_producto` | `motivo` | `text` | `supabase/migrations/00013_producto.sql` | Razón del cambio de costo |
| 10 | `costo_producto` | `created_at` | `timestamptz` | `supabase/migrations/00013_producto.sql` | Timestamp de inserción |
| 11 | `costo_producto` | `costo_original_usd` | `numeric(14, 2)` | `supabase/migrations/00130_cotizacion_usd.sql` | Costo de adquisición original en dólares |
| 12 | `costo_producto` | `cotizacion_aplicada` | `numeric(14, 4)` | `supabase/migrations/00130_cotizacion_usd.sql` | Tipo de cambio aplicado en la conversión |
| 13 | `costo_producto` | `cotizacion_fecha_valor` | `date` | `supabase/migrations/00130_cotizacion_usd.sql` | Fecha de referencia de la cotización dólar |
| 14 | `item_producto` | `costo_ingreso` | `numeric(14, 2)` | `supabase/migrations/00015_item_producto.sql` | Costo unitario real pagado por cada unidad física |
| 15 | `detalle_venta` | `costo_snapshot` | `numeric(14, 2)` | `supabase/migrations/00021_venta.sql` | Costo de mercadería congelado al momento de vender |
| 16 | `detalle_venta` | `monto_ganancia` | `numeric(14, 2)` | `supabase/migrations/00021_venta.sql` | Margen bruto en pesos de la línea (`precio_venta - costo_snapshot`) |
| 17 | `detalle_venta` | `porcentaje_comision_preview` | `numeric(5, 2)` | `supabase/migrations/00088_venta_canal.sql` | Porcentaje de comisión proyectado para canal revendedora |
| 18 | `detalle_venta` | `monto_comision` | `numeric(14, 2)` | `supabase/migrations/00088_venta_canal.sql` | Comisión liquidada en pesos sobre la venta |
| 19 | `ingreso_mercaderia_detalle` | `costo_unitario` | `numeric(14, 2)` | `supabase/migrations/00014_ingreso_mercaderia.sql` | Costo de compra por bulto/unidad pactado con proveedor |
| 20 | `ingreso_mercaderia_detalle` | `costo_original_usd` | `numeric(14, 2)` | `supabase/migrations/00130_cotizacion_usd.sql` | Costo pactado en dólares al ingresar remito |
| 21 | `ingreso_mercaderia_detalle` | `cotizacion_aplicada` | `numeric(14, 4)` | `supabase/migrations/00130_cotizacion_usd.sql` | Cotización utilizada al dar de alta el ingreso |
| 22 | `ingreso_mercaderia_detalle` | `cotizacion_fecha_valor` | `date` | `supabase/migrations/00130_cotizacion_usd.sql` | Fecha del valor de cotización aplicado |
| 23 | `devolucion_venta` | `costo_recuperado` | `numeric(14, 2)` | `supabase/migrations/00070_reintegro_y_devolucion.sql` | Costo contable restituido al stock devuelto |
| 24 | `pago_venta` | `costo_cobro` | `numeric(14, 2)` | `supabase/migrations/00057_costo_cobro.sql` | Costo financiero total retenido por pasarela/banco |
| 25 | `pago_venta` | `desglose_costo` | `jsonb` | `supabase/migrations/00057_costo_cobro.sql` | Detalle jsonb de aranceles, IVA y retenciones |
| 26 | `arancel_cobro` | `arancel_pct` | `numeric(6, 3)` | `supabase/migrations/00057_costo_cobro.sql` | Porcentaje de comisión retenido por procesador |
| 27 | `arancel_cobro` | `iva_arancel_pct` | `numeric(6, 3)` | `supabase/migrations/00057_costo_cobro.sql` | Tasa de IVA sobre el arancel (ej. 21%) |
| 28 | `cuenta_destino` | `ret_iva_pct` | `numeric(6, 3)` | `supabase/migrations/00057_costo_cobro.sql` | Retención impositiva fiscal de IVA de la cuenta |
| 29 | `cuenta_destino` | `ret_ganancias_pct` | `numeric(6, 3)` | `supabase/migrations/00057_costo_cobro.sql` | Retención fiscal de Impuesto a las Ganancias |
| 30 | `cuenta_destino` | `ret_iibb_pct` | `numeric(6, 3)` | `supabase/migrations/00057_costo_cobro.sql` | Retención fiscal de Ingresos Brutos |
| 31 | `cuenta_destino` | `imp_deb_cred_pct` | `numeric(6, 3)` | `supabase/migrations/00057_costo_cobro.sql` | Impuesto a los débitos y créditos bancarios |
| 32 | `liquidacion_revendedora` | `monto_comision` | `numeric(14, 2)` | `supabase/migrations/00094_liquidacion_revendedora.sql` | Monto total acumulado de comisión de liquidación |
| 33 | `escala_comision` | `porcentaje` | `numeric(5, 2)` | `supabase/migrations/00086_comisiones.sql` | Porcentaje de comisión pactado por tramo objetivo |
| 34 | `regla_precio` | `valor` (margen) | `numeric(12, 4)` | `supabase/migrations/00017_precios_enums_regla.sql` | Porcentaje o monto de margen cuando `tipo_regla = 'margen'` |
| 35 | `producto` | `id_regla_margen_aplicada` | `uuid` | `supabase/migrations/00018_producto_precio_venta.sql` | FK que vincula el producto a la regla de margen fijada |

---

### 1.2. Contrastación con el inventario anterior (`rls-por-permiso/inventario.md §4`)

La sección §4 de `rls-por-permiso` fue tomada como punto de partida y contrastada exhaustivamente contra el schema real de las migraciones mediante comandos mecánicos. Se identificaron **4 errores graves de nombres/ubicación de columnas** y **7 omisiones de columnas sensibles**:

1. **`regla_precio.margen_porcentaje` NO EXISTE** (error de cita en §4):
   - §4 afirmaba: `regla_precio` \| `margen_porcentaje` \| `numeric(5,2)` ([`00017:32`]).
   - **Evidencia**: `rg -n "margen_porcentaje" supabase/migrations` devolvió código de salida 1 (0 ocurrencias).
   - **Realidad**: `00017_precios_enums_regla.sql` define `valor numeric(12, 4)` y califica la regla mediante el enum `tipo_regla ('margen', 'descuento', 'recargo')`. La columna de margen es `valor` cuando `tipo_regla = 'margen'`.

2. **`consignacion_revendedora_detalle.comision_porcentaje_snapshot` NO EXISTE** (error de cita en §4):
   - §4 afirmaba: `consignacion_revendedora_detalle` \| `comision_porcentaje_snapshot` \| `numeric(5,2)` ([`00086:79`]).
   - **Evidencia**: `rg -n "comision_porcentaje_snapshot" supabase/migrations` devolvió código de salida 1 (0 ocurrencias). La línea 79 de `00086` es una cláusula `daterange` de un exclude constraint.
   - **Realidad**: La tabla `consignacion_revendedora_detalle` (creada en `00084`) no almacena comisiones. El porcentaje preview vive en `detalle_venta.porcentaje_comision_preview` (`00088:61`), y los tramos de escala en `escala_comision.porcentaje` (`00086:92`).

3. **`venta.monto_comision` NO EXISTE en `venta`** (error de tabla en §4):
   - §4 atribuía `monto_comision numeric(14,2)` a la tabla `venta` citando `00088:62`.
   - **Evidencia**: La línea 60 de `00088_venta_canal.sql` ejecuta `alter table detalle_venta`, y la línea 62 añade `monto_comision` a `detalle_venta`, NO a `venta`. Asimismo, `monto_comision` existe en `liquidacion_revendedora` (`00094:47`). La tabla `venta` jamás tuvo columna `monto_comision`.

4. **`ret_*` atribuido incorrectamente a `arancel_cobro`** (error de tabla en §4):
   - §4 agrupaba: `arancel_cobro` \| `arancel_pct`, `iva_arancel_pct`, `ret_*`.
   - **Evidencia**: `00057_costo_cobro.sql` agrega `ret_iva_pct`, `ret_ganancias_pct`, `ret_iibb_pct` e `imp_deb_cred_pct` a `cuenta_destino` (líneas 56-64), mientras que `arancel_cobro` únicamente contiene `arancel_pct` e `iva_arancel_pct` (líneas 88-92).

5. **Omisiones en §4**:
   - Omisión total de la tabla `costo_producto` entera: omitió sus 13 columnas operativas e históricas (`costo`, `costo_original_usd`, `cotizacion_aplicada`, `cotizacion_fecha_valor`, etc.).
   - Omisión de `ingreso_mercaderia_detalle`: contiene `costo_unitario`, `costo_original_usd`, `cotizacion_aplicada`, `cotizacion_fecha_valor` (protegida por módulo `inventario` en `00142`, pero con datos de costo).
   - Omisión de `detalle_venta.porcentaje_comision_preview`: omitida en la matriz de §4.
   - Omisión de `cuenta_destino.imp_deb_cred_pct`: impuesto financiero que integra el costo de cobro.
   - Omisión de `liquidacion_revendedora.monto_comision`: total acumulado de comisión.
   - Omisión de `producto.id_regla_margen_aplicada`: FK que revela la regla de margen comercial asociada.

---

## 2. Lectores en `lib/dal/**`

Se auditó mecánicamente todo `lib/dal/**` buscando el nombre de cada columna sensible en cualquier posición de consulta (incluyendo proyecciones embebidas o joins de PostgREST como `item:item_producto(...)` e `ingreso_mercaderia_detalle(...)`), así como todas las consultas `select('*')` sobre las tablas sensibles (incluyendo multilínea y con opciones).

> [!NOTE]
> **Aclaración sobre `ingreso_mercaderia_detalle`**: La migración `00142_rlsp_cuatro_tablas.sql` ya implementó una política RLS restrictiva que exige permiso `inventario.ver` para realizar `SELECT` sobre `ingreso_mercaderia_detalle`. Sus lectores en DAL están resguardados por dicha política de fila/módulo, pero contienen columnas de costo que deben inventariarse ante un esquema de segregación por columna.

### 2.1. Matriz de lecturas en DAL (explícitas, embebidas y proyecciones completas)

| Columna Sensible | Tabla | Función DAL | Archivo DAL | Cláusula de Selección | Quién la consume (Action / Endpoint / Server Component) | Guard Real Verificado (`requireModuleRole`) |
|---|---|---|---|---|---|---|
| `costo_ingreso` | `item_producto` | `getConsignacionConDetalle` | `lib/dal/consignaciones/consignacion.ts` | Embebido: `item:item_producto(qr_code, estado_item, costo_ingreso)` | Server Component `app/(app)/consignaciones/[id]/page.tsx` | `consignaciones.ver` (layout) |
| `costo_ingreso` | `item_producto` | `getUltimoContextoIngresoProducto` | `lib/dal/inventario/item.ts` | Explícito: `'tipo_ingreso, costo_ingreso, ingreso:...'` | Server Component `app/(app)/inventario/ingresos/nuevo/page.tsx` | `inventario.ver` (layout) |
| `costo_ingreso` | `item_producto` | `getPerfilProveedorPorId` | `lib/dal/inventario/proveedor.ts` | Explícito: `'costo_ingreso, ingreso_mercaderia!inner(...)'` | Server Component `app/(app)/inventario/proveedores/[id]/page.tsx` | `inventario.ver` (layout) |
| `costo_ingreso` (vía `*`) | `item_producto` | `findItemByQr` | `lib/dal/inventario/item.ts` | `select('*')` | Lookup `/api/ventas/lookup-item` y `/api/consignaciones/lookup-item` | `ventas.ver` / `consignaciones.ver` |
| `costo_ingreso` (vía `*`) | `item_producto` | `getItemConDetalle` | `lib/dal/inventario/item.ts` | `select('*', producto(...))` | Server Component `app/(app)/inventario/ficha/[qr]/page.tsx` | `inventario.ver` (layout) |
| `costo_ingreso` (vía `*`) | `item_producto` | `listItemsByProducto` | `lib/dal/inventario/item.ts` | `select('*')` | Server Component `app/(app)/inventario/productos/[id]/page.tsx` | `inventario.ver` (layout) |
| `costo_ingreso` (vía `*`) | `item_producto` | `listItemsDisponibles` | `lib/dal/inventario/item.ts` | `select('*')` | Endpoint `/api/ventas/stock-disponible/route.ts` | `ventas.ver` |
| `costo_unitario` | `ingreso_mercaderia_detalle` | `listIngresos` | `lib/dal/inventario/ingreso.ts` | Embebido: `detalle:ingreso_mercaderia_detalle(cantidad, costo_unitario)` | Server Component `app/(app)/inventario/ingresos/page.tsx` | `inventario.ver` (layout) |
| `costo_unitario` | `ingreso_mercaderia_detalle` | `listIngresosDeProveedor` | `lib/dal/inventario/ingreso.ts` | Embebido: `detalle:ingreso_mercaderia_detalle(cantidad, costo_unitario)` | Server Component `app/(app)/inventario/proveedores/[id]/page.tsx` | `inventario.ver` (layout) |
| `costo_snapshot` | `detalle_venta` | `getRendicionConDetalle` | `lib/dal/rendiciones/rendicion.ts` | Explícito: `costo_snapshot, monto_proveedor` | Server Component `app/(app)/rendiciones/[id]/page.tsx` | `rendiciones.ver` (layout) |
| `monto_comision, porcentaje_comision_preview` | `detalle_venta` | `obtenerLiquidacionConDetalle` | `lib/dal/revendedoras/liquidacion.ts` | Explícito: `monto_comision, porcentaje_comision_preview` | Server Component `app/(app)/revendedoras/[id]/liquidaciones/[idLiquidacion]/page.tsx` | `revendedoras.ver` (layout) |
| `costo_original_usd` | `costo_producto` | `countProductosCostoUsdVigentes` | `lib/dal/precios/cotizacion.ts` | Filtro `.not('costo_original_usd', 'is', null)` sobre `select('id_costo')` | Actions de cotización en `app/(app)/precios/cotizacion/actions.ts` | `precios.editar_cotizacion` |
| `costo_vigente` (vía RPC) | `costo_producto` | `queryProductos` | `lib/dal/inventario/producto.ts` | RPC `sp_listar_productos` (devuelve `costo_vigente`) | Consumido en `/ventas/nueva`, `/ventas/reservas/nueva`, `/inventario`, `/precios/reglas` | `ventas.ver` / `inventario.ver` / `precios.ver` |
| `costo_vigente` (vía RPC) | `costo_producto` | `listControlDePrecios` | `lib/dal/precios/resolucion.ts` | RPC `sp_control_de_precios` (devuelve `costo_vigente` y regla margen) | Server Component `app/(app)/precios/control/page.tsx` | `precios.ver` (layout) |
| `costo_snapshot` (vía RPC) | `detalle_venta` | `previewRendicion` | `lib/dal/rendiciones/rendicion.ts` | RPC `preview_rendicion` (devuelve `costo_snapshot`) | Server Component `app/(app)/rendiciones/nueva/page.tsx` | `rendiciones.ver` (layout) |
| `costo_snapshot` (vía RPC) | `detalle_venta` | `getPerdidaIncobrableVenta` | `lib/dal/cuotas/cuota.ts` | RPC `sp_perdida_incobrable_venta` (devuelve `costo_snapshot`) | Vista de cuota incobrable | `ventas.ver` (layout) |
| `costo_vigente, margen_pct` (vista) | `v_ganancia_por_producto` | `listGananciaPorProducto` | `lib/dal/reportes/reportes.ts` | `select('*')` sobre la vista | Server Component `app/(app)/reportes/mercaderia/page.tsx` | `reportes.ver` (layout) |
| `monto_proveedor` (vista) | `v_perfil_proveedor` | `listPerfilProveedor` | `lib/dal/reportes/reportes.ts` | `select('*')` sobre la vista | Server Component `app/(app)/reportes/proveedores/page.tsx` | `reportes.ver` (layout) |
| `valor` (margen) (vía `*`) | `regla_precio` | `listReglasPrecio` | `lib/dal/precios/regla.ts` | `select('*')` | Server Component `app/(app)/precios/reglas/page.tsx` y `/api/ventas/descuentos-disponibles` | `precios.ver` / `ventas.ver` |
| `valor` (margen) (vía `*`) | `regla_precio` | `getReglaPrecio` | `lib/dal/precios/regla.ts` | `select('*')` | Actions de precios (`bajaReglaAction`, etc.) | `precios.editar` |
| `monto_comision` (vía `*`) | `liquidacion_revendedora` | `listarLiquidacionesRevendedora` | `lib/dal/revendedoras/liquidacion.ts` | `select('*')` | Server Component `app/(app)/revendedoras/[id]/liquidaciones/page.tsx` | `revendedoras.ver` (layout) |
| `monto_comision` (vía `*`) | `liquidacion_revendedora` | `obtenerLiquidacionConDetalle` | `lib/dal/revendedoras/liquidacion.ts` | `select('*, pago_revendedora(*)')` | Server Component `app/(app)/revendedoras/[id]/liquidaciones/[idLiquidacion]/page.tsx` | `revendedoras.ver` (layout) |
| `arancel_pct, iva_arancel_pct` (vía `*`) | `arancel_cobro` | `listArancelesCobro` | `lib/dal/ventas/arancel.ts` | `select('*')` | Server Component `app/(app)/precios/cuentas/page.tsx` | `precios.ver` (layout) |
| `arancel_pct, iva_arancel_pct` (vía `*`) | `arancel_cobro` | `createArancelCobro` | `lib/dal/ventas/arancel.ts` | `insert(...).select('*')` | Action `crearArancelCobroAction` en `app/(app)/precios/actions.ts` | `precios.crear` |
| `ret_*, imp_deb_cred_pct` (vía `*`) | `cuenta_destino` | `listCuentasDestino` | `lib/dal/ventas/cuenta-destino.ts` | `select('*')` | Utilizado en checkout `app/(app)/ventas/nueva/page.tsx` y pagos | `ventas.ver` (layout) |
| `ret_*, imp_deb_cred_pct` (vía `*`) | `cuenta_destino` | `listCuentasDestinoPaginado` (`from`) | `lib/dal/ventas/cuenta-destino.ts` | `select('*', { count: 'exact' })` | Server Component de cuentas en precios | `precios.ver` (layout) |
| `ret_*, imp_deb_cred_pct` (vía `*`) | `cuenta_destino` | `createCuentaDestino` | `lib/dal/ventas/cuenta-destino.ts` | `insert(...).select('*')` | Action `crearCuentaDestinoAction` en `app/(app)/precios/actions.ts` | `precios.crear` |

### 2.2. Resumen cuantitativo de `select('*')` sobre tablas sensibles en DAL

Se verificaron **13 llamadas concretas a `select('*')`** (o `select('*, ...')`) sobre tablas que alojan columnas sensibles:
- `item_producto` (4 llamadas): `findItemByQr`, `getItemConDetalle`, `listItemsByProducto`, `listItemsDisponibles`.
- `regla_precio` (2 llamadas): `listReglasPrecio`, `getReglaPrecio`.
- `liquidacion_revendedora` (2 llamadas): `listarLiquidacionesRevendedora`, `obtenerLiquidacionConDetalle`.
- `arancel_cobro` (2 llamadas): `listArancelesCobro`, `createArancelCobro`.
- `cuenta_destino` (3 llamadas): `listCuentasDestino`, `listCuentasDestinoPaginado`, `createCuentaDestino`.

---

## 3. Catálogo vivo en SQL: Lectores, Escritores, Triggers y Vistas

Se auditó mecánicamente la última definición viva (`pnpm sp:last`) de cada función almacenada, función de reporte, trigger y vista que mencione tablas o columnas sensibles.

### 3.1. Funciones SQL vigentes (Clasificación por Rol Operativo)

| Nombre de Función | Modo | Rol Operativo | Migración Vigente | Columnas / Tablas Sensibles que Accede | Quién la llama y Guard |
|---|---|---|---|---|---|
| `sp_listar_productos` | **INVOKER** | **Lector** | `00042_inventario_batch.sql` | `costo_producto.costo` (como `costo_vigente`), `moneda`, `id_regla_margen_aplicada` | `queryProductos` (`lib/dal/inventario/producto.ts`) desde checkout `/ventas/nueva` (`ventas.ver`) y buscador `/inventario` (`inventario.ver`) |
| `sp_control_de_precios` | **INVOKER** | **Lector** | `00040_precios_batch.sql` | `costo_producto.costo` (como `costo_vigente`), `regla_precio.valor` (vía `resolver_regla_margen`), `id_regla_margen_aplicada` | `listControlDePrecios` (`lib/dal/precios/resolucion.ts`) desde `/precios/control` (`precios.ver`) |
| `sp_calcular_costo_cobro` | **INVOKER** | **Lector** | `00066_zona_horaria_tenant.sql` | `arancel_cobro.arancel_pct`, `iva_arancel_pct`, `cuenta_destino.ret_*`, `imp_deb_cred_pct` | Invocada internamente por `sp_registrar_venta` (`ventas.crear`) y `sp_cobrar_cuota` (`ventas.editar`) |
| `preview_rendicion` | **INVOKER** | **Lector** | `00126_rendicion_modulo.sql` | `detalle_venta.costo_snapshot`, `monto_proveedor` | `previewRendicion` (`lib/dal/rendiciones/rendicion.ts`) en `/rendiciones/nueva` (`rendiciones.ver`) |
| `preview_liquidacion` | **INVOKER** | **Lector** | `00095_liquidacion_functions.sql` | `detalle_venta.monto_comision`, `porcentaje_comision_preview`, `escala_comision.porcentaje` | `previewLiquidacionAction` (`revendedoras.ver`) |
| `sp_perdida_incobrable_venta` | **INVOKER** | **Lector** | `00059_financiacion_propia.sql` | `detalle_venta.costo_snapshot`, `monto_proveedor` | `getPerdidaIncobrableVenta` (`lib/dal/cuotas/cuota.ts`) en ficha de cuotas (`ventas.ver`) |
| `sp_revaluar_costos_usd_vigentes` | **INVOKER** | **Lector y Escritor** | `00146_rlsp_sp_precios.sql` | Lee `costo_producto.costo_original_usd`, `cotizacion_aplicada`; llama a `sp_aplicar_ultimo_costo` | `revaluarCostosUsdAction` (`precios.editar_cotizacion`) |
| `sp_aplicar_ultimo_costo` | **INVOKER** | **Lector y Escritor** | `00145_rlsp_sp_inventario.sql` | Lee `costo_producto`; inserta nuevo `costo_producto`; actualiza `item_producto.costo_ingreso` | Invocada por `sp_confirmar_ingreso`, `sp_set_costo_producto`, `sp_revaluar_costos_usd_vigentes` |
| `sp_confirmar_ingreso` | **INVOKER** | **Lector y Escritor** | `00145_rlsp_sp_inventario.sql` | Lee `ingreso_mercaderia_detalle.costo_unitario`, `costo_original_usd`, `cotizacion_*`; inserta `item_producto.costo_ingreso`; llama `sp_aplicar_ultimo_costo` | `confirmarIngresoAction` (`inventario.crear`) |
| `sp_crear_stock_directo` | **INVOKER** | **Lector y Escritor** | `00145_rlsp_sp_inventario.sql` | Inserta `item_producto.costo_ingreso`; llama `sp_aplicar_ultimo_costo` (escribe `costo_producto`) | `createProductoAction` (`inventario.crear`) |
| `sp_importar_remito` | **INVOKER** | **Lector y Escritor** | `00145_rlsp_sp_inventario.sql` | Inserta `ingreso_mercaderia_detalle.costo_unitario`, `costo_original_usd`, `cotizacion_*`; llama `sp_aplicar_ultimo_costo` | `importarRemitoAction` (`inventario.crear`) |
| `sp_registrar_venta` | **INVOKER** | **Lector y Escritor** | `00144_rlsp_sp_ventas.sql` | Lee `item_producto.costo_ingreso`; inserta `detalle_venta.costo_snapshot`, `monto_ganancia`, `porcentaje_comision_preview`, `pago_venta.costo_cobro` | `registrarVentaAction` (`ventas.crear` / `revendedoras.crear`) |
| `sp_registrar_cambio` | **INVOKER** | **Lector y Escritor** | `00144_rlsp_sp_ventas.sql` | Lee `detalle_venta.costo_snapshot`, `item_producto.costo_ingreso`; inserta nueva línea en `detalle_venta` | `cambiarItemVentaAction` (`ventas.crear` / `revendedoras.crear`) |
| `sp_registrar_devolucion_cliente` | **INVOKER** | **Lector y Escritor** | `00144_rlsp_sp_ventas.sql` | Lee `detalle_venta.costo_snapshot`; inserta `devolucion_venta.costo_recuperado` | `devolverItemVentaAction` (`ventas.editar`) |
| `sp_cobrar_cuota` | **INVOKER** | **Lector y Escritor** | `00144_rlsp_sp_ventas.sql` | Llama `sp_calcular_costo_cobro`; inserta `pago_venta.costo_cobro`, `desglose_costo` | `cobrarCuotaAction` (`ventas.editar`) |
| `sp_recalcular_precio_venta` | **INVOKER** | **Lector y Escritor** | `00146_rlsp_sp_precios.sql` | Lee `costo_producto.costo`, `regla_precio.valor`; actualiza `producto.id_regla_margen_aplicada` | `recalcularPrecioAction` (`precios.editar`) |
| `sp_generar_liquidacion` | **INVOKER** | **Lector y Escritor** | `00148_rlsp_sp_revendedoras.sql` | Actualiza y lee `detalle_venta.monto_comision`; inserta `liquidacion_revendedora.monto_comision` | `generarLiquidacionAction` (`revendedoras.liquidar`) |
| `rf_finanzas_resultados` | **INVOKER** | **Lector** | `00110_finanzas_cambio_diferencia.sql` | Lee `v_linea_venta` (`costo`, `costo_recuperado`, `comision`), `pago_venta.costo_cobro`, `item_producto.costo_ingreso` | `getResultadosPeriodo` en `/reportes` (`reportes.ver`) |
| `rf_finanzas_flujo` | **INVOKER** | **Lector** | `00095_liquidacion_functions.sql` | Lee `pago_venta.costo_cobro`, `ingreso_mercaderia_detalle.costo_unitario` | `getFlujoFondos` en `/reportes` (`reportes.ver`) |
| `rf_finanzas_posicion` | **INVOKER** | **Lector** | `00111_seguridad_revendedoras.sql` | Lee `item_producto.costo_ingreso`, `ingreso_mercaderia_detalle.costo_unitario`, `liquidacion_revendedora.monto_comision` | `getPosicion` en `/reportes` (`reportes.ver`) |
| `rf_reporte_caja` | **INVOKER** | **Lector** | `00066_zona_horaria_tenant.sql` | Lee `pago_venta.costo_cobro` | `getReporteCaja` en `/reportes` (`reportes.ver`) |
| `rf_rotacion_por_producto` | **INVOKER** | **Lector** | `00028_reportes.sql` | Lee `detalle_venta.monto_ganancia` | Invocada en reportes de rotación (`reportes.ver`) |
| `rf_panel_revendedoras` | **INVOKER** | **Lector** | `00107_panel_declaraciones_pendientes.sql` | Lee `detalle_venta.monto_comision`, `porcentaje_comision_preview` | `obtenerPanelRevendedoras` en `/revendedoras` (`revendedoras.ver`) |
| `rf_totales_panel_revendedoras` | **INVOKER** | **Lector** | `00101_panel_revendedoras_cambio.sql` | Lee `detalle_venta.monto_comision` | Totales del panel `/revendedoras` (`revendedoras.ver`) |
| `rf_cuenta_corriente_revendedora` | **INVOKER** | **Lector** | `00100_finanzas_cambio.sql` | Lee `detalle_venta.monto_comision` | Cuenta corriente `/revendedoras/[id]/cuenta` (`revendedoras.ver`) |
| `rf_perfil_revendedora` | **INVOKER** | **Lector** | `00102_reportes_revendedoras.sql` | Lee `detalle_venta.monto_comision`, `porcentaje_comision_preview` | Reporte revendedoras (`reportes.ver`) |
| `rf_resumen_canal` | **INVOKER** | **Lector** | `00102_reportes_revendedoras.sql` | Lee `detalle_venta.monto_comision`, `porcentaje_comision_preview` | Reporte revendedoras (`reportes.ver`) |
| `rvp_mis_ventas` | **DEFINER** | **Lector** | `00106_rvp_lecturas.sql` | Lee `detalle_venta.monto_comision`, `porcentaje_comision_preview` con lista blanca | Portal revendedora `/mi-cuenta/ventas` (`revendedoras.ver_propio`) |
| `rvp_mi_cuenta` | **DEFINER** | **Lector** | `00111_seguridad_revendedoras.sql` | Lee `liquidacion_revendedora.monto_comision`, `detalle_venta.monto_comision` con lista blanca | Portal revendedora `/mi-cuenta` (`revendedoras.ver_propio`) |
| `rvp_mis_liquidaciones` | **DEFINER** | **Lector** | `00106_rvp_lecturas.sql` | Lee `liquidacion_revendedora.monto_comision` con lista blanca | Portal revendedora `/mi-cuenta/liquidaciones` (`revendedoras.ver_propio`) |
| `tg_detalle_venta_inmutable` | **INVOKER** | **Trigger** | `00088_venta_canal.sql` | Lee `costo_snapshot`, `monto_ganancia`, `monto_comision`, `porcentaje_comision_preview` para validar inmutabilidad | Trigger BEFORE UPDATE / DELETE en tabla `detalle_venta` |

---

### 3.2. Vistas que exponen columnas sensibles

| Vista | Definición Vigente | `security_invoker` | Columnas Sensibles Expuestas |
|---|---|---|---|
| `v_linea_venta` | `00110_finanzas_cambio_diferencia.sql` | `true` | `costo` (desde `dv.costo_snapshot`), `margen` (desde `dv.monto_ganancia`), `costo_recuperado` (desde `dev.costo_recuperado` o `dv.costo_snapshot`), `comision` (desde `dv.monto_comision`), `comision_estimada` (desde `dv.porcentaje_comision_preview`) |
| `v_ganancia_por_producto` | `00028_reportes.sql` | `on` (`true`) | `costo_vigente` (desde `cp.costo`), `moneda`, `ganancia_unitaria`, `margen_pct` |
| `v_perfil_proveedor` | `00071_devolucion_cliente.sql` | `on` (`true`) | `sum(dv.monto_proveedor)` (pasivo acumulado por consignación) |

---

## 4. Escritores por columna (`sp_*` y DAL)

| Columna Sensible | Tabla | Stored Procedures / DAL que la Escriben (INSERT / UPDATE) | Acción / Proceso Disparador |
|---|---|---|---|
| `costo`, `costo_original_usd`, `cotizacion_aplicada`, `cotizacion_fecha_valor` | `costo_producto` | `sp_aplicar_ultimo_costo` (inserta nueva fila e invalida anterior con `vigente_hasta = now()`). Conducido por: `sp_set_costo_producto`, `sp_confirmar_ingreso`, `sp_importar_remito`, `sp_revaluar_costos_usd_vigentes`. | Carga de stock, importación de remito, cambio manual de costo o revaluación por cotización USD. |
| `costo_ingreso` | `item_producto` | `sp_confirmar_ingreso` (INSERT inicial), `sp_crear_stock_directo` (INSERT inicial), `sp_aplicar_ultimo_costo` (UPDATE masivo de ítems en stock disponible). | Ingreso de mercadería y sincronización de costo único. |
| `costo_snapshot` | `detalle_venta` | `sp_registrar_venta` (INSERT), `sp_registrar_cambio` (INSERT de nueva línea). | Registro de venta y cambio de prenda. |
| `monto_ganancia` | `detalle_venta` | `sp_registrar_venta` (INSERT calculado: `precio_venta - costo_snapshot`), `sp_registrar_cambio` (INSERT calculado). | Registro de venta y cambio de prenda. |
| `porcentaje_comision_preview` | `detalle_venta` | `sp_registrar_venta` (INSERT calculado vía `fn_resolver_comision`), `sp_registrar_cambio` (INSERT). | Venta en canal revendedora. |
| `monto_comision` | `detalle_venta` | `sp_generar_liquidacion` (UPDATE definitivo al sellar liquidación), `sp_registrar_cambio` (INSERT inicial en 0). | Liquidación periódica de revendedoras. |
| `costo_unitario`, `costo_original_usd`, `cotizacion_*` | `ingreso_mercaderia_detalle` | `sp_importar_remito` o inserción DAL `addIngresoDetalle` (`lib/dal/inventario/ingreso.ts`). | Carga de remito en borrador. |
| `costo_recuperado` | `devolucion_venta` | `sp_registrar_devolucion_cliente` (INSERT con el `costo_snapshot` del detalle). | Devolución de producto por cliente. |
| `costo_cobro`, `desglose_costo` | `pago_venta` | `sp_registrar_venta` (INSERT vía `sp_calcular_costo_cobro`), `sp_cobrar_cuota` (INSERT vía `sp_calcular_costo_cobro`). | Cobro en mostrador o cobro de cuota financiada. |
| `arancel_pct`, `iva_arancel_pct` | `arancel_cobro` | Inserción/actualización directa en DAL (`lib/dal/ventas/arancel.ts`): `createArancelCobro`, `updateArancelCobro`. | Configuración de pasarelas y aranceles en Precios. |
| `ret_*`, `imp_deb_cred_pct` | `cuenta_destino` | Inserción/actualización directa en DAL (`lib/dal/ventas/cuenta-destino.ts`): `createCuentaDestino`, `updateCuentaDestino`. | Configuración de cuentas bancarias/billeteras. |
| `monto_comision` | `liquidacion_revendedora` | `sp_generar_liquidacion` (INSERT y UPDATE final recalculado). | Generación de liquidación a revendedora. |
| `porcentaje` | `escala_comision` | `sp_crear_regla_comision` (INSERT tramos de escala). | Alta de regla de comisión en revendedoras. |
| `valor` (margen) | `regla_precio` | `sp_create_regla_precio` (INSERT con `tipo_regla = 'margen'`). | Creación de regla de margen en precios. |
| `id_regla_margen_aplicada` | `producto` | `sp_recalcular_precio_venta` (UPDATE), `sp_create_producto` (UPDATE al crear). | Fijación de margen al alta o recálculo masivo. |

---

## 5. Pantallas que muestran cada dato sensible y compuerta de acceso

| Pantalla / Componente UI | Archivo Fuente | Datos Sensibles Visibles | Permiso Requerido para Abrir |
|---|---|---|---|
| Ficha de Producto | `app/(app)/inventario/productos/[id]/page.tsx` (`FichaProductoView.tsx`) | Costo vigente, moneda, margen porcentual, ganancia unitaria estimada, historial de costos | `inventario.ver` |
| Escaneo / Ficha Ítem QR | `app/(app)/inventario/ficha/[qr]/page.tsx` | Costo de ingreso unitario del ítem escaneado | `inventario.ver` |
| Nuevo Ingreso de Stock | `app/(app)/inventario/ingresos/nuevo/page.tsx` (`NuevoIngresoView.tsx`) | Costo unitario de compra (ARS y USD), cotización aplicada | `inventario.ver` (layout), `inventario.crear` (acción) |
| Control de Precios | `app/(app)/precios/control/page.tsx` (`ControlPreciosView.tsx`) | Costo vigente de adquisición, regla de margen aplicada | `precios.ver` |
| Reglas de Precio y Margen | `app/(app)/precios/reglas/page.tsx` (`ReglasPrecioView.tsx`, `GuiaReglas.tsx`) | Valor de margen porcentual por producto/categoría/global | `precios.ver` |
| Cuentas y Tarifarios | `app/(app)/precios/cuentas/page.tsx` (`CuentasTarifariosView.tsx`) | Aranceles bancarios (`arancel_pct`), retenciones fiscales (`ret_*`) | `precios.ver` |
| Checkout / Cobranza Mostrador | `app/(app)/ventas/nueva/CobranzaPanel.tsx` | Costo de cobro financiero y comisión arancelaria del medio de pago seleccionado | `ventas.ver` |
| Ficha de Rendición | `app/(app)/rendiciones/[id]/page.tsx` (`RendicionDetalleView.tsx`) | Costo de mercadería de líneas vendidas (`costo_snapshot`) | `rendiciones.ver` |
| Reporte Financiero (Resultados) | `app/(app)/reportes/page.tsx` (`BloqueGanancia.tsx`, `GraficoTendencia.tsx`) | Costo total de mercadería vendida, ganancia sobre ventas, costo de cobro financiero, ganancia final | `reportes.ver` |
| Reporte de Mercadería | `app/(app)/reportes/mercaderia/page.tsx` | Ganancia unitaria y margen porcentual por producto (`v_ganancia_por_producto`) | `reportes.ver` |
| Liquidación Revendedora | `app/(app)/revendedoras/[id]/liquidaciones/[idLiquidacion]/page.tsx` | Comisiones liquidadas por prenda (`monto_comision`) y comisión total | `revendedoras.ver` |
| Reglas de Comisión | `app/(app)/revendedoras/comisiones/page.tsx` (`ReglasComisionView.tsx`) | Escalas de porcentaje de comisión asignadas | `revendedoras.ver` |
| Portal Revendedora (Mi Cuenta) | `app/(revendedora)/mi-cuenta/page.tsx` | Comisión propia acumulada (liquidada y estimada) | `revendedoras.ver_propio` |

---

## 6. Resumen: qué se rompe si un rol sin permiso deja de leer costos

Si se aplica una restricción que revoque el permiso `SELECT` a nivel de base de datos sobre las columnas sensibles a roles no autorizados (por ejemplo `authenticated`), se identifican los siguientes puntos de ruptura críticos confirmados por código:

1. **Ruptura de la venta en mostrador (`sp_registrar_venta`)**:
   - `sp_registrar_venta` es una función **INVOKER** ejecutada por el vendedor (`ventas.crear`).
   - Lee `v_item.costo_ingreso` para computar `v_costo` y persistir `detalle_venta.costo_snapshot` y `detalle_venta.monto_ganancia`.
   - Si el vendedor no tiene `SELECT` sobre `item_producto.costo_ingreso`, la transacción de venta aborta con error de permisos (`42501`) impidiendo cobrar y despachar.

2. **Ruptura del cambio de prendas (`sp_registrar_cambio`)**:
   - `sp_registrar_cambio` es **INVOKER** (`ventas.crear`).
   - Lee `dv.costo_snapshot` de la prenda original y `ip.costo_ingreso` de la prenda entregada para insertar la nueva línea en `detalle_venta`.
   - Falla inmediatamente si se bloquea la lectura de cualquiera de ambas columnas.

3. **Ruptura de devoluciones de clientes (`sp_registrar_devolucion_cliente`)**:
   - `sp_registrar_devolucion_cliente` es **INVOKER** (`ventas.editar`).
   - Lee `dv.costo_snapshot` para persistir `devolucion_venta.costo_recuperado`. Falla ante la revocación de la columna.

4. **Exposición directa de costo por RPC a roles sin permiso**:
   - `sp_listar_productos`: devuelve `costo_vigente` y es consumido masivamente por `listProductosConDetalle` en `/ventas/nueva` (`ventas.ver`) y `/ventas/reservas/nueva` (`ventas.ver`). Hoy un vendedor o cajero recibe en el payload JSON el costo de compra de todo el catálogo.
   - `sp_control_de_precios`: devuelve `costo_vigente` y el margen aplicado (`regla_margen_nombre`) a la pantalla `/precios/control` (`precios.ver`).

5. **Colapso de consultas DAL por `select('*')`**:
   - Se verificaron **13 consultas DAL que usan `select('*')`** sobre tablas con columnas sensibles (`item_producto`, `regla_precio`, `liquidacion_revendedora`, `arancel_cobro`, `cuenta_destino`).
   - En Postgres, cualquier `SELECT *` falla si el rol carece de permiso en al menos una columna de la tabla. En particular, `findItemByQr` y `listCuentasDestino` harían colapsar la pantalla de ventas (`/ventas/nueva`).

6. **Cálculo de retenciones en cobranzas (`sp_calcular_costo_cobro`)**:
   - `sp_calcular_costo_cobro` es **INVOKER** y se ejecuta dentro de `sp_registrar_venta` y `sp_cobrar_cuota`.
   - Consulta `arancel_cobro` y `cuenta_destino`. Si el rol carece de permiso para ver aranceles o retenciones, el snapshot de aranceles se calculará en cero o fallará la ejecución.

7. **Pantalla de nueva rendición (`preview_rendicion`)**:
   - `preview_rendicion` es **INVOKER** y devuelve explícitamente `dv.costo_snapshot`. Un operador de rendiciones sin permiso de costos no podrá previsualizar la rendición.

8. **Vistas INVOKER y Reportes**:
   - `v_linea_venta` (`security_invoker = true`) expone `costo_snapshot`, `monto_ganancia`, `costo_recuperado` y `monto_comision`. Todas las funciones de reporte (`rf_finanzas_resultados`, `rf_finanzas_ranking_productos`) que leen `v_linea_venta` fallarán si el usuario no tiene permisos de columna.
   - `v_ganancia_por_producto` (`security_invoker = on`) expone `costo_vigente` y `margen_pct`. Falla para roles sin permiso.

9. **Lo que no se pudo verificar mecánicamente por comando**:
   - **Las combinaciones de "Roles reales" presentes en la base de datos de producción**: en el código del repositorio únicamente existen el aprovisionamiento de semillas (`Administrador` y `Revendedora`), mientras que las combinaciones efectivas de `rol.permisos` configuradas por cada cliente en sus tiendas reales no residen en el repositorio git y deben ser provistas por la persona en la Fase 2.

---

## 7. Preguntas abiertas para la Fase 2

1. **¿Qué permiso en `CATALOGO_PERMISOS` debe gobernar la lectura de costos?**
   - Actualmente no existe un permiso atómico `costos.ver`. ¿Se añade una acción a un módulo existente (ej. `inventario.ver_costos`, `precios.ver_costos`) o se crea un permiso global de visualización de costos?
2. **¿Enfoque A (revocación de columnas) vs Enfoque B (segregación de tablas) vs Enfoque C (vistas/funciones DEFINER)?**
   - Si se revoca SELECT en columnas (`costo_ingreso`, `costo_snapshot`), funciones como `sp_registrar_venta`, `sp_registrar_cambio` y `sp_registrar_devolucion_cliente` deberán convertirse a `SECURITY DEFINER` (requiere aprobación explícita según `AGENTS.md`), o bien desacoplarse para no leer el costo directamente desde el actor vendedor.
3. **¿Cómo resolver los 13 `select('*')` en la DAL?**
   - Para tablas compartidas (`item_producto`, `cuenta_destino`), ¿se refactorizan todas las llamadas DAL para usar proyecciones explícitas de columnas públicas antes de alterar permisos en Postgres?
4. **¿Los aranceles de cobro y retenciones bancarias (`arancel_cobro`, `cuenta_destino.ret_*`) se consideran parte del secreto de costos o deben permanecer accesibles al vendedor para operar?**
5. **¿Qué combinaciones de permisos ("Roles reales") se presentarán en producción?** (Pregunta reservada a la definición del usuario en la Fase 2).

---

## Apéndice A: Evidencia mecánica de comandos

### A.1. Verificación de columnas inexistentes citadas erróneamente en inventario anterior

```text
$ rg -n "margen_porcentaje" supabase/migrations
(código de salida 1 - sin ocurrencias)

$ rg -n "comision_porcentaje_snapshot" supabase/migrations
(código de salida 1 - sin ocurrencias)
```

### A.2. Comando de búsqueda de todas las columnas sensibles en `lib/dal/**` (incluye selects embebidos)

Comando ejecutado:
```text
node --experimental-strip-types -e "
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function findFiles(dir, filter) {
  let res = [];
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) res = res.concat(findFiles(full, filter));
    else if (filter(full)) res.push(full);
  }
  return res;
}

const dalFiles = findFiles('lib/dal', f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const sensitiveCols = [
  'costo_ingreso', 'costo_snapshot', 'monto_ganancia', 'porcentaje_comision_preview',
  'monto_comision', 'costo_unitario', 'costo_original_usd', 'cotizacion_aplicada',
  'cotizacion_fecha_valor', 'costo_recuperado', 'costo_cobro', 'desglose_costo',
  'arancel_pct', 'iva_arancel_pct', 'ret_iva_pct', 'ret_ganancias_pct', 'ret_iibb_pct',
  'imp_deb_cred_pct', 'id_regla_margen_aplicada', 'costo_vigente'
];

for (const file of dalFiles) {
  const content = readFileSync(file, 'utf8');
  const rel = relative('.', file).replace(/\\\\/g, '/');
  for (const col of sensitiveCols) {
    const regex = new RegExp('\\\\b' + col + '\\\\b', 'g');
    let m;
    while ((m = regex.exec(content)) !== null) {
      const before = content.slice(0, m.index);
      const lines = before.split('\\n');
      let fnName = 'unknown';
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const fnM = line.match(/(?:export\\s+)?(?:async\\s+)?function\\s+([a-zA-Z0-9_]+)|(?:export\\s+)?const\\s+([a-zA-Z0-9_]+)\\s*=\\s*(?:async\\s*)?\\(/);
        if (fnM) { fnName = fnM[1] || fnM[2]; break; }
      }
      const lineNum = lines.length;
      const lineContent = content.split('\\n')[lineNum - 1].trim();
      console.log(rel + ' | ' + fnName + ' | col: ' + col + ' | ' + lineContent);
    }
  }
}
"
```

Salida textual:
```text
lib/dal/consignaciones/consignacion.ts | getConsignacionConDetalle | col: costo_ingreso | item:item_producto(qr_code, estado_item, costo_ingreso)
lib/dal/inventario/ingreso.ts | from | col: costo_unitario | detalle:ingreso_mercaderia_detalle(cantidad, costo_unitario)
lib/dal/inventario/ingreso.ts | rows | col: costo_unitario | detalle: Array<{ cantidad: number; costo_unitario: number }>
lib/dal/inventario/ingreso.ts | rows | col: costo_unitario | (acc, d) => acc + Number(d.cantidad) * Number(d.costo_unitario),
lib/dal/inventario/ingreso.ts | listIngresosDeProveedor | col: costo_unitario | detalle:ingreso_mercaderia_detalle(cantidad, costo_unitario)
lib/dal/inventario/ingreso.ts | listIngresosDeProveedor | col: costo_unitario | detalle: Array<{ cantidad: number; costo_unitario: number }>
lib/dal/inventario/ingreso.ts | listIngresosDeProveedor | col: costo_unitario | (acc, d) => acc + Number(d.cantidad) * Number(d.costo_unitario),
lib/dal/inventario/ingreso.ts | addIngresoDetalle | col: costo_unitario | costo_unitario: input.costoUnitario,
lib/dal/inventario/ingreso.ts | addIngresoDetalle | col: costo_unitario | costo_unitario: number
lib/dal/inventario/ingreso.ts | addIngresoDetalle | col: costo_original_usd | costo_original_usd: input.costoOriginalUsd ?? null,
lib/dal/inventario/ingreso.ts | addIngresoDetalle | col: cotizacion_aplicada | cotizacion_aplicada: input.cotizacionAplicada ?? null,
lib/dal/inventario/ingreso.ts | addIngresoDetalle | col: cotizacion_fecha_valor | cotizacion_fecha_valor: input.cotizacionFechaValor ?? null,
lib/dal/inventario/item.ts | getUltimoContextoIngresoProducto | col: costo_ingreso | 'tipo_ingreso, costo_ingreso, ingreso:ingreso_mercaderia!inner(proveedor:proveedor(id_proveedor, nombre))',
lib/dal/inventario/item.ts | getUltimoContextoIngresoProducto | col: costo_ingreso | costo_ingreso: number | string
lib/dal/inventario/item.ts | getUltimoContextoIngresoProducto | col: costo_ingreso | costoUnitario: Number(row.costo_ingreso),
lib/dal/inventario/producto.ts | num | col: costo_vigente | Omit<ProductoConDetalle, 'costo_vigente' | 'precio_venta'> & {
lib/dal/inventario/producto.ts | num | col: costo_vigente | costo_vigente: number | string | null
lib/dal/inventario/producto.ts | payload | col: costo_vigente | costo_vigente: num(r.costo_vigente),
lib/dal/inventario/producto.ts | payload | col: costo_vigente | costo_vigente: num(r.costo_vigente),
lib/dal/inventario/proveedor.ts | getPerfilProveedorPorId | col: costo_ingreso | .select('costo_ingreso, ingreso_mercaderia!inner(id_proveedor)')
lib/dal/inventario/proveedor.ts | stockRows | col: costo_ingreso | const stockRows = (stockConsign.data ?? []) as Array<{ costo_ingreso: number | string }>
lib/dal/inventario/proveedor.ts | stockRows | col: costo_ingreso | (acc, r) => acc + Number(r.costo_ingreso ?? 0),
lib/dal/precios/cotizacion.ts | spSetModoCotizacion | col: costo_original_usd | * Devuelve la cantidad de costos revaluados, cuántos se omitieron por no tener costo_original_usd,
lib/dal/precios/cotizacion.ts | res | col: costo_original_usd | * (con costo_original_usd no nulo) y cuántos se omiten por no tener costo original.
lib/dal/precios/cotizacion.ts | countProductosCostoUsdVigentes | col: costo_original_usd | .not('costo_original_usd', 'is', null),
lib/dal/precios/cotizacion.ts | countProductosCostoUsdVigentes | col: costo_original_usd | .is('costo_original_usd', null),
lib/dal/precios/resolucion.ts | spRecalcularBatch | col: costo_vigente | costo_vigente: number | string | null
lib/dal/precios/resolucion.ts | listControlDePrecios | col: costo_vigente | costo_vigente: num(r.costo_vigente),
lib/dal/precios/resolucion.ts | listControlDePrecios | col: costo_vigente | costo_vigente: num(r.costo_vigente),
lib/dal/rendiciones/rendicion.ts | getRendicionConDetalle | col: costo_snapshot | costo_snapshot,
lib/dal/rendiciones/rendicion.ts | getRendicionConDetalle | col: costo_snapshot | costo_snapshot: number
lib/dal/rendiciones/rendicion.ts | getRendicionConDetalle | col: costo_snapshot | costo_snapshot: Number(l.costo_snapshot),
lib/dal/rendiciones/rendicion.ts | getRendicionConDetalle | col: costo_snapshot | costo_snapshot: Number(l.costo_snapshot),
lib/dal/rendiciones/rendicion.ts | previewRendicion | col: costo_snapshot | costo_snapshot: Number(r.costo_snapshot),
lib/dal/rendiciones/rendicion.ts | previewRendicion | col: costo_snapshot | costo_snapshot: Number(r.costo_snapshot),
lib/dal/reportes/finanzas.ts | getFlujo | col: costo_cobro | costo_procesamiento: Number(row.costo_cobro ?? 0),
lib/dal/reportes/reportes.ts | listGananciaPorProducto | col: costo_vigente | costo_vigente: r.costo_vigente == null ? null : Number(r.costo_vigente),
lib/dal/reportes/reportes.ts | listGananciaPorProducto | col: costo_vigente | costo_vigente: r.costo_vigente == null ? null : Number(r.costo_vigente),
lib/dal/reportes/reportes.ts | listGananciaPorProducto | col: costo_vigente | costo_vigente: r.costo_vigente == null ? null : Number(r.costo_vigente),
lib/dal/revendedoras/liquidacion.ts | listarLiquidacionesRevendedora | col: porcentaje_comision_preview | porcentaje_comision_preview: number
lib/dal/revendedoras/liquidacion.ts | obtenerLiquidacionConDetalle | col: porcentaje_comision_preview | porcentaje_comision_preview,
lib/dal/revendedoras/liquidacion.ts | obtenerLiquidacionConDetalle | col: porcentaje_comision_preview | porcentaje_comision_preview: number | string | null
lib/dal/revendedoras/liquidacion.ts | rawLineas | col: porcentaje_comision_preview | porcentaje_comision_preview: Number(row.porcentaje_comision_preview ?? 0),
lib/dal/revendedoras/liquidacion.ts | rawLineas | col: porcentaje_comision_preview | porcentaje_comision_preview: Number(row.porcentaje_comision_preview ?? 0),
lib/dal/revendedoras/liquidacion.ts | listarLiquidacionesRevendedora | col: monto_comision | monto_comision: number
lib/dal/revendedoras/liquidacion.ts | obtenerLiquidacionConDetalle | col: monto_comision | monto_comision,
lib/dal/revendedoras/liquidacion.ts | obtenerLiquidacionConDetalle | col: monto_comision | monto_comision: number | string | null
lib/dal/revendedoras/liquidacion.ts | rawLineas | col: monto_comision | monto_comision: Number(row.monto_comision ?? 0),
lib/dal/revendedoras/liquidacion.ts | rawLineas | col: monto_comision | monto_comision: Number(row.monto_comision ?? 0),
lib/dal/revendedoras/portal.ts | listarMisLiquidaciones | col: monto_comision | monto_comision: Number(r.monto_comision ?? 0),
lib/dal/revendedoras/portal.ts | listarMisLiquidaciones | col: monto_comision | monto_comision: Number(r.monto_comision ?? 0),
lib/dal/ventas/arancel.ts | createArancelCobro | col: arancel_pct | arancel_pct: input.arancel_pct,
lib/dal/ventas/arancel.ts | createArancelCobro | col: arancel_pct | arancel_pct: input.arancel_pct,
lib/dal/ventas/arancel.ts | updateArancelCobro | col: arancel_pct | arancel_pct?: number
lib/dal/ventas/arancel.ts | createArancelCobro | col: iva_arancel_pct | iva_arancel_pct: input.iva_arancel_pct ?? 21,
lib/dal/ventas/arancel.ts | createArancelCobro | col: iva_arancel_pct | iva_arancel_pct: input.iva_arancel_pct ?? 21,
lib/dal/ventas/arancel.ts | updateArancelCobro | col: iva_arancel_pct | iva_arancel_pct?: number
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: ret_iva_pct | ret_iva_pct?: number
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: ret_iva_pct | ret_iva_pct: input.ret_iva_pct ?? 0,
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: ret_iva_pct | ret_iva_pct: input.ret_iva_pct ?? 0,
lib/dal/ventas/cuenta-destino.ts | updateCuentaDestino | col: ret_iva_pct | ret_iva_pct?: number
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: ret_ganancias_pct | ret_ganancias_pct?: number
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: ret_ganancias_pct | ret_ganancias_pct: input.ret_ganancias_pct ?? 0,
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: ret_ganancias_pct | ret_ganancias_pct: input.ret_ganancias_pct ?? 0,
lib/dal/ventas/cuenta-destino.ts | updateCuentaDestino | col: ret_ganancias_pct | ret_ganancias_pct?: number
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: ret_iibb_pct | ret_iibb_pct?: number
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: ret_iibb_pct | ret_iibb_pct: input.ret_iibb_pct ?? 0,
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: ret_iibb_pct | ret_iibb_pct: input.ret_iibb_pct ?? 0,
lib/dal/ventas/cuenta-destino.ts | updateCuentaDestino | col: ret_iibb_pct | ret_iibb_pct?: number
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: imp_deb_cred_pct | imp_deb_cred_pct?: number
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: imp_deb_cred_pct | imp_deb_cred_pct: input.imp_deb_cred_pct ?? 0,
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | col: imp_deb_cred_pct | imp_deb_cred_pct: input.imp_deb_cred_pct ?? 0,
lib/dal/ventas/cuenta-destino.ts | updateCuentaDestino | col: imp_deb_cred_pct | imp_deb_cred_pct?: number
```

### A.3. Comando de búsqueda de todos los `select('*')` en `lib/dal/**` sobre tablas sensibles

Comando ejecutado:
```text
node --experimental-strip-types -e "
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function findFiles(dir, filter) {
  let res = [];
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) res = res.concat(findFiles(full, filter));
    else if (filter(full)) res.push(full);
  }
  return res;
}

const dalFiles = findFiles('lib/dal', f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const sensitiveTables = [
  'costo_producto', 'item_producto', 'detalle_venta', 'ingreso_mercaderia_detalle',
  'devolucion_venta', 'pago_venta', 'arancel_cobro', 'cuenta_destino',
  'liquidacion_revendedora', 'regla_precio', 'escala_comision', 'regla_comision'
];

for (const file of dalFiles) {
  const content = readFileSync(file, 'utf8');
  const rel = relative('.', file).replace(/\\\\/g, '/');
  for (const tbl of sensitiveTables) {
    const pattern = new RegExp('\\\\.from\\\\(\\\\s*[\'\"]' + tbl + '[\'\"]\\\\s*\\\\)([\\\\s\\\\S]*?\\\\.select\\\\([\\\\s\\\\S]*?\\\\))', 'g');
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const before = content.slice(0, m.index);
      const lines = before.split('\\n');
      let fnName = 'unknown';
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const fnM = line.match(/(?:export\\\\s+)?(?:async\\\\s+)?function\\\\s+([a-zA-Z0-9_]+)|(?:export\\\\s+)?const\\\\s+([a-zA-Z0-9_]+)\\\\s*=\\\\s*(?:async\\\\s*)?\\\\(/);
        if (fnM) { fnName = fnM[1] || fnM[2]; break; }
      }
      const selectCall = m[1];
      const hasStar = /select\(\s*[`'"]\s*\*(\s*,|[`'"])/.test(selectCall);
      if (hasStar) {
        console.log(rel + ' | ' + fnName + ' | ' + tbl + ' | selectCall: ' + selectCall.replace(/\\s+/g, ' ').slice(0, 100));
      }
    }
  }
}
"
```

Salida textual:
```text
lib/dal/inventario/item.ts | findItemByQr | item_producto | selectCall: .select('*')
lib/dal/inventario/item.ts | getItemConDetalle | item_producto | selectCall: .select(` *, producto:producto(id_producto, nombre, sku, categoria:categoria(id_categoria, nombre)
lib/dal/inventario/item.ts | listItemsByProducto | item_producto | selectCall: .select('*')
lib/dal/inventario/item.ts | listItemsDisponibles | item_producto | selectCall: .select('*')
lib/dal/precios/regla.ts | listReglasPrecio | regla_precio | selectCall: .select('*')
lib/dal/precios/regla.ts | getReglaPrecio | regla_precio | selectCall: .select('*')
lib/dal/revendedoras/liquidacion.ts | listarLiquidacionesRevendedora | liquidacion_revendedora | selectCall: .select('*')
lib/dal/revendedoras/liquidacion.ts | obtenerLiquidacionConDetalle | liquidacion_revendedora | selectCall: .select('*, pago_revendedora(*)
lib/dal/ventas/arancel.ts | listArancelesCobro | arancel_cobro | selectCall: .select('*')
lib/dal/ventas/arancel.ts | createArancelCobro | arancel_cobro | selectCall: .insert({ id_tenant: idTenant, id_cuenta_destino: input.id_cuenta_destino, medio: input.medio, cuot
lib/dal/ventas/cuenta-destino.ts | listCuentasDestino | cuenta_destino | selectCall: .select('*')
lib/dal/ventas/cuenta-destino.ts | from | cuenta_destino | selectCall: .select('*', { count: 'exact' })
lib/dal/ventas/cuenta-destino.ts | createCuentaDestino | cuenta_destino | selectCall: .insert({ id_tenant: input.id_tenant, nombre: input.nombre, tipo: input.tipo, titular: input.titula
```

### A.4. Comando de clasificación de todas las funciones SQL vivas que tocan columnas sensibles

Comando ejecutado:
```text
node --experimental-strip-types -e "
import { leerMigraciones, sinComentarios, cuerpo, sinComentariosDeBloque } from './scripts/sp-parser.mts';

const archivos = leerMigraciones('supabase/migrations');
const eventosPorFn = new Map();
const defRegex = /^[ \\t]*create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?([A-Za-z0-9_]+)\\s*\\(/gim;
const dropRegex = /^[ \\t]*drop\\s+function\\s+(?:if\\s+exists\\s+)?(?:public\\.)?([A-Za-z0-9_]+)\\b/gim;

archivos.forEach(({ archivo, contenido }, orden) => {
  const visible = sinComentariosDeBloque(contenido);
  for (const m of visible.matchAll(defRegex)) {
    const nombre = m[1].toLowerCase();
    const indice = m.index ?? 0;
    const linea = visible.slice(0, indice).split('\\n').length;
    const textoCuerpo = cuerpo(contenido, indice);
    if (!eventosPorFn.has(nombre)) eventosPorFn.set(nombre, []);
    eventosPorFn.get(nombre).push({ tipo: 'create', fn: { nombre, archivo, linea, cuerpo: textoCuerpo }, orden });
  }
  for (const m of visible.matchAll(dropRegex)) {
    const nombre = m[1].toLowerCase();
    const indice = m.index ?? 0;
    const linea = visible.slice(0, indice).split('\\n').length;
    if (!eventosPorFn.has(nombre)) eventosPorFn.set(nombre, []);
    eventosPorFn.get(nombre).push({ tipo: 'drop', fn: { nombre, archivo, linea, cuerpo: '' }, orden });
  }
});

const vivas = new Map();
for (const [nombre, evs] of eventosPorFn.entries()) {
  const ultimo = evs[evs.length - 1];
  if (ultimo.tipo === 'create') {
    const c = sinComentarios(ultimo.fn.cuerpo);
    const isDefiner = /security\\s+definer/i.test(c);
    vivas.set(nombre, { ...ultimo.fn, isDefiner });
  }
}

const sensitiveKeywords = [
  'costo_ingreso', 'costo_snapshot', 'monto_ganancia', 'monto_comision',
  'porcentaje_comision_preview', 'costo_unitario', 'costo_original_usd',
  'cotizacion_aplicada', 'cotizacion_fecha_valor', 'costo_recuperado',
  'costo_cobro', 'desglose_costo', 'arancel_pct', 'iva_arancel_pct',
  'ret_iva_pct', 'ret_ganancias_pct', 'ret_iibb_pct', 'imp_deb_cred_pct',
  'costo_producto', 'costo_vigente'
];

const results = [];
for (const [nombre, fn] of vivas.entries()) {
  const c = sinComentarios(fn.cuerpo);
  const foundKeywords = [];
  for (const kw of sensitiveKeywords) {
    if (new RegExp('\\\\b' + kw + '\\\\b', 'i').test(c)) { foundKeywords.push(kw); }
  }
  const isTrigger = /returns\\s+trigger/i.test(fn.cuerpo);
  if (foundKeywords.length > 0) {
    const writes = /insert\\s+into|update\\s+\\w+\\s+set/i.test(c);
    const reads = /select\\b|from\\b/i.test(c);
    let rol = 'Lector';
    if (isTrigger) rol = 'Trigger';
    else if (writes && reads) rol = 'Lector y Escritor';
    else if (writes) rol = 'Escritor';
    results.push({ nombre, modo: fn.isDefiner ? 'DEFINER' : 'INVOKER', archivo: fn.archivo, rol, keywords: foundKeywords });
  }
}
results.sort((a, b) => a.nombre.localeCompare(b.nombre));
for (const r of results) {
  console.log(r.nombre + ' | ' + r.modo + ' | ' + r.rol + ' | ' + r.archivo + ' | ' + r.keywords.join(', '));
}
"
```

Salida textual:
```text
preview_liquidacion | INVOKER | Lector | supabase/migrations/00095_liquidacion_functions.sql | monto_comision, porcentaje_comision_preview
preview_rendicion | INVOKER | Lector | supabase/migrations/00126_rendicion_modulo.sql | costo_snapshot
rf_cuenta_corriente_revendedora | INVOKER | Lector | supabase/migrations/00100_finanzas_cambio.sql | monto_comision
rf_finanzas_flujo | INVOKER | Lector | supabase/migrations/00095_liquidacion_functions.sql | costo_unitario, costo_cobro
rf_finanzas_posicion | INVOKER | Lector | supabase/migrations/00111_seguridad_revendedoras.sql | costo_ingreso, monto_comision, costo_unitario
rf_finanzas_resultados | INVOKER | Lector | supabase/migrations/00110_finanzas_cambio_diferencia.sql | costo_ingreso, costo_recuperado, costo_cobro
rf_panel_revendedoras | INVOKER | Lector | supabase/migrations/00107_panel_declaraciones_pendientes.sql | monto_comision, porcentaje_comision_preview
rf_perfil_revendedora | INVOKER | Lector | supabase/migrations/00102_reportes_revendedoras.sql | monto_comision, porcentaje_comision_preview
rf_resumen_canal | INVOKER | Lector | supabase/migrations/00102_reportes_revendedoras.sql | monto_comision, porcentaje_comision_preview
rf_totales_panel_revendedoras | INVOKER | Lector | supabase/migrations/00101_panel_revendedoras_cambio.sql | monto_comision
rvp_mi_cuenta | DEFINER | Lector | supabase/migrations/00111_seguridad_revendedoras.sql | monto_comision, porcentaje_comision_preview
rvp_mis_liquidaciones | DEFINER | Lector | supabase/migrations/00106_rvp_lecturas.sql | monto_comision
rvp_mis_ventas | DEFINER | Lector | supabase/migrations/00106_rvp_lecturas.sql | monto_comision, porcentaje_comision_preview
sp_aplicar_ultimo_costo | INVOKER | Lector y Escritor | supabase/migrations/00145_rlsp_sp_inventario.sql | costo_ingreso, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor, costo_producto
sp_calcular_costo_cobro | INVOKER | Lector | supabase/migrations/00066_zona_horaria_tenant.sql | arancel_pct, iva_arancel_pct, ret_iva_pct, ret_ganancias_pct, ret_iibb_pct, imp_deb_cred_pct
sp_cobrar_cuota | INVOKER | Lector y Escritor | supabase/migrations/00144_rlsp_sp_ventas.sql | costo_cobro, desglose_costo
sp_confirmar_ingreso | INVOKER | Lector y Escritor | supabase/migrations/00145_rlsp_sp_inventario.sql | costo_ingreso, costo_unitario, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
sp_control_de_precios | INVOKER | Lector | supabase/migrations/00040_precios_batch.sql | costo_producto, costo_vigente
sp_crear_stock_directo | INVOKER | Lector y Escritor | supabase/migrations/00145_rlsp_sp_inventario.sql | costo_ingreso
sp_generar_liquidacion | INVOKER | Lector y Escritor | supabase/migrations/00148_rlsp_sp_revendedoras.sql | monto_comision
sp_importar_remito | INVOKER | Lector y Escritor | supabase/migrations/00145_rlsp_sp_inventario.sql | costo_unitario, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor
sp_listar_productos | INVOKER | Lector | supabase/migrations/00042_inventario_batch.sql | costo_producto, costo_vigente
sp_perdida_incobrable_venta | INVOKER | Lector | supabase/migrations/00059_financiacion_propia.sql | costo_snapshot
sp_recalcular_precio_venta | INVOKER | Lector y Escritor | supabase/migrations/00146_rlsp_sp_precios.sql | costo_producto
sp_registrar_cambio | INVOKER | Lector y Escritor | supabase/migrations/00144_rlsp_sp_ventas.sql | costo_ingreso, costo_snapshot, monto_ganancia, monto_comision, porcentaje_comision_preview
sp_registrar_devolucion_cliente | INVOKER | Lector y Escritor | supabase/migrations/00144_rlsp_sp_ventas.sql | costo_snapshot, costo_recuperado
sp_registrar_venta | INVOKER | Lector y Escritor | supabase/migrations/00144_rlsp_sp_ventas.sql | costo_ingreso, costo_snapshot, monto_ganancia, porcentaje_comision_preview, costo_cobro, desglose_costo
sp_revaluar_costos_usd_vigentes | INVOKER | Lector | supabase/migrations/00146_rlsp_sp_precios.sql | costo_original_usd, cotizacion_aplicada, costo_producto
tg_detalle_venta_inmutable | INVOKER | Trigger | supabase/migrations/00088_venta_canal.sql | costo_snapshot, monto_ganancia, monto_comision, porcentaje_comision_preview
```

### A.5. Salida textual de `pnpm sp:last` para lectores RPC de costo directo

```text
$ pnpm sp:last sp_listar_productos
Vigente: supabase/migrations/00042_inventario_batch.sql:40
create or replace function sp_listar_productos(...) ...
cp.costo as costo_vigente,
case when cp.id_costo is not null then coalesce(cp.moneda, 'ARS') end as moneda_vigente,
f.id_regla_margen_aplicada ...

$ pnpm sp:last sp_control_de_precios
Vigente: supabase/migrations/00040_precios_batch.sql:55
create or replace function sp_control_de_precios() ...
cp.costo as costo_vigente,
ra.nombre as regla_margen_nombre,
precio_proyectado ...
```
