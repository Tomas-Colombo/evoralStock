# Inventario de lecturas y escrituras por módulo (Fase 1 — rls-por-permiso)

**Change**: `rls-por-permiso` · **Spec**: `proposal.md` · **Fase**: 1 (Solo Lectura) · **Fecha**: 2026-11-06 (revisión de citas y permisos por tabla)

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
  - Lee y escribe: `regla_precio`, `plan_cuotas`, `recargo_cuotas`, `cotizacion_config`, `cotizacion_dolar`, `cuenta_destino`, `arancel_cobro`.
  - Lee y escribe (cross-module): `costo_producto` (revaluación masiva en lote vía `sp_revaluar_costos_usd_vigentes`), `producto` (actualización de `precio_venta` y `precio_venta_desactualizado`).
  - Lee: `categoria`, `proveedor` (para filtros en reglas y control de precios).
- **`ventas`** (incluye rutas `clientes`, `cuotas`, `reservas`):
  - Lee y escribe: `cliente`, `venta`, `detalle_venta`, `pago_venta`, `comprobante`, `cuota_financiada`, `devolucion_venta`, `reintegro_cliente`, `cambio_venta`, `reserva`, `detalle_reserva`.
  - Lee (cross-module): `cuenta_destino` y `arancel_cobro` (leídas en checkout y cobro de cuotas para calcular recargos/aranceles y asignar cuenta; escritas por `precios`), `producto` (catálogo, precios), `costo_producto` (snapshot de costo en venta), `plan_cuotas` y `recargo_cuotas` (planes de pago), `revendedora`, `regla_comision`, `escala_comision` (ventas de canal revendedora).
  - Lee y escribe (cross-module en SPs): `item_producto`, `movimiento_item` (transiciones a `vendido`, `reservado`, `disponible`).
- **`consignaciones`**:
  - Lee y escribe: `consignacion`, `consignacion_detalle`.
  - Lee y escribe (cross-module en SPs): `item_producto`, `movimiento_item` (transición a `consignado_proveedor`).
  - Lee: `proveedor` (valida proveedor consignatario).
- **`rendiciones`**:
  - Lee y escribe: `rendicion_proveedor`.
  - Lee y actualiza (cross-module en SPs): `venta`, `detalle_venta` (ventas de mercadería consignada a liquidar), `consignacion`, `consignacion_detalle` (cierre de items), `proveedor`, `item_producto`.
- **`gastos`**:
  - Lee y escribe: `categoria_gasto`, `gasto_negocio`.
  - Lee: `cuenta_destino` (asociada opcionalmente en el gasto; no la muta).
- **`reportes`**:
  - No posee tablas operativas propias.
  - Lee de forma transversal vía funciones SQL (`rf_*`) y vistas con `security_invoker = true` (`v_linea_venta`, `v_ganancia_por_producto`, `v_perfil_proveedor`, `v_alerta_reposicion`, etc.): `venta`, `detalle_venta`, `pago_venta`, `cuota_financiada`, `devolucion_venta`, `reintegro_cliente`, `cambio_venta`, `producto`, `categoria`, `costo_producto`, `item_producto`, `movimiento_item`, `ingreso_mercaderia`, `proveedor`, `consignacion`, `consignacion_detalle`, `rendicion_proveedor`, `gasto_negocio`, `categoria_gasto`, `revendedora`, `consignacion_revendedora`, `consignacion_revendedora_detalle`, `liquidacion_revendedora`, `pago_revendedora`, `cuenta_destino`.
- **`revendedoras`** (incluye portal `mi-cuenta` con permisos `ver_propio` y `declarar`):
  - Lee y escribe: `revendedora`, `consignacion_revendedora`, `consignacion_revendedora_detalle`, `regla_comision`, `escala_comision`, `liquidacion_revendedora`, `pago_revendedora`, `declaracion_venta_revendedora`.
  - Lee (cross-module): `cuenta_destino` (para pagar liquidación en [`app/(app)/revendedoras/[id]/liquidaciones/[idLiquidacion]/page.tsx:9`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/revendedoras/[id]/liquidaciones/[idLiquidacion]/page.tsx#L9)).
  - Lee y escribe (cross-module en SPs): `item_producto`, `movimiento_item` (entrega a revendedora, devoluciones, ventas), `venta`, `detalle_venta`, `pago_venta` (confirmación de declaraciones de venta de revendedora).
- **`ayuda`**:
  - Lee y escribe: `consulta_ayuda`.

---

### 1.2. Clasificación de tablas: exclusivas, compartidas y sistema

Se definen como **exclusivas** aquellas tablas a las que únicamente usuarios de un único módulo funcional necesitan acceder para su operativa.
Se definen como **compartidas** aquellas tablas donde usuarios de múltiples módulos operativos necesitan leer o escribir filas, o donde la restricción por RLS rompería pantallas legítimas de otros módulos.
Se definen como **sistema** las tablas de infraestructura transversal y plataforma.

#### Resumen cuantitativo (total 51 tablas):
- **Sistema**: 11 tablas (`tenant`, `modulo`, `tenant_modulo`, `configuracion`, `rol`, `usuario`, `auditoria`, `producto_sku_seq`, `superadmin`, `tenant_cargo`, `tenant_pago`).
- **Exclusivas**: 13 tablas.
  - `inventario` (2): `categoria`, `ingreso_mercaderia_detalle`.
  - `precios` (2): `cotizacion_config`, `cotizacion_dolar`.
  - `ventas` (4): `cliente`, `comprobante`, `reserva`, `detalle_reserva`.
  - `rendiciones` (1): `rendicion_proveedor`.
  - `gastos` (2): `categoria_gasto`, `gasto_negocio`.
  - `revendedoras` (1): `declaracion_venta_revendedora`.
  - `ayuda` (1): `consulta_ayuda`.
- **Compartidas**: 27 tablas.
  - `costo_producto` (`inventario`, `precios`, `reportes`, snapshot en `ventas` y `revendedoras`)
  - `proveedor` (`inventario`, `precios`, `consignaciones`, `rendiciones`, `reportes`)
  - `producto` (`inventario`, `precios`, `ventas`, `consignaciones`, `revendedoras`, `reportes`)
  - `item_producto` (`inventario`, `ventas`, `consignaciones`, `revendedoras`, `reportes`)
  - `movimiento_item` (`inventario`, `ventas`, `consignaciones`, `revendedoras`)
  - `ingreso_mercaderia` (`inventario`, `reportes`)
  - `regla_precio` (`precios`, `inventario`)
  - `plan_cuotas` (`precios`, `ventas`)
  - `recargo_cuotas` (`precios`, `ventas`)
  - `cuenta_destino` (escrita por `precios`; leída por `precios`, `ventas`, `revendedoras`, `reportes`)
  - `arancel_cobro` (escrita por `precios`; leída por `precios`, `ventas`)
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
  - `regla_comision` (`revendedoras`, `ventas` en preview de comisiones)
  - `escala_comision` (`revendedoras`, `ventas` en preview de comisiones)
  - `liquidacion_revendedora` (`revendedoras`, `reportes`)
  - `pago_revendedora` (`revendedoras`, `reportes`)

> [!IMPORTANT]
> **Reclasificación de `arancel_cobro` y `cuenta_destino`**:
> Las Server Actions de mutación residen en [`app/(app)/precios/actions.ts:218, 289, 332, 373, 406, 424`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/precios/actions.ts#L218) y están protegidas por `precios.crear` y `precios.editar`. No son escritas por `ventas`. Sin embargo, son leídas en checkout (`ventas.ver`), pago de liquidaciones (`revendedoras.ver`) y reporte de caja (`reportes.ver`). Por ende, ambas son compartidas y deben permitir SELECT a estos módulos.

---

### 1.3. ¿Qué `sp_*´/`rf_*´ INVOKER cruzan tablas de otro módulo?

Dado que las funciones son **INVOKER**, Postgres evalúa la RLS bajo el contexto del usuario autenticado. Si un `sp_*` de un módulo cruza a tablas de otro módulo con policy restrictiva, la ejecución fallará o devolverá filas vacías salvo que la policy admita al permiso invocador.

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

### 1.4. ¿Qué `sp_*´ de escritura hoy no chequean permiso?

**Confirmación técnica**: **NINGÚN `sp_*´ de escritura de dominio de tenant chequea permisos de usuario adentro.**
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
| `sp_toggle_tenant_modulo` | [`00086_comisiones.sql:224`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00086_comisiones.sql#L224) *(00117:27 revocó execute a authenticated)* | No |

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
Para cada tabla se detallan las Server Actions que la mutan junto a su permiso verificado (`módulo.acción`), los permisos requeridos para **SELECT** y los permisos requeridos para **escritura** (INSERT / UPDATE / DELETE). Toda la evidencia de acciones surge de la búsqueda mecánica de Apéndice A trazada hasta consultas DAL (`.from`) y llamadas a procedimientos almacenados (`.rpc`). Las filas no trazables se marcan explícitamente como "no verificado".

| # | Tabla | Id Tenant | Módulo de Permiso Principal | Acciones y Permiso (Evidencia Mecánica) | Permisos SELECT | Permisos Escritura |
|---|---|---|---|---|---|---|
| 1 | `tenant` | Sí (PK) | `administracion` | `updateTenantLogoAction` (`administracion.editar`), `quitarTenantLogoAction` (`administracion.editar`), `registrarCargoTenantAction` (superadmin / plataforma), `registrarPagoTenantAction` (superadmin / plataforma), `anularMovimientoTenantAction` (superadmin / plataforma), `togglePaqueteTenantAction` (superadmin / plataforma), `altaTenantAction` (superadmin / plataforma), `cambiarEstadoTenantAction` (superadmin / plataforma), `actualizarCotizacionManualAction` (`precios.editar_cotizacion`), `sincronizarCotizacionBcraAction` (`precios.editar_cotizacion`), `revaluarCostosUsdAction` (`precios.editar_cotizacion`), `leerCotizacionVigenteAction` (`inventario.ver`) | Todos los usuarios autenticados (contexto de tenant) | `administracion.editar`, `precios.editar_cotizacion`, `inventario.ver` |
| 2 | `modulo` | No (global) | `administracion` | `anularMovimientoTenantAction` (superadmin / plataforma), `togglePaqueteTenantAction` (superadmin / plataforma), `altaTenantAction` (superadmin / plataforma), `declararVentaAction` (`revendedoras.declarar`), `retirarDeclaracionAction` (`revendedoras.declarar`), `registrarVentaAction` (`ventas.crear`), `cambiarItemVentaAction` (`ventas.crear`), `crearRevendedoraUnificadaAction` (`revendedoras.crear`), `crearRevendedoraAction` (`revendedoras.crear`), `editarRevendedoraAction` (`revendedoras.editar`), `bajaRevendedoraAction` (`revendedoras.eliminar`), `darAccesoRevendedoraAction` (`revendedoras.editar`), `confirmarDeclaracionAction` (`revendedoras.crear`), `rechazarDeclaracionAction` (`revendedoras.crear`), `crearReglaGeneralAction` (`revendedoras.editar`), `guardarComisionPropiaAction` (`revendedoras.editar`), `terminarReglaAction` (`revendedoras.editar`), `editarConsignacionRevendedoraAction` (`revendedoras.editar`), `confirmarConsignacionRevendedoraAction` (`revendedoras.crear`), `registrarDevolucionRevendedoraAction` (`revendedoras.editar`), `cerrarConsignacionRevendedoraAction` (`revendedoras.editar`), `eliminarConsignacionRevendedoraAction` (`revendedoras.eliminar`), `previewLiquidacionAction` (`revendedoras.ver`), `generarLiquidacionAction` (`revendedoras.liquidar`), `excluirDetalleLiquidacionAction` (`revendedoras.liquidar`), `reincluirDetalleLiquidacionAction` (`revendedoras.liquidar`), `marcarLiquidacionPagadaAction` (`revendedoras.liquidar`) | Todos los usuarios autenticados | `revendedoras.declarar`, `ventas.crear`, `revendedoras.crear`, `revendedoras.editar`, `revendedoras.eliminar`, `revendedoras.ver`, `revendedoras.liquidar` |
| 3 | `tenant_modulo` | Sí | `administracion` | `anularMovimientoTenantAction` (superadmin / plataforma), `togglePaqueteTenantAction` (superadmin / plataforma), `altaTenantAction` (superadmin / plataforma), `declararVentaAction` (`revendedoras.declarar`), `retirarDeclaracionAction` (`revendedoras.declarar`), `registrarVentaAction` (`ventas.crear`), `cambiarItemVentaAction` (`ventas.crear`), `crearRevendedoraUnificadaAction` (`revendedoras.crear`), `crearRevendedoraAction` (`revendedoras.crear`), `editarRevendedoraAction` (`revendedoras.editar`), `bajaRevendedoraAction` (`revendedoras.eliminar`), `darAccesoRevendedoraAction` (`revendedoras.editar`), `confirmarDeclaracionAction` (`revendedoras.crear`), `rechazarDeclaracionAction` (`revendedoras.crear`), `crearReglaGeneralAction` (`revendedoras.editar`), `guardarComisionPropiaAction` (`revendedoras.editar`), `terminarReglaAction` (`revendedoras.editar`), `editarConsignacionRevendedoraAction` (`revendedoras.editar`), `confirmarConsignacionRevendedoraAction` (`revendedoras.crear`), `registrarDevolucionRevendedoraAction` (`revendedoras.editar`), `cerrarConsignacionRevendedoraAction` (`revendedoras.editar`), `eliminarConsignacionRevendedoraAction` (`revendedoras.eliminar`), `previewLiquidacionAction` (`revendedoras.ver`), `generarLiquidacionAction` (`revendedoras.liquidar`), `excluirDetalleLiquidacionAction` (`revendedoras.liquidar`), `reincluirDetalleLiquidacionAction` (`revendedoras.liquidar`), `marcarLiquidacionPagadaAction` (`revendedoras.liquidar`) | Todos los usuarios autenticados (policy `tenant_modulo_select_own_tenant` `00117`) | `revendedoras.declarar`, `ventas.crear`, `revendedoras.crear`, `revendedoras.editar`, `revendedoras.eliminar`, `revendedoras.ver`, `revendedoras.liquidar` |
| 4 | `configuracion` | Sí | `administracion` | `updateConfiguracionQrAction` (`administracion.editar`), `updateConfiguracionImpresoraAction` (`administracion.editar`) | `administracion.ver`, `inventario.ver` (render etiquetas QR) | `administracion.editar` |
| 5 | `rol` | Sí | `administracion` | `createRolAction` (`administracion.crear`), `updateRolAction` (`administracion.editar`), `deleteRolAction` (`administracion.eliminar`), `altaTenantAction` (superadmin / plataforma), `crearRevendedoraUnificadaAction` (`revendedoras.crear`), `darAccesoRevendedoraAction` (`revendedoras.editar`) | Todos los usuarios autenticados (sesión) y `administracion.ver` | `administracion.crear`, `administracion.editar`, `administracion.eliminar`, `revendedoras.crear`, `revendedoras.editar` |
| 6 | `usuario` | Sí | `administracion` | `changePasswordAction` (superadmin / plataforma), `toggleUsuarioEstadoAction` (`administracion.editar`), `invitarUsuarioAction` (`administracion.crear`), `asignarRolAction` (`administracion.editar`), `deleteRolAction` (`administracion.eliminar`), `cambiarMiPasswordAction` (`administracion.ver`), `restablecerClaveAction` (`administracion.editar`), `altaTenantAction` (superadmin / plataforma), `crearRevendedoraUnificadaAction` (`revendedoras.crear`), `darAccesoRevendedoraAction` (`revendedoras.editar`), `revocarAccesoRevendedoraAction` (`revendedoras.editar`) | Todos los autenticados (sesión propia), `administracion.ver` | `administracion.editar`, `administracion.crear`, `administracion.eliminar`, `administracion.ver`, `revendedoras.crear`, `revendedoras.editar` |
| 7 | `auditoria` | Sí | `administracion` | `changePasswordAction` (superadmin / plataforma), `toggleUsuarioEstadoAction` (`administracion.editar`), `asignarRolAction` (`administracion.editar`), `createRolAction` (`administracion.crear`), `updateRolAction` (`administracion.editar`), `deleteRolAction` (`administracion.eliminar`), `updateConfiguracionQrAction` (`administracion.editar`), `updateConfiguracionImpresoraAction` (`administracion.editar`), `updateTenantLogoAction` (`administracion.editar`), `quitarTenantLogoAction` (`administracion.editar`), `cambiarMiPasswordAction` (`administracion.ver`), `anularMovimientoTenantAction` (superadmin / plataforma), `togglePaqueteTenantAction` (superadmin / plataforma), `registrarVentaAction` (`ventas.crear`), `anularVentaAction` (`ventas.editar`), `devolverItemVentaAction` (`ventas.editar`), `emitirComprobanteAction` (`ventas.crear`), `crearReservaAction` (`ventas.crear`), `cancelarReservaAction` (`ventas.editar`), `vencerReservasAction` (`ventas.editar`), `cobrarCuotaAction` (`ventas.editar`), `marcarCuotaIncobrableAction` (`ventas.eliminar`), `excluirDetalleAction` (`rendiciones.editar`), `reincluirDetalleAction` (`rendiciones.editar`), `generarRendicionAction` (`rendiciones.crear`), `marcarRendicionPagadaAction` (`rendiciones.editar`), `registrarGastoAction` (`gastos.crear`), `eliminarGastoAction` (`gastos.editar`), `setPresupuestoAction` (`gastos.editar`), `createReglaAction` (`precios.crear`), `bajaReglaAction` (`precios.eliminar`), `extenderVigenciaReglaAction` (`precios.editar`), `recalcularPrecioAction` (`precios.editar`), `actualizarCotizacionManualAction` (`precios.editar_cotizacion`), `cambiarModoCotizacionAction` (`precios.editar_cotizacion`), `sincronizarCotizacionBcraAction` (`precios.editar_cotizacion`), `revaluarCostosUsdAction` (`precios.editar_cotizacion`), `crearRevendedoraUnificadaAction` (`revendedoras.crear`), `crearRevendedoraAction` (`revendedoras.crear`), `editarRevendedoraAction` (`revendedoras.editar`), `bajaRevendedoraAction` (`revendedoras.eliminar`), `confirmarDeclaracionAction` (`revendedoras.crear`), `rechazarDeclaracionAction` (`revendedoras.crear`), `crearReglaGeneralAction` (`revendedoras.editar`), `guardarComisionPropiaAction` (`revendedoras.editar`), `terminarReglaAction` (`revendedoras.editar`), `editarConsignacionRevendedoraAction` (`revendedoras.editar`), `confirmarConsignacionRevendedoraAction` (`revendedoras.crear`), `registrarDevolucionRevendedoraAction` (`revendedoras.editar`), `cerrarConsignacionRevendedoraAction` (`revendedoras.editar`), `eliminarConsignacionRevendedoraAction` (`revendedoras.eliminar`), `generarLiquidacionAction` (`revendedoras.liquidar`), `excluirDetalleLiquidacionAction` (`revendedoras.liquidar`), `reincluirDetalleLiquidacionAction` (`revendedoras.liquidar`), `marcarLiquidacionPagadaAction` (`revendedoras.liquidar`), `crearConsignacionAction` (`consignaciones.crear`), `editarConsignacionAction` (`consignaciones.editar`), `confirmarConsignacionAction` (`consignaciones.editar`), `eliminarConsignacionAction` (`consignaciones.eliminar`), `agregarItemConsignacionAction` (`consignaciones.crear`), `cancelarItemConsignacionAction` (`consignaciones.editar`), `confirmarSalidaItemAction` (`consignaciones.editar`), `cerrarConsignacionAction` (`consignaciones.editar`), `registrarAjusteInventarioAction` (`inventario.editar`), `createProductoAction` (`inventario.crear`), `asignarTallesProductoAction` (`inventario.editar`), `setCostoProductoAction` (`inventario.editar`), `transicionItemAction` (`inventario.editar`), `cancelarIngresoAction` (`inventario.eliminar`), `confirmarIngresoAction` (`inventario.crear`), `importarRemitoAction` (`inventario.crear`), `crearIngresoCompletoAction` (`inventario.crear`), `leerCotizacionVigenteAction` (`inventario.ver`) | `administracion.ver` | `administracion.editar`, `administracion.crear`, `administracion.eliminar`, `administracion.ver`, `ventas.crear`, `ventas.editar`, `ventas.eliminar`, `rendiciones.editar`, `rendiciones.crear`, `gastos.crear`, `gastos.editar`, `precios.crear`, `precios.eliminar`, `precios.editar`, `precios.editar_cotizacion`, `revendedoras.crear`, `revendedoras.editar`, `revendedoras.eliminar`, `revendedoras.liquidar`, `consignaciones.crear`, `consignaciones.editar`, `consignaciones.eliminar`, `inventario.editar`, `inventario.crear`, `inventario.eliminar`, `inventario.ver` |
| 8 | `producto_sku_seq` | Sí | `inventario` | no verificado | no verificado | no verificado |
| 9 | `superadmin` | No (global) | Plataforma | `loginAction` (superadmin / plataforma), `registrarCargoTenantAction` (superadmin / plataforma), `registrarPagoTenantAction` (superadmin / plataforma), `anularMovimientoTenantAction` (superadmin / plataforma), `togglePaqueteTenantAction` (superadmin / plataforma), `altaTenantAction` (superadmin / plataforma), `cambiarEstadoTenantAction` (superadmin / plataforma) | Superadmin exclusivo | Superadmin exclusivo (sin mutación desde app tenant) |
| 10 | `tenant_cargo` | Sí | Plataforma | `registrarCargoTenantAction` (superadmin / plataforma), `registrarPagoTenantAction` (superadmin / plataforma), `anularMovimientoTenantAction` (superadmin / plataforma) | Superadmin exclusivo | Superadmin exclusivo (sin mutación desde app tenant) |
| 11 | `tenant_pago` | Sí | Plataforma | `registrarCargoTenantAction` (superadmin / plataforma), `registrarPagoTenantAction` (superadmin / plataforma), `anularMovimientoTenantAction` (superadmin / plataforma) | Superadmin exclusivo | Superadmin exclusivo (sin mutación desde app tenant) |
| 12 | `categoria` | Sí | `inventario` | `createCategoriaAction` (`inventario.crear`), `updateCategoriaAction` (`inventario.editar`), `toggleCategoriaActivaAction` (`inventario.editar`), `asignarTallesProductoAction` (`inventario.editar`) | `inventario.ver`, `precios.ver`, `reportes.ver` | `inventario.crear`, `inventario.editar` |
| 13 | `proveedor` | Sí | `inventario` | `setProveedorActivoAction` (`inventario.editar`), `createProveedorAction` (`inventario.crear`), `updateProveedorAction` (`inventario.editar`) | `inventario.ver`, `precios.ver`, `consignaciones.ver`, `rendiciones.ver`, `reportes.ver` | `inventario.editar`, `inventario.crear` |
| 14 | `producto` | Sí | `inventario` | `registrarVentaAction` (`ventas.crear`), `cambiarItemVentaAction` (`ventas.crear`), `crearReservaAction` (`ventas.crear`), `recalcularPrecioAction` (`precios.editar`), `marcarLiquidacionPagadaAction` (`revendedoras.liquidar`), `createProductoAction` (`inventario.crear`), `updateProductoAction` (`inventario.editar`), `asignarTallesProductoAction` (`inventario.editar`), `cancelarIngresoAction` (`inventario.eliminar`), `importarRemitoAction` (`inventario.crear`), `crearIngresoCompletoAction` (`inventario.crear`) | `inventario.ver`, `precios.ver`, `ventas.ver`, `consignaciones.ver`, `revendedoras.ver`, `reportes.ver` | `ventas.crear`, `precios.editar`, `revendedoras.liquidar`, `inventario.crear`, `inventario.editar`, `inventario.eliminar` |
| 15 | `costo_producto` | Sí | `inventario` | `recalcularPrecioAction` (`precios.editar`), `revaluarCostosUsdAction` (`precios.editar_cotizacion`), `createProductoAction` (`inventario.crear`), `setCostoProductoAction` (`inventario.editar`), `importarRemitoAction` (`inventario.crear`), `crearIngresoCompletoAction` (`inventario.crear`) | `inventario.ver`, `precios.ver`, `ventas.crear` (snapshot en SP), `revendedoras.editar` (snapshot en SP), `reportes.ver` | `precios.editar`, `precios.editar_cotizacion`, `inventario.crear`, `inventario.editar` |
| 16 | `ingreso_mercaderia` | Sí | `inventario` | `registrarVentaAction` (`ventas.crear`), `agregarItemConsignacionAction` (`consignaciones.crear`), `createProductoAction` (`inventario.crear`), `cancelarIngresoAction` (`inventario.eliminar`), `confirmarIngresoAction` (`inventario.crear`), `importarRemitoAction` (`inventario.crear`), `crearIngresoCompletoAction` (`inventario.crear`) | `inventario.ver`, `reportes.ver` (`rf_finanzas_flujo`) | `ventas.crear`, `consignaciones.crear`, `inventario.crear`, `inventario.eliminar` |
| 17 | `ingreso_mercaderia_detalle` | Sí | `inventario` | `createProductoAction` (`inventario.crear`), `removeIngresoDetalleAction` (`inventario.editar`), `cancelarIngresoAction` (`inventario.eliminar`), `confirmarIngresoAction` (`inventario.crear`), `importarRemitoAction` (`inventario.crear`), `crearIngresoCompletoAction` (`inventario.crear`) | `inventario.ver` | `inventario.crear`, `inventario.editar`, `inventario.eliminar` |
| 18 | `item_producto` | Sí | `inventario` | `registrarVentaAction` (`ventas.crear`), `anularVentaAction` (`ventas.editar`), `devolverItemVentaAction` (`ventas.editar`), `cambiarItemVentaAction` (`ventas.crear`), `crearReservaAction` (`ventas.crear`), `confirmarConsignacionRevendedoraAction` (`revendedoras.crear`), `registrarDevolucionRevendedoraAction` (`revendedoras.editar`), `previewLiquidacionAction` (`revendedoras.ver`), `eliminarConsignacionAction` (`consignaciones.eliminar`), `agregarItemConsignacionAction` (`consignaciones.crear`), `cancelarItemConsignacionAction` (`consignaciones.editar`), `registrarAjusteInventarioAction` (`inventario.editar`), `createProductoAction` (`inventario.crear`), `asignarTallesProductoAction` (`inventario.editar`), `transicionItemAction` (`inventario.editar`), `cancelarIngresoAction` (`inventario.eliminar`), `confirmarIngresoAction` (`inventario.crear`), `crearIngresoCompletoAction` (`inventario.crear`) | `inventario.ver`, `ventas.ver`, `consignaciones.ver`, `rendiciones.ver`, `revendedoras.ver`, `revendedoras.ver_propio`, `reportes.ver` | `ventas.crear`, `ventas.editar`, `revendedoras.crear`, `revendedoras.editar`, `revendedoras.ver`, `consignaciones.eliminar`, `consignaciones.crear`, `consignaciones.editar`, `inventario.editar`, `inventario.crear`, `inventario.eliminar` |
| 19 | `movimiento_item` | Sí | `inventario` | `agregarItemConsignacionAction` (`consignaciones.crear`), `cancelarItemConsignacionAction` (`consignaciones.editar`), `registrarAjusteInventarioAction` (`inventario.editar`), `createProductoAction` (`inventario.crear`), `asignarTallesProductoAction` (`inventario.editar`), `transicionItemAction` (`inventario.editar`), `confirmarIngresoAction` (`inventario.crear`), `crearIngresoCompletoAction` (`inventario.crear`) | `inventario.ver`, `ventas.ver`, `consignaciones.ver`, `revendedoras.ver` | `consignaciones.crear`, `consignaciones.editar`, `inventario.editar`, `inventario.crear` |
| 20 | `regla_precio` | Sí | `precios` | `createReglaAction` (`precios.crear`), `bajaReglaAction` (`precios.eliminar`), `extenderVigenciaReglaAction` (`precios.editar`) | `precios.ver`, `inventario.crear` (aplica regla por defecto en alta) | `precios.crear`, `precios.eliminar`, `precios.editar` |
| 21 | `cotizacion_config` | Sí | `precios` | `actualizarCotizacionManualAction` (`precios.editar_cotizacion`), `cambiarModoCotizacionAction` (`precios.editar_cotizacion`), `sincronizarCotizacionBcraAction` (`precios.editar_cotizacion`), `revaluarCostosUsdAction` (`precios.editar_cotizacion`), `leerCotizacionVigenteAction` (`inventario.ver`) | `precios.ver`, `inventario.ver`, `reportes.ver` | `precios.editar_cotizacion`, `inventario.ver` |
| 22 | `cotizacion_dolar` | Sí | `precios` | `actualizarCotizacionManualAction` (`precios.editar_cotizacion`), `cambiarModoCotizacionAction` (`precios.editar_cotizacion`), `sincronizarCotizacionBcraAction` (`precios.editar_cotizacion`), `revaluarCostosUsdAction` (`precios.editar_cotizacion`), `leerCotizacionVigenteAction` (`inventario.ver`) | `precios.ver`, `inventario.ver`, `reportes.ver` | `precios.editar_cotizacion`, `inventario.ver` |
| 23 | `plan_cuotas` | Sí | `precios` | `crearPlanCuotasAction` (`precios.crear`), `setPlanCuotasActivoAction` (`precios.editar`) | `precios.ver`, `ventas.ver` (checkout cuotas) | `precios.crear`, `precios.editar` |
| 24 | `recargo_cuotas` | Sí | `precios` | `crearRecargoCuotasAction` (`precios.crear`), `actualizarRecargoCuotasAction` (`precios.editar`), `cerrarVigenciaRecargoAction` (`precios.editar`) | `precios.ver`, `ventas.ver` (checkout cuotas) | `precios.crear`, `precios.editar` |
| 25 | `cliente` | Sí | `ventas` | `crearClienteAction` (`ventas.crear`), `updateClienteAction` (`ventas.editar`), `toggleClienteActivoAction` (`ventas.editar`) | `ventas.ver`, `reportes.ver` (`rf_deudores_resumen`, `rf_cuentas_por_cobrar`) | `ventas.crear`, `ventas.editar` |
| 26 | `venta` | Sí | `ventas` | `registrarVentaAction` (`ventas.crear`), `anularVentaAction` (`ventas.editar`), `devolverItemVentaAction` (`ventas.editar`), `cambiarItemVentaAction` (`ventas.crear`), `cobrarCuotaAction` (`ventas.editar`), `marcarCuotaIncobrableAction` (`ventas.eliminar`), `generarRendicionAction` (`rendiciones.crear`), `previewLiquidacionAction` (`revendedoras.ver`), `generarLiquidacionAction` (`revendedoras.liquidar`) | `ventas.ver`, `rendiciones.crear`, `revendedoras.ver`, `revendedoras.liquidar`, `revendedoras.ver_propio`, `reportes.ver` | `ventas.crear`, `ventas.editar`, `ventas.eliminar`, `rendiciones.crear`, `revendedoras.ver`, `revendedoras.liquidar` |
| 27 | `detalle_venta` | Sí | `ventas` | `registrarVentaAction` (`ventas.crear`), `anularVentaAction` (`ventas.editar`), `devolverItemVentaAction` (`ventas.editar`), `cambiarItemVentaAction` (`ventas.crear`), `excluirDetalleAction` (`rendiciones.editar`), `reincluirDetalleAction` (`rendiciones.editar`), `generarRendicionAction` (`rendiciones.crear`), `previewLiquidacionAction` (`revendedoras.ver`), `generarLiquidacionAction` (`revendedoras.liquidar`), `excluirDetalleLiquidacionAction` (`revendedoras.liquidar`), `reincluirDetalleLiquidacionAction` (`revendedoras.liquidar`) | `ventas.ver`, `rendiciones.crear`, `revendedoras.ver`, `revendedoras.liquidar`, `reportes.ver` | `ventas.crear`, `ventas.editar`, `rendiciones.editar`, `rendiciones.crear`, `revendedoras.ver`, `revendedoras.liquidar` |
| 28 | `pago_venta` | Sí | `ventas` | `registrarVentaAction` (`ventas.crear`), `anularVentaAction` (`ventas.editar`), `devolverItemVentaAction` (`ventas.editar`), `cobrarCuotaAction` (`ventas.editar`) | `ventas.ver`, `reportes.ver` (caja, flujo, resultados) | `ventas.crear`, `ventas.editar` |
| 29 | `comprobante` | Sí | `ventas` | `emitirComprobanteAction` (`ventas.crear`) | `ventas.ver` | `ventas.crear` |
| 30 | `cuenta_destino` | Sí | `precios` | `registrarVentaAction` (`ventas.crear`), `cobrarCuotaAction` (`ventas.editar`), `crearCuentaDestinoAction` (`precios.crear`), `actualizarCuentaDestinoAction` (`precios.editar`), `marcarCuentaPredeterminadaAction` (`precios.editar`), `reincluirDetalleLiquidacionAction` (`revendedoras.liquidar`), `marcarLiquidacionPagadaAction` (`revendedoras.liquidar`) | `precios.ver`, `ventas.ver`, `revendedoras.ver`, `reportes.ver` | `ventas.crear`, `ventas.editar`, `precios.crear`, `precios.editar`, `revendedoras.liquidar` |
| 31 | `arancel_cobro` | Sí | `precios` | `crearCuentaDestinoAction` (`precios.crear`), `crearArancelCobroAction` (`precios.crear`), `actualizarArancelCobroAction` (`precios.editar`), `cerrarVigenciaArancelAction` (`precios.editar`) | `precios.ver`, `ventas.ver` | `precios.crear`, `precios.editar` |
| 32 | `cuota_financiada` | Sí | `ventas` | `registrarVentaAction` (`ventas.crear`), `anularVentaAction` (`ventas.editar`), `devolverItemVentaAction` (`ventas.editar`), `cambiarItemVentaAction` (`ventas.crear`), `cobrarCuotaAction` (`ventas.editar`), `marcarCuotaIncobrableAction` (`ventas.eliminar`) | `ventas.ver`, `reportes.ver` (`rf_deudores_resumen`, `rf_cuentas_por_cobrar`, `rf_alertas_cuotas_vencidas`) | `ventas.crear`, `ventas.editar`, `ventas.eliminar` |
| 33 | `devolucion_venta` | Sí | `ventas` | `devolverItemVentaAction` (`ventas.editar`), `cambiarItemVentaAction` (`ventas.crear`), `generarRendicionAction` (`rendiciones.crear`), `previewLiquidacionAction` (`revendedoras.ver`), `generarLiquidacionAction` (`revendedoras.liquidar`) | `ventas.ver`, `reportes.ver` (`rf_finanzas_resultados`) | `ventas.editar`, `ventas.crear`, `rendiciones.crear`, `revendedoras.ver`, `revendedoras.liquidar` |
| 34 | `reintegro_cliente` | Sí | `ventas` | `anularVentaAction` (`ventas.editar`), `devolverItemVentaAction` (`ventas.editar`) | `ventas.ver`, `reportes.ver` (`rf_finanzas_flujo`, `rf_reporte_caja`) | `ventas.editar` |
| 35 | `cambio_venta` | Sí | `ventas` | `devolverItemVentaAction` (`ventas.editar`), `cambiarItemVentaAction` (`ventas.crear`) | `ventas.ver`, `revendedoras.ver`, `revendedoras.ver_propio`, `reportes.ver` | `ventas.editar`, `ventas.crear` |
| 36 | `reserva` | Sí | `ventas` | `registrarVentaAction` (`ventas.crear`), `crearReservaAction` (`ventas.crear`), `cancelarReservaAction` (`ventas.editar`), `vencerReservasAction` (`ventas.editar`) | `ventas.ver` | `ventas.crear`, `ventas.editar` |
| 37 | `detalle_reserva` | Sí | `ventas` | `registrarVentaAction` (`ventas.crear`), `crearReservaAction` (`ventas.crear`), `cancelarReservaAction` (`ventas.editar`), `vencerReservasAction` (`ventas.editar`), `agregarItemConsignacionAction` (`consignaciones.crear`) | `ventas.ver` | `ventas.crear`, `ventas.editar`, `consignaciones.crear` |
| 38 | `consignacion` | Sí | `consignaciones` | `crearConsignacionAction` (`consignaciones.crear`), `editarConsignacionAction` (`consignaciones.editar`), `confirmarConsignacionAction` (`consignaciones.editar`), `eliminarConsignacionAction` (`consignaciones.eliminar`), `agregarItemConsignacionAction` (`consignaciones.crear`), `cerrarConsignacionAction` (`consignaciones.editar`) | `consignaciones.ver`, `rendiciones.ver`, `rendiciones.crear`, `reportes.ver` | `consignaciones.crear`, `consignaciones.editar`, `consignaciones.eliminar` |
| 39 | `consignacion_detalle` | Sí | `consignaciones` | `editarConsignacionAction` (`consignaciones.editar`), `confirmarConsignacionAction` (`consignaciones.editar`), `eliminarConsignacionAction` (`consignaciones.eliminar`), `agregarItemConsignacionAction` (`consignaciones.crear`), `cancelarItemConsignacionAction` (`consignaciones.editar`), `confirmarSalidaItemAction` (`consignaciones.editar`), `cerrarConsignacionAction` (`consignaciones.editar`) | `consignaciones.ver`, `rendiciones.crear`, `reportes.ver` | `consignaciones.editar`, `consignaciones.eliminar`, `consignaciones.crear` |
| 40 | `rendicion_proveedor` | Sí | `rendiciones` | `generarRendicionAction` (`rendiciones.crear`), `marcarRendicionPagadaAction` (`rendiciones.editar`) | `rendiciones.ver`, `reportes.ver` (`rf_finanzas_flujo`, `rf_finanzas_posicion`) | `rendiciones.crear`, `rendiciones.editar` |
| 41 | `categoria_gasto` | Sí | `gastos` | `setPresupuestoAction` (`gastos.editar`), `createCategoriaGastoAction` (`gastos.crear`), `renameCategoriaGastoAction` (`gastos.editar`), `bajaCategoriaGastoAction` (`gastos.editar`), `reactivarCategoriaGastoAction` (`gastos.editar`) | `gastos.ver`, `reportes.ver` | `gastos.editar`, `gastos.crear` |
| 42 | `gasto_negocio` | Sí | `gastos` | `registrarGastoAction` (`gastos.crear`), `eliminarGastoAction` (`gastos.editar`), `bajaCategoriaGastoAction` (`gastos.editar`) | `gastos.ver`, `reportes.ver` (resultados, flujo, caja, kpis) | `gastos.crear`, `gastos.editar` |
| 43 | `revendedora` | Sí | `revendedoras` | `registrarVentaAction` (`ventas.crear`), `crearRevendedoraUnificadaAction` (`revendedoras.crear`), `crearRevendedoraAction` (`revendedoras.crear`), `editarRevendedoraAction` (`revendedoras.editar`), `bajaRevendedoraAction` (`revendedoras.eliminar`), `darAccesoRevendedoraAction` (`revendedoras.editar`), `revocarAccesoRevendedoraAction` (`revendedoras.editar`), `crearReglaGeneralAction` (`revendedoras.editar`), `guardarComisionPropiaAction` (`revendedoras.editar`), `previewLiquidacionAction` (`revendedoras.ver`), `generarLiquidacionAction` (`revendedoras.liquidar`), `marcarLiquidacionPagadaAction` (`revendedoras.liquidar`), `devolverItemsRevendedoraAction` (`revendedoras.editar`) | `revendedoras.ver`, `ventas.ver` (checkout), `revendedoras.ver_propio` (portal), `reportes.ver` | `ventas.crear`, `revendedoras.crear`, `revendedoras.editar`, `revendedoras.eliminar`, `revendedoras.ver`, `revendedoras.liquidar` |
| 44 | `consignacion_revendedora` | Sí | `revendedoras` | `registrarVentaAction` (`ventas.crear`), `editarConsignacionRevendedoraAction` (`revendedoras.editar`), `confirmarConsignacionRevendedoraAction` (`revendedoras.crear`), `registrarDevolucionRevendedoraAction` (`revendedoras.editar`), `cerrarConsignacionRevendedoraAction` (`revendedoras.editar`), `eliminarConsignacionRevendedoraAction` (`revendedoras.eliminar`), `marcarLiquidacionPagadaAction` (`revendedoras.liquidar`), `devolverItemsRevendedoraAction` (`revendedoras.editar`) | `revendedoras.ver`, `revendedoras.ver_propio`, `reportes.ver` | `ventas.crear`, `revendedoras.editar`, `revendedoras.crear`, `revendedoras.eliminar`, `revendedoras.liquidar` |
| 45 | `consignacion_revendedora_detalle` | Sí | `revendedoras` | `registrarVentaAction` (`ventas.crear`), `anularVentaAction` (`ventas.editar`), `devolverItemVentaAction` (`ventas.editar`), `confirmarConsignacionRevendedoraAction` (`revendedoras.crear`), `registrarDevolucionRevendedoraAction` (`revendedoras.editar`), `cerrarConsignacionRevendedoraAction` (`revendedoras.editar`), `eliminarConsignacionRevendedoraAction` (`revendedoras.eliminar`), `marcarLiquidacionPagadaAction` (`revendedoras.liquidar`), `devolverItemsRevendedoraAction` (`revendedoras.editar`) | `revendedoras.ver`, `revendedoras.ver_propio`, `reportes.ver` | `ventas.crear`, `ventas.editar`, `revendedoras.crear`, `revendedoras.editar`, `revendedoras.eliminar`, `revendedoras.liquidar` |
| 46 | `regla_comision` | Sí | `revendedoras` | `crearRevendedoraUnificadaAction` (`revendedoras.crear`), `crearReglaGeneralAction` (`revendedoras.editar`), `guardarComisionPropiaAction` (`revendedoras.editar`), `terminarReglaAction` (`revendedoras.editar`) | `revendedoras.ver`, `ventas.ver` (preview/cálculo comisiones en checkout) | `revendedoras.crear`, `revendedoras.editar` |
| 47 | `escala_comision` | Sí | `revendedoras` | `crearRevendedoraUnificadaAction` (`revendedoras.crear`), `crearReglaGeneralAction` (`revendedoras.editar`), `guardarComisionPropiaAction` (`revendedoras.editar`) | `revendedoras.ver`, `ventas.ver` (preview comisiones por escala) | `revendedoras.crear`, `revendedoras.editar` |
| 48 | `liquidacion_revendedora` | Sí | `revendedoras` | `generarLiquidacionAction` (`revendedoras.liquidar`), `excluirDetalleLiquidacionAction` (`revendedoras.liquidar`), `reincluirDetalleLiquidacionAction` (`revendedoras.liquidar`), `marcarLiquidacionPagadaAction` (`revendedoras.liquidar`) | `revendedoras.ver`, `revendedoras.liquidar`, `revendedoras.ver_propio`, `reportes.ver` | `revendedoras.liquidar` |
| 49 | `pago_revendedora` | Sí | `revendedoras` | `reincluirDetalleLiquidacionAction` (`revendedoras.liquidar`), `marcarLiquidacionPagadaAction` (`revendedoras.liquidar`) | `revendedoras.ver`, `revendedoras.liquidar`, `reportes.ver` (flujo y posición) | `revendedoras.liquidar` |
| 50 | `declaracion_venta_revendedora` | Sí | `revendedoras` | `declararVentaAction` (`revendedoras.declarar`), `retirarDeclaracionAction` (`revendedoras.declarar`), `confirmarDeclaracionAction` (`revendedoras.crear`), `rechazarDeclaracionAction` (`revendedoras.crear`) | `revendedoras.ver`, `revendedoras.editar`, `revendedoras.declarar` | `revendedoras.declarar`, `revendedoras.crear` |
| 51 | `consulta_ayuda` | Sí | `ayuda` | `consultarAyudaAction` (`ayuda.consultar`), `calificarConsultaAyudaAction` (`ayuda.consultar`) | `ayuda.consultar` | `ayuda.consultar` |

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

| Tabla Compartida | Columna Sensible | Tipo / Definición | Módulo Dueño | Riesgo de Exposición |
|---|---|---|---|---|
| `detalle_venta` | `costo_snapshot` | `numeric(14,2)` ([`00021:39`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00021_venta.sql#L39)) | `inventario` / `precios` | Vendedor sin permiso de costos ve el costo exacto del producto vendido |
| `detalle_venta` | `monto_ganancia` | `numeric(14,2)` ([`00021:40`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00021_venta.sql#L40)) | `reportes` | Vendedor ve el margen neto ganado por la tienda en cada ítem |
| `item_producto` | `costo_ingreso` | `numeric(14,2)` ([`00015:17`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00015_item_producto.sql#L17)) | `inventario` | Vendedor o cajero al escanear/buscar stock ve el costo unitario de compra |
| `pago_venta` | `costo_cobro` | `numeric(14,2)` ([`00057:132`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00057_costo_cobro.sql#L132)) | `precios` / `reportes` | Revela el arancel o retención bancaria/posnet pagada |
| `pago_venta` | `desglose_costo` | `jsonb` ([`00057:136`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00057_costo_cobro.sql#L136)) | `precios` / `reportes` | Desglose de retenciones fiscales (IVA, Ganancias, IIBB) |
| `devolucion_venta` | `costo_recuperado` | `numeric(14,2)` ([`00070:31`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00070_reintegro_y_devolucion.sql#L31)) | `inventario` | Revela el costo contable del stock devuelto |
| `venta` | `monto_comision` | `numeric(14,2)` ([`00088:62`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00088_venta_canal.sql#L62)) | `revendedoras` | Comisión de revendedora en ventas compartidas |
| `consignacion_revendedora_detalle` | `comision_porcentaje_snapshot` | `numeric(5,2)` ([`00086:79`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00086_comisiones.sql#L79)) | `revendedoras` | Porcentaje de comisión acordado |
| `arancel_cobro` | `arancel_pct`, `iva_arancel_pct`, `ret_*` | `numeric(6,3)` ([`00057:13-63`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00057_costo_cobro.sql#L13)) | `precios` | Información financiera de costos de intermediación de pagos |
| `regla_precio` | `margen_porcentaje` | `numeric(5,2)` ([`00017:32`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00017_precios_enums_regla.sql#L32)) | `precios` | Política de márgenes y recargos comerciales de la empresa |

---

## 5. Observaciones fuera de alcance (Closed Scope)

Las siguientes anomalías o deudas técnicas fueron observadas durante el inventario y quedan registradas sin modificar código:
1. **Acciones de `gastos` cohabitando en archivo ajeno**: Las Server Actions de gastos residen en [`app/(app)/rendiciones/actions.ts:125, 147, 168, 192`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/rendiciones/actions.ts#L125). Aunque están correctamente protegidas por `guardedModulo('gastos', accion)`, genera confusión respecto a la estructura de carpetas.
2. **Acciones de `proveedores` divididas**: La acción `createProveedorAction` reside en [`app/(app)/inventario/actions.ts:226`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/inventario/actions.ts#L226), mientras que `setProveedorActivoAction` reside en [`app/(app)/proveedores/actions.ts:18`](file:///c:/Archivos%20de%20trabajo/evoralStock/app/(app)/proveedores/actions.ts#L18). Ambas exigen permiso `inventario`.
3. **Ausencia de trigger de protección en rol `Administrador`**: El rol `Revendedora` tiene un trigger en DB que impide renombrarlo o eliminarlo ([`00079:34`](file:///c:/Archivos%20de%20trabajo/evoralStock/supabase/migrations/00079_rol_revendedora.sql#L34)), pero `Administrador` no posee protección similar a nivel de schema Postgres (solo la validación en `sp_delete_rol` de no tener usuarios).
4. **Vistas sin RLS granular**: Vistas como `v_linea_venta` tienen `security_invoker = true`, lo que hereda las políticas de `venta` y `detalle_venta`. Al aplicar RLS por permisos, los usuarios sin `reportes` o `ventas` no podrán consultar la vista.

---

## 6. Método de verificación

Para erradicar citas aproximadas o permisos incorrectos, se aplicó un método mecánico estricto sin ejecución de base de datos (`gate:db` omitido por restricción de solo lectura):

1. **Búsqueda mecánica de acciones y compuertas**:
   Se ejecutó `rg -n "export async function \w+Action|await guarded\w*\(|requireModuleRole\(" app` y su salida textual completa fue fijada como Apéndice A sin resumir ni editar.
2. **Extracción unívoca de permisos**:
   Para cada acción del Apéndice A, el permiso (`módulo.acción`) se obtuvo de la línea de guardia inmediata siguiente. Para acciones con wrapper (`guarded`, `guardedGastos`, `guardedModulo`), el módulo se resolvió a partir de la definición del wrapper en ese mismo archivo fuente.
3. **Trazabilidad hacia tablas vía DAL y SPs**:
   Cada Server Action fue trazada hacia las funciones DAL invocadas en su cuerpo, y desde la DAL hasta las llamadas `.from('<tabla>')` o `.rpc('<sp>')`. Para cada stored procedure invocado, las tablas afectadas se determinaron examinando la última definición vigente (`pnpm sp:last <nombre>`) en `supabase/migrations/`.
4. **Criterio de no verificación**:
   Cualquier tabla que no pudo ser vinculada directamente a través de llamadas `.from` o `.rpc` en el código de aplicación fue clasificada estrictamente como "no verificado" (1 fila: `producto_sku_seq`, secuencia interna actualizada dentro de `sp_gen_sku` sin endpoint directo ni llamada RPC en DAL).

---

## Apéndice A: Evidencia mecánica de Server Actions y compuertas de autorización

```text
app\api\ventas\stock-disponible\route.ts:28:    await requireModuleRole(session, 'ventas', 'ver')
app\api\consignaciones\lookup-item\route.ts:26:    await requireModuleRole(session, 'consignaciones', 'ver')
app\api\ventas\lookup-item\route.ts:58:    await requireModuleRole(session, 'ventas', 'ver')
app\api\ventas\export\route.ts:32:    await requireModuleRole(session, 'ventas', 'ver')
app\api\revendedoras\lookup-item\route.ts:16:    await requireModuleRole(session, 'revendedoras', 'ver')
app\api\consignaciones\items-elegibles\route.ts:23:    await requireModuleRole(session, 'consignaciones', 'ver')
app\api\ventas\descuentos-disponibles\route.ts:23:    await requireModuleRole(session, 'ventas', 'ver')
app\(app)\actions.ts:14:export async function logoutAction(): Promise<void> {
app\(auth)\settings\password-actions.ts:28:export async function changePasswordAction(
app\(app)\administracion\actions.ts:44:    await requireModuleRole(session, 'administracion', accion)
app\(app)\administracion\actions.ts:52:export async function toggleUsuarioEstadoAction(input: {
app\(app)\administracion\actions.ts:56:  const g = await guarded('editar')
app\(app)\administracion\actions.ts:67:export async function invitarUsuarioAction(input: {
app\(app)\administracion\actions.ts:73:  const g = await guarded('crear')
app\(app)\administracion\actions.ts:97:export async function asignarRolAction(input: {
app\(app)\administracion\actions.ts:102:  const g = await guarded('editar')
app\(app)\administracion\actions.ts:113:export async function createRolAction(input: {
app\(app)\administracion\actions.ts:117:  const g = await guarded('crear')
app\(app)\administracion\actions.ts:137:export async function updateRolAction(input: {
app\(app)\administracion\actions.ts:142:  const g = await guarded('editar')
app\(app)\administracion\actions.ts:181:export async function deleteRolAction(input: { idRol: string }): Promise<ActionResult> {
app\(app)\administracion\actions.ts:182:  const g = await guarded('eliminar')
app\(app)\administracion\actions.ts:197:export async function updateConfiguracionQrAction(
app\(app)\administracion\actions.ts:200:  const g = await guarded('editar')
app\(app)\administracion\actions.ts:216:export async function updateConfiguracionImpresoraAction(raw: unknown): Promise<ActionResult> {
app\(app)\administracion\actions.ts:217:  const g = await guarded('editar')
app\(app)\administracion\actions.ts:233:export async function updateTenantLogoAction(
app\(app)\administracion\actions.ts:236:  const g = await guarded('editar')
app\(app)\administracion\actions.ts:254:export async function quitarTenantLogoAction(): Promise<ActionResult> {
app\(app)\administracion\actions.ts:255:  const g = await guarded('editar')
app\(app)\administracion\actions.ts:267:export async function cambiarMiPasswordAction(
app\(app)\administracion\actions.ts:270:  const g = await guarded('ver')
app\(app)\clientes\layout.tsx:15:    await requireModuleRole(session, 'ventas', 'ver')
app\(app)\ayuda\actions.ts:36:export async function consultarAyudaAction(
app\(app)\ayuda\actions.ts:41:    await requireModuleRole(session, 'ayuda', 'consultar')
app\(app)\ayuda\actions.ts:118:export async function calificarConsultaAyudaAction(
app\(app)\ayuda\actions.ts:123:    await requireModuleRole(session, 'ayuda', 'consultar')
app\(auth)\login\actions.ts:26:export async function loginAction(
app\(app)\administracion\layout.tsx:17:    await requireModuleRole(session, 'administracion', 'ver')
app\(plataforma)\plataforma\actions.ts:27:export async function registrarCargoTenantAction(
app\(plataforma)\plataforma\actions.ts:63:export async function registrarPagoTenantAction(
app\(plataforma)\plataforma\actions.ts:96:export async function anularMovimientoTenantAction(
app\(plataforma)\plataforma\actions.ts:129:export async function togglePaqueteTenantAction(
app\(plataforma)\plataforma\actions.ts:163:export async function altaTenantAction(
app\(plataforma)\plataforma\actions.ts:195:export async function cambiarEstadoTenantAction(
app\(revendedora)\mi-cuenta\layout.tsx:58:    await requireModuleRole(session, 'revendedoras', 'ver_propio')
app\(revendedora)\mi-cuenta\actions.ts:13:export async function declararVentaAction(input: unknown) {
app\(revendedora)\mi-cuenta\actions.ts:19:    await requireModuleRole(session, 'revendedoras', 'declarar')
app\(revendedora)\mi-cuenta\actions.ts:42:export async function retirarDeclaracionAction(input: unknown) {
app\(revendedora)\mi-cuenta\actions.ts:48:    await requireModuleRole(session, 'revendedoras', 'declarar')
app\(app)\administracion\usuarios\actions.ts:8:export async function restablecerClaveAction(input: unknown) {
app\(app)\administracion\usuarios\actions.ts:11:    await requireModuleRole(session, 'administracion', 'editar')
app\(app)\layout.tsx:22: * Per-module authorization (`requireModuleRole(session, 'inventario', 'ver')`)
app\(app)\ventas\layout.tsx:13:    await requireModuleRole(session, 'ventas', 'ver')
app\(app)\cuotas\layout.tsx:17:    await requireModuleRole(session, 'ventas', 'ver')
app\(app)\rendiciones\layout.tsx:13:    await requireModuleRole(session, 'rendiciones', 'ver')
app\(app)\ventas\actions.ts:50:    await requireModuleRole(session, modulo, accion)
app\(app)\ventas\actions.ts:60:export async function registrarVentaAction(
app\(app)\ventas\actions.ts:63:  const gVentas = await guarded('ventas', 'crear')
app\(app)\ventas\actions.ts:73:    const gRev = await guarded('revendedoras', 'crear')
app\(app)\ventas\actions.ts:116:export async function anularVentaAction(input: {
app\(app)\ventas\actions.ts:120:  const g = await guarded('ventas', 'editar')
app\(app)\ventas\actions.ts:140:export async function devolverItemVentaAction(input: {
app\(app)\ventas\actions.ts:147:  const g = await guarded('ventas', 'editar')
app\(app)\ventas\actions.ts:167:export async function cambiarItemVentaAction(
app\(app)\ventas\actions.ts:170:  const gVentas = await guarded('ventas', 'crear')
app\(app)\ventas\actions.ts:177:    const gRev = await guarded('revendedoras', 'crear')
app\(app)\ventas\actions.ts:205:export async function emitirComprobanteAction(input: {
app\(app)\ventas\actions.ts:210:  const g = await guarded('ventas', 'crear')
app\(app)\ventas\actions.ts:227:export async function crearReservaAction(input: {
app\(app)\ventas\actions.ts:233:  const g = await guarded('ventas', 'crear')
app\(app)\ventas\actions.ts:250:export async function cancelarReservaAction(input: {
app\(app)\ventas\actions.ts:254:  const g = await guarded('ventas', 'editar')
app\(app)\ventas\actions.ts:266:export async function vencerReservasAction(): Promise<ActionResult<{ vencidas: number }>> {
app\(app)\ventas\actions.ts:267:  const g = await guarded('ventas', 'editar')
app\(app)\ventas\actions.ts:290:export async function crearClienteAction(input: {
app\(app)\ventas\actions.ts:297:  const g = await guarded('ventas', 'crear')
app\(app)\ventas\actions.ts:317:export async function updateClienteAction(input: {
app\(app)\ventas\actions.ts:327:  const g = await guarded('ventas', 'editar')
app\(app)\ventas\actions.ts:339:export async function toggleClienteActivoAction(input: {
app\(app)\ventas\actions.ts:343:  const g = await guarded('ventas', 'editar')
app\(app)\ventas\actions.ts:360:export async function cobrarCuotaAction(input: {
app\(app)\ventas\actions.ts:367:  const g = await guarded('ventas', 'editar')
app\(app)\ventas\actions.ts:399:export async function marcarCuotaIncobrableAction(input: {
app\(app)\ventas\actions.ts:403:  const g = await guarded('ventas', 'eliminar')
app\(app)\rendiciones\actions.ts:31:    await requireModuleRole(session, modulo, accion)
app\(app)\rendiciones\actions.ts:48:export async function excluirDetalleAction(input: {
app\(app)\rendiciones\actions.ts:52:  const g = await guarded('editar')
app\(app)\rendiciones\actions.ts:63:export async function reincluirDetalleAction(input: {
app\(app)\rendiciones\actions.ts:66:  const g = await guarded('editar')
app\(app)\rendiciones\actions.ts:77:export async function generarRendicionAction(input: {
app\(app)\rendiciones\actions.ts:81:  const g = await guarded('crear')
app\(app)\rendiciones\actions.ts:96:export async function marcarRendicionPagadaAction(input: {
app\(app)\rendiciones\actions.ts:100:  const g = await guarded('editar')
app\(app)\rendiciones\actions.ts:117:export async function registrarGastoAction(input: {
app\(app)\rendiciones\actions.ts:125:  const g = await guardedGastos('crear')
app\(app)\rendiciones\actions.ts:148:export async function eliminarGastoAction(input: {
app\(app)\rendiciones\actions.ts:151:  const g = await guardedGastos('editar')
app\(app)\rendiciones\actions.ts:163:export async function setPresupuestoAction(input: {
app\(app)\rendiciones\actions.ts:167:  const g = await guardedGastos('editar')
app\(app)\rendiciones\actions.ts:179:export async function createCategoriaGastoAction(input: {
app\(app)\rendiciones\actions.ts:182:  const g = await guardedGastos('crear')
app\(app)\rendiciones\actions.ts:197:export async function renameCategoriaGastoAction(input: {
app\(app)\rendiciones\actions.ts:201:  const g = await guardedGastos('editar')
app\(app)\rendiciones\actions.ts:215:export async function bajaCategoriaGastoAction(input: {
app\(app)\rendiciones\actions.ts:218:  const g = await guardedGastos('editar')
app\(app)\rendiciones\actions.ts:231:export async function reactivarCategoriaGastoAction(input: {
app\(app)\rendiciones\actions.ts:234:  const g = await guardedGastos('editar')
app\(app)\gastos\layout.tsx:15:    await requireModuleRole(session, 'gastos', 'ver')
app\(app)\precios\actions.ts:58:    await requireModuleRole(session, 'precios', accion)
app\(app)\precios\actions.ts:68:export async function createReglaAction(input: {
app\(app)\precios\actions.ts:83:  const g = await guarded('crear')
app\(app)\precios\actions.ts:96:export async function bajaReglaAction(idRegla: string): Promise<ActionResult> {
app\(app)\precios\actions.ts:97:  const g = await guarded('eliminar')
app\(app)\precios\actions.ts:109:export async function extenderVigenciaReglaAction(input: {
app\(app)\precios\actions.ts:113:  const g = await guarded('editar')
app\(app)\precios\actions.ts:140:export async function crearPlanCuotasAction(cuotas: number): Promise<PlanesResult> {
app\(app)\precios\actions.ts:141:  const g = await guarded('crear')
app\(app)\precios\actions.ts:155:export async function setPlanCuotasActivoAction(
app\(app)\precios\actions.ts:159:  const g = await guarded('editar')
app\(app)\precios\actions.ts:172:export async function recalcularPrecioAction(
app\(app)\precios\actions.ts:175:  const g = await guarded('editar')
app\(app)\precios\actions.ts:187:export async function recalcularBatchAction(
app\(app)\precios\actions.ts:190:  const g = await guarded('editar')
app\(app)\precios\actions.ts:218:export async function crearCuentaDestinoAction(input: {
app\(app)\precios\actions.ts:236:  const g = await guarded('crear')
app\(app)\precios\actions.ts:289:export async function actualizarCuentaDestinoAction(input: {
app\(app)\precios\actions.ts:303:  const g = await guarded('editar')
app\(app)\precios\actions.ts:332:export async function crearArancelCobroAction(input: {
app\(app)\precios\actions.ts:341:  const g = await guarded('crear')
app\(app)\precios\actions.ts:373:export async function actualizarArancelCobroAction(input: {
app\(app)\precios\actions.ts:382:  const g = await guarded('editar')
app\(app)\precios\actions.ts:406:export async function cerrarVigenciaArancelAction(input: {
app\(app)\precios\actions.ts:410:  const g = await guarded('editar')
app\(app)\precios\actions.ts:424:export async function marcarCuentaPredeterminadaAction(input: {
app\(app)\precios\actions.ts:427:  const g = await guarded('editar')
app\(app)\precios\actions.ts:444:export async function crearRecargoCuotasAction(input: {
app\(app)\precios\actions.ts:453:  const g = await guarded('crear')
app\(app)\precios\actions.ts:490:export async function actualizarRecargoCuotasAction(input: {
app\(app)\precios\actions.ts:496:  const g = await guarded('editar')
app\(app)\precios\actions.ts:517:export async function cerrarVigenciaRecargoAction(input: {
app\(app)\precios\actions.ts:521:  const g = await guarded('editar')
app\(app)\reportes\layout.tsx:13:    await requireModuleRole(session, 'reportes', 'ver')
app\(app)\revendedoras\actions.ts:13:export async function crearRevendedoraUnificadaAction(input: unknown) {
app\(app)\revendedoras\actions.ts:16:    await requireModuleRole(session, 'revendedoras', 'crear')
app\(app)\revendedoras\actions.ts:35:      await requireModuleRole(session, 'administracion', 'crear')
app\(app)\revendedoras\actions.ts:36:      await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\revendedoras\actions.ts:47:      await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\revendedoras\actions.ts:98:export async function crearRevendedoraAction(formData: unknown) {
app\(app)\revendedoras\actions.ts:101:    await requireModuleRole(session, 'revendedoras', 'crear')
app\(app)\revendedoras\actions.ts:122:export async function editarRevendedoraAction(id: string, formData: unknown) {
app\(app)\revendedoras\actions.ts:125:    await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\revendedoras\actions.ts:147:export async function bajaRevendedoraAction(id: string) {
app\(app)\revendedoras\actions.ts:150:    await requireModuleRole(session, 'revendedoras', 'eliminar')
app\(app)\revendedoras\actions.ts:172:export async function darAccesoRevendedoraAction(input: unknown) {
app\(app)\revendedoras\actions.ts:175:    await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\revendedoras\actions.ts:176:    await requireModuleRole(session, 'administracion', 'crear')
app\(app)\revendedoras\actions.ts:204:export async function revocarAccesoRevendedoraAction(id: unknown) {
app\(app)\revendedoras\actions.ts:207:    await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\revendedoras\actions.ts:208:    await requireModuleRole(session, 'administracion', 'eliminar')
app\(app)\precios\layout.tsx:13:    await requireModuleRole(session, 'precios', 'ver')
app\(app)\inventario\layout.tsx:20:    await requireModuleRole(session, 'inventario', 'ver')
app\(app)\revendedoras\declaraciones\page.tsx:27:  await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\revendedoras\declaraciones\actions.ts:13:export async function confirmarDeclaracionAction(input: unknown) {
app\(app)\revendedoras\declaraciones\actions.ts:19:    await requireModuleRole(session, 'revendedoras', 'crear')
app\(app)\revendedoras\declaraciones\actions.ts:41:export async function rechazarDeclaracionAction(input: unknown) {
app\(app)\revendedoras\declaraciones\actions.ts:47:    await requireModuleRole(session, 'revendedoras', 'crear')
app\(app)\revendedoras\comisiones\page.tsx:13:  await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\revendedoras\comisiones\actions.ts:17:export async function crearReglaGeneralAction(input: unknown) {
app\(app)\revendedoras\comisiones\actions.ts:21:    await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\revendedoras\comisiones\actions.ts:43:export async function guardarComisionPropiaAction(input: unknown) {
app\(app)\revendedoras\comisiones\actions.ts:47:    await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\revendedoras\comisiones\actions.ts:68:export async function terminarReglaAction(input: unknown) {
app\(app)\revendedoras\comisiones\actions.ts:72:    await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\consignaciones\actions.ts:27:    await requireModuleRole(session, 'consignaciones', accion)
app\(app)\consignaciones\actions.ts:40:export async function crearConsignacionAction(input: {
app\(app)\consignaciones\actions.ts:46:  const g = await guarded('crear')
app\(app)\consignaciones\actions.ts:65:export async function editarConsignacionAction(input: {
app\(app)\consignaciones\actions.ts:70:  const g = await guarded('editar')
app\(app)\consignaciones\actions.ts:83:export async function confirmarConsignacionAction(input: {
app\(app)\consignaciones\actions.ts:86:  const g = await guarded('editar')
app\(app)\consignaciones\actions.ts:104:export async function eliminarConsignacionAction(input: {
app\(app)\consignaciones\actions.ts:107:  const g = await guarded('eliminar')
app\(app)\consignaciones\actions.ts:120:export async function agregarItemConsignacionAction(input: {
app\(app)\consignaciones\actions.ts:125:  const g = await guarded('crear')
app\(app)\consignaciones\actions.ts:140:export async function cancelarItemConsignacionAction(input: {
app\(app)\consignaciones\actions.ts:145:  const g = await guarded('editar')
app\(app)\consignaciones\actions.ts:156:export async function confirmarSalidaItemAction(input: {
app\(app)\consignaciones\actions.ts:160:  const g = await guarded('editar')
app\(app)\consignaciones\actions.ts:173:export async function cerrarConsignacionAction(input: {
app\(app)\consignaciones\actions.ts:176:  const g = await guarded('editar')
app\(app)\consignaciones\actions.ts:192:export async function registrarAjusteInventarioAction(input: {
app\(app)\consignaciones\actions.ts:201:    await requireModuleRole(session, 'inventario', 'editar')
app\(app)\revendedoras\nuevo\page.tsx:14:  await requireModuleRole(session, 'revendedoras', 'crear')
app\(app)\consignaciones\layout.tsx:13:    await requireModuleRole(session, 'consignaciones', 'ver')
app\(app)\revendedoras\layout.tsx:13:    await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\proveedores\layout.tsx:15:    await requireModuleRole(session, 'inventario', 'ver')
app\(app)\revendedoras\[id]\cuenta\page.tsx:17:  await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\revendedoras\[id]\ventas\page.tsx:16:  await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\proveedores\actions.ts:18:export async function setProveedorActivoAction(input: {
app\(app)\proveedores\actions.ts:24:    await requireModuleRole(session, 'inventario', 'editar')
app\(app)\revendedoras\[id]\devolucion\page.tsx:16:  await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\revendedoras\[id]\devolucion\actions.ts:9:export async function devolverItemsRevendedoraAction(input: unknown) {
app\(app)\revendedoras\[id]\devolucion\actions.ts:12:    await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\inventario\actions.ts:78:    await requireModuleRole(session, 'inventario', accion)
app\(app)\inventario\actions.ts:162:export async function createCategoriaAction(input: {
app\(app)\inventario\actions.ts:167:  const g = await guarded('crear')
app\(app)\inventario\actions.ts:185:export async function updateCategoriaAction(
app\(app)\inventario\actions.ts:193:  const g = await guarded('editar')
app\(app)\inventario\actions.ts:209:export async function toggleCategoriaActivaAction(input: {
app\(app)\inventario\actions.ts:213:  const g = await guarded('editar')
app\(app)\inventario\actions.ts:226:export async function createProveedorAction(input: {
app\(app)\inventario\actions.ts:235:  const g = await guarded('crear')
app\(app)\inventario\actions.ts:266:export async function updateProveedorAction(
app\(app)\inventario\actions.ts:279:  const g = await guarded('editar')
app\(app)\inventario\actions.ts:322:export async function createProductoAction(input: {
app\(app)\inventario\actions.ts:338:  const g = await guarded('crear')
app\(app)\inventario\actions.ts:427:export async function updateProductoAction(
app\(app)\inventario\actions.ts:438:  const g = await guarded('editar')
app\(app)\inventario\actions.ts:455:export async function asignarTallesProductoAction(input: {
app\(app)\inventario\actions.ts:459:  const g = await guarded('editar')
app\(app)\inventario\actions.ts:471:export async function setCostoProductoAction(input: {
app\(app)\inventario\actions.ts:477:  const g = await guarded('editar')
app\(app)\inventario\actions.ts:495:export async function transicionItemAction(input: {
app\(app)\inventario\actions.ts:510:  const g = await guarded('editar')
app\(app)\inventario\actions.ts:539:export async function removeIngresoDetalleAction(input: {
app\(app)\inventario\actions.ts:543:  const g = await guarded('editar')
app\(app)\inventario\actions.ts:558:export async function cancelarIngresoAction(input: {
app\(app)\inventario\actions.ts:562:  const g = await guarded('eliminar')
app\(app)\inventario\actions.ts:581:export async function confirmarIngresoAction(input: {
app\(app)\inventario\actions.ts:584:  const g = await guarded('crear')
app\(app)\inventario\actions.ts:603:export async function parseRemitoPdfAction(
app\(app)\inventario\actions.ts:606:  const g = await guarded('crear')
app\(app)\inventario\actions.ts:729:export async function importarRemitoAction(input: {
app\(app)\inventario\actions.ts:734:  const g = await guarded('crear')
app\(app)\inventario\actions.ts:778:export async function crearIngresoCompletoAction(input: {
app\(app)\inventario\actions.ts:786:  const g = await guarded('crear')
app\(app)\inventario\actions.ts:875:export async function leerCotizacionVigenteAction(): Promise<
app\(app)\inventario\actions.ts:878:  const g = await guarded('ver')
app\(app)\revendedoras\[id]\consignaciones\actions.test.ts:48:    it('pasa por las 3 puertas: requireModuleRole(crear) -> safeParse -> DAL', async () => {
app\(app)\revendedoras\[id]\declaraciones\page.tsx:19:  await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\revendedoras\[id]\consignaciones\actions.ts:16:export async function crearConsignacionRevendedoraAction(input: unknown) {
app\(app)\revendedoras\[id]\consignaciones\actions.ts:19:    await requireModuleRole(session, 'revendedoras', 'crear')
app\(app)\revendedoras\[id]\consignaciones\actions.ts:40:export async function editarConsignacionRevendedoraAction(idRevendedora: string, input: unknown) {
app\(app)\revendedoras\[id]\consignaciones\actions.ts:43:    await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\revendedoras\[id]\consignaciones\actions.ts:64:export async function confirmarConsignacionRevendedoraAction(idRevendedora: string, input: unknown) {
app\(app)\revendedoras\[id]\consignaciones\actions.ts:67:    await requireModuleRole(session, 'revendedoras', 'crear')
app\(app)\revendedoras\[id]\consignaciones\actions.ts:89:export async function registrarDevolucionRevendedoraAction(idRevendedora: string, input: unknown) {
app\(app)\revendedoras\[id]\consignaciones\actions.ts:92:    await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\revendedoras\[id]\consignaciones\actions.ts:114:export async function cerrarConsignacionRevendedoraAction(idRevendedora: string, input: unknown) {
app\(app)\revendedoras\[id]\consignaciones\actions.ts:117:    await requireModuleRole(session, 'revendedoras', 'editar')
app\(app)\revendedoras\[id]\consignaciones\actions.ts:138:export async function eliminarConsignacionRevendedoraAction(idRevendedora: string, input: unknown) {
app\(app)\revendedoras\[id]\consignaciones\actions.ts:141:    await requireModuleRole(session, 'revendedoras', 'eliminar')
app\(app)\revendedoras\[id]\en-poder\page.tsx:21:  await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\revendedoras\[id]\liquidaciones\actions.ts:15:export async function previewLiquidacionAction(input: unknown) {
app\(app)\revendedoras\[id]\liquidaciones\actions.ts:18:    await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\revendedoras\[id]\liquidaciones\actions.ts:33:export async function generarLiquidacionAction(input: unknown) {
app\(app)\revendedoras\[id]\liquidaciones\actions.ts:36:    await requireModuleRole(session, 'revendedoras', 'liquidar')
app\(app)\revendedoras\[id]\liquidaciones\actions.ts:57:export async function excluirDetalleLiquidacionAction(input: unknown) {
app\(app)\revendedoras\[id]\liquidaciones\actions.ts:60:    await requireModuleRole(session, 'revendedoras', 'liquidar')
app\(app)\revendedoras\[id]\liquidaciones\actions.ts:75:export async function reincluirDetalleLiquidacionAction(input: unknown) {
app\(app)\revendedoras\[id]\liquidaciones\actions.ts:78:    await requireModuleRole(session, 'revendedoras', 'liquidar')
app\(app)\revendedoras\[id]\liquidaciones\actions.ts:93:export async function marcarLiquidacionPagadaAction(input: unknown) {
app\(app)\revendedoras\[id]\liquidaciones\actions.ts:96:    await requireModuleRole(session, 'revendedoras', 'liquidar')
app\(app)\revendedoras\[id]\consignaciones\page.tsx:16:  await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\revendedoras\[id]\liquidaciones\page.tsx:16:  await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\revendedoras\[id]\consignaciones\[idConsignacion]\page.tsx:12:  await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\revendedoras\[id]\consignaciones\nueva\page.tsx:14:  await requireModuleRole(session, 'revendedoras', 'crear')
app\(app)\revendedoras\[id]\liquidaciones\nueva\page.tsx:14:  await requireModuleRole(session, 'revendedoras', 'liquidar')
app\(app)\revendedoras\[id]\liquidaciones\[idLiquidacion]\page.tsx:16:  await requireModuleRole(session, 'revendedoras', 'ver')
app\(app)\precios\cotizacion\actions.ts:27: * 3 compuertas: requireModuleRole('precios', 'editar_cotizacion') -> Zod -> DAL.
app\(app)\precios\cotizacion\actions.ts:29:export async function actualizarCotizacionManualAction(
app\(app)\precios\cotizacion\actions.ts:35:    await requireModuleRole(session, 'precios', 'editar_cotizacion')
app\(app)\precios\cotizacion\actions.ts:61: * 3 compuertas: requireModuleRole('precios', 'editar_cotizacion') -> Zod -> DAL.
app\(app)\precios\cotizacion\actions.ts:63:export async function cambiarModoCotizacionAction(
app\(app)\precios\cotizacion\actions.ts:69:    await requireModuleRole(session, 'precios', 'editar_cotizacion')
app\(app)\precios\cotizacion\actions.ts:95: * 3 compuertas: requireModuleRole('precios', 'editar_cotizacion') -> Zod -> DAL.
app\(app)\precios\cotizacion\actions.ts:97:export async function sincronizarCotizacionBcraAction(
app\(app)\precios\cotizacion\actions.ts:103:    await requireModuleRole(session, 'precios', 'editar_cotizacion')
app\(app)\precios\cotizacion\actions.ts:130: * 3 compuertas: requireModuleRole('precios', 'editar_cotizacion') -> Zod -> DAL.
app\(app)\precios\cotizacion\actions.ts:133:export async function revaluarCostosUsdAction(
app\(app)\precios\cotizacion\actions.ts:139:    await requireModuleRole(session, 'precios', 'editar_cotizacion')
```
