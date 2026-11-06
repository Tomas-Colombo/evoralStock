# Inventario de lecturas y escrituras por módulo (Fase 1 — rls-por-permiso)

**Change**: `rls-por-permiso` · **Spec**: `proposal.md` · **Fase**: 1 (Solo Lectura) · **Fecha**: 2026-11-06

---

## 1. Respuestas a las 5 preguntas de `proposal.md §6`

### 1.1. ¿Qué tablas lee o escribe cada módulo de permisos (no cada carpeta)?

El sistema cuenta con **10 módulos de permisos** (`CATALOGO_PERMISOS` en [`lib/types/administracion.ts:61-76`](file:///c:/Archivos%20de%20trabajo/evoralStock/lib/types/administracion.ts#L61-L76)): `administracion`, `inventario`, `precios`, `ventas`, `consignaciones`, `rendiciones`, `gastos`, `reportes`, `revendedoras` y `ayuda`. No existen módulos de permiso llamados `clientes`, `cuotas` ni `proveedores` (los dos primeros son del permiso `ventas`; el tercero de `inventario`, [`docs/modulos.md:25-30`](file:///c:/Archivos%20de%20trabajo/evoralStock/docs/modulos.md#L25-L30)).

- **`administracion`**:
  - Lee y escribe tablas de sistema: `rol`, `usuario`, `auditoria`, `configuracion`, `tenant_modulo`, `tenant`.
  - Nota: `superadmin`, `tenant_cargo`, `tenant_pago` pertenecen al panel de plataforma / superadmin (fuera de tenant regular).
- **`inventario`**:
  - Lee y escribe: `producto`, `categoria`, `costo_producto`, `ingreso_mercaderia`, `ingreso_mercaderia_detalle`, `item_producto`, `movimiento_item`, `proveedor`.
  - Lee (cross-module): `regla_precio` (para cálculo de precio de venta inicial), `cotizacion_config` y `cotizacion_dolar` (para conversión ARS/USD al ingresar stock).
- **`precios`**:
  - Lee y escribe: `regla_precio`, `plan_cuotas`, `recargo_cuotas`, `cotizacion_config`, `cotizacion_dolar`.
  - Lee y escribe (cross-module): `costo_producto` (revaluación masiva en lote vía `sp_revaluar_costos_usd_vigentes`), `producto` (actualización de `precio_venta` y `precio_venta_desactualizado`).
  - Lee: `categoria`, `proveedor` (para filtros en reglas y control de precios).
- **`ventas`** (incluye rutas `clientes`, `cuotas`, `reservas`):
  - Lee y escribe: `cliente`, `venta`, `detalle_venta`, `pago_venta`, `comprobante`, `cuenta_destino`, `arancel_cobro`, `cuota_financiada`, `devolucion_venta`, `reintegro_cliente`, `cambio_venta`, `reserva`, `detalle_reserva`.
  - Lee y escribe (cross-module en SPs): `item_producto`, `movimiento_item` (transiciones a `vendido`, `reservado`, `disponible`).
  - Lee (cross-module): `producto` (catálogo, precios), `costo_producto` (snapshot de costo en venta), `plan_cuotas` y `recargo_cuotas` (planes de pago), `revendedora`, `regla_comision`, `escala_comision` (ventas de canal revendedora).
- **`consignaciones`**:
  - Lee y escribe: `consignacion`, `consignacion_detalle`.
  - Lee y escribe (cross-module en SPs): `item_producto`, `movimiento_item` (transición a `consignado_proveedor`).
  - Lee: `proveedor` (valida proveedor consignatario).
- **`rendiciones`**:
  - Lee y escribe: `rendicion_proveedor`.
  - Lee y actualiza (cross-module en SPs): `venta`, `detalle_venta` (ventas de mercadería consignada a liquidar), `consignacion`, `consignacion_detalle` (cierre de items), `proveedor`, `item_producto`.
- **`gastos`**:
  - Lee y escribe: `categoria_gasto`, `gasto_negocio`.
  - Lee: `cuenta_destino` (cuenta de donde sale el dinero del gasto).
- **`reportes`**:
  - No posee tablas operativas propias.
  - Lee de forma transversal vía funciones SQL (`rf_*`) y vistas con `security_invoker = true` (`v_linea_venta`, `v_ganancia_por_producto`, `v_perfil_proveedor`, `v_alerta_reposicion`, etc.): `venta`, `detalle_venta`, `pago_venta`, `cuota_financiada`, `devolucion_venta`, `reintegro_cliente`, `cambio_venta`, `producto`, `categoria`, `costo_producto`, `item_producto`, `movimiento_item`, `ingreso_mercaderia`, `proveedor`, `consignacion`, `consignacion_detalle`, `rendicion_proveedor`, `gasto_negocio`, `categoria_gasto`, `revendedora`, `consignacion_revendedora`, `consignacion_revendedora_detalle`, `liquidacion_revendedora`, `pago_revendedora`, `cuenta_destino`.
- **`revendedoras`** (incluye portal `mi-cuenta` con permisos `ver_propio` y `declarar`):
  - Lee y escribe: `revendedora`, `consignacion_revendedora`, `consignacion_revendedora_detalle`, `regla_comision`, `escala_comision`, `liquidacion_revendedora`, `pago_revendedora`, `declaracion_venta_revendedora`.
  - Lee y escribe (cross-module en SPs): `item_producto`, `movimiento_item` (entrega a revendedora, devoluciones, ventas), `venta`, `detalle_venta`, `pago_venta` (confirmación de declaraciones de venta de revendedora).
- **`ayuda`**:
  - Lee y escribe: `consulta_ayuda`.

---

### 1.2. ¿Cuáles son exclusivas de un módulo y cuáles compartidas?

Se definen como **exclusivas** aquellas tablas a las que **únicamente los usuarios con permiso de ese módulo necesitan acceder directamente (SELECT / INSERT / UPDATE / DELETE)** para su operativa.
Se definen como **compartidas** aquellas tablas donde usuarios de múltiples módulos operativos necesitan leer o escribir filas, o donde la restricción por RLS rompería pantallas legítimas de otros módulos.
Se definen como **sistema** las tablas de infraestructura transversal y plataforma.

#### Resumen cuantitativo (total 51 tablas):
- **Sistema**: 11 tablas (`tenant`, `modulo`, `tenant_modulo`, `configuracion`, `rol`, `usuario`, `auditoria`, `producto_sku_seq`, `superadmin`, `tenant_cargo`, `tenant_pago`).
- **Exclusivas**: 15 tablas.
  - `inventario` (3): `categoria`, `ingreso_mercaderia`, `ingreso_mercaderia_detalle`.
  - `precios` (2): `cotizacion_config`, `cotizacion_dolar`.
  - `ventas` (5): `cliente`, `comprobante`, `arancel_cobro`, `reserva`, `detalle_reserva`.
  - `rendiciones` (1): `rendicion_proveedor`.
  - `gastos` (2): `categoria_gasto`, `gasto_negocio`.
  - `revendedoras` (3): `regla_comision`, `escala_comision`, `declaracion_venta_revendedora`.
  - `ayuda` (1): `consulta_ayuda`.
- **Compartidas**: 25 tablas.
  - `costo_producto` (`inventario`, `precios`, `reportes`)
  - `proveedor` (`inventario`, `precios`, `consignaciones`, `rendiciones`, `reportes`)
  - `producto` (`inventario`, `precios`, `ventas`, `consignaciones`, `revendedoras`, `reportes`)
  - `item_producto` (`inventario`, `ventas`, `consignaciones`, `revendedoras`, `reportes`)
  - `movimiento_item` (`inventario`, `ventas`, `consignaciones`, `revendedoras`)
  - `regla_precio` (`precios`, `inventario`)
  - `plan_cuotas` (`precios`, `ventas`)
  - `recargo_cuotas` (`precios`, `ventas`)
  - `cuenta_destino` (`ventas`, `gastos`, `reportes`)
  - `venta` (`ventas`, `rendiciones`, `revendedoras`, `reportes`)
  - `detalle_venta` (`ventas`, `rendiciones`, `revendedoras`, `reportes`)
  - `pago_venta` (`ventas`, `reportes`)
  - `cuota_financiada` (`ventas`, `reportes`)
  - `devolucion_venta` (`ventas`, `reportes`)
  - `reintegro_cliente` (`ventas`, `reportes`)
  - `cambio_venta` (`ventas`, `revendedoras`, `reportes`)
  - `consignacion` (`consignaciones`, `rendiciones`, `reportes`)
  - `consignacion_detalle` (`consignaciones`, `rendiciones`, `reportes`)
  - `revendedora` (`revendedoras`, `ventas`, `reportes`)
  - `consignacion_revendedora` (`revendedoras`, `reportes`)
  - `consignacion_revendedora_detalle` (`revendedoras`, `reportes`)
  - `liquidacion_revendedora` (`revendedoras`, `reportes`)
  - `pago_revendedora` (`revendedoras`, `reportes`)

> [!IMPORTANT]
> **Hallazgo crítico respecto a `proposal.md §3`/Fase 4**:
> El borrador inicial proponía como candidatas exclusivas a `costo_producto` y `proveedor`. El inventario demuestra que:
> 1. `proveedor` **no es exclusiva**: es leída directamente por selectores en `consignaciones` ([`app/(app)/consignaciones/nueva/page.tsx:9`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/consignaciones/nueva/page.tsx#L9)), `rendiciones` ([`app/(app)/rendiciones/nueva/page.tsx:12`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/rendiciones/nueva/page.tsx#L12)) y `precios` ([`app/(app)/precios/reglas/nueva/page.tsx:14`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/precios/reglas/nueva/page.tsx#L14)). Si se le aplica una policy restrictiva de `inventario.ver`, los encargados de consignaciones o precios sin rol de inventario no podrán operar.
> 2. `costo_producto` **no es exclusiva de inventario**: el módulo `precios` necesita leerla y revaluarla masivamente ([`app/(app)/precios/actions.ts:58`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/precios/actions.ts#L58)).

---

### 1.3. ¿Qué `sp_*`/`rf_*` INVOKER cruzan tablas de otro módulo?

Dado que las funciones son **INVOKER**, Postgres evalúa la RLS bajo el contexto del usuario autenticado. Si un `sp_*` de un módulo cruza a tablas de otro módulo que tienen una policy restrictiva, la ejecución fallará o devolverá filas vacías salvo que la policy permita la operación o el SP gestione privilegios.

1. **`sp_registrar_venta`** (INVOKER, [`00093_venta_revendedora_pago.sql:66`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00093_venta_revendedora_pago.sql#L66)) — Módulo `ventas` (`ventas.crear`):
   - Cruza a: `item_producto`, `movimiento_item`, `producto`, `costo_producto` (lee snapshot de costo), `revendedora`, `regla_comision`, `escala_comision`.
2. **`sp_registrar_cambio`** (INVOKER, [`00099_sp_registrar_cambio.sql:7`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00099_sp_registrar_cambio.sql#L7)) — Módulo `ventas` (`ventas.crear`):
   - Cruza a: `item_producto`, `movimiento_item`, `costo_producto`.
3. **`sp_registrar_devolucion_cliente`** (INVOKER, [`00110_finanzas_cambio_diferencia.sql:263`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00110_finanzas_cambio_diferencia.sql#L263)) — Módulo `ventas` (`ventas.crear`):
   - Cruza a: `item_producto`, `movimiento_item` (restaura stock a `disponible`).
4. **`sp_crear_consignacion_con_items` / `sp_confirmar_consignacion` / `sp_eliminar_consignacion`** (INVOKER, [`00125_consignacion_modulo_grupo_b.sql:224, 345, 404`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00125_consignacion_modulo_grupo_b.sql#L224)) — Módulo `consignaciones` (`consignaciones.crear`, `consignaciones.editar`):
   - Cruza a: `proveedor` (valida proveedor consignatario), `item_producto`, `movimiento_item` (reserva/libera stock físico).
5. **`sp_generar_rendicion`** (INVOKER, [`00138_fix_sp_generar_rendicion_update.sql:99`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00138_fix_sp_generar_rendicion_update.sql#L99)) — Módulo `rendiciones` (`rendiciones.crear`):
   - Cruza a: `proveedor`, `venta`, `detalle_venta` (detecta ventas de mercadería en consignación), `consignacion`, `consignacion_detalle` (actualiza estado a liquidado), `item_producto`.
6. **`sp_crear_consignacion_revendedora_con_items` / `sp_confirmar_consignacion_revendedora`** (INVOKER, [`00085_consignacion_revendedora_functions.sql:103, 322`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00085_consignacion_revendedora_functions.sql#L103)) — Módulo `revendedoras` (`revendedoras.crear`, `revendedoras.editar`):
   - Cruza a: `item_producto`, `movimiento_item` (pasa items a `en_poder_revendedora`).
7. **`sp_generar_liquidacion`** (INVOKER, [`00095_liquidacion_functions.sql:266`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00095_liquidacion_functions.sql#L266)) — Módulo `revendedoras` (`revendedoras.liquidar`):
   - Cruza a: `venta`, `detalle_venta` (lee ventas registradas en canal revendedora).
8. **`sp_confirmar_declaracion_venta`** (INVOKER, [`00104_declaracion_venta_functions.sql:170`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00104_declaracion_venta_functions.sql#L170)) — Módulo `revendedoras` (`revendedoras.editar`):
   - Cruza a: `venta`, `detalle_venta`, `pago_venta` (genera la venta real), `item_producto`, `movimiento_item`, `costo_producto`.
9. **`sp_control_de_precios` / `sp_precios_resumen` / `sp_recalcular_precios_batch`** (INVOKER, [`00040_precios_batch.sql:23, 130`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00040_precios_batch.sql#L23)) — Módulo `precios` (`precios.ver`, `precios.editar`):
   - Cruza a: `producto` (lee y actualiza precio de venta), `costo_producto` (lee costo base), `categoria`, `proveedor` (filtros).
10. **`sp_create_producto` / `sp_importar_remito`** (INVOKER, [`00036_sku_autogen.sql:106`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00036_sku_autogen.sql#L106), [`00136_conversion_costo_usd.sql:258`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00136_conversion_costo_usd.sql#L258)) — Módulo `inventario` (`inventario.crear`):
    - Cruza a: `regla_precio` (aplica regla de margen para fijar precio), `costo_producto`, `cotizacion_config`, `cotizacion_dolar` (obtiene cotización USD vigente).
11. **Funciones de reporte `rf_*`** (INVOKER, módulo `reportes` con permiso `reportes.ver`):
    - `rf_finanzas_resultados` ([`00110:69`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00110_finanzas_cambio_diferencia.sql#L69)): cruza `venta`, `detalle_venta`, `devolucion_venta`, `cambio_venta`, `item_producto`, `costo_producto`, `pago_venta`, `gasto_negocio`, `cuota_financiada`, `liquidacion_revendedora`.
    - `rf_finanzas_flujo` ([`00095:956`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00095_liquidacion_functions.sql#L956)): cruza `pago_venta`, `reintegro_cliente`, `ingreso_mercaderia`, `rendicion_proveedor`, `pago_revendedora`, `gasto_negocio`.
    - `rf_finanzas_posicion` ([`00111:344`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00111_seguridad_revendedoras.sql#L344)): cruza `cuota_financiada`, `item_producto`, `rendicion_proveedor`, `pago_revendedora`, `liquidacion_revendedora`.
    - `rf_dashboard_kpis` ([`00074:141`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00074_limpieza_reportes_viejos.sql#L141)): cruza `venta`, `detalle_venta`, `item_producto`, `gasto_negocio`, `cuota_financiada`.
    - `rf_reporte_caja` ([`00074:217`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00074_limpieza_reportes_viejos.sql#L217)): cruza `pago_venta`, `reintegro_cliente`, `gasto_negocio`, `cuenta_destino`.
    - `rf_cuentas_por_cobrar` / `rf_alertas_cuotas_vencidas` / `rf_deudores_resumen` ([`00061:81, 193`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00061_reportes_caja_y_deuda.sql#L81), [`00135:8`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00135_rf_deudores_resumen.sql#L8)): cruza `cuota_financiada`, `cliente`, `venta`, `pago_venta`.

---

### 1.4. ¿Qué `sp_*` de escritura hoy no chequean permiso?

**Confirmación técnica**: **NINGÚN `sp_*` de escritura de dominio de tenant chequea permisos de usuario adentro.**
Todos se limitan a resolver el tenant (`v_tenant := auth_tenant_id();`), el actor (`v_actor := auth.uid();`) y confiar en la compuerta de aplicación (`requireModuleRole`).

A continuación se listan los `sp_*` de escritura vigentes (obtenidos con `pnpm sp:last`), ninguno de los cuales valida permiso interno (0/84 chequean permisos):

| Stored Procedure de Escritura | Definición Vigente (`pnpm sp:last`) | ¿Chequea permiso? |
| --- | --- | --- |
| `sp_create_producto` | [`00036_sku_autogen.sql:106`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00036_sku_autogen.sql#L106) | No |
| `sp_set_costo_producto` | [`00136_conversion_costo_usd.sql:193`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00136_conversion_costo_usd.sql#L193) | No |
| `sp_transicion_item_producto` | [`00016_inventario_functions.sql:126`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00016_inventario_functions.sql#L126) | No |
| `sp_confirmar_ingreso` | [`00032_talles.sql:39`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00032_talles.sql#L39) | No |
| `sp_cancelar_ingreso` | [`00039_cancelar_ingreso_borra_stock.sql:18`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00039_cancelar_ingreso_borra_stock.sql#L18) | No |
| `sp_crear_stock_directo` | [`00033_sp_crear_stock_directo.sql:11`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00033_sp_crear_stock_directo.sql#L11) | No |
| `sp_importar_remito` | [`00136_conversion_costo_usd.sql:258`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00136_conversion_costo_usd.sql#L258) | No |
| `sp_asignar_talles_a_producto` | [`00045_fix_asignar_talles_referencia_id.sql:11`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00045_fix_asignar_talles_referencia_id.sql#L11) | No |
| `sp_registrar_ajuste_inventario` | [`00025_consignacion_functions.sql:281`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00025_consignacion_functions.sql#L281) | No |
| `sp_gen_sku` | [`00036_sku_autogen.sql:42`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00036_sku_autogen.sql#L42) | No |
| `sp_recalcular_precio_venta` | [`00019_precios_functions.sql:149`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00019_precios_functions.sql#L149) | No |
| `sp_marcar_precio_desactualizado_by_regla` | [`00019_precios_functions.sql:232`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00019_precios_functions.sql#L232) | No |
| `sp_marcar_precio_desactualizado_by_producto` | [`00019_precios_functions.sql:224`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00019_precios_functions.sql#L224) | No |
| `sp_create_regla_precio` | [`00046_descuentos_seleccionables.sql:217`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00046_descuentos_seleccionables.sql#L217) | No |
| `sp_baja_regla_precio` | [`00019_precios_functions.sql:109`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00019_precios_functions.sql#L109) | No |
| `sp_extender_vigencia_regla` | [`00019_precios_functions.sql:127`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00019_precios_functions.sql#L127) | No |
| `sp_recalcular_precios_batch` | [`00040_precios_batch.sql:130`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00040_precios_batch.sql#L130) | No |
| `sp_set_cotizacion_manual` | [`00130_cotizacion_usd.sql:195`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00130_cotizacion_usd.sql#L195) | No |
| `sp_set_modo_cotizacion` | [`00130_cotizacion_usd.sql:281`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00130_cotizacion_usd.sql#L281) | No |
| `sp_registrar_cotizacion_bcra` | [`00133_sp_registrar_cotizacion_bcra_hoy.sql:68`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00133_sp_registrar_cotizacion_bcra_hoy.sql#L68) | No |
| `sp_revaluar_costos_usd_vigentes` | [`00137_revaluar_costos_usd_vigentes.sql:4`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00137_revaluar_costos_usd_vigentes.sql#L4) | No |
| `sp_crear_reserva` | [`00048_fix_sp_crear_reserva_ambiguo.sql:21`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00048_fix_sp_crear_reserva_ambiguo.sql#L21) | No |
| `sp_cancelar_reserva` | [`00023_ventas_reservas_functions.sql:98`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00023_ventas_reservas_functions.sql#L98) | No |
| `sp_vencer_reservas` | [`00023_ventas_reservas_functions.sql:147`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00023_ventas_reservas_functions.sql#L147) | No |
| `sp_registrar_venta` | [`00093_venta_revendedora_pago.sql:66`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00093_venta_revendedora_pago.sql#L66) | No |
| `sp_anular_venta` | [`00023_ventas_reservas_functions.sql:351`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00023_ventas_reservas_functions.sql#L351) | No |
| `sp_registrar_devolucion_cliente` | [`00110_finanzas_cambio_diferencia.sql:263`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00110_finanzas_cambio_diferencia.sql#L263) | No |
| `sp_registrar_cambio` | [`00099_sp_registrar_cambio.sql:7`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00099_sp_registrar_cambio.sql#L7) | No |
| `sp_emitir_comprobante` | [`00023_ventas_reservas_functions.sql:463`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00023_ventas_reservas_functions.sql#L463) | No |
| `sp_cobrar_cuota` | [`00069_incobrables_sin_gasto.sql:298`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00069_incobrables_sin_gasto.sql#L298) | No |
| `sp_marcar_cuota_incobrable` | [`00069_incobrables_sin_gasto.sql:193`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00069_incobrables_sin_gasto.sql#L193) | No |
| `sp_crear_consignacion` | [`00025_consignacion_functions.sql:24`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00025_consignacion_functions.sql#L24) | No |
| `sp_crear_consignacion_con_items` | [`00125_consignacion_modulo_grupo_b.sql:224`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00125_consignacion_modulo_grupo_b.sql#L224) | No |
| `sp_agregar_item_consignacion` | [`00124_consignacion_modulo_grupo_a.sql:203`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00124_consignacion_modulo_grupo_a.sql#L203) | No |
| `sp_cancelar_item_consignacion` | [`00124_consignacion_modulo_grupo_a.sql:260`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00124_consignacion_modulo_grupo_a.sql#L260) | No |
| `sp_editar_consignacion` | [`00125_consignacion_modulo_grupo_b.sql:280`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00125_consignacion_modulo_grupo_b.sql#L280) | No |
| `sp_confirmar_consignacion` | [`00125_consignacion_modulo_grupo_b.sql:345`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00125_consignacion_modulo_grupo_b.sql#L345) | No |
| `sp_cerrar_consignacion` | [`00025_consignacion_functions.sql:186`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00025_consignacion_functions.sql#L186) | No |
| `sp_eliminar_consignacion` | [`00125_consignacion_modulo_grupo_b.sql:404`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00125_consignacion_modulo_grupo_b.sql#L404) | No |
| `sp_generar_rendicion` | [`00138_fix_sp_generar_rendicion_update.sql:99`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00138_fix_sp_generar_rendicion_update.sql#L99) | No |
| `sp_excluir_detalle_rendicion` | [`00126_rendicion_modulo.sql:377`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00126_rendicion_modulo.sql#L377) | No |
| `sp_reincluir_detalle_rendicion` | [`00126_rendicion_modulo.sql:416`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00126_rendicion_modulo.sql#L416) | No |
| `sp_marcar_rendicion_pagada` | [`00126_rendicion_modulo.sql:457`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00126_rendicion_modulo.sql#L457) | No |
| `sp_registrar_gasto` | [`00053_gasto_descripcion_opcional_y_delete.sql:31`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00053_gasto_descripcion_opcional_y_delete.sql#L31) | No |
| `sp_eliminar_gasto` | [`00053_gasto_descripcion_opcional_y_delete.sql:71`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00053_gasto_descripcion_opcional_y_delete.sql#L71) | No |
| `sp_set_presupuesto_categoria_gasto` | [`00027_rendicion_gasto_functions.sql:301`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00027_rendicion_gasto_functions.sql#L301) | No |
| `sp_crear_revendedora` | [`00097_panel_revendedoras.sql:488`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00097_panel_revendedoras.sql#L488) | No |
| `sp_editar_revendedora` | [`00076_revendedora.sql:75`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00076_revendedora.sql#L75) | No |
| `sp_baja_revendedora` | [`00085_consignacion_revendedora_functions.sql:47`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00085_consignacion_revendedora_functions.sql#L47) | No |
| `sp_enlazar_revendedora_usuario` | [`00079_rol_revendedora.sql:99`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00079_rol_revendedora.sql#L99) | No |
| `sp_reactivar_acceso_revendedora` | [`00112_reactivar_acceso_revendedora.sql:17`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00112_reactivar_acceso_revendedora.sql#L17) | No |
| `sp_crear_consignacion_revendedora_con_items` | [`00085_consignacion_revendedora_functions.sql:103`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00085_consignacion_revendedora_functions.sql#L103) | No |
| `sp_editar_consignacion_revendedora` | [`00085_consignacion_revendedora_functions.sql:250`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00085_consignacion_revendedora_functions.sql#L250) | No |
| `sp_confirmar_consignacion_revendedora` | [`00085_consignacion_revendedora_functions.sql:322`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00085_consignacion_revendedora_functions.sql#L322) | No |
| `sp_entregar_consignacion_revendedora` | [`00085_consignacion_revendedora_functions.sql:387`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00085_consignacion_revendedora_functions.sql#L387) | No |
| `sp_registrar_devolucion_revendedora` | [`00085_consignacion_revendedora_functions.sql:419`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00085_consignacion_revendedora_functions.sql#L419) | No |
| `sp_devolver_items_revendedora` | [`00085_consignacion_revendedora_functions.sql:479`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00085_consignacion_revendedora_functions.sql#L479) | No |
| `sp_cerrar_consignacion_revendedora` | [`00085_consignacion_revendedora_functions.sql:546`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00085_consignacion_revendedora_functions.sql#L546) | No |
| `sp_eliminar_consignacion_revendedora` | [`00085_consignacion_revendedora_functions.sql:609`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00085_consignacion_revendedora_functions.sql#L609) | No |
| `sp_crear_regla_comision` | [`00087_comisiones_functions.sql:8`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00087_comisiones_functions.sql#L8) | No |
| `sp_terminar_regla_comision` | [`00087_comisiones_functions.sql:111`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00087_comisiones_functions.sql#L111) | No |
| `sp_generar_liquidacion` | [`00095_liquidacion_functions.sql:266`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00095_liquidacion_functions.sql#L266) | No |
| `sp_excluir_detalle_liquidacion` | [`00095_liquidacion_functions.sql:424`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00095_liquidacion_functions.sql#L424) | No |
| `sp_reincluir_detalle_liquidacion` | [`00095_liquidacion_functions.sql:488`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00095_liquidacion_functions.sql#L488) | No |
| `sp_marcar_liquidacion_pagada` | [`00095_liquidacion_functions.sql:551`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00095_liquidacion_functions.sql#L551) | No |
| `sp_declarar_venta_revendedora` | [`00105_declaracion_venta_invoker.sql:114`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00105_declaracion_venta_invoker.sql#L114) | No |
| `sp_retirar_declaracion` | [`00105_declaracion_venta_invoker.sql:170`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00105_declaracion_venta_invoker.sql#L170) | No |
| `sp_confirmar_declaracion_venta` | [`00104_declaracion_venta_functions.sql:170`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00104_declaracion_venta_functions.sql#L170) | No |
| `sp_rechazar_declaracion_venta` | [`00104_declaracion_venta_functions.sql:238`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00104_declaracion_venta_functions.sql#L238) | No |
| `sp_registrar_consulta_ayuda` | [`00127_ayuda.sql:110`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00127_ayuda.sql#L110) | No |
| `sp_calificar_consulta_ayuda` | [`00127_ayuda.sql:160`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00127_ayuda.sql#L160) | No |
| `sp_create_rol` | [`00029_administracion_functions.sql:19`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00029_administracion_functions.sql#L19) | No |
| `sp_update_rol_permisos` | [`00029_administracion_functions.sql:46`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00029_administracion_functions.sql#L46) | No |
| `sp_delete_rol` | [`00029_administracion_functions.sql:80`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00029_administracion_functions.sql#L80) | No |
| `sp_toggle_usuario_activo` | [`00029_administracion_functions.sql:134`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00029_administracion_functions.sql#L134) | No |
| `sp_set_tenant_logo` | [`00116_logo_tenant_storage.sql:102`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00116_logo_tenant_storage.sql#L102) | No |
| `sp_set_configuracion_qr_lado_mm` | [`00113_configuracion_etiquetas_qr.sql:9`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00113_configuracion_etiquetas_qr.sql#L9) | No |
| `sp_toggle_tenant_modulo` | [`00086_comisiones.sql:224`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00086_comisiones.sql#L224) | No |

*(Única excepción en el sistema: los procedimientos exclusivos de superadmin de plataforma como `sp_alta_tenant`, `sp_registrar_cargo_tenant`, etc., que validan `exists (select 1 from superadmin where id_auth_user = p_actor)`, [`00119:142`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00119_super_admin_plataforma.sql#L142)).*

---

### 1.5. ¿Cómo se identifica al administrador?

1. **En la base de datos (Postgres / Supabase)**:
   - **No existe columna booleana `es_admin` / `is_admin`** en ninguna tabla (`usuario` ni `rol`, ver [`00005_rol.sql:9`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00005_rol.sql#L9) y [`00006_usuario.sql:9`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00006_usuario.sql#L9)).
   - **Tampoco existe claim de admin en el JWT**: el JWT solo lleva el claim `tenant_id` inyectado por el Auth Hook ([`00008_auth_hook_tenant_id.sql:23`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00008_auth_hook_tenant_id.sql#L23)).
   - Se identifica convencionalmente por **`rol.nombre = 'Administrador'`**:
     - Al provisionar el tenant, se inserta una fila en `rol` con `nombre = 'Administrador'` ([`scripts/provision-tenant.mts:224`](file:///c:/Archivos%20de%20trabajo/evoralStock/scripts/provision-tenant.mts#L224), [`00120_alta_baja_tenant.sql:212`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00120_alta_baja_tenant.sql#L212)).
     - Todas las migraciones que han agregado nuevos permisos al sistema actualizan específicamente el rol por su nombre:
       - `00108_admin_permisos_revendedoras.sql:11` (`where r.nombre = 'Administrador'`)
       - `00127_ayuda.sql:58` (`where nombre = 'Administrador'`)
       - `00128_admin_permiso_ventas_eliminar.sql:14` (`where nombre = 'Administrador'`)
       - `00131_admin_permiso_precios_editar_cotizacion.sql:11` (`where nombre = 'Administrador'`)
2. **A nivel funcional / autorización**:
   - Se identifica por **tener el objeto completo de permisos** en `rol.permisos`: el aprovisionamiento le asigna todas las acciones de `CATALOGO_PERMISOS` para todos los módulos contratados por el tenant (excepto las exclusivas del portal revendedora `ver_propio` y `declarar`, [`scripts/provision-tenant.mts:230-233`](file:///c:/Archivos%20de%20trabajo/evoralStock/scripts/provision-tenant.mts#L230-L233)).
   - No hay protección a nivel de trigger que impida borrar o renombrar el rol 'Administrador' (a diferencia de 'Revendedora', protegido por `fn_rol_revendedora_protect` en [`00079:34`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00079_rol_revendedora.sql#L34)). Solo se valida en `sp_delete_rol` que no tenga usuarios asignados ([`00029:89`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00029_administracion_functions.sql#L89)).

---

## 2. Matriz exhaustiva tabla × módulo de permiso

A continuación se auditan las **49 tablas con `id_tenant`** y las **2 tablas globales sin `id_tenant`**.

| # | Tabla | Id Tenant | Módulo de Permiso Principal | Otros Módulos Lectores / Escritores | DAL / Server Action / Guard | Clasificación |
|---|---|---|---|---|---|---|
| 1 | `tenant` | Sí (PK) | `administracion` | Todos (resuelto en sesión) | `lib/dal/session.ts:70`, `sp_session_context` ([`00109:13`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00109_marca_tenant.sql#L13)) | **Sistema** |
| 2 | `modulo` | No (global) | `administracion` | Todos (vía sesión) | `lib/dal/plataforma/index.ts:16`, lectura pública autenticada ([`00003:21`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00003_modulo_tenant_modulo.sql#L21)) | **Sistema** |
| 3 | `tenant_modulo` | Sí | `administracion` | Todos (vía sesión) | `sp_session_context` ([`00109:13`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00109_marca_tenant.sql#L13)), `sp_toggle_tenant_modulo` ([`00086:224`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00086_comisiones.sql#L224)) | **Sistema** |
| 4 | `configuracion` | Sí | `administracion` | `inventario` (QR tags) | `lib/dal/inventario/codigo.ts:15`, `sp_set_configuracion_qr_lado_mm` ([`00113:9`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00113_configuracion_etiquetas_qr.sql#L9)) | **Sistema** |
| 5 | `rol` | Sí | `administracion` | Todos (vía sesión) | `lib/dal/administracion/administracion.ts:14, 52`, `requireModuleRole('administracion', 'ver'/'crear'/'editar'/'eliminar')` ([`app/(app)/administracion/actions.ts:42`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/administracion/actions.ts#L42)) | **Sistema** |
| 6 | `usuario` | Sí | `administracion` | Todos (vía sesión) | `lib/dal/administracion/administracion.ts:31, 80`, `requireModuleRole('administracion', 'editar')` ([`app/(app)/administracion/usuarios/actions.ts:11`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/administracion/usuarios/actions.ts#L11)) | **Sistema** |
| 7 | `auditoria` | Sí | `administracion` | Todos (escrita por SPs) | `lib/dal/administracion/administracion.ts:100`, `requireModuleRole('administracion', 'ver')` ([`app/(app)/administracion/actions.ts:42`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/administracion/actions.ts#L42)) | **Sistema** |
| 8 | `producto_sku_seq` | Sí | `inventario` | — | `sp_gen_sku` ([`00036:42`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00036_sku_autogen.sql#L42)), secuencia interna | **Sistema** |
| 9 | `superadmin` | No (global) | Plataforma | — | `lib/dal/plataforma/guard.ts:18` | **Sistema** |
| 10 | `tenant_cargo` | Sí | Plataforma | — | `sp_registrar_cargo_tenant` ([`00119:169`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00119_super_admin_plataforma.sql#L169)) | **Sistema** |
| 11 | `tenant_pago` | Sí | Plataforma | — | `sp_registrar_pago_tenant` ([`00119:233`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00119_super_admin_plataforma.sql#L233)) | **Sistema** |
| 12 | `categoria` | Sí | `inventario` | `reportes` (`rf_*`) | `lib/dal/inventario/categoria.ts:8, 20`, `requireModuleRole('inventario', 'crear')` ([`app/(app)/inventario/actions.ts:207`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/inventario/actions.ts#L207)) | **Exclusiva** |
| 13 | `proveedor` | Sí | `inventario` | `precios`, `consignaciones`, `rendiciones`, `reportes` | `lib/dal/inventario/proveedor.ts:8-54`, `requireModuleRole('inventario', 'crear'/'editar')` ([`app/(app)/inventario/actions.ts:226`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/inventario/actions.ts#L226), [`app/(app)/proveedores/actions.ts:24`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/proveedores/actions.ts#L24)) | **Compartida** |
| 14 | `producto` | Sí | `inventario` | `precios`, `ventas`, `consignaciones`, `revendedoras`, `reportes` | `lib/dal/inventario/producto.ts:11-200`, `requireModuleRole('inventario', 'ver'/'crear'/'editar')` ([`app/(app)/inventario/actions.ts:78`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/inventario/actions.ts#L78)) | **Compartida** |
| 15 | `costo_producto` | Sí | `inventario` | `precios`, `reportes`, `ventas` (snapshot) | `lib/dal/precios/resolucion.ts:14`, `lib/dal/inventario/producto.ts:241`, `requireModuleRole('inventario', 'crear')` ([`app/(app)/inventario/actions.ts:78`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/inventario/actions.ts#L78)), `requireModuleRole('precios', 'editar_cotizacion')` ([`app/(app)/precios/actions.ts:58`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/precios/actions.ts#L58)) | **Compartida** |
| 16 | `ingreso_mercaderia` | Sí | `inventario` | `reportes` (flujo neto) | `lib/dal/inventario/ingreso.ts:22, 40`, `requireModuleRole('inventario', 'crear'/'eliminar')` ([`app/(app)/inventario/actions.ts:162, 182`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/inventario/actions.ts#L162)) | **Exclusiva** |
| 17 | `ingreso_mercaderia_detalle` | Sí | `inventario` | — | `lib/dal/inventario/ingreso.ts:56, 74`, `requireModuleRole('inventario', 'crear')` ([`app/(app)/inventario/actions.ts:142`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/inventario/actions.ts#L142)) | **Exclusiva** |
| 18 | `item_producto` | Sí | `inventario` | `ventas`, `consignaciones`, `revendedoras`, `reportes` | `lib/dal/inventario/item.ts:10, 31`, `sp_confirmar_salida_item` ([`00016:167`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00016_inventario_functions.sql#L167)) | **Compartida** |
| 19 | `movimiento_item` | Sí | `inventario` | `ventas`, `consignaciones`, `revendedoras` | `lib/dal/inventario/item.ts:50`, escrita por todos los SPs de transición física | **Compartida** |
| 20 | `regla_precio` | Sí | `precios` | `inventario` (alta prod) | `lib/dal/precios/regla.ts:8, 38`, `requireModuleRole('precios', 'crear'/'editar')` ([`app/(app)/precios/actions.ts:78`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/precios/actions.ts#L78)) | **Compartida** |
| 21 | `cotizacion_config` | Sí | `precios` | — | `lib/dal/precios/cotizacion.ts:12, 47`, `requireModuleRole('precios', 'editar_cotizacion')` ([`app/(app)/precios/cotizacion/actions.ts:70`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/precios/cotizacion/actions.ts#L70)) | **Exclusiva** |
| 22 | `cotizacion_dolar` | Sí | `precios` | — | `lib/dal/precios/cotizacion.ts:31, 88`, `requireModuleRole('precios', 'editar_cotizacion')` ([`app/(app)/precios/cotizacion/actions.ts:48, 92`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/precios/cotizacion/actions.ts#L48)) | **Exclusiva** |
| 23 | `plan_cuotas` | Sí | `precios` | `ventas` (checkout) | `lib/dal/precios/cuotas.ts:8, 19`, `requireModuleRole('precios', 'crear')` ([`app/(app)/precios/actions.ts:150`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/precios/actions.ts#L150)) | **Compartida** |
| 24 | `recargo_cuotas` | Sí | `precios` | `ventas` (checkout) | `lib/dal/precios/recargo.ts:8, 18`, `requireModuleRole('precios', 'editar')` ([`app/(app)/precios/actions.ts:180`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/precios/actions.ts#L180)) | **Compartida** |
| 25 | `cliente` | Sí | `ventas` | `reportes` (`rf_deudores`) | `lib/dal/clientes/cliente.ts:11, 38`, `requireModuleRole('ventas', 'crear')` ([`app/(app)/ventas/actions.ts:120`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ventas/actions.ts#L120)) | **Exclusiva** |
| 26 | `venta` | Sí | `ventas` | `rendiciones`, `revendedoras`, `reportes` | `lib/dal/ventas/venta.ts:10, 50, 85`, `requireModuleRole('ventas', 'crear'/'eliminar')` ([`app/(app)/ventas/actions.ts:50, 80`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ventas/actions.ts#L50)) | **Compartida** |
| 27 | `detalle_venta` | Sí | `ventas` | `rendiciones`, `revendedoras`, `reportes` | `lib/dal/ventas/venta.ts:32`, leída en rendición ([`00138:133`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00138_fix_sp_generar_rendicion_update.sql#L133)) y liquidación ([`00095:266`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00095_liquidacion_functions.sql#L266)) | **Compartida** |
| 28 | `pago_venta` | Sí | `ventas` | `reportes` | `lib/dal/ventas/venta.ts:70`, `lib/dal/cuotas/cuota.ts:30`, `requireModuleRole('ventas', 'editar')` ([`app/(app)/ventas/actions.ts:190`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ventas/actions.ts#L190)) | **Compartida** |
| 29 | `comprobante` | Sí | `ventas` | — | `lib/dal/ventas/comprobante.ts:10`, `requireModuleRole('ventas', 'crear')` ([`app/(app)/ventas/actions.ts:210`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ventas/actions.ts#L210)) | **Exclusiva** |
| 30 | `cuenta_destino` | Sí | `ventas` | `gastos`, `reportes` | `lib/dal/ventas/cuenta-destino.ts:9, 25`, `requireModuleRole('ventas', 'crear')` ([`app/(app)/ventas/actions.ts:230`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ventas/actions.ts#L230)) | **Compartida** |
| 31 | `arancel_cobro` | Sí | `ventas` | — | `lib/dal/ventas/arancel.ts:8, 22`, `requireModuleRole('ventas', 'editar')` ([`app/(app)/ventas/actions.ts:250`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ventas/actions.ts#L250)) | **Exclusiva** |
| 32 | `cuota_financiada` | Sí | `ventas` | `reportes` | `lib/dal/cuotas/cuota.ts:10, 30, 50`, `requireModuleRole('ventas', 'editar'/'eliminar')` ([`app/(app)/ventas/actions.ts:190, 200`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ventas/actions.ts#L190)) | **Compartida** |
| 33 | `devolucion_venta` | Sí | `ventas` | `reportes` | `lib/dal/ventas/venta.ts:110`, `requireModuleRole('ventas', 'crear')` ([`app/(app)/ventas/actions.ts:150`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ventas/actions.ts#L150)) | **Compartida** |
| 34 | `reintegro_cliente` | Sí | `ventas` | `reportes` | `lib/dal/ventas/venta.ts:110`, `requireModuleRole('ventas', 'crear')` ([`app/(app)/ventas/actions.ts:150`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ventas/actions.ts#L150)) | **Compartida** |
| 35 | `cambio_venta` | Sí | `ventas` | `revendedoras`, `reportes` | `lib/dal/ventas/venta.ts:140`, `requireModuleRole('ventas', 'crear')` ([`app/(app)/ventas/actions.ts:170`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ventas/actions.ts#L170)) | **Compartida** |
| 36 | `reserva` | Sí | `ventas` | — | `lib/dal/reservas/reserva.ts:10, 30, 50`, `requireModuleRole('ventas', 'crear'/'eliminar')` ([`app/(app)/ventas/actions.ts:270, 290`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ventas/actions.ts#L270)) | **Exclusiva** |
| 37 | `detalle_reserva` | Sí | `ventas` | — | `lib/dal/reservas/reserva.ts:70` | **Exclusiva** |
| 38 | `consignacion` | Sí | `consignaciones` | `rendiciones`, `reportes` | `lib/dal/consignaciones/consignacion.ts:12, 40`, `requireModuleRole('consignaciones', 'crear'/'editar'/'eliminar')` ([`app/(app)/consignaciones/actions.ts:27`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/consignaciones/actions.ts#L27)) | **Compartida** |
| 39 | `consignacion_detalle` | Sí | `consignaciones` | `rendiciones`, `reportes` | `lib/dal/consignaciones/consignacion.ts:80`, cruzada por `sp_generar_rendicion` ([`00138:99`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00138_fix_sp_generar_rendicion_update.sql#L99)) | **Compartida** |
| 40 | `rendicion_proveedor` | Sí | `rendiciones` | `reportes` (flujo / posición) | `lib/dal/rendiciones/rendicion.ts:10, 35, 70`, `guardedModulo('rendiciones', 'crear'/'editar')` ([`app/(app)/rendiciones/actions.ts:40`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/rendiciones/actions.ts#L40)) | **Exclusiva** |
| 41 | `categoria_gasto` | Sí | `gastos` | `reportes` | `lib/dal/gastos/gasto.ts:11, 25, 70`, `guardedModulo('gastos', 'crear'/'editar')` ([`app/(app)/rendiciones/actions.ts:44`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/rendiciones/actions.ts#L44)) | **Exclusiva** |
| 42 | `gasto_negocio` | Sí | `gastos` | `reportes` | `lib/dal/gastos/gasto.ts:40, 85, 110`, `guardedModulo('gastos', 'crear'/'editar')` ([`app/(app)/rendiciones/actions.ts:44`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/rendiciones/actions.ts#L44)) | **Exclusiva** |
| 43 | `revendedora` | Sí | `revendedoras` | `ventas`, `reportes` | `lib/dal/revendedoras/panel.ts:10, 35`, `requireModuleRole('revendedoras', 'crear'/'editar'/'eliminar')` ([`app/(app)/revendedoras/actions.ts:24`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/revendedoras/actions.ts#L24)) | **Compartida** |
| 44 | `consignacion_revendedora` | Sí | `revendedoras` | `reportes` | `lib/dal/revendedoras/consignacion.ts:12`, `requireModuleRole('revendedoras', 'crear'/'editar'/'eliminar')` ([`app/(app)/revendedoras/[id]/consignaciones/actions.ts:25`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/revendedoras/[id]/consignaciones/actions.ts#L25)) | **Compartida** |
| 45 | `consignacion_revendedora_detalle` | Sí | `revendedoras` | `reportes` | `lib/dal/revendedoras/consignacion.ts:50` | **Compartida** |
| 46 | `regla_comision` | Sí | `revendedoras` | `ventas` (preview/cálculo SP) | `lib/dal/revendedoras/comisiones.ts:10, 25`, `requireModuleRole('revendedoras', 'crear')` ([`app/(app)/revendedoras/comisiones/actions.ts:20`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/revendedoras/comisiones/actions.ts#L20)) | **Exclusiva** |
| 47 | `escala_comision` | Sí | `revendedoras` | `ventas` (preview/cálculo SP) | `lib/dal/revendedoras/comisiones.ts:45` | **Exclusiva** |
| 48 | `liquidacion_revendedora` | Sí | `revendedoras` | `reportes` | `lib/dal/revendedoras/liquidacion.ts:10, 40`, `requireModuleRole('revendedoras', 'liquidar')` ([`app/(app)/revendedoras/[id]/liquidaciones/actions.ts:24`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/revendedoras/[id]/liquidaciones/actions.ts#L24)) | **Compartida** |
| 49 | `pago_revendedora` | Sí | `revendedoras` | `reportes` | `lib/dal/revendedoras/liquidacion.ts:80`, `requireModuleRole('revendedoras', 'liquidar')` ([`app/(app)/revendedoras/[id]/liquidaciones/actions.ts:24`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/revendedoras/[id]/liquidaciones/actions.ts#L24)) | **Compartida** |
| 50 | `declaracion_venta_revendedora` | Sí | `revendedoras` | — | `lib/dal/revendedoras/declaraciones.ts:25, 55`, `requireModuleRole('revendedoras', 'declarar')` ([`app/(revendedora)/mi-cuenta/actions.ts:19`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(revendedora)/mi-cuenta/actions.ts#L19)), `requireModuleRole('revendedoras', 'editar')` ([`app/(app)/revendedoras/declaraciones/actions.ts:41`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/revendedoras/declaraciones/actions.ts#L41)) | **Exclusiva** |
| 51 | `consulta_ayuda` | Sí | `ayuda` | — | `lib/dal/ayuda/index.ts:15, 40`, `requireModuleRole('ayuda', 'consultar')` ([`app/(app)/ayuda/actions.ts:41, 123`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/ayuda/actions.ts#L41)) | **Exclusiva** |

---

## 3. Cruce con `cotizacion-usd`

Referencia: [`openspec/changes/cotizacion-usd/tasks.md`](file:///c:/Archivos%20de%20trabajo/evoralStock/openspec/changes/cotizacion-usd/tasks.md). El cambio `cotizacion-usd` ya fue implementado y mergeado en `main`.

### 3.1. Tablas afectadas por `cotizacion-usd`
1. **`cotizacion_config`**: creada en [`00130_cotizacion_usd.sql:17`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00130_cotizacion_usd.sql#L17). RLS de tenant + restrictiva de revendedoras.
2. **`cotizacion_dolar`**: creada en [`00130_cotizacion_usd.sql:38`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00130_cotizacion_usd.sql#L38). RLS de tenant + restrictiva de revendedoras.
3. **`costo_producto`**: alterada en [`00130_cotizacion_usd.sql:66-68`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00130_cotizacion_usd.sql#L66-L68) agregando: `costo_original_usd`, `cotizacion_aplicada`, `cotizacion_fecha_valor`.
4. **`ingreso_mercaderia_detalle`**: alterada en [`00130_cotizacion_usd.sql:71-73`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00130_cotizacion_usd.sql#L71-L73) agregando: `costo_original_usd`, `cotizacion_aplicada`, `cotizacion_fecha_valor`.

### 3.2. Stored Procedures creados o modificados por `cotizacion-usd`
1. **`sp_get_cotizacion_vigente()`**: creado en [`00130_cotizacion_usd.sql:78`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00130_cotizacion_usd.sql#L78) (INVOKER).
2. **`sp_set_cotizacion_manual()`**: creado en [`00130_cotizacion_usd.sql:195`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00130_cotizacion_usd.sql#L195) (INVOKER).
3. **`sp_set_modo_cotizacion()`**: creado en [`00130_cotizacion_usd.sql:281`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00130_cotizacion_usd.sql#L281) (INVOKER).
4. **`sp_registrar_cotizacion_bcra()`**: modificado en [`00133_sp_registrar_cotizacion_bcra_hoy.sql:68`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00133_sp_registrar_cotizacion_bcra_hoy.sql#L68) (INVOKER).
5. **`sp_set_costo_producto()`**: modificado en [`00136_conversion_costo_usd.sql:193`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00136_conversion_costo_usd.sql#L193) (INVOKER) para admitir `p_costo_original_usd`, `p_cotizacion_aplicada`, `p_cotizacion_fecha_valor`.
6. **`sp_importar_remito()`**: modificado en [`00136_conversion_costo_usd.sql:258`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00136_conversion_costo_usd.sql#L258) (INVOKER) para persistir metadatos USD.
7. **`sp_revaluar_costos_usd_vigentes()`**: creado en [`00137_revaluar_costos_usd_vigentes.sql:4`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00137_revaluar_costos_usd_vigentes.sql#L4) (INVOKER) para revaluación masiva en lote.
8. **Permiso `precios.editar_cotizacion`**: creado e incorporado a `CATALOGO_PERMISOS` ([`lib/types/administracion.ts:63`](file:///c:/Archivos%20de%20trabajo/evoralStock/lib/types/administracion.ts#L63)) y backfilleado al rol Administrador en [`00131_admin_permiso_precios_editar_cotizacion.sql:11`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00131_admin_permiso_precios_editar_cotizacion.sql#L11).

> [!WARNING]
> En la Fase 5 de `rls-por-permiso`, al modificar los `sp_*` para exigir permisos, es imperativo partir de `pnpm sp:last` para no perder los parámetros de conversión USD de `sp_set_costo_producto`, `sp_importar_remito` ni `sp_revaluar_costos_usd_vigentes`.

---

## 4. Columnas sensibles en tablas compartidas (insumo de `costos-por-columna`)

Las siguientes columnas contienen datos comerciales/financieros sensibles (costo de adquisición, margen de ganancia, aranceles, comisiones) alojados en tablas **compartidas** con roles de menor privilegio (como vendedores o revendedoras). RLS filtra filas completas, por lo que estas columnas son visibles en cualquier `SELECT *` directo vía PostgREST si no se segregan por columna o vista:

| Tabla Compartida | Columna Sensible | Tipo / Definición | Módulo Dueño | Riego de Exposición |
|---|---|---|---|---|
| `detalle_venta` | `costo_snapshot` | `numeric(14,2)` ([`00021:39`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00021_venta.sql#L39)) | `inventario` / `precios` | Vendedor sin permiso de costos ve el costo exacto del producto vendido |
| `detalle_venta` | `monto_ganancia` | `numeric(14,2)` ([`00021:40`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00021_venta.sql#L40)) | `reportes` | Vendedor ve el margen neto ganado por la tienda en cada ítem |
| `item_producto` | `costo_ingreso` | `numeric(14,2)` ([`00015:17`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00015_item_producto.sql#L17)) | `inventario` | Vendedor o cajero al escanear/buscar stock ve el costo unitario de compra |
| `pago_venta` | `costo_cobro` | `numeric(14,2)` ([`00057:132`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00057_costo_cobro.sql#L132)) | `ventas` / `reportes` | Revela el arancel o retención bancaria/posnet pagada |
| `pago_venta` | `desglose_costo` | `jsonb` ([`00057:136`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00057_costo_cobro.sql#L136)) | `ventas` / `reportes` | Desglose de retenciones fiscales (IVA, Ganancias, IIBB) |
| `devolucion_venta` | `costo_recuperado` | `numeric(14,2)` ([`00070:31`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00070_reintegro_y_devolucion.sql#L31)) | `inventario` | Revela el costo contable del stock devuelto |
| `venta` | `monto_comision` | `numeric(14,2)` ([`00088:62`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00088_venta_canal.sql#L62)) | `revendedoras` | Comisión de revendedora en ventas compartidas |
| `consignacion_revendedora_detalle` | `comision_porcentaje_snapshot` | `numeric(5,2)` ([`00086:79`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00086_comisiones.sql#L79)) | `revendedoras` | Porcentaje de comisión acordado |
| `arancel_cobro` | `arancel_pct`, `iva_arancel_pct`, `ret_*` | `numeric(6,3)` ([`00057:13-63`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00057_costo_cobro.sql#L13)) | `ventas` | Información financiera de costos de intermediación de pagos |
| `regla_precio` | `margen_porcentaje` | `numeric(5,2)` ([`00017:32`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00017_precios_enums_regla.sql#L32)) | `precios` | Política de márgenes y recargos comerciales de la empresa |

---

## 5. Observaciones fuera de alcance (Closed Scope)

Las siguientes anomalías o deudas técnicas fueron observadas durante el inventario y quedan registradas sin modificar código:
1. **Acciones de `gastos` cohabitando en archivo ajeno**: Las Server Actions de gastos residen en [`app/(app)/rendiciones/actions.ts:44`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/rendiciones/actions.ts#L44). Aunque están correctamente protegidas por `guardedModulo('gastos', accion)`, genera confusión respecto a la estructura de carpetas.
2. **Acciones de `proveedores` divididas**: La acción `createProveedorAction` reside en [`app/(app)/inventario/actions.ts:226`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/inventario/actions.ts#L226), mientras que `setProveedorActivoAction` reside en [`app/(app)/proveedores/actions.ts:18`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/proveedores/actions.ts#L18). Ambas exigen permiso `inventario`.
3. **Ausencia de trigger de protección en rol `Administrador`**: El rol `Revendedora` tiene un trigger en DB que impide renombrarlo o eliminarlo ([`00079:34`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00079_rol_revendedora.sql#L34)), pero `Administrador` no posee protección similar a nivel de schema Postgres (solo la validación en `sp_delete_rol` de no tener usuarios).
4. **Vistas sin RLS granular**: Vistas como `v_linea_venta` tienen `security_invoker = true`, lo que hereda las políticas de `venta` y `detalle_venta`. Al aplicar RLS por permisos, los usuarios sin `reportes` o `ventas` no podrán consultar la vista.
