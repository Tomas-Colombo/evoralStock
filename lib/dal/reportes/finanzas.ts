import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import type {
  FinanzasContextoPeriodo,
  FinanzasFlujoRow,
  FinanzasPosicion,
  FinanzasPresupuestoRow,
  FinanzasRankingRow,
  FinanzasResultadosRow,
  FinanzasSerieMensualRow,
  CuentasPorCobrar,
} from '@/lib/types/reportes'

function fila<T>(data: unknown): T | null {
  if (!data) return null
  return (Array.isArray(data) ? data[0] : data) as T
}

function toNullableNumber(v: unknown): number | null {
  return v == null ? null : Number(v)
}

export async function getResultados(desde: string, hasta: string): Promise<FinanzasResultadosRow | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('rf_finanzas_resultados', {
    p_desde: desde,
    p_hasta: hasta,
  })
  if (error) throw new Error(`rf_finanzas_resultados: ${error.message}`)

  const row = fila<Record<string, unknown>>(data)
  if (!row) return null

  return {
    mes: String(row.mes ?? ''),
    ventas_brutas: Number(row.ventas_brutas ?? 0),
    anulaciones: Number(row.anulaciones ?? 0),
    ventas_netas: Number(row.ventas_netas ?? 0),
    costo_mercaderia: toNullableNumber(row.costo_mercaderia),
    ganancia_sobre_ventas: toNullableNumber(row.ganancia_sobre_ventas),
    gastos: Number(row.gastos ?? 0),
    comision_liquidada: Number(row.comision_liquidada ?? 0),
    comision_pendiente_estimada: Number(row.comision_pendiente_estimada ?? 0),
    ganancia_final: toNullableNumber(row.ganancia_final),
    porcentaje_ganancia: toNullableNumber(row.porcentaje_ganancia),
    cantidad_ventas: Number(row.cantidad_ventas ?? 0),
    ticket_promedio: Number(row.ticket_promedio ?? 0),
  }
}

export async function getFlujo(desde: string, hasta: string): Promise<FinanzasFlujoRow | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('rf_finanzas_flujo', {
    p_desde: desde,
    p_hasta: hasta,
  })
  if (error) throw new Error(`rf_finanzas_flujo: ${error.message}`)

  const row = fila<Record<string, unknown>>(data)
  if (!row) return null

  return {
    mes: String(row.mes ?? ''),
    cobrado: Number(row.cobrado ?? 0),
    devuelto_clientes: Number(row.devuelto_clientes ?? 0),
    costo_procesamiento: Number(row.costo_cobro ?? 0),
    neto_cobros: Number(row.neto_cobros ?? 0),
    compras_mercaderia: toNullableNumber(row.compras_mercaderia),
    pagos_proveedores: toNullableNumber(row.pagos_proveedores),
    gastos: Number(row.gastos ?? 0),
    flujo_neto: toNullableNumber(row.flujo_neto),
    por_acreditar: row.por_acreditar ? (row.por_acreditar as Record<string, number>) : null,
  }
}

export async function getSerieMensual(hasta: string, meses: number = 12): Promise<FinanzasSerieMensualRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('rf_finanzas_serie_mensual', {
    p_hasta: hasta,
    p_meses: meses,
  })
  if (error) throw new Error(`rf_finanzas_serie_mensual: ${error.message}`)

  return (data as Record<string, unknown>[]).map(row => ({
    mes: String(row.mes ?? ''),
    ventas_netas: Number(row.ventas_netas ?? 0),
    ganancia_sobre_ventas: toNullableNumber(row.ganancia_sobre_ventas),
    ganancia_final: toNullableNumber(row.ganancia_final),
    cobrado_neto: Number(row.cobrado_neto ?? 0),
  }))
}

export async function getPosicion(): Promise<FinanzasPosicion | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('rf_finanzas_posicion')
  if (error) throw new Error(`rf_finanzas_posicion: ${error.message}`)

  const row = fila<Record<string, unknown>>(data)
  if (!row) return null

  return {
    capital_propio: toNullableNumber(row.capital_propio),
    mercaderia_terceros: toNullableNumber(row.mercaderia_terceros),
    devueltos_clientes: toNullableNumber(row.devueltos_clientes),
    valor_venta_potencial: Number(row.valor_venta_potencial ?? 0),
    productos_sin_precio: Number(row.productos_sin_precio ?? 0),
    por_cobrar: row.por_cobrar ? (row.por_cobrar as CuentasPorCobrar) : null,
    deuda_proveedores: toNullableNumber(row.deuda_proveedores),
  }
}

export async function getRankingProductos(desde: string, hasta: string, limite: number, orden: 'ganancia' | 'unidades' | 'monto'): Promise<FinanzasRankingRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('rf_finanzas_ranking_productos', {
    p_desde: desde,
    p_hasta: hasta,
    p_limite: limite,
    p_orden: orden,
  })
  if (error) throw new Error(`rf_finanzas_ranking_productos: ${error.message}`)

  return (data as Record<string, unknown>[]).map(row => ({
    id_producto: String(row.id_producto ?? ''),
    nombre: String(row.nombre ?? ''),
    unidades_vendidas: Number(row.unidades_vendidas ?? 0),
    monto_vendido: Number(row.monto_vendido ?? 0),
    ganancia: toNullableNumber(row.ganancia),
    porcentaje_ventas: row.porcentaje_ventas != null ? Number(row.porcentaje_ventas) : null,
  }))
}

export async function getGastosPresupuesto(mes: string): Promise<FinanzasPresupuestoRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('rf_finanzas_gastos_presupuesto', {
    p_mes: mes,
  })
  if (error) throw new Error(`rf_finanzas_gastos_presupuesto: ${error.message}`)

  return (data as Record<string, unknown>[]).map(row => ({
    id_categoria_gasto: String(row.id_categoria_gasto ?? ''),
    nombre: String(row.nombre ?? ''),
    gastado: Number(row.gastado ?? 0),
    presupuesto_mensual: Number(row.presupuesto_mensual ?? 0),
    consumido_pct: Number(row.consumido_pct ?? 0),
  }))
}

export async function getContextoPeriodo(): Promise<FinanzasContextoPeriodo | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('fn_contexto_periodo')
  if (error) throw new Error(`fn_contexto_periodo: ${error.message}`)

  const row = fila<Record<string, unknown>>(data)
  if (!row) return null

  return {
    hoy: String(row.hoy ?? ''),
    mes_desde: String(row.mes_desde ?? ''),
    mes_hasta: String(row.mes_hasta ?? ''),
  }
}
