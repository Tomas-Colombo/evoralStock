import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import { errorDeRpc } from '@/lib/dal/errors'
import { nombreCliente } from '@/lib/types/ventas'
import type {
  EstadoRendicion,
  PreviewLineaRendicion,
  RendicionConDetalle,
  RendicionConResumen,
  RendicionProveedorRow,
} from '@/lib/types/rendiciones'

export async function listRendiciones(opts?: {
  estado?: EstadoRendicion
  idProveedor?: string
}): Promise<RendicionConResumen[]> {
  const supabase = await createServerClient()
  let q = supabase
    .from('rendicion_proveedor')
    .select(`
      *,
      proveedor:proveedor(id_proveedor, nombre, telefono)
    `)
    .order('fecha_generacion', { ascending: false })
  if (opts?.estado) q = q.eq('estado', opts.estado)
  if (opts?.idProveedor) q = q.eq('id_proveedor', opts.idProveedor)
  const { data, error } = await q
  if (error) throw new Error(`listRendiciones: ${error.message}`)
  return (data ?? []) as unknown as RendicionConResumen[]
}

export async function getRendicionConDetalle(id: string): Promise<RendicionConDetalle | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('rendicion_proveedor')
    .select(`
      *,
      proveedor:proveedor(id_proveedor, nombre, telefono)
    `)
    .eq('id_rendicion', id)
    .maybeSingle()
  if (error) throw new Error(`getRendicionConDetalle head: ${error.message}`)
  if (!data) return null

  // Líneas: mismo shape que preview_rendicion pero filtrando por id_rendicion.
  const { data: lineas, error: lErr } = await supabase
    .from('detalle_venta')
    .select(`
      id_detalle_venta,
      id_venta,
      precio_venta,
      detalle_venta_costo(costo_snapshot),
      detalle_venta_rendicion(monto_proveedor),
      venta:venta(fecha, cliente:cliente(nombre, nombre_completo)),
      producto:producto(nombre, sku),
      item:item_producto(qr_code)
    `)
    .eq('id_rendicion', id)
    .order('id_detalle_venta', { ascending: true })
  if (lErr) throw new Error(`getRendicionConDetalle lineas: ${lErr.message}`)

  const mapped: PreviewLineaRendicion[] = ((lineas ?? []) as unknown as Array<{
    id_detalle_venta: string
    id_venta: string
    precio_venta: number
    detalle_venta_costo: { costo_snapshot?: number | string | null } | Array<{ costo_snapshot?: number | string | null }> | null
    detalle_venta_rendicion: { monto_proveedor?: number | string | null } | Array<{ monto_proveedor?: number | string | null }> | null
    venta: { fecha: string; cliente: { nombre: string; nombre_completo: string } | null } | null
    producto: { nombre: string; sku: string | null } | null
    item: { qr_code: string } | null
  }>).map((l) => {
    const dvc = Array.isArray(l.detalle_venta_costo) ? l.detalle_venta_costo[0] : l.detalle_venta_costo
    const dvr = Array.isArray(l.detalle_venta_rendicion) ? l.detalle_venta_rendicion[0] : l.detalle_venta_rendicion
    return {
      id_detalle_venta: l.id_detalle_venta,
      id_venta: l.id_venta,
      fecha: l.venta?.fecha ?? '',
      producto_nombre: l.producto?.nombre ?? '—',
      producto_sku: l.producto?.sku ?? null,
      qr_code: l.item?.qr_code ?? '—',
      precio_venta: Number(l.precio_venta),
      costo_snapshot: dvc?.costo_snapshot != null ? Number(dvc.costo_snapshot) : null,
      monto_proveedor: dvr?.monto_proveedor != null ? Number(dvr.monto_proveedor) : null,
      cliente_nombre: l.venta?.cliente ? nombreCliente(l.venta.cliente) : null,
    }
  })

  return {
    ...(data as unknown as RendicionProveedorRow),
    proveedor: (data as unknown as { proveedor: RendicionConResumen['proveedor'] }).proveedor,
    lineas: mapped,
  }
}

/**
 * Preview: líneas pendientes de rendir para un proveedor. Read-only.
 * Es un `SELECT` server-side vía RPC (definido en 00027 como
 * `preview_rendicion(id_proveedor)`) para reutilizar exactamente los
 * mismos filtros que aplica sp_generar_rendicion (no duplicar criterio).
 */
export async function previewRendicion(idProveedor: string): Promise<PreviewLineaRendicion[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('preview_rendicion', {
    p_id_proveedor: idProveedor,
  })
  if (error) throw new Error(`preview_rendicion: ${error.message}`)
  return ((data ?? []) as PreviewLineaRendicion[]).map((r) => ({
    ...r,
    precio_venta: Number(r.precio_venta),
    costo_snapshot: r.costo_snapshot != null ? Number(r.costo_snapshot) : null,
    monto_proveedor: r.monto_proveedor != null ? Number(r.monto_proveedor) : null,
  }))
}

// ─── RPCs ────────────────────────────────────────────────────────────

export async function spGenerarRendicion(input: {
  idProveedor: string
  observaciones?: string | null
}): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_generar_rendicion', {
    p_id_proveedor: input.idProveedor,
    p_observaciones: input.observaciones ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_generar_rendicion', error))
  return data as string
}

export async function spMarcarRendicionPagada(input: {
  idRendicion: string
  fechaPago?: string | null
}): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_marcar_rendicion_pagada', {
    p_id_rendicion: input.idRendicion,
    p_fecha_pago: input.fechaPago ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_marcar_rendicion_pagada', error))
}

export async function spExcluirDetalleRendicion(input: {
  idDetalle: string
  motivo?: string | null
}): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_excluir_detalle_rendicion', {
    p_id_detalle: input.idDetalle,
    p_motivo: input.motivo ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_excluir_detalle_rendicion', error))
}

export async function spReincluirDetalleRendicion(idDetalle: string): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_reincluir_detalle_rendicion', {
    p_id_detalle: idDetalle,
  })
  if (error) throw new Error(errorDeRpc('sp_reincluir_detalle_rendicion', error))
}
