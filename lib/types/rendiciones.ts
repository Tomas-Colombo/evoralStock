/**
 * Tipos TS para rendiciones y gastos (Etapa 7). Contra 00026/00027.
 */

export type EstadoRendicion = 'pendiente' | 'pagada'

export const ESTADO_RENDICION_LABEL: Record<EstadoRendicion, string> = {
  pendiente: 'Pendiente de pago',
  pagada: 'Pagada',
}
// Color del Badge por estado. Vive junto a la etiqueta porque el listado y
// el detalle tenían cada uno su copia y podían divergir.
export const ESTADO_RENDICION_VARIANT: Record<EstadoRendicion, 'success' | 'warning'> = {
  pendiente: 'warning',
  pagada: 'success',
}

export interface RendicionProveedorRow {
  id_rendicion: string
  id_tenant: string
  id_proveedor: string
  id_usuario_alta: string | null
  fecha_generacion: string
  periodo_desde: string | null
  periodo_hasta: string | null
  monto_total: number
  cantidad_lineas: number
  estado: EstadoRendicion
  fecha_pago: string | null
  observaciones: string | null
  created_at: string
  updated_at: string
}

export interface RendicionConResumen extends RendicionProveedorRow {
  proveedor: { id_proveedor: string; nombre: string; telefono: string | null } | null
}

/** Fila de la preview antes de generar la rendición. */
export interface PreviewLineaRendicion {
  id_detalle_venta: string
  id_venta: string
  fecha: string
  producto_nombre: string
  producto_sku: string | null
  qr_code: string
  precio_venta: number
  costo_snapshot: number
  monto_proveedor: number
  cliente_nombre: string | null
}

export interface RendicionConDetalle extends RendicionProveedorRow {
  proveedor: { id_proveedor: string; nombre: string; telefono: string | null } | null
  lineas: PreviewLineaRendicion[]  // mismas columnas que preview, reutilizamos shape
}

// ─── Gastos ──────────────────────────────────────────────────────────

export interface CategoriaGastoRow {
  id_categoria_gasto: string
  id_tenant: string
  nombre: string
  descripcion: string | null
  presupuesto_mensual: number | null
  activa: boolean
  fecha_baja: string | null
  created_at: string
  updated_at: string
}

export interface GastoNegocioRow {
  id_gasto: string
  id_tenant: string
  id_categoria_gasto: string
  id_usuario_alta: string | null
  fecha: string
  monto: number
  /** Opcional: un gasto puede quedar identificado sólo por categoría + monto. */
  descripcion: string | null
  comprobante_ref: string | null
  created_at: string
  updated_at: string
}

export interface GastoConCategoria extends GastoNegocioRow {
  categoria: { id_categoria_gasto: string; nombre: string } | null
}

/**
 * Status del presupuesto de una categoría en el mes calendario en curso.
 * `gastado_pct = gastado_mes / presupuesto_mensual`. Si presupuesto es
 * null → sin control (`sin_control=true`).
 */
export interface CategoriaGastoStatus {
  id_categoria_gasto: string
  nombre: string
  presupuesto_mensual: number | null
  gastado_mes: number
  gastado_pct: number | null
  restante: number | null
  sin_control: boolean
  alerta: 'ok' | 'cerca' | 'excedido' | 'sin_control'
}
