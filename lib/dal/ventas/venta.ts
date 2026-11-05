import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import type { FormaPago } from '@/lib/types/precios'
import type {
  CanalVenta,
  MedioPago,
  RegistrarVentaInput,
  VentaConDetalle,
  VentaRow,
} from '@/lib/types/ventas'

/** Una venta como la ve el listado: con cliente y cantidad de líneas. */
export type VentaListada = VentaRow & {
  cliente: { id_cliente: string; nombre: string; nombre_completo: string } | null
  lineas_count: number
}

/**
 * Rango temporal de un período de ventas.
 *
 * `hastaExclusivo` es EXCLUSIVO a propósito: `fecha` es `timestamptz` (00021),
 * así que un tope inclusivo con un día sin hora (`<= '2026-08-31'`) se resuelve
 * como `<= 2026-08-31T00:00:00` y deja afuera TODAS las ventas de ese día.
 * Usar `inicioDelDia()` / `inicioDelDiaSiguiente()` de `lib/fechas`.
 */
export interface PeriodoVentas {
  desde?: string
  hastaExclusivo?: string
  canal?: CanalVenta
  idRevendedora?: string
}

/** Filas por request al recorrer un período completo (KPIs y export). */
const CHUNK_PERIODO = 1000

const SELECT_LISTADO = `
  *,
  cliente:cliente(id_cliente, nombre, nombre_completo),
  lineas:detalle_venta(id_detalle_venta)
`

type VentaCruda = VentaRow & {
  cliente: { id_cliente: string; nombre: string; nombre_completo: string } | null
  lineas: Array<{ id_detalle_venta: string }>
}

function aListada(r: VentaCruda): VentaListada {
  const { lineas, ...rest } = r
  return { ...rest, lineas_count: lineas?.length ?? 0 }
}

/**
 * Página del listado con `total` para paginación server-side.
 */
export async function listVentasPaginado(
  opts: PeriodoVentas & { page: number; pageSize: number },
): Promise<{ rows: VentaListada[]; total: number }> {
  const supabase = await createServerClient()
  const from = (Math.max(1, opts.page) - 1) * opts.pageSize
  const to = from + opts.pageSize - 1

  let q = supabase
    .from('venta')
    .select(SELECT_LISTADO, { count: 'exact' })
    .order('fecha', { ascending: false })
    .range(from, to)
  if (opts.desde) q = q.gte('fecha', opts.desde)
  if (opts.hastaExclusivo) q = q.lt('fecha', opts.hastaExclusivo)
  if (opts.canal) q = q.eq('canal', opts.canal)
  if (opts.idRevendedora) q = q.eq('id_revendedora', opts.idRevendedora)
  const { data, count, error } = await q
  if (error) throw new Error(`listVentasPaginado: ${error.message}`)
  return {
    rows: ((data ?? []) as unknown as VentaCruda[]).map(aListada),
    total: count ?? 0,
  }
}

/**
 * Recorre un período COMPLETO en chunks. PostgREST topea las filas por request
 * (y un `.limit()` fijo corta en silencio), así que paginamos hasta agotar: si
 * el período tiene 3.000 ventas, salen las 3.000.
 */
async function recorrerPeriodo<T>(select: string, opts: PeriodoVentas): Promise<T[]> {
  const supabase = await createServerClient()
  const acc: T[] = []
  for (let offset = 0; ; offset += CHUNK_PERIODO) {
    let q = supabase
      .from('venta')
      .select(select)
      .order('fecha', { ascending: false })
      .range(offset, offset + CHUNK_PERIODO - 1)
    if (opts.desde) q = q.gte('fecha', opts.desde)
    if (opts.hastaExclusivo) q = q.lt('fecha', opts.hastaExclusivo)
    if (opts.canal) q = q.eq('canal', opts.canal)
    const { data, error } = await q
    if (error) throw new Error(`recorrerPeriodo: ${error.message}`)
    const chunk = (data ?? []) as unknown as T[]
    acc.push(...chunk)
    if (chunk.length < CHUNK_PERIODO) return acc
  }
}

/**
 * Totales del período COMPLETO — no de la página visible. Los KPIs no pueden
 * depender de cuántas filas entraron en la página actual.
 */
export async function resumenVentasPeriodo(
  opts: PeriodoVentas,
): Promise<{ registradas: number; anuladas: number; facturado: number }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .rpc('rf_resumen_ventas_periodo', {
      p_desde: opts.desde ?? null,
      p_hasta_exclusivo: opts.hastaExclusivo ?? null,
      p_canal: opts.canal ?? null,
    })
    .single<{ registradas: number | string; anuladas: number | string; facturado: number | string }>()
  if (error) throw new Error(`resumenVentasPeriodo: ${error.message}`)
  return {
    registradas: Number(data?.registradas ?? 0),
    anuladas: Number(data?.anuladas ?? 0),
    facturado: Number(data?.facturado ?? 0),
  }
}

/** Todas las ventas del período, para exportar. */
export async function listVentasPeriodo(opts: PeriodoVentas): Promise<VentaListada[]> {
  const filas = await recorrerPeriodo<VentaCruda>(SELECT_LISTADO, opts)
  return filas.map(aListada)
}

export async function getVentaConDetalle(id: string): Promise<VentaConDetalle | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('venta')
    .select(`
      *,
      cliente:cliente(id_cliente, nombre, nombre_completo, telefono),
      lineas:detalle_venta(
        *,
        producto:producto(id_producto, nombre, sku),
        item:item_producto(qr_code),
        devolucion:devolucion_venta(id_devolucion),
        cambio:cambio_venta(id_cambio, diferencia)
      ),
      comprobantes:comprobante(*),
      pagos:pago_venta(
        *,
        cuenta:cuenta_destino(id_cuenta_destino, nombre, tipo)
      )
    `)
    .eq('id_venta', id)
    .maybeSingle()
  if (error) throw new Error(`getVentaConDetalle: ${error.message}`)
  return (data ?? null) as unknown as VentaConDetalle | null
}

function extraerSlugRpc(error: { message: string }): string {
  if (error.message.includes('modulo-revendedoras-deshabilitado')) {
    return 'modulo-revendedoras-deshabilitado'
  }
  const clean = error.message.replace(/^.*(?:sp_[a-z_]+):\s*/i, '').trim()
  const match = clean.match(/([a-z0-9_-]+)/)
  return match ? match[1] : clean
}

/**
 * Llama al RPC transaccional. Devuelve id_venta.
 * Errores del RPC se propagan tal cual (message = código semántico:
 * 'item-no-disponible', 'item-en-reserva', etc.).
 */
export async function spRegistrarVenta(input: RegistrarVentaInput): Promise<string> {
  if (input.lineas.length === 0) throw new Error('lineas-vacias')
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_registrar_venta', {
    p_lineas: input.lineas.map((l) => ({
      id_item: l.id_item,
      descuentos: l.descuentos ?? [],
    })) as unknown as object,
    p_forma_pago: input.forma_pago,
    p_id_cliente: input.id_cliente ?? null,
    p_id_reserva: input.id_reserva ?? null,
    p_observaciones: input.observaciones ?? null,
    // null = el SP arma un pago único contra la cuenta predeterminada.
    p_pagos: (input.pagos?.length
      ? input.pagos.map((p) => ({
          medio: p.medio,
          id_cuenta_destino: p.id_cuenta_destino,
          monto: p.monto,
          // Define qué fila del tarifario aplica (00057). El SP exige que
          // venga con `tarjeta_credito` y que NO venga con el resto.
          cuotas: p.cuotas ?? null,
          monto_recibido: p.monto_recibido ?? null,
          referencia: p.referencia ?? null,
        }))
      : null) as unknown as object,
    // null = venta sin financiación propia. El SP exige cliente si viene.
    p_financiacion: (input.financiacion
      ? {
          cuotas: input.financiacion.cuotas,
          primer_vencimiento: input.financiacion.primer_vencimiento,
        }
      : null) as unknown as object,
    // null = sin financiador declarado: el recargo se resuelve contra el
    // comodín. Con `propia`, el SP ignora cuenta y medio.
    p_financiador: (input.financiador
      ? {
          id_cuenta_destino: input.financiador.id_cuenta_destino ?? null,
          medio: input.financiador.medio ?? null,
          propia: input.financiador.propia ?? false,
        }
      : null) as unknown as object,
    p_canal: input.canal ?? 'local',
    p_id_revendedora: input.id_revendedora ?? null,
  })
  if (error) throw new Error(extraerSlugRpc(error))
  return data as string
}

export async function spAnularVenta(
  idVenta: string,
  motivo?: string,
): Promise<{ total_reintegrado: number }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_anular_venta', {
    p_id_venta: idVenta,
    p_motivo: motivo ?? null,
  })
  if (error) throw new Error(extraerSlugRpc(error))
  return data as { total_reintegrado: number }
}

export async function spRegistrarDevolucionCliente(
  idDetalleVenta: string,
  motivo?: string,
  idCuentaReintegro?: string,
  medioReintegro?: MedioPago,
): Promise<{ reintegro: number }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_registrar_devolucion_cliente', {
    p_id_detalle_venta: idDetalleVenta,
    p_motivo: motivo ?? null,
    p_id_cuenta_reintegro: idCuentaReintegro ?? null,
    p_medio_reintegro: medioReintegro ?? null,
  })
  if (error) throw new Error(extraerSlugRpc(error))
  return data as { reintegro: number }
}

export async function spRegistrarCambio(
  idDetalleOriginal: string,
  idItemEntregado: string,
  motivo?: string,
  medioCobro?: MedioPago,
  idCuentaDestino?: string,
): Promise<{ id_cambio: string; diferencia: number; id_detalle_nuevo: string }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_registrar_cambio', {
    p_id_detalle_original: idDetalleOriginal,
    p_id_item_entregado: idItemEntregado,
    p_motivo: motivo ?? null,
    p_medio_cobro: medioCobro ?? null,
    p_id_cuenta_destino: idCuentaDestino ?? null,
  })
  if (error) throw new Error(extraerSlugRpc(error))
  return data as { id_cambio: string; diferencia: number; id_detalle_nuevo: string }
}

/**
 * Historial de compras de un cliente (útil para pantalla /clientes/[id]).
 */
export async function listVentasPorCliente(
  idCliente: string,
): Promise<VentaRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('venta')
    .select('*')
    .eq('id_cliente', idCliente)
    .order('fecha', { ascending: false })
  if (error) throw new Error(`listVentasPorCliente: ${error.message}`)
  return (data ?? []) as VentaRow[]
}

// Re-export types used by consumers
export type { FormaPago }
