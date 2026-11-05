import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import type { ProveedorInsert, ProveedorRow } from '@/lib/types/inventario'

export async function listProveedores(): Promise<ProveedorRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('proveedor').select('*').order('nombre', { ascending: true })
  if (error) throw new Error(`listProveedores: ${error.message}`)
  return (data ?? []) as ProveedorRow[]
}

export async function listProveedoresActivos(): Promise<ProveedorRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('proveedor').select('*').eq('activo', true).order('nombre', { ascending: true })
  if (error) throw new Error(`listProveedoresActivos: ${error.message}`)
  return (data ?? []) as ProveedorRow[]
}

/** Conteo de proveedores activos sin traer las filas (KPI de la home). */
export async function countProveedoresActivos(): Promise<number> {
  const supabase = await createServerClient()
  const { count, error } = await supabase
    .from('proveedor')
    .select('id_proveedor', { count: 'exact', head: true })
    .eq('activo', true)
  if (error) throw new Error(`countProveedoresActivos: ${error.message}`)
  return count ?? 0
}

export async function getProveedor(id: string): Promise<ProveedorRow | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('proveedor').select('*').eq('id_proveedor', id).maybeSingle()
  if (error) throw new Error(`getProveedor: ${error.message}`)
  return (data ?? null) as ProveedorRow | null
}

export async function createProveedor(input: ProveedorInsert): Promise<ProveedorRow> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('proveedor').insert(input).select('*').single()
  if (error) throw new Error(`createProveedor: ${error.message}`)
  return data as ProveedorRow
}

export async function updateProveedor(
  id: string,
  patch: Partial<Omit<ProveedorInsert, 'id_tenant'>>,
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('proveedor').update(patch).eq('id_proveedor', id)
  if (error) throw new Error(`updateProveedor: ${error.message}`)
}

/**
 * Perfil agregado de UN proveedor: deuda pendiente + contadores + rendido
 * histórico. NO usa `v_perfil_proveedor` porque esa vista filtra por
 * `activo = true` (los perfiles de proveedores dados de baja tienen que
 * seguir siendo consultables para ver la deuda histórica y decidir si
 * reactivar).
 */
export interface PerfilProveedorDetalle {
  items_disponibles: number
  consignaciones_activas: number
  monto_pendiente_rendicion: number
  lineas_pendientes_rendicion: number
  monto_rendido_historico: number
  rendiciones_pendientes_pago: number
  /**
   * Valor a costo (= lo que se le debe al proveedor si se vende) de la
   * mercadería de consignación que sigue en poder de la tienda: estados
   * 'disponible', 'reservado', 'devuelto_cliente' y 'en_revendedora' (esos
   * cuatro SÍ te quedan pendientes al proveedor; 'vendido', 'devuelto' al
   * proveedor y 'baja' no). Es deuda POTENCIAL — se vuelve real al vender.
   */
  valor_stock_consignacion: number
  items_en_stock_consignacion: number
  /**
   * Deuda total con el proveedor = pendiente de rendir (ya vendido)
   * + valor a costo del stock de consignación aún en tu poder. Representa
   * el "techo" de lo que le tenés que pagar si todo lo suyo se vende.
   */
  deuda_total_consignacion: number
}

export async function getPerfilProveedorPorId(
  id: string,
): Promise<PerfilProveedorDetalle> {
  const supabase = await createServerClient()

  const [items, stockConsign, consign, pend, rendHist, rendPend] = await Promise.all([
    supabase
      .from('item_producto')
      .select('id_item, ingreso_mercaderia!inner(id_proveedor)', { count: 'exact', head: true })
      .eq('estado_item', 'disponible')
      .eq('tipo_ingreso', 'consignacion')
      .eq('ingreso_mercaderia.id_proveedor', id),
    // Stock de consignación en poder de la tienda (deuda potencial): todos
    // los estados que NO son 'vendido' (ya cuenta como pendiente de rendir),
    // NO son 'devuelto' (fue al proveedor) ni 'baja' (ajuste). Incluye
    // 'en_revendedora' porque el artículo sigue siendo responsabilidad del local.
    supabase
      .from('item_producto')
      .select('costo_ingreso, ingreso_mercaderia!inner(id_proveedor)')
      .eq('tipo_ingreso', 'consignacion')
      .in('estado_item', ['disponible', 'reservado', 'devuelto_cliente', 'en_revendedora'])
      .eq('ingreso_mercaderia.id_proveedor', id),
    supabase
      .from('consignacion')
      .select('id_consignacion', { count: 'exact', head: true })
      .eq('id_proveedor', id)
      .eq('estado', 'activa'),
    supabase
      .from('detalle_venta')
      .select('monto_proveedor, venta!inner(estado_venta)')
      .eq('id_proveedor', id)
      .is('id_rendicion', null)
      .eq('excluida_rendicion', false)
      .gt('monto_proveedor', 0)
      .eq('venta.estado_venta', 'registrada'),
    supabase
      .from('rendicion_proveedor')
      .select('monto_total')
      .eq('id_proveedor', id),
    supabase
      .from('rendicion_proveedor')
      .select('id_rendicion', { count: 'exact', head: true })
      .eq('id_proveedor', id)
      .eq('estado', 'pendiente'),
  ])

  if (items.error) throw new Error(`perfil.items: ${items.error.message}`)
  if (stockConsign.error) throw new Error(`perfil.stockConsign: ${stockConsign.error.message}`)
  if (consign.error) throw new Error(`perfil.consign: ${consign.error.message}`)
  if (pend.error) throw new Error(`perfil.pend: ${pend.error.message}`)
  if (rendHist.error) throw new Error(`perfil.rendHist: ${rendHist.error.message}`)
  if (rendPend.error) throw new Error(`perfil.rendPend: ${rendPend.error.message}`)

  const pendRows = (pend.data ?? []) as Array<{ monto_proveedor: number | string }>
  const monto_pendiente_rendicion = pendRows.reduce(
    (acc, r) => acc + Number(r.monto_proveedor ?? 0),
    0,
  )
  const monto_rendido_historico = ((rendHist.data ?? []) as Array<{ monto_total: number | string }>)
    .reduce((acc, r) => acc + Number(r.monto_total ?? 0), 0)

  const stockRows = (stockConsign.data ?? []) as Array<{ costo_ingreso: number | string }>
  const valor_stock_consignacion = stockRows.reduce(
    (acc, r) => acc + Number(r.costo_ingreso ?? 0),
    0,
  )

  return {
    items_disponibles: items.count ?? 0,
    consignaciones_activas: consign.count ?? 0,
    monto_pendiente_rendicion,
    lineas_pendientes_rendicion: pendRows.length,
    monto_rendido_historico,
    rendiciones_pendientes_pago: rendPend.count ?? 0,
    valor_stock_consignacion,
    items_en_stock_consignacion: stockRows.length,
    deuda_total_consignacion: valor_stock_consignacion + monto_pendiente_rendicion,
  }
}
