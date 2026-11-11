/**
 * Tipos TS para consignaciones (Etapa 6).
 * Mantenidos a mano contra 00024/00025.
 */

export type EstadoConsignacion = 'activa' | 'cerrada'
export type EstadoConsignacionDetalle = 'pendiente' | 'devuelto' | 'cancelado'

export const ESTADO_CONSIGNACION_LABEL: Record<EstadoConsignacion, string> = {
  activa: 'Activa',
  cerrada: 'Cerrada',
}
// Color del Badge por estado. Vive junto a la etiqueta porque el listado y
// el detalle tenían cada uno su copia y podían divergir.
export const ESTADO_CONSIGNACION_VARIANT: Record<EstadoConsignacion, 'success' | 'neutral'> = {
  activa: 'success',
  cerrada: 'neutral',
}
export const ESTADO_DETALLE_LABEL: Record<EstadoConsignacionDetalle, string> = {
  pendiente: 'Pendiente',
  devuelto: 'Devuelto',
  cancelado: 'Cancelado',
}

export interface ConsignacionRow {
  id_consignacion: string
  id_tenant: string
  id_proveedor: string
  id_usuario_alta: string | null
  fecha: string
  estado: EstadoConsignacion
  fecha_cierre: string | null
  observaciones: string | null
  created_at: string
  updated_at: string
}

export interface ConsignacionDetalleRow {
  id_consignacion_detalle: string
  id_tenant: string
  id_consignacion: string
  id_item: string
  id_producto: string
  estado: EstadoConsignacionDetalle
  fecha_apartado: string
  fecha_devolucion: string | null
  motivo: string | null
  created_at: string
}

export interface ConsignacionConResumen extends ConsignacionRow {
  proveedor: { id_proveedor: string; nombre: string; telefono: string | null } | null
  total_items: number
  pendientes: number
  devueltos: number
  cancelados: number
}

export interface ConsignacionConDetalle extends ConsignacionRow {
  proveedor: { id_proveedor: string; nombre: string; telefono: string | null } | null
  detalles: Array<
    ConsignacionDetalleRow & {
      producto: { id_producto: string; nombre: string; sku: string | null } | null
      item: { qr_code: string; estado_item: string; costo_ingreso: number | null } | null
    }
  >
}
