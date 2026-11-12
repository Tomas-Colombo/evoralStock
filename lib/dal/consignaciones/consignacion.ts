import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import { errorDeRpc } from '@/lib/dal/errors'
import type {
  ConsignacionConDetalle,
  ConsignacionConResumen,
  ConsignacionRow,
  EstadoConsignacion,
} from '@/lib/types/consignaciones'

export async function listConsignaciones(opts?: {
  estado?: EstadoConsignacion
  idProveedor?: string
  /** Timestamp ISO inclusivo (inicio del día). */
  desde?: string
  /** Timestamp ISO EXCLUSIVO (inicio del día siguiente). */
  hastaExclusivo?: string
}): Promise<ConsignacionConResumen[]> {
  const supabase = await createServerClient()
  let q = supabase
    .from('consignacion')
    .select(`
      *,
      proveedor:proveedor(id_proveedor, nombre, telefono),
      detalles:consignacion_detalle(estado)
    `)
    .order('fecha', { ascending: false })
  if (opts?.estado) q = q.eq('estado', opts.estado)
  if (opts?.idProveedor) q = q.eq('id_proveedor', opts.idProveedor)
  if (opts?.desde) q = q.gte('fecha', opts.desde)
  if (opts?.hastaExclusivo) q = q.lt('fecha', opts.hastaExclusivo)
  const { data, error } = await q
  if (error) throw new Error(`listConsignaciones: ${error.message}`)

  return ((data ?? []) as unknown as Array<
    ConsignacionRow & {
      proveedor: ConsignacionConResumen['proveedor']
      detalles: Array<{ estado: 'pendiente' | 'devuelto' | 'cancelado' }>
    }
  >).map((row) => {
    const detalles = row.detalles ?? []
    const pendientes = detalles.filter((d) => d.estado === 'pendiente').length
    const devueltos = detalles.filter((d) => d.estado === 'devuelto').length
    const cancelados = detalles.filter((d) => d.estado === 'cancelado').length
    const { detalles: _drop, ...rest } = row
    void _drop
    return {
      ...rest,
      total_items: detalles.length,
      pendientes,
      devueltos,
      cancelados,
    }
  })
}

export async function getConsignacionConDetalle(
  id: string,
): Promise<ConsignacionConDetalle | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('consignacion')
    .select(`
      *,
      proveedor:proveedor(id_proveedor, nombre, telefono),
      detalles:consignacion_detalle(
        *,
        producto:producto(id_producto, nombre, sku),
        item:item_producto(qr_code, estado_item, item_costo(costo_ingreso))
      )
    `)
    .eq('id_consignacion', id)
    .maybeSingle()
  if (error) throw new Error(`getConsignacionConDetalle: ${error.message}`)
  if (!data) return null

  const row = data as unknown as {
    detalles?: Array<{
      item?: {
        qr_code: string
        estado_item: string
        item_costo?: { costo_ingreso?: number | string | null } | Array<{ costo_ingreso?: number | string | null }> | null
      } | null
      [k: string]: unknown
    }>
    [k: string]: unknown
  }

  return {
    ...row,
    detalles: (row.detalles ?? []).map((d) => {
      if (!d.item) return d
      const embed = Array.isArray(d.item.item_costo) ? d.item.item_costo[0] : d.item.item_costo
      const rawCosto = embed?.costo_ingreso
      const { item_costo: _drop, ...itemRest } = d.item
      void _drop
      return {
        ...d,
        item: {
          ...itemRest,
          costo_ingreso: rawCosto != null ? Number(rawCosto) : null,
        },
      }
    }),
  } as unknown as ConsignacionConDetalle
}

/** Unidad elegible para apartar en un lote de consignación (buscador). */
export interface ItemElegibleConsignacion {
  id_item: string
  id_producto: string
  qr_code: string
  producto_nombre: string
  sku: string | null
  talle: string | null
}

/**
 * Unidades que se pueden apartar en un lote del proveedor dado: `disponible`,
 * `tipo_ingreso='consignacion'` y del proveedor (vía su ingreso). Excluye las
 * que ya están en una consignación pendiente o en una reserva activa — las
 * mismas reglas que valida `/api/consignaciones/lookup-item` unidad por unidad.
 *
 * Alimenta el buscador con sugerencias por nombre/SKU/QR. Es un snapshot: el
 * server revalida al apartar (sp_agregar_item_consignacion), así que una lista
 * un poco desactualizada no compromete la integridad.
 */
export async function listItemsElegiblesConsignacion(
  idProveedor: string,
): Promise<ItemElegibleConsignacion[]> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('item_producto')
    .select(
      'id_item, id_producto, qr_code, talle, producto:producto(nombre, sku), ingreso:ingreso_mercaderia!inner(id_proveedor)',
    )
    .eq('estado_item', 'disponible')
    .eq('tipo_ingreso', 'consignacion')
    .eq('ingreso.id_proveedor', idProveedor)
    .order('fecha_ingreso', { ascending: true })
    .limit(500)
  if (error) throw new Error(`listItemsElegiblesConsignacion: ${error.message}`)

  const rows = (data ?? []) as unknown as Array<{
    id_item: string
    id_producto: string
    qr_code: string
    talle: string | null
    producto: { nombre: string; sku: string | null } | null
  }>
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id_item)
  const [{ data: pendientes }, { data: reservados }] = await Promise.all([
    supabase
      .from('consignacion_detalle')
      .select('id_item')
      .in('id_item', ids)
      .eq('estado', 'pendiente'),
    supabase
      .from('detalle_reserva')
      .select('id_item')
      .in('id_item', ids)
      .eq('estado', 'activa'),
  ])

  const excluidos = new Set<string>([
    ...((pendientes ?? []).map((x) => x.id_item as string)),
    ...((reservados ?? []).map((x) => x.id_item as string)),
  ])

  return rows
    .filter((r) => !excluidos.has(r.id_item))
    .map((r) => ({
      id_item: r.id_item,
      id_producto: r.id_producto,
      qr_code: r.qr_code,
      producto_nombre: r.producto?.nombre ?? '(sin nombre)',
      sku: r.producto?.sku ?? null,
      talle: r.talle,
    }))
}

// ─── RPCs ────────────────────────────────────────────────────────────

/**
 * Alta atómica del lote: proveedor + ítems en una sola transacción. Reemplaza
 * a `sp_crear_consignacion` (lote vacío), que quedó revocada en 00054 — no
 * existen consignaciones sin ítems.
 */
export async function spCrearConsignacionConItems(input: {
  idProveedor: string
  observaciones?: string | null
  items: string[]
  motivo?: string | null
}): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_crear_consignacion_con_items', {
    p_id_proveedor: input.idProveedor,
    p_observaciones: input.observaciones ?? null,
    p_items: input.items,
    p_motivo: input.motivo ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_crear_consignacion_con_items', error))
  return data as string
}

export async function spEditarConsignacion(input: {
  idConsignacion: string
  observaciones?: string | null
  idProveedor?: string | null
}): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_editar_consignacion', {
    p_id_consignacion: input.idConsignacion,
    p_observaciones: input.observaciones ?? null,
    p_id_proveedor: input.idProveedor ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_editar_consignacion', error))
}

/** Confirma la salida de todos los pendientes y cierra el lote. */
export async function spConfirmarConsignacion(idConsignacion: string): Promise<number> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_confirmar_consignacion', {
    p_id_consignacion: idConsignacion,
  })
  if (error) throw new Error(errorDeRpc('sp_confirmar_consignacion', error))
  return (data as number) ?? 0
}

/** Borrado físico. Los ítems que ya habían salido vuelven a 'disponible'. */
export async function spEliminarConsignacion(
  idConsignacion: string,
): Promise<{ items_reestockeados: number; detalles_borrados: number }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_eliminar_consignacion', {
    p_id_consignacion: idConsignacion,
  })
  if (error) throw new Error(errorDeRpc('sp_eliminar_consignacion', error))
  return data as { items_reestockeados: number; detalles_borrados: number }
}

export async function spAgregarItemConsignacion(input: {
  idConsignacion: string
  idItem: string
  motivo?: string | null
}): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_agregar_item_consignacion', {
    p_id_consignacion: input.idConsignacion,
    p_id_item: input.idItem,
    p_motivo: input.motivo ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_agregar_item_consignacion', error))
  return data as string
}

export async function spCancelarItemConsignacion(
  idDetalle: string,
  motivo?: string,
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_cancelar_item_consignacion', {
    p_id_detalle: idDetalle,
    p_motivo: motivo ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_cancelar_item_consignacion', error))
}

export async function spConfirmarSalidaItem(idDetalle: string): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_confirmar_salida_item', {
    p_id_detalle: idDetalle,
  })
  if (error) throw new Error(errorDeRpc('sp_confirmar_salida_item', error))
}

export async function spCerrarConsignacion(idConsignacion: string): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_cerrar_consignacion', {
    p_id_consignacion: idConsignacion,
  })
  if (error) throw new Error(errorDeRpc('sp_cerrar_consignacion', error))
}

export async function spRegistrarAjusteInventario(input: {
  idItem: string
  cantidadSistema: number
  cantidadContada: number
  observaciones: string
  darDeBaja?: boolean
}): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_registrar_ajuste_inventario', {
    p_id_item: input.idItem,
    p_cantidad_sistema: input.cantidadSistema,
    p_cantidad_contada: input.cantidadContada,
    p_observaciones: input.observaciones,
    p_dar_de_baja: input.darDeBaja ?? false,
  })
  if (error) throw new Error(errorDeRpc('sp_registrar_ajuste_inventario', error))
  return data as string
}
