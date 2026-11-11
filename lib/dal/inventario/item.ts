import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import { errorDeRpc } from '@/lib/dal/errors'
import { ESTADOS_IMPRIMIBLES, ETIQUETAS_MAX } from '@/lib/inventario/limites'
import type {
  EstadoItem,
  ItemConProducto,
  ItemProductoRow,
  MovimientoItemRow,
} from '@/lib/types/inventario'

// Lista explícita, no '*': la Fase 3E de costos-por-columna mueve los costos a
// tablas satélite. Con '*' la columna desaparecería en silencio y el lector
// recibiría undefined; nombrada, PostgREST falla (42703) y rg encuentra a todos.
const COLUMNAS_ITEM =
  'id_item, id_tenant, id_producto, id_ingreso, id_ingreso_detalle, qr_code, estado_item, talle, costo_ingreso, tipo_ingreso, fecha_ingreso, fecha_venta, fecha_devolucion, created_at, updated_at'

export { ESTADOS_IMPRIMIBLES, ETIQUETAS_MAX }

/**
 * Buscar item por QR (flujo de escaneo — anexo §5, punto 5). RLS scope-ea
 * automáticamente al tenant actual. Devuelve null si no existe o si existe
 * pero pertenece a otro tenant (RLS lo oculta).
 */
export async function findItemByQr(qr: string): Promise<ItemProductoRow | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('item_producto').select(COLUMNAS_ITEM).eq('qr_code', qr).maybeSingle()
  if (error) throw new Error(`findItemByQr: ${error.message}`)
  return (data ?? null) as ItemProductoRow | null
}

/**
 * Ficha de item + producto + categoría + proveedor + movimientos
 * (Planificacion.txt Etapa 3 §69 "Ficha de producto con escaneo").
 */
export async function getItemConDetalle(idItem: string): Promise<ItemConProducto | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('item_producto')
    .select(`
      ${COLUMNAS_ITEM},
      producto:producto(id_producto, nombre, sku,
        categoria:categoria(id_categoria, nombre)),
      ingreso:ingreso_mercaderia(
        proveedor:proveedor(id_proveedor, nombre, telefono))
    `)
    .eq('id_item', idItem)
    .maybeSingle()

  if (error) throw new Error(`getItemConDetalle: ${error.message}`)
  if (!data) return null

  const { data: movs, error: movErr } = await supabase
    .from('movimiento_item')
    .select('*')
    .eq('id_item', idItem)
    .order('ts', { ascending: false })
  if (movErr) throw new Error(`getItemConDetalle movs: ${movErr.message}`)

  const proveedor = (data as unknown as { ingreso: { proveedor: ItemConProducto['proveedor'] } | null })
    .ingreso?.proveedor ?? null

  return {
    ...(data as ItemProductoRow),
    producto: (data as unknown as { producto: ItemConProducto['producto'] }).producto,
    proveedor,
    movimientos: (movs ?? []) as MovimientoItemRow[],
  }
}

/**
 * Proveedor "habitual" de un producto: el del ingreso más reciente entre sus
 * ítems. Es una regla de negocio (mono-proveedor por producto) que no está
 * enforced en DB, así que la derivamos por historial. Devuelve null si el
 * producto todavía no tiene ítems o si sus ingresos fueron sin proveedor.
 */
export async function getProveedorHabitualDeProducto(
  idProducto: string,
): Promise<{ id_proveedor: string; nombre: string } | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('item_producto')
    .select('ingreso:ingreso_mercaderia!inner(proveedor:proveedor(id_proveedor, nombre))')
    .eq('id_producto', idProducto)
    .order('fecha_ingreso', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`getProveedorHabitualDeProducto: ${error.message}`)
  const prov = (data as { ingreso: { proveedor: { id_proveedor: string; nombre: string } | null } } | null)
    ?.ingreso?.proveedor
  return prov ?? null
}

/**
 * Contexto del último ingreso de un producto: proveedor, tipo (compra o
 * consignación) y costo unitario. Se usa para prefilear el restock — la
 * regla de negocio es que cada producto es mono-proveedor y suele repetir
 * modo de ingreso; el costo se anticipa con el histórico y el usuario lo
 * corrige si cambió. Devuelve null si el producto no tiene ítems.
 */
export async function getUltimoContextoIngresoProducto(
  idProducto: string,
): Promise<{
  proveedor: { id_proveedor: string; nombre: string } | null
  tipoIngreso: 'compra' | 'consignacion'
  costoUnitario: number
} | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('item_producto')
    .select(
      'tipo_ingreso, costo_ingreso, ingreso:ingreso_mercaderia!inner(proveedor:proveedor(id_proveedor, nombre))',
    )
    .eq('id_producto', idProducto)
    .order('fecha_ingreso', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`getUltimoContextoIngresoProducto: ${error.message}`)
  if (!data) return null
  const row = data as unknown as {
    tipo_ingreso: 'compra' | 'consignacion'
    costo_ingreso: number | string
    ingreso: { proveedor: { id_proveedor: string; nombre: string } | null } | null
  }
  return {
    proveedor: row.ingreso?.proveedor ?? null,
    tipoIngreso: row.tipo_ingreso,
    costoUnitario: Number(row.costo_ingreso),
  }
}

/**
 * Asigna talles retroactivamente a ítems que se ingresaron sin talle y siguen
 * disponibles. Delega al RPC `sp_asignar_talles_a_producto` (migration 00044):
 * ese RPC valida el cupo, respeta FIFO, y registra ajuste + auditoría.
 */
export async function spAsignarTallesAProducto(input: {
  idProducto: string
  distribucion: Array<{ talle: string; cantidad: number }>
}): Promise<{ actualizados: number }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_asignar_talles_a_producto', {
    p_id_producto: input.idProducto,
    p_distribucion: input.distribucion,
  })
  if (error) throw new Error(errorDeRpc('sp_asignar_talles_a_producto', error))
  return { actualizados: Number(data ?? 0) }
}

/** Lo único que necesita una etiqueta física: el código y qué producto es. */
export interface ItemParaEtiqueta {
  qr_code: string
  talle: string | null
  nombre: string
  sku: string | null
  descripcion?: string | null
}

/**
 * Ítems para imprimir etiquetas, por sus QR, en UN round-trip.
 *
 * Existe porque la ruta de impresión resolvía cada etiqueta con
 * `findItemByQr` + `getItemConDetalle`: tres queries por etiqueta y en serie
 * (la primera traía el ítem sólo para sacar el `id_item`, la segunda volvía a
 * traer el MISMO ítem con joins, y la tercera el historial de movimientos).
 * Cien etiquetas eran trescientos round-trips secuenciales para imprimir un
 * nombre y un talle.
 *
 * `getItemConDetalle` es el cargador de la ficha y seguirá trayendo el
 * historial, el proveedor y la categoría, porque la ficha los muestra. Una
 * etiqueta no.
 *
 * Los QR que no existen, los que pertenecen a otro tenant (RLS) o los cuyos
 * ítems ya fueron vendidos / dados de baja / devueltos simplemente no vienen
 * en el resultado. El llamador compara contra lo que pidió: una hoja de
 * etiquetas a la que le faltan códigos tiene que avisarlo, no imprimirse corta.
 */
export async function listItemsParaEtiquetas(qrs: string[]): Promise<ItemParaEtiqueta[]> {
  if (qrs.length === 0) return []
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('item_producto')
    .select('qr_code, talle, producto:producto(nombre, sku, descripcion)')
    .in('qr_code', qrs.slice(0, ETIQUETAS_MAX))
    .in('estado_item', [...ESTADOS_IMPRIMIBLES])
  if (error) throw new Error(`listItemsParaEtiquetas: ${error.message}`)

  const filas = (data ?? []) as unknown as Array<{
    qr_code: string
    talle: string | null
    producto: { nombre: string; sku: string | null; descripcion?: string | null } | null
  }>

  // Se devuelven en el orden en que los pidieron, no en el que los dio la DB:
  // la hoja impresa tiene que coincidir con lo que el operador seleccionó.
  const porQr = new Map(filas.map((f) => [f.qr_code, f]))
  return qrs
    .map((qr) => porQr.get(qr))
    .filter((f): f is (typeof filas)[number] => f !== undefined && f.producto !== null)
    .map((f) => ({
      qr_code: f.qr_code,
      talle: f.talle,
      nombre: f.producto!.nombre,
      sku: f.producto!.sku,
      descripcion: f.producto!.descripcion ?? null,
    }))
}

/**
 * Códigos QR vigentes (`disponible` o `reservado`) generados por un ingreso
 * confirmado, en una sola query y en orden determinista de creación, para
 * imprimir o reimprimir la plancha de etiquetas sin incluir ítems ya vendidos,
 * devueltos o dados de baja.
 */
export async function listQrsByIngreso(idIngreso: string): Promise<string[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('item_producto')
    .select('qr_code')
    .eq('id_ingreso', idIngreso)
    .in('estado_item', [...ESTADOS_IMPRIMIBLES])
    .order('created_at', { ascending: true })
    .order('id_item', { ascending: true })
  if (error) throw new Error(`listQrsByIngreso: ${error.message}`)
  return ((data ?? []) as Array<{ qr_code: string }>).map((r) => r.qr_code)
}

/**
 * Carga una tanda paginada de etiquetas desde su origen (ingreso o producto con
 * talle opcional) con conteo total exacto en una sola consulta.
 */
export async function listItemsParaEtiquetasPorOrigen(
  origen:
    | { tipo: 'ingreso'; idIngreso: string; tanda: number }
    | {
        tipo: 'producto'
        idProducto: string
        talle: string | null
        incluirReservados: boolean
        tanda: number
      },
): Promise<{ items: ItemParaEtiqueta[]; total: number }> {
  const supabase = await createServerClient()
  const desde = (Math.max(1, origen.tanda) - 1) * ETIQUETAS_MAX
  const hasta = desde + ETIQUETAS_MAX - 1

  let query = supabase
    .from('item_producto')
    .select('qr_code, talle, producto:producto(nombre, sku, descripcion)', { count: 'exact' })

  if (origen.tipo === 'ingreso') {
    query = query
      .eq('id_ingreso', origen.idIngreso)
      .in('estado_item', [...ESTADOS_IMPRIMIBLES])
  } else {
    query = query.eq('id_producto', origen.idProducto)
    const estados = origen.incluirReservados ? ['disponible', 'reservado'] : ['disponible']
    query = query.in('estado_item', estados)
    if (origen.talle === '__sin__') {
      query = query.is('talle', null)
    } else if (origen.talle !== null) {
      query = query.eq('talle', origen.talle)
    }
  }

  query = query
    .order('created_at', { ascending: true })
    .order('id_item', { ascending: true })
    .range(desde, hasta)

  const { data, error, count } = await query
  if (error) throw new Error(`listItemsParaEtiquetasPorOrigen: ${error.message}`)

  const total = count ?? 0
  const filas = (data ?? []) as unknown as Array<{
    qr_code: string
    talle: string | null
    producto: { nombre: string; sku: string | null; descripcion?: string | null } | null
  }>

  const items = filas
    .filter((f) => f.producto !== null)
    .map((f) => ({
      qr_code: f.qr_code,
      talle: f.talle,
      nombre: f.producto!.nombre,
      sku: f.producto!.sku,
      descripcion: f.producto!.descripcion ?? null,
    }))

  return { items, total }
}

export async function listItemsByProducto(idProducto: string): Promise<ItemProductoRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('item_producto')
    .select(COLUMNAS_ITEM)
    .eq('id_producto', idProducto)
    .order('fecha_ingreso', { ascending: false })
  if (error) throw new Error(`listItemsByProducto: ${error.message}`)
  return (data ?? []) as ItemProductoRow[]
}

/**
 * Unidades `disponible` de un producto (opcionalmente de un talle), ordenadas
 * FIFO (más viejo primero). Se usa al cargar una venta por SKU: un SKU apunta
 * al producto/variante, no a una unidad, así que hay que elegir una unidad
 * concreta. El talle se compara case-insensitive (ilike sin comodines).
 */
/**
 * Filtro de talle para `listItemsDisponibles`:
 *   - `undefined` → no filtra por talle (cualquiera)
 *   - `null`      → sólo unidades SIN talle asignado (talle IS NULL)
 *   - `"M"`       → sólo unidades de ese talle (case-insensitive)
 */
export async function listItemsDisponibles(
  idProducto: string,
  talle?: string | null,
): Promise<ItemProductoRow[]> {
  const supabase = await createServerClient()
  let query = supabase
    .from('item_producto')
    .select(COLUMNAS_ITEM)
    .eq('id_producto', idProducto)
    .eq('estado_item', 'disponible')
    .order('fecha_ingreso', { ascending: true })
    .limit(25)
  if (talle === null) query = query.is('talle', null)
  else if (talle) query = query.ilike('talle', talle)
  const { data, error } = await query
  if (error) throw new Error(`listItemsDisponibles: ${error.message}`)
  return (data ?? []) as ItemProductoRow[]
}

/** Stock de un talle concreto (`null` = unidades sin talle asignado). */
export interface StockPorTalle {
  talle: string | null
  /** Unidades libres: ni reservadas por otro ni ya cargadas en el carrito. */
  disponibles: number
  /**
   * Unidades tomadas por una reserva activa ajena al contexto. Se informan
   * aparte en vez de desaparecer: el vendedor tiene que poder VER que el
   * talle existe pero está reservado.
   */
  reservados: number
}

/**
 * Stock disponible de un producto AGRUPADO POR TALLE.
 *
 * No usa `listItemsDisponibles`: esa función corta en 25 unidades FIFO, y con
 * un corte no se puede saber qué talles existen — si las 25 más viejas son
 * todas "M", el resto de los talles desaparece del mapa.
 *
 * Descuenta las unidades bloqueadas por una reserva activa, salvo las de
 * `idReservaCtx` (la reserva que se está cobrando) y las de `excluir`
 * (unidades que ya están en el carrito y por lo tanto no se pueden volver a
 * agregar).
 *
 * Delega en `sp_stock_por_talle` (00050): un round-trip y sólo viaja el
 * agregado. La versión anterior traía todas las unidades disponibles y después
 * mandaba sus id_item de vuelta en un `.in(...)` para cruzarlas contra
 * `detalle_reserva` — con 3000 unidades eran 3000 UUIDs en el query string y
 * el request moría con 414 URI Too Long.
 */
export async function contarDisponiblesPorTalle(
  idProducto: string,
  opts?: { idReservaCtx?: string | null; excluir?: string[] },
): Promise<{
  porTalle: StockPorTalle[]
  totalDisponible: number
  /** Reservas activas (distintas de `idReservaCtx`) que están bloqueando unidades. */
  reservasBloqueantes: string[]
}> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_stock_por_talle', {
    p_id_producto: idProducto,
    p_id_reserva_ctx: opts?.idReservaCtx ?? null,
    p_excluir: opts?.excluir ?? [],
  })
  if (error) throw new Error(`sp_stock_por_talle: ${error.message}`)

  const r = (data ?? {}) as {
    porTalle?: StockPorTalle[]
    totalDisponible?: number | string
    reservasBloqueantes?: string[]
  }
  return {
    porTalle: r.porTalle ?? [],
    totalDisponible: Number(r.totalDisponible ?? 0),
    reservasBloqueantes: r.reservasBloqueantes ?? [],
  }
}

/**
 * Stock disponible por producto y talle para varios productos del carrito.
 *
 * Cada producto se cuenta con `sp_stock_por_talle`, que agrega en la base.
 * Antes esto traía las unidades una por una y las contaba en memoria: PostgREST
 * corta en `max_rows` (1000), así que con mucho stock el conteo quedaba corto
 * sin avisar, y todos los id_item viajaban en la URL de una sola consulta. Las
 * consultas van en paralelo; el llamador acota N (`validarYFiltrarIdsProductos`).
 */
export async function contarDisponiblesMultiplesProductos(
  idsProductos: string[],
  opts?: { idReservaCtx?: string | null },
): Promise<Array<{ id_producto: string; talle: string | null; disponibles: number }>> {
  const porProducto = await Promise.all(
    idsProductos.map(async (id) => {
      const { porTalle } = await contarDisponiblesPorTalle(id, { idReservaCtx: opts?.idReservaCtx })
      return porTalle.map((s) => ({ id_producto: id, talle: s.talle, disponibles: s.disponibles }))
    }),
  )
  return porProducto.flat()
}

/**
 * Transición de estado — ÚNICO punto de entrada. Llama al RPC que valida
 * la máquina de estados en DB (is_transicion_item_valida). Cualquier
 * UPDATE directo de `estado_item` desde la app es un bug.
 */
export async function spTransicionItem(input: {
  idItem: string
  estadoHasta: EstadoItem
  tipoMovimiento: string
  referenciaId?: string | null
  referenciaTipo?: string | null
}): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_transicion_item_producto', {
    p_id_item: input.idItem,
    p_estado_hasta: input.estadoHasta,
    p_tipo_movimiento: input.tipoMovimiento,
    p_referencia_id: input.referenciaId ?? null,
    p_referencia_tipo: input.referenciaTipo ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_transicion_item_producto', error))
}
