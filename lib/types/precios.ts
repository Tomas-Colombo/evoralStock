/**
 * Tipos TS para el motor de precios (Etapa 4).
 * Mantenidos a mano contra 00017-00019.
 */

export type TipoRegla = 'margen' | 'descuento' | 'recargo'
export type TipoValorRegla = 'porcentaje' | 'monto_fijo'
export type AlcanceRegla = 'global' | 'categoria' | 'proveedor' | 'producto'
/**
 * Cómo se PRECIÓ la venta. Las cuotas ya no son un set fijo: el enum de la DB
 * (00052) cubre `cuotas_2`..`cuotas_24` y cada tenant elige cuáles ofrece en
 * `plan_cuotas`. `transferencia` existe en el enum desde 00047.
 */
export type FormaPago = 'efectivo' | 'transferencia' | `cuotas_${number}`

/** Rango que soporta el enum `forma_pago` en la DB (00052). */
export const CUOTAS_MIN = 2
export const CUOTAS_MAX = 24

/** `'cuotas_6'` → 6. Cualquier otra forma de pago → null. */
export function cuotasDeFormaPago(fp: string | null | undefined): number | null {
  const m = /^cuotas_(\d+)$/.exec(fp ?? '')
  return m ? Number(m[1]) : null
}

/** 6 → `'cuotas_6'`. El caller valida el rango contra CUOTAS_MIN/MAX. */
export function formaPagoDeCuotas(cuotas: number): FormaPago {
  return `cuotas_${cuotas}`
}

/**
 * Etiqueta legible. Reemplaza al viejo `FORMA_PAGO_LABEL`: con las cuotas
 * configurables ya no hay un Record cerrado que enumerarlas.
 */
export function formaPagoLabel(fp: string | null | undefined): string {
  if (!fp) return '—'
  if (fp === 'efectivo') return 'Efectivo'
  if (fp === 'transferencia') return 'Transferencia'
  const n = cuotasDeFormaPago(fp)
  return n === null ? fp : `${n} cuotas`
}

/**
 * Un recargo por cuotas (`recargo_cuotas`, 00063). Espejo de `ArancelCobroRow`:
 * misma llave `(cuenta, medio, cuotas)`, flecha opuesta — el arancel baja lo
 * que cobra el comercio, el recargo sube lo que paga el cliente.
 *
 * CUIDADO CON LA UNIDAD: en `porcentaje`, `valor` es 10 para "+10%", igual que
 * `ArancelCobroRow.arancel_pct` — y distinto de `ReglaPrecioRow.valor`, que
 * usa 0.10 para lo mismo.
 */
export interface RecargoCuotasRow {
  id_recargo_cuotas: string
  id_tenant: string
  cuotas: number
  /** `null` = comodín: cualquier cuenta sin fila propia. */
  id_cuenta_destino: string | null
  /** `null` = comodín: cualquier medio. */
  medio: MedioPagoRecargo | null
  /** `true` = lo financia el comercio. Sin cuenta ni medio, y sin comodín. */
  propia: boolean
  tipo_valor: TipoValorRegla
  valor: number
  vigente_desde: string
  /** `null` = vigente. No se borran: se cierra la vigencia. */
  vigente_hasta: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

/**
 * Los medios que puede nombrar un recargo. Es el mismo juego que `MedioPago`
 * de `lib/types/ventas`, redeclarado acá para que este módulo no dependa del
 * de ventas — la dirección del import es precios → ventas, no al revés.
 */
export type MedioPagoRecargo =
  | 'efectivo'
  | 'transferencia'
  | 'tarjeta_debito'
  | 'tarjeta_credito'

/** Un plan de cuotas ofrecido por el tenant (`plan_cuotas`, 00052). */
export interface PlanCuotasRow {
  id_tenant: string
  cuotas: number
  activo: boolean
  created_at: string
}

export const TIPO_REGLA_LABEL: Record<TipoRegla, string> = {
  margen: 'Margen',
  descuento: 'Descuento',
  recargo: 'Recargo',
}

export const ALCANCE_LABEL: Record<AlcanceRegla, string> = {
  global: 'Global',
  categoria: 'Categoría',
  proveedor: 'Proveedor',
  producto: 'Producto',
}

export interface ReglaPrecioRow {
  id_regla: string
  id_tenant: string
  nombre: string
  tipo_regla: TipoRegla
  tipo_valor: TipoValorRegla
  valor: number
  alcance: AlcanceRegla
  id_producto: string | null
  id_categoria: string | null
  id_proveedor: string | null
  forma_pago: FormaPago | null
  prioridad: number
  /** Sólo relevante en descuentos. Flag informativo: no fuerza exclusividad. */
  acumulable: boolean
  fecha_inicio: string | null
  fecha_hasta: string | null
  fecha_baja: string | null
  created_at: string
  updated_at: string
}

export interface ReglaPrecioInsert {
  nombre: string
  tipo_regla: TipoRegla
  tipo_valor: TipoValorRegla
  valor: number
  alcance: AlcanceRegla
  id_producto?: string | null
  id_categoria?: string | null
  id_proveedor?: string | null
  forma_pago?: FormaPago | null
  prioridad?: number
  acumulable?: boolean
  fecha_inicio?: string | null
  fecha_hasta?: string | null
}

/**
 * Un descuento aplicable a un producto del carrito, tal como lo devuelve
 * `sp_descuentos_disponibles_venta`. La UI agrupa por alcance: 'producto'
 * se ofrece en la fila; global/categoría/proveedor en el panel lateral.
 */
export interface DescuentoDisponible {
  id_producto: string
  id_regla: string
  nombre: string
  alcance: AlcanceRegla
  tipo_valor: TipoValorRegla
  valor: number
  acumulable: boolean
}

/**
 * Respuesta de `sp_calcular_precio_venta_snapshot`. La UI y la venta
 * consumen esto.
 */
export type SnapshotPrecio =
  | {
      ok: true
      precio_lista: number
      precio_final: number
      forma_pago: FormaPago
      desactualizado: boolean
      desglose: DesgloseVenta
    }
  | {
      ok: false
      reason: 'sin-precio-lista'
      requiere_recalcular: true
    }

/** Un descuento efectivamente aplicado a la línea, con su impacto en $. */
export interface DescuentoAplicado {
  id_regla: string
  nombre: string
  alcance: AlcanceRegla
  tipo_valor: TipoValorRegla
  valor: number
  acumulable: boolean
  /** Cuánto restó del precio de lista (en $, ya redondeado). */
  monto: number
}

/** El recargo por forma de pago aplicado, si hubo. */
/**
 * Recargo aplicado, tal como queda en el snapshot de la línea.
 *
 * Conviven DOS formatos y hay que tolerar los dos: las ventas anteriores a
 * 00064 traen `id_regla` (apuntaba a `regla_precio`), las posteriores traen
 * `id_recargo_cuotas` más el financiador que lo resolvió. La clave del
 * desglose no cambió a propósito — renombrarla habría dejado ilegible el
 * historial.
 */
export interface RecargoAplicado {
  /** Sólo en ventas anteriores a 00064. */
  id_regla?: string
  /** Desde 00064. */
  id_recargo_cuotas?: string
  tipo_valor: TipoValorRegla
  /** En el formato nuevo, 10 = +10%. En el viejo, 0.10 para lo mismo. */
  valor: number
  forma_pago: FormaPago
  /** Desde 00064: quién financiaba cuando se resolvió el recargo. */
  propia?: boolean
  id_cuenta_destino?: string | null
  medio?: MedioPagoRecargo | null
  monto: number
}

/** Desglose de reglas que devuelve el snapshot y se persiste en la venta. */
export interface DesgloseVenta {
  descuentos: DescuentoAplicado[]
  recargo_forma_pago?: RecargoAplicado
}

/**
 * Contadores del home de Precios. Se resuelven con una agregación
 * (`sp_precios_resumen`) en vez de traer el catálogo entero.
 */
export interface PreciosResumen {
  productosActivos: number
  desactualizados: number
  sinPrecio: number
  conRegla: number
}

/**
 * Resumen de impacto de una regla de margen por categoría (REQ-CIR-01).
 * Columnas devueltas por `sp_impacto_regla_margen`.
 */
export interface ImpactoReglaCategoria {
  id_categoria: string | null
  categoria_nombre: string
  productos: number
  cambian: number | null
  suben: number | null
  bajan: number | null
  sin_costo: number | null
}

/**
 * Estado del producto respecto a su precio (Control de precios).
 */
export interface ProductoConPrecioStatus {
  id_producto: string
  id_categoria?: string | null
  nombre: string
  sku: string | null
  categoria_nombre: string | null
  costo_vigente: number | null
  precio_venta: number | null
  precio_venta_resuelto_at: string | null
  precio_venta_desactualizado: boolean
  regla_margen_nombre: string | null
  id_regla_margen_resuelta?: string | null
  /** Precio proyectado si se recalcula ahora (útil para preview). */
  precio_proyectado: number | null
  /** Diferencia % vs precio actual. Null si no hay precio actual. */
  diferencia_pct: number | null
}
