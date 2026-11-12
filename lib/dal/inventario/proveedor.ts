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
  monto_pendiente_rendicion: number | null
  lineas_pendientes_rendicion: number | null
  monto_rendido_historico: number | null
  rendiciones_pendientes_pago: number | null
  /**
   * Valor a costo (= lo que se le debe al proveedor si se vende) de la
   * mercadería de consignación que sigue en poder de la tienda: estados
   * 'disponible', 'reservado', 'devuelto_cliente' y 'en_revendedora' (esos
   * cuatro SÍ te quedan pendientes al proveedor; 'vendido', 'devuelto' al
   * proveedor y 'baja' no). Es deuda POTENCIAL — se vuelve real al vender.
   */
  valor_stock_consignacion: number | null
  items_en_stock_consignacion: number | null
  // Ítems con costo pendiente (null): no suman al valor, así que el total
  // queda por debajo; la UI lo avisa en vez de contarlos como 0.
  items_costo_pendiente_consignacion: number | null
  /**
   * Deuda total con el proveedor = pendiente de rendir (ya vendido)
   * + valor a costo del stock de consignación aún en tu poder. Representa
   * el "techo" de lo que le tenés que pagar si todo lo suyo se vende.
   */
  deuda_total_consignacion: number | null
}

export interface PermisosPerfilProveedor {
  puedeVerCostos: boolean
  puedeVerRendiciones: boolean
}

export function proyectarPerfilProveedor(
  perfil: PerfilProveedorDetalle,
  permisos: PermisosPerfilProveedor,
): PerfilProveedorDetalle {
  const puedeVerMontos = permisos.puedeVerCostos || permisos.puedeVerRendiciones
  if (!puedeVerMontos) {
    return {
      items_disponibles: perfil.items_disponibles,
      consignaciones_activas: perfil.consignaciones_activas,
      monto_pendiente_rendicion: null,
      lineas_pendientes_rendicion: null,
      monto_rendido_historico: null,
      rendiciones_pendientes_pago: null,
      valor_stock_consignacion: null,
      items_en_stock_consignacion: null,
      items_costo_pendiente_consignacion: null,
      deuda_total_consignacion: null,
    }
  }
  if (!permisos.puedeVerCostos) {
    return {
      ...perfil,
      valor_stock_consignacion: null,
      items_en_stock_consignacion: null,
      items_costo_pendiente_consignacion: null,
      // La deuda total suma el stock a costo: sin ver_costos no hay total que mostrar.
      deuda_total_consignacion: null,
    }
  }
  return perfil
}

export async function getPerfilProveedorPorId(
  id: string,
  // Sin default: un llamador que se olvide los permisos no debe recibir montos.
  permisos: PermisosPerfilProveedor,
): Promise<PerfilProveedorDetalle> {
  const supabase = await createServerClient()
  const puedeVerMontos = permisos.puedeVerCostos || permisos.puedeVerRendiciones

  const [items, consign] = await Promise.all([
    supabase
      .from('item_producto')
      .select('id_item, ingreso_mercaderia!inner(id_proveedor)', { count: 'exact', head: true })
      .eq('estado_item', 'disponible')
      .eq('tipo_ingreso', 'consignacion')
      .eq('ingreso_mercaderia.id_proveedor', id),
    supabase
      .from('consignacion')
      .select('id_consignacion', { count: 'exact', head: true })
      .eq('id_proveedor', id)
      .eq('estado', 'activa'),
  ])

  if (items.error) throw new Error(`perfil.items: ${items.error.message}`)
  if (consign.error) throw new Error(`perfil.consign: ${consign.error.message}`)

  if (!puedeVerMontos) {
    return proyectarPerfilProveedor(
      {
        items_disponibles: items.count ?? 0,
        consignaciones_activas: consign.count ?? 0,
        monto_pendiente_rendicion: null,
        lineas_pendientes_rendicion: null,
        monto_rendido_historico: null,
        rendiciones_pendientes_pago: null,
        valor_stock_consignacion: null,
        items_en_stock_consignacion: null,
        items_costo_pendiente_consignacion: null,
        deuda_total_consignacion: null,
      },
      permisos,
    )
  }

  const [stockConsign, pend, rendHist, rendPend] = await Promise.all([
    // Stock de consignación en poder de la tienda (deuda potencial): todos
    // los estados que NO son 'vendido' (ya cuenta como pendiente de rendir),
    // NO son 'devuelto' (fue al proveedor) ni 'baja' (ajuste). Incluye
    // 'en_revendedora' porque el artículo sigue siendo responsabilidad del local.
    permisos.puedeVerCostos
      ? supabase
          .from('item_producto')
          .select('id_item, item_costo(costo_ingreso), ingreso_mercaderia!inner(id_proveedor)')
          .eq('tipo_ingreso', 'consignacion')
          .in('estado_item', ['disponible', 'reservado', 'devuelto_cliente', 'en_revendedora'])
          .eq('ingreso_mercaderia.id_proveedor', id)
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('detalle_venta')
      .select('id_detalle_venta, detalle_venta_rendicion!inner(monto_proveedor), venta!inner(estado_venta)')
      .eq('id_proveedor', id)
      .is('id_rendicion', null)
      .eq('excluida_rendicion', false)
      .gt('detalle_venta_rendicion.monto_proveedor', 0)
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

  if (stockConsign.error) throw new Error(`perfil.stockConsign: ${stockConsign.error.message}`)
  if (pend.error) throw new Error(`perfil.pend: ${pend.error.message}`)
  if (rendHist.error) throw new Error(`perfil.rendHist: ${rendHist.error.message}`)
  if (rendPend.error) throw new Error(`perfil.rendPend: ${rendPend.error.message}`)

  const pendRows = ((pend.data ?? []) as Array<{ detalle_venta_rendicion?: unknown }>).map((r) => {
    const emb = Array.isArray(r.detalle_venta_rendicion)
      ? r.detalle_venta_rendicion[0]
      : r.detalle_venta_rendicion
    const raw = (emb as { monto_proveedor?: number | string | null } | null | undefined)?.monto_proveedor
    return { monto_proveedor: raw != null ? Number(raw) : 0 }
  })
  const monto_pendiente_rendicion = pendRows.reduce(
    (acc, r) => acc + r.monto_proveedor,
    0,
  )
  const monto_rendido_historico = ((rendHist.data ?? []) as Array<{ monto_total: number | string }>)
    .reduce((acc, r) => acc + Number(r.monto_total ?? 0), 0)

  const stockRows = ((stockConsign.data ?? []) as Array<{ item_costo?: unknown }>).map((r) => {
    const emb = Array.isArray(r.item_costo) ? r.item_costo[0] : r.item_costo
    const raw = (emb as { costo_ingreso?: number | string | null } | null | undefined)?.costo_ingreso
    return { costo_ingreso: raw != null ? Number(raw) : null }
  })
  const valor_stock_consignacion = permisos.puedeVerCostos
    ? stockRows.reduce((acc, r) => acc + (r.costo_ingreso ?? 0), 0)
    : null

  return proyectarPerfilProveedor(
    {
      items_disponibles: items.count ?? 0,
      consignaciones_activas: consign.count ?? 0,
      monto_pendiente_rendicion,
      lineas_pendientes_rendicion: pendRows.length,
      monto_rendido_historico,
      rendiciones_pendientes_pago: rendPend.count ?? 0,
      valor_stock_consignacion,
      items_en_stock_consignacion: permisos.puedeVerCostos ? stockRows.length : null,
      items_costo_pendiente_consignacion: permisos.puedeVerCostos
        ? stockRows.filter((r) => r.costo_ingreso == null).length
        : null,
      deuda_total_consignacion:
        valor_stock_consignacion != null
          ? valor_stock_consignacion + monto_pendiente_rendicion
          : null,
    },
    permisos,
  )
}
