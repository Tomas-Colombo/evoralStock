import 'server-only'
import { errorDeRpc } from '@/lib/dal/errors'
import { createServerClient } from '@/lib/dal/supabase'
import type {
  MedioPagoRecargo,
  DescuentoDisponible,
  FormaPago,
  PreciosResumen,
  ProductoConPrecioStatus,
  SnapshotPrecio,
} from '@/lib/types/precios'

/**
 * Snapshot de precio para una venta. RPC `sp_calcular_precio_venta_snapshot`
 * aplica los descuentos ELEGIDOS (`idsDescuentos`) que sean válidos para el
 * producto + el recargo por forma de pago. NO persiste — solo calcula.
 *
 * Los ids se pasan "todos juntos" a propósito: el SP valida cada uno contra
 * el producto (alcance + vigencia) e ignora los que no aplican, así el
 * caller no tiene que saber qué descuento pega en qué producto.
 */
export async function calcularSnapshotPrecio(input: {
  idProducto: string
  formaPago?: FormaPago
  idsDescuentos?: string[]
  /**
   * Quién financia (00064). Define QUÉ recargo por cuotas aplica. Omitirlo
   * resuelve contra el comodín, que es el comportamiento anterior a 00063.
   */
  idCuentaDestino?: string | null
  medio?: MedioPagoRecargo | null
  propia?: boolean
}): Promise<SnapshotPrecio> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_calcular_precio_venta_snapshot', {
    p_id_producto: input.idProducto,
    p_forma_pago: input.formaPago ?? 'efectivo',
    p_ids_descuentos: input.idsDescuentos ?? [],
    p_id_cuenta_destino: input.idCuentaDestino ?? null,
    p_medio: input.medio ?? null,
    p_propia: input.propia ?? false,
  })
  if (error) throw new Error(`sp_calcular_precio_venta_snapshot: ${error.message}`)
  return data as SnapshotPrecio
}

/**
 * Descuentos vigentes que aplican a cada producto del carrito. La UI los
 * agrupa: alcance='producto' se ofrece por fila; global/categoría/proveedor
 * en el panel lateral. Un round-trip para todo el carrito.
 */
export async function listDescuentosDisponiblesVenta(
  idsProductos: string[],
): Promise<DescuentoDisponible[]> {
  if (idsProductos.length === 0) return []
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_descuentos_disponibles_venta', {
    p_ids_productos: idsProductos,
  })
  if (error) throw new Error(`sp_descuentos_disponibles_venta: ${error.message}`)
  return ((data ?? []) as Array<DescuentoDisponible & { valor: number | string }>).map((r) => ({
    id_producto: r.id_producto,
    id_regla: r.id_regla,
    nombre: r.nombre,
    alcance: r.alcance,
    tipo_valor: r.tipo_valor,
    valor: Number(r.valor),
    acumulable: r.acumulable,
  }))
}

/**
 * Recalcula (persiste) `precio_venta` de UN producto aplicando la regla
 * de margen resuelta contra el costo vigente. Devuelve el nuevo precio
 * o null si no hay costo vigente.
 */
export async function spRecalcularPrecioVenta(idProducto: string): Promise<number | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_recalcular_precio_venta', {
    p_id_producto: idProducto,
  })
  if (error) throw new Error(errorDeRpc('sp_recalcular_precio_venta', error))
  return data === null ? null : Number(data)
}

/**
 * Recalcula múltiples productos en UN round-trip (`sp_recalcular_precios_batch`,
 * 00040). Devuelve mapa id → precio nuevo (null si no se pudo).
 *
 * El loop vive ahora en Postgres: recorre `p_ids` en orden (la auditoría
 * sigue quedando ordenada, que era el motivo del loop serial original) y
 * aísla cada producto en su propio subbloque, así un fallo devuelve null
 * para ese id sin abortar el resto. Antes esto era un round-trip por id:
 * 35 productos = ~10s.
 */
export async function spRecalcularBatch(ids: string[]): Promise<Record<string, number | null>> {
  if (ids.length === 0) return {}

  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_recalcular_precios_batch', {
    p_ids: ids,
  })
  if (error) throw new Error(errorDeRpc('sp_recalcular_precios_batch', error))

  const out: Record<string, number | null> = {}
  for (const row of (data ?? []) as Array<{ id_producto: string; precio: number | null }>) {
    out[row.id_producto] = row.precio == null ? null : Number(row.precio)
  }
  return out
}

/** Forma cruda que devuelve `sp_control_de_precios` (numerics como number|string). */
interface ControlDePreciosRpcRow {
  id_producto: string
  nombre: string
  sku: string | null
  categoria_nombre: string | null
  costo_vigente: number | string | null
  precio_venta: number | string | null
  precio_venta_resuelto_at: string | null
  precio_venta_desactualizado: boolean
  regla_margen_nombre: string | null
  precio_proyectado: number | string | null
  diferencia_pct: number | string | null
}

/** PostgREST puede serializar `numeric` como string para preservar precisión. */
const num = (v: number | string | null): number | null => (v == null ? null : Number(v))

/**
 * Vista "Control de precios": listado de productos activos con costo,
 * precio actual, regla de margen aplicable, y precio proyectado (preview
 * de qué pasaría si se recalcula ahora).
 *
 * TODO el trabajo pasa en `sp_control_de_precios` (00040): un round-trip.
 * La versión anterior resolvía la cascada de margen desde TS con un
 * `await resolver_regla_margen` POR PRODUCTO — 35 productos activos eran
 * 35 round-trips secuenciales (~10s medidos). El LATERAL de la RPC hace
 * lo mismo en una sola pasada del planner.
 */
export async function listControlDePrecios(): Promise<ProductoConPrecioStatus[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_control_de_precios')
  if (error) throw new Error(`listControlDePrecios: ${error.message}`)

  return ((data ?? []) as ControlDePreciosRpcRow[]).map((r) => ({
    id_producto: r.id_producto,
    nombre: r.nombre,
    sku: r.sku,
    categoria_nombre: r.categoria_nombre,
    costo_vigente: num(r.costo_vigente),
    precio_venta: num(r.precio_venta),
    precio_venta_resuelto_at: r.precio_venta_resuelto_at,
    precio_venta_desactualizado: r.precio_venta_desactualizado,
    regla_margen_nombre: r.regla_margen_nombre,
    precio_proyectado: num(r.precio_proyectado),
    diferencia_pct: num(r.diferencia_pct),
  }))
}

/**
 * Contadores del home de Precios. El home NO usa `precio_proyectado`, así
 * que no tiene por qué pagar la proyección de todo el catálogo: una
 * agregación (`sp_precios_resumen`, 00040) alcanza y sale en un round-trip.
 */
export async function getPreciosResumen(): Promise<PreciosResumen> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .rpc('sp_precios_resumen')
    .single<{
      productos_activos: number
      desactualizados: number
      sin_precio: number
      con_regla: number
    }>()
  if (error) throw new Error(`getPreciosResumen: ${error.message}`)

  return {
    productosActivos: data?.productos_activos ?? 0,
    desactualizados: data?.desactualizados ?? 0,
    sinPrecio: data?.sin_precio ?? 0,
    conRegla: data?.con_regla ?? 0,
  }
}
