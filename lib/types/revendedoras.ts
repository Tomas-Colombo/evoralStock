export interface RevendedoraRow {
  id_revendedora: string
  id_tenant: string
  id_usuario: string | null
  nombre: string
  apellido: string
  telefono: string | null
  email: string | null
  notas: string | null
  fecha_alta: string
  activo: boolean
  created_at: string
  updated_at: string
}

export type EstadoConsignacionRevendedora = 'abierta' | 'cerrada'

export type EstadoConsignacionRevendedoraDetalle =
  | 'pendiente'
  | 'en_poder'
  | 'vendido'
  | 'devuelto'
  | 'baja'

export interface ConsignacionRevendedoraRow {
  id_consignacion_revendedora: string
  id_tenant: string
  id_revendedora: string
  id_usuario_alta: string | null
  periodo_desde: string | null
  periodo_hasta: string | null
  estado: EstadoConsignacionRevendedora
  confirmada: boolean
  fecha_confirmacion: string | null
  fecha_cierre: string | null
  observaciones: string | null
  created_at: string
  updated_at: string
}

export interface ConsignacionRevendedoraDetalleRow {
  id_consignacion_revendedora_detalle: string
  id_tenant: string
  id_consignacion_revendedora: string
  id_item: string
  id_producto: string
  estado_detalle: EstadoConsignacionRevendedoraDetalle
  fecha_entrega: string | null
  fecha_devolucion: string | null
  motivo: string | null
  created_at: string
}

export interface ConsignacionRevendedoraItemDetalle {
  id_consignacion_revendedora_detalle: string
  id_item: string
  id_producto: string
  codigo_barra: string | null
  sku: string
  nombre_producto: string
  talle: string | null
  precio_actual: number
  estado_detalle: EstadoConsignacionRevendedoraDetalle
  fecha_entrega: string | null
  fecha_devolucion: string | null
  motivo: string | null
  created_at: string
}

export interface ConsignacionRevendedoraConDetalle extends ConsignacionRevendedoraRow {
  revendedora: {
    nombre: string
    apellido: string
    telefono: string | null
    email: string | null
  }
  detalles: ConsignacionRevendedoraItemDetalle[]
}

export interface ConsignacionRevendedoraListItem {
  id_consignacion_revendedora: string
  id_revendedora: string
  estado: EstadoConsignacionRevendedora
  confirmada: boolean
  fecha_confirmacion: string | null
  fecha_cierre: string | null
  periodo_desde: string | null
  periodo_hasta: string | null
  observaciones: string | null
  created_at: string
  total_items: number
  items_en_poder: number
}

export interface StockPorTenenciaRow {
  id_producto: string
  disponible_central: number
  reservado_central: number
  en_revendedoras: number
  por_revendedora: Record<string, number> | null
}

export type EstadoLiquidacion = 'pendiente' | 'pagada'

export interface LiquidacionRevendedoraRow {
  id_liquidacion: string
  id_tenant: string
  id_revendedora: string
  periodo_desde: string
  periodo_hasta: string
  monto_vendido: number
  monto_comision: number
  monto_a_cobrar: number
  cantidad_lineas: number
  porcentaje_aplicado: number
  estado: EstadoLiquidacion
  fecha_liquidacion: string
  fecha_pago: string | null
  observaciones: string | null
  id_usuario_alta: string | null
  created_at: string
  updated_at: string
}

export interface PagoRevendedoraRow {
  id_pago_revendedora: string
  id_tenant: string
  id_liquidacion: string
  fecha: string
  monto: number
  metodo: string | null
  referencia: string | null
  id_cuenta: string
  created_at: string
}

export interface PreviewLineaLiquidacion {
  id_detalle_venta: string
  id_venta: string
  id_item: string
  fecha_venta: string
  id_producto?: string
  nombre_producto?: string
  sku?: string
  precio_venta: number
  porcentaje_preview?: number
  monto_comision_estimada?: number
  excluida?: boolean
}

export interface PreviewLiquidacionResponse {
  cantidad_lineas: number
  monto_vendido: number
  porcentaje_resuelto: number
  monto_comision: number
  monto_a_cobrar: number
  lineas: PreviewLineaLiquidacion[]
}

export interface CuentaCorrienteRevendedora {
  total_en_poder: number
  total_vendido: number
  total_devuelto: number
  total_comision_liquidada: number
  total_liquidado: number
  total_pagado: number
  adeudado: number
}

export type EstadoCuentaRevendedora = 'al_dia' | 'con_saldo' | 'atrasada'

export interface PanelRevendedoraRow {
  id_revendedora: string
  nombre: string
  apellido: string
  email: string | null
  telefono: string | null
  activo: boolean
  items_en_poder: number
  monto_en_poder: number
  vendido_periodo: number
  comision_liquidada: number
  comision_estimada: number
  adeudado: number
  fecha_ultima_venta: string | null
  declaraciones_pendientes: number
  estado_cuenta: EstadoCuentaRevendedora
  total_filas: number
  kpi_en_poder: number
  kpi_en_local: number
  kpi_adeudado_total: number
  kpi_liquidaciones_pendientes_monto: number
  kpi_liquidaciones_pendientes_cant: number
}

export interface TotalesPanelRevendedoras {
  en_poder: number
  en_local: number
  adeudado_total: number
  liquidaciones_pendientes_monto: number
  liquidaciones_pendientes_cant: number
}

export interface PanelRevendedorasResponse {
  totales: TotalesPanelRevendedoras
  revendedoras: PanelRevendedoraRow[]
  total: number
}

export interface QuienTieneItemResponse {
  id_revendedora: string
  nombre: string
  apellido: string
  telefono: string | null
  email: string | null
  id_consignacion: string
  fecha_entrega: string
  estado_detalle: string
}

export const ORDEN_PANEL_REVENDEDORAS_LABEL: Record<string, string> = {
  apellido_asc: 'Apellido (A-Z)',
  apellido_desc: 'Apellido (Z-A)',
  nombre_asc: 'Nombre (A-Z)',
  nombre_desc: 'Nombre (Z-A)',
  adeudado_desc: 'Mayor deuda',
  adeudado_asc: 'Menor deuda',
  vendido_desc: 'Mayor venta del período',
  vendido_asc: 'Menor venta del período',
  items_poder_desc: 'Más piezas en poder',
  items_poder_asc: 'Menos piezas en poder',
  ultima_venta_desc: 'Venta más reciente',
  ultima_venta_asc: 'Venta más antigua',
}

export type OrdenPanelRevendedoras = keyof typeof ORDEN_PANEL_REVENDEDORAS_LABEL

export type EstadoFiltroStock = 'con_pendiente' | 'sin_declaracion'
export type EstadoFiltroVentas = 'liquidada' | 'pendiente'
export type EstadoFiltroLiquidaciones = 'pendiente' | 'pagada'
export type EstadoFiltroDeclaraciones = 'pendiente' | 'confirmada' | 'rechazada' | 'retirada'

export interface RvpListaPaginada<T> {
  rows: T[]
  total: number
}

export interface RvpMiCuentaRow {
  piezas_en_poder: number
  valor_en_poder: number
  total_vendido: number
  comision_liquidada: number
  comision_estimada: number
  total_adeudado: number
  total_pagado: number
  declaraciones_pendientes: number
  porcentaje_comision_actual: number
  tramo_comision_actual: string
}

export interface RvpMiStockRow {
  id_item: string
  id_producto: string
  nombre_producto: string
  sku: string
  talle: string | null
  precio_venta: number
  fecha_entrega: string
  declaracion_pendiente: boolean
}

export interface RvpMisVentasRow {
  id_venta: string
  id_detalle_venta: string
  descripcion: string
  talle: string | null
  fecha_venta: string
  precio_venta: number
  comision_liquidada: number
  comision_estimada: number
  comision_total: number
  liquidada: boolean
  fecha_liquidacion: string | null
}

export interface RvpMisLiquidacionesRow {
  id_liquidacion: string
  fecha_liquidacion: string
  periodo_desde: string
  periodo_hasta: string
  total_venta: number
  monto_comision: number
  monto_a_cobrar: number
  estado: 'pendiente' | 'pagada'
  total_pagado: number
}

export interface RvpMisDeclaracionesRow {
  id_declaracion: string
  id_item: string
  fecha: string
  nota: string | null
  estado: 'pendiente' | 'confirmada' | 'rechazada' | 'retirada'
  motivo_rechazo: string | null
  nombre_producto: string
  sku: string
  talle: string | null
  precio_venta: number
}

export interface DeclaracionVentaLocalRow {
  id_declaracion: string
  id_tenant: string
  id_revendedora: string
  revendedora_nombre: string
  revendedora_apellido: string
  id_item: string
  nombre_producto: string
  sku: string
  talle: string | null
  precio_venta: number
  fecha: string
  nota: string | null
  estado: 'pendiente' | 'confirmada' | 'rechazada' | 'retirada'
  id_venta: string | null
  motivo_rechazo: string | null
  created_at: string
}

export interface RvpItemStockResuelto {
  id_item: string
  id_producto: string
  descripcion: string
  sku: string
  talle: string | null
  precio_venta: number | null
}

