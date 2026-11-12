/**
 * Tipos TS mantenidos a mano contra 00020-00023 y 00047.
 */

import type { DesgloseVenta, FormaPago } from './precios'
import type { TipoIngreso } from './inventario'

export type EstadoVenta = 'registrada' | 'anulada'
export type CanalVenta = 'local' | 'revendedora' | 'online'
/**
 * Por dónde ENTRÓ la plata. Distinto de `FormaPago`, que es cómo se PRECIÓ la
 * venta (esa define el recargo por regla; ésta no toca el precio).
 */
export type MedioPago = 'efectivo' | 'transferencia' | 'tarjeta_debito' | 'tarjeta_credito' | 'cuenta_revendedora'
export type TipoCuentaDestino = 'efectivo' | 'banco' | 'billetera_virtual'
export type EstadoReserva = 'activa' | 'cancelada' | 'vencida' | 'convertida_venta'
export type TipoComprobante = 'factura_a' | 'factura_b' | 'factura_c' | 'remito' | 'ticket'

export const ESTADO_VENTA_LABEL: Record<EstadoVenta, string> = {
  registrada: 'Registrada',
  anulada: 'Anulada',
}
export const CANAL_VENTA_LABEL: Record<CanalVenta, string> = {
  local: 'Local',
  revendedora: 'Revendedora',
  online: 'Online',
}
export const ESTADO_RESERVA_LABEL: Record<EstadoReserva, string> = {
  activa: 'Activa',
  cancelada: 'Cancelada',
  vencida: 'Vencida',
  convertida_venta: 'Convertida en venta',
}
// Color del Badge por estado. Vive junto a la etiqueta porque el listado y
// el detalle tenían cada uno su copia y podían divergir.
export const ESTADO_RESERVA_VARIANT: Record<EstadoReserva, 'success' | 'info' | 'warning' | 'neutral'> = {
  activa: 'success',
  cancelada: 'neutral',
  vencida: 'warning',
  convertida_venta: 'info',
}
export const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta_debito: 'Tarjeta de débito',
  tarjeta_credito: 'Tarjeta de crédito',
  cuenta_revendedora: 'Cuenta revendedora',
}
export const TIPO_CUENTA_DESTINO_LABEL: Record<TipoCuentaDestino, string> = {
  efectivo: 'Efectivo',
  banco: 'Cuenta bancaria',
  billetera_virtual: 'Billetera virtual',
}
export const TIPO_COMPROBANTE_LABEL: Record<TipoComprobante, string> = {
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  remito: 'Remito',
  ticket: 'Ticket',
}

// ─── Cliente ─────────────────────────────────────────────────────────

export interface ClienteRow {
  id_cliente: string
  id_tenant: string
  nombre: string
  /** Opcional (00058). NULL en los clientes anteriores a esa migración. */
  apellido: string | null
  /** Generada por la DB: `nombre apellido`. Para MOSTRAR, no para ordenar. */
  nombre_completo: string
  telefono: string | null
  email: string | null
  notas: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export interface ClienteInsert {
  id_tenant: string
  nombre: string
  apellido?: string | null
  telefono?: string | null
  email?: string | null
  notas?: string | null
  activo?: boolean
}

/**
 * Cómo se ordena una cartera de clientes. El alfabético por apellido usa
 * `apellido` + `nombre`, NO `nombre_completo`: son criterios distintos y el
 * segundo no se puede derivar del primero.
 */
export type OrdenClientes = 'apellido_asc' | 'apellido_desc' | 'nombre_asc'

export const ORDEN_CLIENTES_LABEL: Record<OrdenClientes, string> = {
  apellido_asc: 'Apellido (A-Z)',
  apellido_desc: 'Apellido (Z-A)',
  nombre_asc: 'Nombre (A-Z)',
}

/** El nombre que se muestra. `nombre_completo` cuando está, con fallback. */
export function nombreCliente(
  c: { nombre: string; nombre_completo?: string | null } | null | undefined,
): string {
  if (!c) return 'Mostrador'
  return c.nombre_completo?.trim() || c.nombre
}

// ─── Venta ───────────────────────────────────────────────────────────

export interface VentaRow {
  id_venta: string
  id_tenant: string
  id_cliente: string | null
  id_usuario_alta: string | null
  fecha: string
  forma_pago: FormaPago
  canal: CanalVenta
  id_revendedora: string | null
  total: number
  observaciones: string | null
  estado_venta: EstadoVenta
  fecha_anulacion: string | null
  motivo_anulacion: string | null
  created_at: string
  updated_at: string
}

export interface DetalleVentaRow {
  id_detalle_venta: string
  id_tenant: string
  id_venta: string
  id_item: string
  id_producto: string
  id_proveedor: string | null
  precio_venta: number
  costo_snapshot: number | null
  monto_proveedor: number | null
  monto_gasto: number
  monto_ganancia: number | null
  tipo_ingreso_snapshot: TipoIngreso
  desglose_reglas: DesgloseVenta
  id_rendicion: string | null
  excluida_rendicion: boolean
  porcentaje_comision_preview: number
  monto_comision: number
  id_liquidacion: string | null
  excluida_liquidacion: boolean
  created_at: string
}

export interface VentaConDetalle extends VentaRow {
  cliente: Pick<ClienteRow, 'id_cliente' | 'nombre' | 'nombre_completo' | 'telefono'> | null
  lineas: Array<
    DetalleVentaRow & {
      producto: { id_producto: string; nombre: string; sku: string | null } | null
      item: { qr_code: string } | null
      devolucion?: { id_devolucion: string } | null
      cambio?: { id_cambio: string; diferencia: number } | null
    }
  >
  comprobantes: ComprobanteRow[]
  pagos: Array<PagoVentaRow & { cuenta: Pick<CuentaDestinoRow, 'id_cuenta_destino' | 'nombre' | 'tipo'> | null }>
}

// ─── Cobranza (00047) ────────────────────────────────────────────────

export interface CuentaDestinoRow {
  id_cuenta_destino: string
  id_tenant: string
  nombre: string
  tipo: TipoCuentaDestino
  titular: string | null
  identificador: string | null
  activo: boolean
  es_predeterminada: boolean
  /** Retenciones (00057). Dependen de la situación fiscal del comercio, no
   *  del plan de cuotas: por eso viven acá y no en el tarifario. */
  ret_iva_pct: number
  ret_ganancias_pct: number
  ret_iibb_pct: number
  /** Impuesto a los débitos y créditos. Sólo si la plata toca un banco. */
  imp_deb_cred_pct: number
  created_at: string
  updated_at: string
}

export interface PagoVentaRow {
  id_pago_venta: string
  id_tenant: string
  id_venta: string
  id_cuenta_destino: string
  medio: MedioPago
  monto: number
  /** Cuotas de ESTE pago (00057). Sólo con `tarjeta_credito`. */
  cuotas: number | null
  /** Sólo efectivo: lo que el cliente entregó. */
  monto_recibido: number | null
  /** Columna generada por la DB (`monto_recibido - monto`). */
  vuelto: number | null
  referencia: string | null
  /** Lo que se lleva el procesador. Snapshot: no recalcular al leer. */
  costo_cobro: number
  neto_acreditado: number | null
  fecha_acreditacion: string | null
  /** `{}` en los pagos anteriores a 00057 — normalizar con `desgloseCosto()`. */
  desglose_costo: DesgloseCostoGuardado
  created_at: string
}

/** Un pago tal como lo arma la UI para sp_registrar_venta. */
export interface PagoInput {
  medio: MedioPago
  id_cuenta_destino: string
  monto: number
  /** Requerido con `tarjeta_credito`, prohibido en el resto (lo valida el SP). */
  cuotas?: number | null
  monto_recibido?: number | null
  referencia?: string | null
}

// ─── Costo de cobro (00057) ──────────────────────────────────────────

/** Tarifario de un procesador para (cuenta, medio, plan de cuotas). */
export interface ArancelCobroRow {
  id_arancel_cobro: string
  id_tenant: string
  id_cuenta_destino: string
  medio: MedioPago
  /** `null` = comodín: aplica a cualquier plan de ese medio. */
  cuotas: number | null
  arancel_pct: number
  /** IVA SOBRE EL ARANCEL, no sobre la venta. */
  iva_arancel_pct: number
  dias_acreditacion: number
  vigente_desde: string
  /** `null` = vigente. Los aranceles no se borran: se cierra la vigencia. */
  vigente_hasta: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

export interface ArancelCobroInsert {
  id_cuenta_destino: string
  medio: MedioPago
  cuotas?: number | null
  arancel_pct: number
  iva_arancel_pct?: number
  dias_acreditacion?: number
  vigente_desde?: string
  notas?: string | null
}

export type ConceptoRetencion = 'iva' | 'ganancias' | 'iibb' | 'imp_deb_cred'

export const CONCEPTO_RETENCION_LABEL: Record<ConceptoRetencion, string> = {
  iva: 'Retención IVA',
  ganancias: 'Retención Ganancias',
  iibb: 'Retención IIBB',
  imp_deb_cred: 'Impuesto débitos y créditos',
}

export interface RetencionAplicada {
  concepto: ConceptoRetencion
  pct: number
  monto: number
}

/**
 * Desglose del costo de un cobro, tal como lo devuelve
 * `sp_calcular_costo_cobro` y como queda persistido en `pago_venta`.
 *
 * `sin_tarifario: true` no es un error: significa que ese medio todavía no
 * tiene arancel cargado y el pago se registró con costo 0. La venta nunca se
 * bloquea por esto.
 */
export type DesgloseCosto =
  | {
      sin_tarifario: true
      costo_total: number
      neto: number
      dias_acreditacion: number
    }
  | {
      sin_tarifario: false
      id_arancel_cobro: string
      arancel_pct: number
      arancel_monto: number
      iva_arancel_pct: number
      iva_arancel_monto: number
      retenciones: RetencionAplicada[]
      costo_total: number
      neto: number
      dias_acreditacion: number
    }

/**
 * Lo que puede venir en la columna: un desglose real, o `{}` para los pagos
 * anteriores a 00057. Se mantiene aparte de `DesgloseCosto` para que el
 * narrowing por `sin_tarifario` siga funcionando en el resto del código.
 */
export type DesgloseCostoGuardado = DesgloseCosto | Record<string, never>

/** `{}` de un pago viejo → `null`. Cualquier otra cosa es un desglose real. */
export function desgloseCosto(d: DesgloseCostoGuardado): DesgloseCosto | null {
  return d && typeof (d as DesgloseCosto).sin_tarifario === 'boolean'
    ? (d as DesgloseCosto)
    : null
}

export interface ComprobanteRow {
  id_comprobante: string
  id_tenant: string
  id_venta: string
  tipo: TipoComprobante
  numero: string
  fecha_emision: string
  created_at: string
}

/** Payload que la UI arma para sp_registrar_venta. */
export interface RegistrarVentaInput {
  /** `descuentos`: ids de reglas de descuento elegidas para esa línea. */
  lineas: Array<{ id_item: string; descuentos?: string[] }>
  forma_pago: FormaPago
  canal?: CanalVenta
  id_revendedora?: string | null
  id_cliente?: string | null
  id_reserva?: string | null
  observaciones?: string | null
  /**
   * Cobranza. Vacío/omitido = el SP arma un solo pago por el total contra la
   * cuenta predeterminada. Si viene, la suma DEBE dar el total de la venta.
   */
  pagos?: PagoInput[]
  /**
   * Financiación propia. Si viene, lo que no cubran los `pagos` del día queda
   * como deuda del cliente en `cuota_financiada` — y `id_cliente` pasa a ser
   * obligatorio.
   */
  financiacion?: FinanciacionInput | null
  /**
   * Quién financia esta venta (00064). Define QUÉ recargo por cuotas se aplicó
   * al precificar, y a qué cuenta va el pago cuando no se detalla la cobranza.
   * Omitirlo resuelve el recargo comodín.
   */
  financiador?: FinanciadorInput | null
}

/** Quién financia. Con `propia`, cuenta y medio se ignoran: no hay procesador. */
export interface FinanciadorInput {
  id_cuenta_destino?: string | null
  medio?: MedioPago | null
  propia?: boolean
}

// ─── Reserva ─────────────────────────────────────────────────────────

export interface ReservaRow {
  id_reserva: string
  id_tenant: string
  id_cliente: string | null
  id_usuario_alta: string | null
  fecha: string
  fecha_vencimiento: string
  estado_reserva: EstadoReserva
  fecha_cierre: string | null
  observaciones: string | null
  created_at: string
  updated_at: string
}

export interface DetalleReservaRow {
  id_detalle_reserva: string
  id_tenant: string
  id_reserva: string
  id_item: string
  id_producto: string
  precio_snapshot: number
  estado: EstadoReserva
  created_at: string
}

export interface ReservaConDetalle extends ReservaRow {
  cliente: Pick<ClienteRow, 'id_cliente' | 'nombre' | 'nombre_completo' | 'telefono'> | null
  lineas: Array<
    DetalleReservaRow & {
      producto: { id_producto: string; nombre: string; sku: string | null } | null
      item: { qr_code: string; estado_item: string } | null
    }
  >
}

/**
 * Una reserva activa que está bloqueando unidades de un producto concreto.
 * El carrito de venta la usa para dos cosas: marcar el producto como
 * reservado en el buscador, y saber a qué reserva engancharse si el vendedor
 * lo carga igual.
 */
export interface ReservaDeProducto {
  id_reserva: string
  cliente_nombre: string | null
  fecha_vencimiento: string
  /** Unidades de ESE producto bloqueadas por ESTA reserva. */
  unidades: number
}

// ─── Vista carrito (UI-only) ────────────────────────────────────────

export interface LineaCarrito {
  id_item: string
  /** Necesario para poder repedir otra unidad del mismo producto (cambio de talle). */
  id_producto: string
  qr_code: string
  /** Talle de la unidad concreta; null = producto sin talle. */
  talle: string | null
  producto_nombre: string
  sku: string | null
  categoria_nombre: string | null
  precio_lista: number | null
  precio_final: number | null
  desactualizado: boolean
  desglose: DesgloseVenta
  advertencia: string | null // e.g. "reservado por otro cliente"
}

// ─── Financiación propia (00059) ─────────────────────────────────────

/**
 * Quién asume el riesgo de crédito. Dato explícito, no inferido del medio de
 * pago: un cliente puede pagar 6 cuotas en efectivo (financia el comercio) o
 * con tarjeta en 6 (financia el banco).
 */
export type TipoFinanciacion = 'ninguna' | 'externa' | 'propia'

export type EstadoCuota = 'pendiente' | 'parcial' | 'pagada' | 'incobrable' | 'anulada'

export const ESTADO_CUOTA_LABEL: Record<EstadoCuota, string> = {
  pendiente: 'Pendiente',
  parcial: 'Parcial',
  pagada: 'Pagada',
  incobrable: 'Incobrable',
  anulada: 'Anulada',
}

/** Los estados que todavía representan plata a cobrar. */
export const ESTADOS_CON_DEUDA: EstadoCuota[] = ['pendiente', 'parcial']

export interface CuotaFinanciadaRow {
  id_cuota_financiada: string
  id_tenant: string
  id_venta: string
  /** NOT NULL: una deuda sin cliente es una deuda perdida. */
  id_cliente: string
  numero: number
  monto: number
  monto_pagado: number
  fecha_vencimiento: string
  estado: EstadoCuota
  fecha_cobro: string | null
  fecha_incobrable: string | null
  id_usuario_incobrable: string | null
  motivo_incobrable: string | null
  created_at: string
  updated_at: string
}

/** Una cuota como la ve el panel de control: con su cliente y su venta. */
export type CuotaListada = CuotaFinanciadaRow & {
  cliente: Pick<ClienteRow, 'id_cliente' | 'nombre' | 'apellido' | 'nombre_completo' | 'telefono'> | null
  venta: { id_venta: string; fecha: string; total: number } | null
}

/** Lo que la UI manda para financiar una venta. */
export interface FinanciacionInput {
  cuotas: number
  /** ISO `YYYY-MM-DD`. Las siguientes van mes a mes desde acá. */
  primer_vencimiento: string
}

/**
 * Una línea del reparto del costo no cubierto. Es una ATRIBUCIÓN proporcional
 * al costo, no un hecho: la plata es fungible y no hay tal cosa como "esta
 * cuota pagó un artículo y no el otro".
 */
export interface LineaCostoNoCubierto {
  id_detalle_venta: string
  producto_nombre: string | null
  producto_sku: string | null
  tipo_ingreso_snapshot: string
  id_proveedor: string | null
  proveedor_nombre: string | null
  costo_linea: number
  costo_cubierto: number
  costo_no_cubierto: number
  /** Excluida de rendición ⇒ no se le paga al proveedor: no sale del bolsillo. */
  excluida_rendicion: boolean
  rendida: boolean
}

/** Respuesta de `sp_perdida_incobrable_venta`. */
export interface PerdidaIncobrable {
  /** Lo que no se cobró de las cuotas marcadas incobrables. */
  monto_adeudado: number
  total_cobrado: number
  costo_total: number
  /** `max(0, costo_total − total_cobrado)`: plata que hay que poner. */
  costo_no_cubierto: number
  detalle: LineaCostoNoCubierto[]
}

// ─── Filtros del panel de cuotas ─────────────────────────────────────

/** Los recortes que ofrece el panel de control. */
export type FiltroEstadoCuotas =
  | 'todas'
  | 'con_deuda'
  | 'vencidas'
  | 'vence_este_mes'
  | 'parciales'
  | 'pagadas'
  | 'incobrables'

export type OrdenCuotas =
  | 'vencimiento_asc'
  | 'vencimiento_desc'
  | 'apellido_asc'
  | 'monto_desc'

export const FILTRO_ESTADO_CUOTAS_LABEL: Record<FiltroEstadoCuotas, string> = {
  todas: 'Todas',
  con_deuda: 'Con deuda',
  vencidas: 'Vencidas',
  vence_este_mes: 'Vence este mes',
  parciales: 'Parciales',
  pagadas: 'Pagadas',
  incobrables: 'Incobrables',
}

export const ORDEN_CUOTAS_LABEL: Record<OrdenCuotas, string> = {
  vencimiento_asc: 'Vencimiento (más próximo)',
  vencimiento_desc: 'Vencimiento (más lejano)',
  apellido_asc: 'Apellido (A-Z)',
  monto_desc: 'Monto adeudado',
}

/**
 * Resultado de `sp_marcar_cuota_incobrable`. Da por perdida la cuota elegida
 * Y todas las POSTERIORES del mismo plan que sigan abiertas: si el cliente no
 * pagó la 3, la 4 no se va a cobrar sola.
 */
export interface ResultadoIncobrable {
  cuotas_afectadas: number
  monto_total: number
  desde: number
  hasta: number
}
