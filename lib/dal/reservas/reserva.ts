import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import { errorDeRpc } from '@/lib/dal/errors'
import type {
  EstadoReserva,
  ReservaConDetalle,
  ReservaDeProducto,
  ReservaRow,
} from '@/lib/types/ventas'

export async function listReservas(opts?: {
  estado?: EstadoReserva
}): Promise<Array<ReservaRow & { cliente: { id_cliente: string; nombre: string; nombre_completo: string } | null; items_count: number }>> {
  const supabase = await createServerClient()
  let q = supabase
    .from('reserva')
    .select(`
      *,
      cliente:cliente(id_cliente, nombre, nombre_completo),
      lineas:detalle_reserva(id_detalle_reserva)
    `)
    .order('fecha', { ascending: false })
  if (opts?.estado) q = q.eq('estado_reserva', opts.estado)
  const { data, error } = await q
  if (error) throw new Error(`listReservas: ${error.message}`)
  return ((data ?? []) as unknown as Array<
    ReservaRow & {
      cliente: { id_cliente: string; nombre: string; nombre_completo: string } | null
      lineas: Array<{ id_detalle_reserva: string }>
    }
  >).map((r) => {
    const { lineas, ...rest } = r
    return { ...rest, items_count: lineas?.length ?? 0 }
  })
}

/**
 * Unidades bloqueadas por reservas activas, agrupadas por producto.
 *
 * Reservar NO cambia `estado_item` (sigue 'disponible'): el bloqueo vive en
 * `detalle_reserva`. Por eso el stock del catálogo cuenta las unidades
 * reservadas como si estuvieran libres, y el carrito de venta necesita este
 * mapa para distinguirlas — y para saber a qué reserva engancharse cuando el
 * vendedor elige igual ese producto.
 *
 * Una query, sin importar cuántas reservas haya.
 */
export async function listReservasActivasPorProducto(): Promise<
  Record<string, ReservaDeProducto[]>
> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('detalle_reserva')
    .select(`
      id_producto,
      id_reserva,
      reserva:reserva!inner(
        fecha_vencimiento,
        estado_reserva,
        cliente:cliente(nombre, nombre_completo)
      )
    `)
    .eq('estado', 'activa')
    .eq('reserva.estado_reserva', 'activa')
  if (error) throw new Error(`listReservasActivasPorProducto: ${error.message}`)

  const filas = (data ?? []) as unknown as Array<{
    id_producto: string
    id_reserva: string
    reserva: {
      fecha_vencimiento: string
      cliente: { nombre: string; nombre_completo: string } | null
    } | null
  }>

  const porProducto: Record<string, ReservaDeProducto[]> = {}
  for (const f of filas) {
    if (!f.id_producto || !f.reserva) continue
    const lista = (porProducto[f.id_producto] ??= [])
    const existente = lista.find((r) => r.id_reserva === f.id_reserva)
    if (existente) existente.unidades++
    else {
      lista.push({
        id_reserva: f.id_reserva,
        cliente_nombre: f.reserva.cliente?.nombre ?? null,
        fecha_vencimiento: f.reserva.fecha_vencimiento,
        unidades: 1,
      })
    }
  }
  return porProducto
}

export async function getReservaConDetalle(id: string): Promise<ReservaConDetalle | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('reserva')
    .select(`
      *,
      cliente:cliente(id_cliente, nombre, nombre_completo, telefono),
      lineas:detalle_reserva(
        *,
        producto:producto(id_producto, nombre, sku),
        item:item_producto(qr_code, estado_item)
      )
    `)
    .eq('id_reserva', id)
    .maybeSingle()
  if (error) throw new Error(`getReservaConDetalle: ${error.message}`)
  return (data ?? null) as unknown as ReservaConDetalle | null
}

export async function listReservasPorCliente(idCliente: string): Promise<ReservaRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('reserva').select('*').eq('id_cliente', idCliente)
    .order('fecha', { ascending: false })
  if (error) throw new Error(`listReservasPorCliente: ${error.message}`)
  return (data ?? []) as ReservaRow[]
}

export async function spCrearReserva(input: {
  idCliente: string | null
  items: string[]
  fechaVencimiento: string
  observaciones?: string | null
}): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_crear_reserva', {
    p_id_cliente: input.idCliente,
    p_items: input.items,
    p_fecha_vencimiento: input.fechaVencimiento,
    p_observaciones: input.observaciones ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_crear_reserva', error))
  return data as string
}

export async function spCancelarReserva(idReserva: string, motivo?: string): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_cancelar_reserva', {
    p_id_reserva: idReserva,
    p_motivo: motivo ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_cancelar_reserva', error))
}

export async function spVencerReservas(): Promise<number> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_vencer_reservas')
  if (error) throw new Error(errorDeRpc('sp_vencer_reservas', error))
  return Number(data ?? 0)
}


/**
 * Reservas activas de un conjunto de ítems en UNA sola consulta.
 * Devuelve un Map<id_item, id_reserva>.
 * Con una lista vacía, no consulta a la base y devuelve un Map vacío.
 */
export async function getReservasActivasDeItems(
  idsItem: string[],
): Promise<Map<string, string>> {
  if (idsItem.length === 0) return new Map()
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('detalle_reserva')
    .select('id_item, id_reserva')
    .in('id_item', idsItem)
    .eq('estado', 'activa')
  if (error) throw new Error(`getReservasActivasDeItems: ${error.message}`)

  const mapa = new Map<string, string>()
  for (const fila of (data ?? []) as Array<{ id_item: string; id_reserva: string }>) {
    mapa.set(fila.id_item, fila.id_reserva)
  }
  return mapa
}
