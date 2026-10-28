import { createServerClient } from '../supabase'
import { extractErrorSlug } from './slug-error'
import type {
  PanelRevendedoraRow,
  PanelRevendedorasResponse,
  QuienTieneItemResponse,
} from '@/lib/types/revendedoras'

export interface ObtenerPanelRevendedorasParams {
  desde?: string
  hasta?: string
  estado?: 'todos' | 'activa' | 'inactiva'
  cuenta?: 'todos' | 'con_saldo' | 'atrasada' | 'declaraciones_pendientes'
  q?: string
  orden?: string
  limit?: number
  offset?: number
}

export async function obtenerPanelRevendedoras(
  params: ObtenerPanelRevendedorasParams = {},
): Promise<{ ok: true; data: PanelRevendedorasResponse } | { ok: false; reason: string }> {
  const supabase = await createServerClient()

  const pEstado =
    params.estado === 'activa' ? true : params.estado === 'inactiva' ? false : null

  const { data, error } = await supabase.rpc('rf_panel_revendedoras', {
    p_desde: params.desde || null,
    p_hasta: params.hasta || null,
    p_estado: pEstado,
    p_filtro_cuenta: params.cuenta || null,
    p_busqueda: params.q || null,
    p_orden: params.orden || 'apellido_asc',
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  })

  if (error) {
    return { ok: false, reason: extractErrorSlug(error) }
  }

  const rows = (data as PanelRevendedoraRow[]) ?? []
  if (rows.length > 0) {
    const first = rows[0]
    return {
      ok: true,
      data: {
        totales: {
          en_poder: Number(first.kpi_en_poder ?? 0),
          en_local: Number(first.kpi_en_local ?? 0),
          adeudado_total: Number(first.kpi_adeudado_total ?? 0),
          liquidaciones_pendientes_monto: Number(first.kpi_liquidaciones_pendientes_monto ?? 0),
          liquidaciones_pendientes_cant: Number(first.kpi_liquidaciones_pendientes_cant ?? 0),
        },
        revendedoras: rows,
        total: Number(first.total_filas ?? rows.length),
      },
    }
  }

  // Si no hay filas coincidentes con el filtro, consultar solo los totales generales
  const { data: totalesData, error: totalesErr } = await supabase.rpc('rf_totales_panel_revendedoras')
  if (totalesErr) {
    return { ok: false, reason: extractErrorSlug(totalesErr) }
  }

  const t = Array.isArray(totalesData) ? totalesData[0] : totalesData
  return {
    ok: true,
    data: {
      totales: {
        en_poder: Number(t?.kpi_en_poder ?? 0),
        en_local: Number(t?.kpi_en_local ?? 0),
        adeudado_total: Number(t?.kpi_adeudado_total ?? 0),
        liquidaciones_pendientes_monto: Number(t?.kpi_liquidaciones_pendientes_monto ?? 0),
        liquidaciones_pendientes_cant: Number(t?.kpi_liquidaciones_pendientes_cant ?? 0),
      },
      revendedoras: [],
      total: 0,
    },
  }
}

export async function quienTieneItem(
  identificador: string,
): Promise<{ ok: true; data: QuienTieneItemResponse | null } | { ok: false; reason: string }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('rf_quien_tiene_item', {
    p_identificador: identificador,
  })

  if (error) {
    return { ok: false, reason: extractErrorSlug(error) }
  }

  const rows = (data as QuienTieneItemResponse[]) ?? []
  return { ok: true, data: rows.length > 0 ? rows[0] : null }
}

export interface ItemEnPoderRevendedoraRow {
  id_item: string
  id_producto: string
  nombre_producto: string
  sku: string
  /** QR de la unidad: la devolución lo usa para reconocer el escaneo. */
  qr_code: string | null
  talle: string | null
  precio_venta: number
  fecha_entrega: string
}

export async function listarItemsEnPoderRevendedora(
  idRevendedora: string,
): Promise<{ ok: true; data: ItemEnPoderRevendedoraRow[] } | { ok: false; reason: string }> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('consignacion_revendedora_detalle')
    .select(`
      id_item,
      id_producto,
      fecha_entrega,
      created_at,
      producto (
        nombre,
        sku,
        precio_venta
      ),
      item_producto (
        qr_code,
        talle
      ),
      consignacion_revendedora!inner (
        id_revendedora,
        confirmada,
        estado
      )
    `)
    .eq('estado_detalle', 'en_poder')
    .eq('consignacion_revendedora.id_revendedora', idRevendedora)
    .eq('consignacion_revendedora.confirmada', true)
    .eq('consignacion_revendedora.estado', 'abierta')

  if (error) {
    return { ok: false, reason: extractErrorSlug(error) }
  }

  interface DetalleRaw {
    id_item: string
    id_producto: string
    fecha_entrega: string | null
    created_at: string
    producto: { nombre: string; sku: string; precio_venta: number } | null
    item_producto: { qr_code: string | null; talle: string | null } | null
  }

  const rawList = (data as unknown as DetalleRaw[]) ?? []
  const items: ItemEnPoderRevendedoraRow[] = rawList.map((d) => ({
    id_item: d.id_item,
    id_producto: d.id_producto,
    nombre_producto: d.producto?.nombre ?? 'Producto',
    sku: d.producto?.sku ?? '',
    qr_code: d.item_producto?.qr_code ?? null,
    talle: d.item_producto?.talle ?? null,
    precio_venta: Number(d.producto?.precio_venta ?? 0),
    fecha_entrega: d.fecha_entrega ?? d.created_at,
  }))

  return { ok: true, data: items }
}
