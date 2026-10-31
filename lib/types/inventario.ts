/**
 * Tipos TS mantenidos a mano contra `supabase/migrations/00010-00016_*.sql`.
 * Reglas:
 *  - snake_case en propiedades = mismos nombres que las columnas DB
 *    (evita mapper hasta que Etapa siguiente lo justifique).
 *  - Todos los tipos son *rows* (lo que devuelve Supabase `.select()`).
 *  - `*Insert` son los payloads que Supabase espera para `.insert()`,
 *    marcando opcionales los campos con default en DB.
 *  - Si cambia una migración, ACTUALIZAR ACÁ EN EL MISMO COMMIT.
 */

// ─── Enums ──────────────────────────────────────────────────────────

export type EstadoItem =
  | 'disponible'
  | 'reservado'
  | 'vendido'
  | 'devuelto'
  | 'devuelto_cliente'
  | 'baja'
  | 'en_revendedora'

// Etiqueta y color del Badge por estado del ítem físico. Antes el buscador y
// la ficha tenían cada uno su copia.
export const ESTADO_ITEM_LABEL: Record<EstadoItem, string> = {
  disponible: 'Disponible',
  reservado: 'Reservado',
  vendido: 'Vendido',
  devuelto: 'Devuelto',
  devuelto_cliente: 'Devuelto por cliente',
  baja: 'Dado de baja',
  en_revendedora: 'En revendedora',
}

export const ESTADO_ITEM_VARIANT: Record<EstadoItem, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  disponible: 'success',
  reservado: 'info',
  vendido: 'info',
  devuelto: 'neutral',
  devuelto_cliente: 'warning',
  baja: 'danger',
  en_revendedora: 'warning',
}

export const TIPOS_INGRESO = ['compra', 'consignacion'] as const
export type TipoIngreso = (typeof TIPOS_INGRESO)[number]

export const TIPOS_PROVEEDOR = ['mayorista', 'particular', 'consignatario'] as const
export type TipoProveedor = (typeof TIPOS_PROVEEDOR)[number]

export type TipoMovimientoItem =
  | 'alta'
  | 'venta'
  | 'reserva'
  | 'liberacion'
  | 'consignacion'
  | 'devolucion'
  | 'ajuste'
  | 'baja'

// ─── Row types ──────────────────────────────────────────────────────

export interface CategoriaRow {
  id_categoria: string
  id_tenant: string
  nombre: string
  descripcion: string | null
  activa: boolean
  // 00032: talles/medidas propios de la categoría (ej: ['S','M','L','XL']).
  talles: string[]
  created_at: string
  updated_at: string
}

export interface ProveedorRow {
  id_proveedor: string
  id_tenant: string
  nombre: string
  tipo: TipoProveedor
  telefono: string | null
  email: string | null
  cuit: string | null
  dias_rotacion: number | null
  notas: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export interface ProductoRow {
  id_producto: string
  id_tenant: string
  id_categoria: string
  sku: string | null
  nombre: string
  descripcion: string | null
  stock_minimo: number
  activo: boolean
  // 00031: creado automáticamente desde import de remito PDF (revisar).
  es_nuevo: boolean
  // Etapa 4: precio de venta fijado por sp_recalcular_precio_venta.
  precio_venta: number | null
  id_regla_margen_aplicada: string | null
  precio_venta_resuelto_at: string | null
  precio_venta_desactualizado: boolean
  created_at: string
  updated_at: string
}

export interface CostoProductoRow {
  id_costo: string
  id_tenant: string
  id_producto: string
  costo: number
  moneda: string
  vigente_desde: string
  vigente_hasta: string | null
  id_usuario_alta: string | null
  motivo: string | null
  created_at: string
}

export interface IngresoMercaderiaRow {
  id_ingreso: string
  id_tenant: string
  // 00037: opcional — null = ingreso sin proveedor (producción propia, oferta).
  id_proveedor: string | null
  tipo_ingreso: TipoIngreso
  fecha: string
  numero_remito: string | null
  pdf_url: string | null
  observaciones: string | null
  confirmado: boolean
  // 00035: cancelación/reversión del ingreso (null = vigente).
  cancelado_at: string | null
  motivo_cancelacion: string | null
  id_usuario_alta: string | null
  created_at: string
  updated_at: string
}

export interface IngresoMercaderiaDetalleRow {
  id_detalle: string
  id_tenant: string
  id_ingreso: string
  id_producto: string
  cantidad: number
  costo_unitario: number
  // 00032: talle de la línea; se copia a cada item al confirmar.
  talle: string | null
  created_at: string
}

export interface ItemProductoRow {
  id_item: string
  id_tenant: string
  id_producto: string
  id_ingreso: string | null
  id_ingreso_detalle: string | null
  qr_code: string
  estado_item: EstadoItem
  // 00032: talle de la unidad; null = producto sin talle.
  talle: string | null
  costo_ingreso: number
  tipo_ingreso: TipoIngreso
  fecha_ingreso: string
  fecha_venta: string | null
  fecha_devolucion: string | null
  created_at: string
  updated_at: string
}

export interface MovimientoItemRow {
  id_movimiento: string
  id_tenant: string
  id_item: string
  tipo_movimiento: TipoMovimientoItem | string
  estado_desde: EstadoItem | null
  estado_hasta: EstadoItem
  referencia_tipo: string | null
  referencia_id: string | null
  diferencia: Record<string, unknown> | null
  id_usuario: string | null
  ts: string
}

// ─── Insert payloads ────────────────────────────────────────────────

export interface CategoriaInsert {
  id_tenant: string
  nombre: string
  descripcion?: string | null
  activa?: boolean
  talles?: string[]
}

export interface ProveedorInsert {
  id_tenant: string
  nombre: string
  tipo?: TipoProveedor
  telefono?: string | null
  email?: string | null
  cuit?: string | null
  dias_rotacion?: number | null
  notas?: string | null
  activo?: boolean
}

export interface IngresoMercaderiaInsert {
  id_tenant: string
  // 00037: opcional — null = ingreso sin proveedor.
  id_proveedor?: string | null
  tipo_ingreso: TipoIngreso
  fecha?: string
  numero_remito?: string | null
  pdf_url?: string | null
  observaciones?: string | null
  id_usuario_alta?: string | null
}

export interface IngresoMercaderiaDetalleInsert {
  id_tenant: string
  id_ingreso: string
  id_producto: string
  cantidad: number
  costo_unitario: number
  talle?: string | null
}

// ─── Domain view models (agregados que la UI necesita frecuentemente) ─

/** Producto + su costo vigente + su categoría (lo que muestra el listado maestro). */
export interface ProductoConDetalle extends ProductoRow {
  categoria: Pick<CategoriaRow, 'id_categoria' | 'nombre'> | null
  costo_vigente: number | null
  moneda_vigente: string | null
  stock_disponible: number
  stock_total: number
}

/** Item + producto + categoría — vista para la ficha /inventario/ficha/[qr]. */
export interface ItemConProducto extends ItemProductoRow {
  producto: Pick<ProductoRow, 'id_producto' | 'nombre' | 'sku'> & {
    categoria: Pick<CategoriaRow, 'id_categoria' | 'nombre'> | null
  }
  proveedor: Pick<ProveedorRow, 'id_proveedor' | 'nombre' | 'telefono'> | null
  movimientos: MovimientoItemRow[]
}

/** Ingreso + proveedor + suma de líneas para el listado de ingresos. */
export interface IngresoConResumen extends IngresoMercaderiaRow {
  proveedor: Pick<ProveedorRow, 'id_proveedor' | 'nombre'> | null
  total_lineas: number
  total_cantidad: number
  total_costo: number
}
