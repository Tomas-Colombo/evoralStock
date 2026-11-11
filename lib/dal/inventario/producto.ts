import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import { errorDeRpc } from '@/lib/dal/errors'
import type {
  ProductoConDetalle,
  ProductoRow,
  ProductoSinCosto,
  TipoIngreso,
} from '@/lib/types/inventario'

/** Default page size for the paginated product listing. */
export const PRODUCTOS_PAGE_SIZE = 50

export type { ProductoSinCosto } from '@/lib/types/inventario'

export type ProductoRowConCategoria = ProductoRow & {
  categoria: { id_categoria: string; nombre: string; talles: string[] } | null
}

export interface ListProductosOpts {
  search?: string
  idCategoria?: string
  soloActivos?: boolean
  /** 1-based page. Pagination only kicks in when both page & pageSize are set. */
  page?: number
  pageSize?: number
}

/** PostgREST puede serializar `numeric` como string para preservar precisión. */
const num = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v)

/** Payload de `sp_listar_productos` (00042). */
interface ListarProductosRpc {
  total: number | string
  rows: Array<
    Omit<ProductoConDetalle, 'costo_vigente' | 'precio_venta'> & {
      costo_vigente: number | string | null
      precio_venta: number | string | null
    }
  >
}

/**
 * Núcleo compartido del listado maestro. Devuelve la página pedida + el
 * total que matchea los filtros (para paginar). Sin `page`/`pageSize` trae
 * todo.
 *
 * UN round-trip (`sp_listar_productos`, 00042). La versión anterior hacía
 * tres en cadena — producto+categoria, después `costo_producto` acotado a
 * los ids, después `item_producto` — y agregaba en memoria. Con las queries
 * ejecutando en ~1ms y cada round-trip costando ~258ms, esa cadena era casi
 * todo el tiempo de la home de Inventario.
 */
async function queryProductos(
  opts?: ListProductosOpts,
): Promise<{ rows: ProductoConDetalle[]; total: number }> {
  const supabase = await createServerClient()
  const paginate = opts?.page != null && opts?.pageSize != null

  const { data, error } = await supabase.rpc('sp_listar_productos', {
    p_search: opts?.search ?? null,
    p_id_categoria: opts?.idCategoria ?? null,
    p_solo_activos: opts?.soloActivos ?? false,
    p_limit: paginate ? opts!.pageSize! : null,
    p_offset: paginate ? (opts!.page! - 1) * opts!.pageSize! : 0,
  })
  if (error) throw new Error(`listProductosConDetalle: ${error.message}`)

  const payload = (data ?? { total: 0, rows: [] }) as ListarProductosRpc
  const rows: ProductoConDetalle[] = (payload.rows ?? []).map((r) => ({
    ...r,
    precio_venta: num(r.precio_venta),
    costo_vigente: num(r.costo_vigente),
  }))

  return { rows, total: paginate ? Number(payload.total ?? 0) : rows.length }
}

/**
 * Listado maestro de productos con costo vigente + categoría + stock (todo).
 *
 * Un solo round-trip (ver `queryProductos`). Para la vista paginada usar
 * `listProductosConDetallePaginado` — esta trae la tabla completa y es la que
 * consumen los pickers/dashboard que necesitan todos los productos.
 */
export async function listProductosConDetalle(
  opts?: Omit<ListProductosOpts, 'page' | 'pageSize'>,
): Promise<ProductoConDetalle[]> {
  const { rows } = await queryProductos(opts)
  return rows
}

/**
 * Variante paginada del listado maestro: trae solo `pageSize` filas y el
 * total de coincidencias, para no cargar toda la tabla en la vista de lista.
 */
export async function listProductosConDetallePaginado(opts: {
  search?: string
  idCategoria?: string
  soloActivos?: boolean
  page: number
  pageSize: number
}): Promise<{ rows: ProductoConDetalle[]; total: number }> {
  return queryProductos(opts)
}

import { omitirCostoProducto } from '@/lib/inventario/proyeccion-costos'
export { omitirCostoProducto }

/**
 * Variante del listado maestro sin costo vigente ni margen.
 * Para Server Components cuyas vistas cliente no muestran ni consumen costo.
 */
export async function listProductosSinCosto(
  opts?: Omit<ListProductosOpts, 'page' | 'pageSize'>,
): Promise<ProductoSinCosto[]> {
  const { rows } = await queryProductos(opts)
  return rows.map(omitirCostoProducto)
}

/**
 * Variante paginada sin costo ni margen para la tabla de inventario cuando
 * no se deben exponer costos al cliente.
 */
export async function listProductosSinCostoPaginado(opts: {
  search?: string
  idCategoria?: string
  soloActivos?: boolean
  page: number
  pageSize: number
}): Promise<{ rows: ProductoSinCosto[]; total: number }> {
  const { rows, total } = await queryProductos(opts)
  return {
    rows: rows.map(omitirCostoProducto),
    total,
  }
}

/**
 * Cifras rápidas del módulo (KPIs de la home) sin cargar toda la tabla
 * hidratada: 2 queries de columnas mínimas (producto: id+stock_minimo;
 * item_producto: solo los `disponible`), agregadas en memoria. Reemplaza el
 * `listProductosConDetalle()` completo, que traía costos + categoría + todos
 * los items solo para estos totales.
 */
export async function getInventarioResumen(): Promise<{
  productosActivos: number
  stockDisponibleTotal: number
  productosBajoMinimo: number
}> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_inventario_resumen').single<{
    productos_activos: number
    stock_disponible_total: number
    productos_bajo_minimo: number
  }>()
  if (error) throw new Error(`getInventarioResumen: ${error.message}`)

  return {
    productosActivos: data?.productos_activos ?? 0,
    stockDisponibleTotal: data?.stock_disponible_total ?? 0,
    productosBajoMinimo: data?.productos_bajo_minimo ?? 0,
  }
}

/** Fila mínima para el buscador con sugerencias (solo nombre + SKU). */
export interface ProductoBuscadorItem {
  id_producto: string
  nombre: string
  sku: string | null
}

/**
 * Catálogo liviano para el buscador con autocompletado: trae SOLO id/nombre/sku
 * de los productos activos. A diferencia de `listProductosConDetalle`, no
 * hidrata costos ni stock (esas 2 queries extra no hacen falta para sugerir),
 * así que es barata aunque el catálogo sea grande.
 */
export async function listProductosParaBuscador(): Promise<ProductoBuscadorItem[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('producto')
    .select('id_producto, nombre, sku')
    .eq('activo', true)
    .order('nombre', { ascending: true })
  if (error) throw new Error(`listProductosParaBuscador: ${error.message}`)
  return (data ?? []) as ProductoBuscadorItem[]
}

export async function getProducto(id: string): Promise<ProductoRow | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('producto').select('*').eq('id_producto', id).maybeSingle()
  if (error) throw new Error(`getProducto: ${error.message}`)
  return (data ?? null) as ProductoRow | null
}

/**
 * Producto con su categoría (incluyendo `talles`), usado al buscar por
 * `id_producto` en los pickers de venta, reserva y consignación.
 */
export async function getProductoConCategoria(
  id: string,
): Promise<ProductoRowConCategoria | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('producto')
    .select('*, categoria:categoria(id_categoria, nombre, talles)')
    .eq('id_producto', id)
    .maybeSingle()
  if (error) throw new Error(`getProductoConCategoria: ${error.message}`)
  return (data ?? null) as ProductoRowConCategoria | null
}

/**
 * Busca un producto por su SKU exacto (scope-eado al tenant por RLS). Se usa
 * en el fallback de búsqueda manual sin escáner: el vendedor tipea el SKU
 * corto (ej: REM-0007) impreso/anotado y llega al producto.
 */
export async function findProductoBySku(
  sku: string,
): Promise<ProductoRowConCategoria | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('producto')
    .select('*, categoria:categoria(id_categoria, nombre, talles)')
    .eq('sku', sku)
    .maybeSingle()
  if (error) throw new Error(`findProductoBySku: ${error.message}`)
  return (data ?? null) as ProductoRowConCategoria | null
}

/**
 * Alta de producto vía RPC `sp_create_producto` (audit + creación en la
 * misma transacción). Devuelve el id_producto nuevo.
 */
export async function spCreateProducto(input: {
  idCategoria: string
  nombre: string
  sku?: string | null
  stockMinimo?: number
  descripcion?: string | null
}): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_create_producto', {
    p_id_categoria: input.idCategoria,
    p_nombre: input.nombre,
    p_sku: input.sku ?? null,
    p_stock_minimo: input.stockMinimo ?? 0,
    p_descripcion: input.descripcion ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_create_producto', error))
  return data as string
}

/**
 * Genera stock inicial (items físicos con QR) para un producto, sin pasar
 * por un ingreso. `items` = pares talle/cantidad. Devuelve cuántos se crearon.
 */
export async function spCrearStockDirecto(input: {
  idProducto: string
  costo?: number | null
  tipoIngreso?: TipoIngreso
  items: Array<{ talle: string | null; cantidad: number }>
}): Promise<number> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_crear_stock_directo', {
    p_id_producto: input.idProducto,
    p_costo: input.costo ?? null,
    p_tipo_ingreso: input.tipoIngreso ?? 'compra',
    p_items: input.items,
  })
  if (error) throw new Error(errorDeRpc('sp_crear_stock_directo', error))
  return data as number
}

/**
 * Setea un nuevo costo vigente. Cierra el anterior automáticamente
 * (sp_set_costo_producto lo resuelve).
 */
export async function spSetCostoProducto(input: {
  idProducto: string
  costo: number
  moneda?: string
  motivo?: string | null
  ip?: string | null
  costoOriginalUsd?: number | null
  cotizacionAplicada?: number | null
  cotizacionFechaValor?: string | null
}): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_set_costo_producto', {
    p_id_producto: input.idProducto,
    p_costo: input.costo,
    p_moneda: input.moneda ?? 'ARS',
    p_motivo: input.motivo ?? null,
    p_ip: input.ip ?? null,
    p_costo_original_usd: input.costoOriginalUsd ?? null,
    p_cotizacion_aplicada: input.cotizacionAplicada ?? null,
    p_cotizacion_fecha_valor: input.cotizacionFechaValor ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_set_costo_producto', error))
  return data as string
}

/** Update simple de metadatos (no toca costo — para eso está spSetCostoProducto). */
export async function updateProducto(
  id: string,
  patch: {
    nombre?: string
    sku?: string | null
    descripcion?: string | null
    stock_minimo?: number
    id_categoria?: string
    activo?: boolean
    es_nuevo?: boolean
  },
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('producto').update(patch).eq('id_producto', id)
  if (error) throw new Error(`updateProducto: ${error.message}`)
}
