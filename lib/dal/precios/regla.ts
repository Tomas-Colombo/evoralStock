import 'server-only'
import { errorDeRpc } from '@/lib/dal/errors'
import { createServerClient } from '@/lib/dal/supabase'
import type {
  AlcanceRegla,
  FormaPago,
  ImpactoReglaCategoria,
  ReglaPrecioInsert,
  ReglaPrecioRow,
  TipoRegla,
} from '@/lib/types/precios'

/**
 * Listado de reglas del tenant. Por defecto solo activas (sin fecha_baja).
 */
// Lista explícita, no '*': la Fase 3E de costos-por-columna oculta por policy
// las filas de margen. Nombrar las columnas deja a la vista qué lee cada caller
// y evita que una columna nueva viaje sola hasta el navegador.
const COLUMNAS_REGLA =
  'id_regla, id_tenant, nombre, tipo_regla, tipo_valor, valor, alcance, id_producto, id_categoria, id_proveedor, forma_pago, prioridad, acumulable, fecha_inicio, fecha_hasta, fecha_baja, created_at, updated_at'

export async function listReglasPrecio(opts?: {
  incluirBaja?: boolean
  tipoRegla?: TipoRegla
  alcance?: AlcanceRegla
}): Promise<ReglaPrecioRow[]> {
  const supabase = await createServerClient()
  let q = supabase.from('regla_precio').select(COLUMNAS_REGLA)
    .order('tipo_regla', { ascending: true })
    .order('alcance', { ascending: false }) // producto (más específico) primero
    .order('prioridad', { ascending: false })
    .order('updated_at', { ascending: false })

  if (!opts?.incluirBaja) q = q.is('fecha_baja', null)
  if (opts?.tipoRegla) q = q.eq('tipo_regla', opts.tipoRegla)
  if (opts?.alcance) q = q.eq('alcance', opts.alcance)

  const { data, error } = await q
  if (error) throw new Error(`listReglasPrecio: ${error.message}`)
  return (data ?? []) as ReglaPrecioRow[]
}

export async function getReglaPrecio(id: string): Promise<ReglaPrecioRow | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('regla_precio').select(COLUMNAS_REGLA).eq('id_regla', id).maybeSingle()
  if (error) throw new Error(`getReglaPrecio: ${error.message}`)
  return (data ?? null) as ReglaPrecioRow | null
}

/**
 * Crea una regla vía RPC (audit). Devuelve id_regla.
 * Validación mínima en TS (la DB hace el resto vía checks):
 *   - alcance=producto ⇒ id_producto requerido, no id_categoria/proveedor.
 *   - forma_pago solo con tipo_regla=recargo.
 */
export async function spCreateReglaPrecio(input: ReglaPrecioInsert): Promise<string> {
  if (input.tipo_regla !== 'recargo' && input.forma_pago) {
    throw new Error('forma_pago solo aplica a reglas de recargo')
  }
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_create_regla_precio', {
    p_nombre: input.nombre,
    p_tipo_regla: input.tipo_regla,
    p_tipo_valor: input.tipo_valor,
    p_valor: input.valor,
    p_alcance: input.alcance,
    p_id_producto: input.id_producto ?? null,
    p_id_categoria: input.id_categoria ?? null,
    p_id_proveedor: input.id_proveedor ?? null,
    p_forma_pago: input.forma_pago ?? null,
    p_prioridad: input.prioridad ?? 0,
    p_fecha_inicio: input.fecha_inicio ?? null,
    p_fecha_hasta: input.fecha_hasta ?? null,
    p_acumulable: input.acumulable ?? false,
  })
  if (error) throw new Error(errorDeRpc('sp_create_regla_precio', error))
  return data as string
}

/**
 * Consulta el impacto de una regla de margen por categoría (REQ-CIR-01).
 * Devuelve filas agrupadas por categoría (categoría null = "Sin categoría").
 * Columnas sensibles de precios (cambian, suben, bajan, sin_costo) vienen en null
 * si el usuario no posee inventario.ver_costos.
 */
export async function spImpactoReglaMargen(
  idRegla: string,
): Promise<ImpactoReglaCategoria[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_impacto_regla_margen', {
    p_id_regla: idRegla,
  })
  if (error) throw new Error(errorDeRpc('sp_impacto_regla_margen', error))

  return ((data ?? []) as Array<{
    id_categoria: string | null
    categoria_nombre: string
    productos: number | string
    cambian: number | string | null
    suben: number | string | null
    bajan: number | string | null
    sin_costo: number | string | null
  }>).map((r) => ({
    id_categoria: r.id_categoria,
    categoria_nombre: r.categoria_nombre,
    productos: Number(r.productos),
    cambian: r.cambian == null ? null : Number(r.cambian),
    suben: r.suben == null ? null : Number(r.suben),
    bajan: r.bajan == null ? null : Number(r.bajan),
    sin_costo: r.sin_costo == null ? null : Number(r.sin_costo),
  }))
}

/**
 * Aplica una regla de margen recalculando masivamente en el servidor todos los
 * productos activos que la ganan y poseen costo vigente (REQ-CIR-02).
 * Devuelve la cantidad de productos recalculados.
 */
export async function spAplicarReglaMargen(idRegla: string): Promise<number> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_aplicar_regla_margen', {
    p_id_regla: idRegla,
  })
  if (error) throw new Error(errorDeRpc('sp_aplicar_regla_margen', error))
  return Number(data ?? 0)
}

export async function spBajaReglaPrecio(idRegla: string): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_baja_regla_precio', {
    p_id_regla: idRegla,
  })
  if (error) throw new Error(errorDeRpc('sp_baja_regla_precio', error))
}

export async function spExtenderVigenciaRegla(
  idRegla: string,
  fechaHasta: string,
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_extender_vigencia_regla', {
    p_id_regla: idRegla,
    p_fecha_hasta: fechaHasta,
  })
  if (error) throw new Error(errorDeRpc('sp_extender_vigencia_regla', error))
}

export function reglaAplicaAhora(r: ReglaPrecioRow, now = new Date()): boolean {
  if (r.fecha_baja) return false
  if (r.fecha_inicio && new Date(r.fecha_inicio) > now) return false
  if (r.fecha_hasta && new Date(r.fecha_hasta) < now) return false
  return true
}

export function reglaEstaEnUso(): boolean {
  // Placeholder: cuando exista detalle_venta con id_regla_snapshot,
  // consultar aquí. Por ahora todas las reglas se consideran "no usadas"
  // hasta que Etapa 5 exista.
  return false
}

export type { FormaPago }
