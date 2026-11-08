import 'server-only'
import { errorDeRpc } from '@/lib/dal/errors'
import { createServerClient } from '@/lib/dal/supabase'
import type {
  CategoriaGastoRow,
  CategoriaGastoStatus,
  GastoConCategoria,
} from '@/lib/types/rendiciones'

export async function listCategoriasGasto(opts?: {
  soloActivas?: boolean
}): Promise<CategoriaGastoRow[]> {
  const supabase = await createServerClient()
  let q = supabase.from('categoria_gasto').select('*').order('nombre', { ascending: true })
  if (opts?.soloActivas) q = q.eq('activa', true)
  const { data, error } = await q
  if (error) throw new Error(`listCategoriasGasto: ${error.message}`)
  return (data ?? []) as CategoriaGastoRow[]
}

export async function listGastos(opts?: {
  desde?: string
  hasta?: string
  idCategoria?: string
  limit?: number
}): Promise<GastoConCategoria[]> {
  const supabase = await createServerClient()
  let q = supabase
    .from('gasto_negocio')
    .select(`
      *,
      categoria:categoria_gasto(id_categoria_gasto, nombre)
    `)
    .order('fecha', { ascending: false })
    .limit(opts?.limit ?? 200)
  if (opts?.desde) q = q.gte('fecha', opts.desde)
  if (opts?.hasta) q = q.lte('fecha', opts.hasta)
  if (opts?.idCategoria) q = q.eq('id_categoria_gasto', opts.idCategoria)
  const { data, error } = await q
  if (error) throw new Error(`listGastos: ${error.message}`)
  return (data ?? []) as unknown as GastoConCategoria[]
}

export type GastosOrden = 'fecha_desc' | 'fecha_asc' | 'monto_desc' | 'monto_asc'

/**
 * Página del listado con `total` para paginación server-side.
 * Filtros: rango de fechas (inclusivo), categoría, orden.
 */
export async function listGastosPaginado(opts: {
  desde?: string
  hasta?: string
  idCategoria?: string
  orden?: GastosOrden
  page: number
  pageSize: number
}): Promise<{ rows: GastoConCategoria[]; total: number }> {
  const supabase = await createServerClient()
  const from = (Math.max(1, opts.page) - 1) * opts.pageSize
  const to = from + opts.pageSize - 1

  const orderBy: { column: string; ascending: boolean } = (() => {
    switch (opts.orden ?? 'fecha_desc') {
      case 'fecha_asc': return { column: 'fecha', ascending: true }
      case 'monto_desc': return { column: 'monto', ascending: false }
      case 'monto_asc': return { column: 'monto', ascending: true }
      case 'fecha_desc':
      default: return { column: 'fecha', ascending: false }
    }
  })()

  let q = supabase
    .from('gasto_negocio')
    .select(`
      *,
      categoria:categoria_gasto(id_categoria_gasto, nombre)
    `, { count: 'exact' })
    .order(orderBy.column, { ascending: orderBy.ascending })
    .range(from, to)
  if (opts.desde) q = q.gte('fecha', opts.desde)
  if (opts.hasta) q = q.lte('fecha', opts.hasta)
  if (opts.idCategoria) q = q.eq('id_categoria_gasto', opts.idCategoria)
  const { data, count, error } = await q
  if (error) throw new Error(`listGastosPaginado: ${error.message}`)
  return {
    rows: (data ?? []) as unknown as GastoConCategoria[],
    total: count ?? 0,
  }
}

// ─── Categorías de gasto (CRUD) ──────────────────────────────────────

export async function createCategoriaGasto(input: {
  tenantId: string
  nombre: string
}): Promise<CategoriaGastoRow> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('categoria_gasto')
    .insert({
      id_tenant: input.tenantId,
      nombre: input.nombre,
      activa: true,
    })
    .select('*')
    .single()
  if (error) throw new Error(`createCategoriaGasto: ${error.message}`)
  return data as CategoriaGastoRow
}

export async function renameCategoriaGasto(id: string, nombre: string): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('categoria_gasto')
    .update({ nombre })
    .eq('id_categoria_gasto', id)
  if (error) throw new Error(`renameCategoriaGasto: ${error.message}`)
}

/**
 * Baja de una categoría de gasto:
 *  - Si no tiene gastos asociados → DELETE físico.
 *  - Si tiene gastos → soft-delete (`activa=false`, `fecha_baja=now()`) para
 *    preservar la referencia histórica en `gasto_negocio`.
 */
export async function bajaCategoriaGasto(id: string): Promise<{ hardDeleted: boolean }> {
  const supabase = await createServerClient()

  const { count, error: cErr } = await supabase
    .from('gasto_negocio')
    .select('id_gasto', { count: 'exact', head: true })
    .eq('id_categoria_gasto', id)
  if (cErr) throw new Error(`bajaCategoriaGasto count: ${cErr.message}`)

  if ((count ?? 0) === 0) {
    const { error } = await supabase
      .from('categoria_gasto')
      .delete()
      .eq('id_categoria_gasto', id)
    if (error) throw new Error(`bajaCategoriaGasto delete: ${error.message}`)
    return { hardDeleted: true }
  }

  const { error } = await supabase
    .from('categoria_gasto')
    .update({ activa: false, fecha_baja: new Date().toISOString() })
    .eq('id_categoria_gasto', id)
  if (error) throw new Error(`bajaCategoriaGasto soft: ${error.message}`)
  return { hardDeleted: false }
}

export async function reactivarCategoriaGasto(id: string): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('categoria_gasto')
    .update({ activa: true, fecha_baja: null })
    .eq('id_categoria_gasto', id)
  if (error) throw new Error(`reactivarCategoriaGasto: ${error.message}`)
}

/**
 * RF-10: presupuesto vs gastado del mes calendario en curso, por categoría.
 * Se hacen 2 queries y se agregan en memoria. Volumen chico por tenant.
 */
export async function listPresupuestoMes(): Promise<CategoriaGastoStatus[]> {
  const supabase = await createServerClient()
  const inicioMes = new Date()
  inicioMes.setDate(1)
  inicioMes.setHours(0, 0, 0, 0)

  const { data: cats, error: cErr } = await supabase
    .from('categoria_gasto')
    .select('id_categoria_gasto, nombre, presupuesto_mensual')
    .eq('activa', true)
    .order('nombre', { ascending: true })
  if (cErr) throw new Error(`listPresupuestoMes cats: ${cErr.message}`)

  const rows = (cats ?? []) as Array<{
    id_categoria_gasto: string
    nombre: string
    presupuesto_mensual: number | null
  }>
  if (rows.length === 0) return []

  const { data: gastos, error: gErr } = await supabase
    .from('gasto_negocio')
    .select('id_categoria_gasto, monto')
    .gte('fecha', inicioMes.toISOString())
  if (gErr) throw new Error(`listPresupuestoMes gastos: ${gErr.message}`)

  const acum = new Map<string, number>()
  for (const g of gastos ?? []) {
    const k = g.id_categoria_gasto as string
    acum.set(k, (acum.get(k) ?? 0) + Number(g.monto))
  }

  return rows.map((c) => {
    const gastado = acum.get(c.id_categoria_gasto) ?? 0
    const presupuesto = c.presupuesto_mensual == null ? null : Number(c.presupuesto_mensual)
    if (presupuesto == null) {
      return {
        id_categoria_gasto: c.id_categoria_gasto,
        nombre: c.nombre,
        presupuesto_mensual: null,
        gastado_mes: Number(gastado.toFixed(2)),
        gastado_pct: null,
        restante: null,
        sin_control: true,
        alerta: 'sin_control' as const,
      }
    }
    const pct = presupuesto === 0 ? (gastado > 0 ? 999 : 0) : (gastado / presupuesto) * 100
    const restante = presupuesto - gastado
    const alerta: CategoriaGastoStatus['alerta'] =
      pct >= 100 ? 'excedido' : pct >= 80 ? 'cerca' : 'ok'
    return {
      id_categoria_gasto: c.id_categoria_gasto,
      nombre: c.nombre,
      presupuesto_mensual: presupuesto,
      gastado_mes: Number(gastado.toFixed(2)),
      gastado_pct: Number(pct.toFixed(1)),
      restante: Number(restante.toFixed(2)),
      sin_control: false,
      alerta,
    }
  })
}

// ─── RPCs ────────────────────────────────────────────────────────────

export async function spRegistrarGasto(input: {
  idCategoriaGasto: string
  monto: number
  descripcion?: string | null
  fecha?: string | null
  comprobanteRef?: string | null
}): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_registrar_gasto', {
    p_id_categoria_gasto: input.idCategoriaGasto,
    p_monto: input.monto,
    p_descripcion: input.descripcion ?? null,
    p_fecha: input.fecha ?? null,
    p_comprobante_ref: input.comprobanteRef ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_registrar_gasto', error))
  return data as string
}

/**
 * Borrado FÍSICO de un gasto (carga equivocada). No hay soft-delete porque
 * un gasto anulado seguiría apareciendo en el histórico sin aportar nada;
 * `sp_eliminar_gasto` audita la fila completa antes de borrarla.
 */
export async function spEliminarGasto(idGasto: string): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_eliminar_gasto', {
    p_id_gasto: idGasto,
  })
  if (error) throw new Error(errorDeRpc('sp_eliminar_gasto', error))
}

export async function spSetPresupuesto(input: {
  idCategoria: string
  presupuesto: number | null
}): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_set_presupuesto_categoria_gasto', {
    p_id_categoria: input.idCategoria,
    p_presupuesto: input.presupuesto,
  })
  if (error) throw new Error(errorDeRpc('sp_set_presupuesto_categoria_gasto', error))
}
