import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import type {
  IngresoConResumen,
  IngresoMercaderiaDetalleRow,
  IngresoMercaderiaInsert,
  IngresoMercaderiaRow,
  ProveedorRow,
  TipoIngreso,
} from '@/lib/types/inventario'

/** Default page size for the paginated ingresos listing. */
export const INGRESOS_PAGE_SIZE = 50

/**
 * Listado de ingresos con resumen agregado (proveedor + totales).
 * Ordenado por fecha desc. Query única: cabecera + join proveedor +
 * aggregation de detalle en memoria (cantidad y costo).
 *
 * Pagina siempre: devuelve la página pedida (`page`, 1-based) + el total de
 * ingresos, para no traer todo el historial de una a la vista de lista.
 */
export async function listIngresosConResumen(opts?: {
  page?: number
  pageSize?: number
}): Promise<{ rows: IngresoConResumen[]; total: number }> {
  const supabase = await createServerClient()
  const page = Math.max(1, opts?.page ?? 1)
  const pageSize = opts?.pageSize ?? INGRESOS_PAGE_SIZE
  const from = (page - 1) * pageSize

  const { data, error, count } = await supabase
    .from('ingreso_mercaderia')
    .select(
      `
      *,
      proveedor:proveedor(id_proveedor, nombre),
      detalle:ingreso_mercaderia_detalle(cantidad, costo_unitario)
    `,
      { count: 'exact' },
    )
    // Los cancelados se borran de verdad (00039); este filtro oculta cualquier
    // registro viejo que todavía tenga cancelado_at.
    .is('cancelado_at', null)
    .order('fecha', { ascending: false })
    .range(from, from + pageSize - 1)
  if (error) throw new Error(`listIngresosConResumen: ${error.message}`)

  const rows = ((data ?? []) as Array<
    IngresoMercaderiaRow & {
      proveedor: Pick<ProveedorRow, 'id_proveedor' | 'nombre'> | null
      detalle: Array<{ cantidad: number; costo_unitario: number }>
    }
  >).map((row) => {
    const detalle = row.detalle ?? []
    const total_cantidad = detalle.reduce((acc, d) => acc + Number(d.cantidad), 0)
    const total_costo = detalle.reduce(
      (acc, d) => acc + Number(d.cantidad) * Number(d.costo_unitario),
      0,
    )
    const { detalle: _drop, ...rest } = row
    void _drop
    return {
      ...rest,
      total_lineas: detalle.length,
      total_cantidad,
      total_costo,
    }
  })

  return { rows, total: count ?? 0 }
}

/**
 * Ingresos de UN proveedor, con resumen de cantidad/costo. No pagina — la
 * usa el perfil del proveedor y ahí conviene ver el histórico completo
 * (la lista general sí pagina). Excluye cancelados por consistencia con
 * `listIngresosConResumen`.
 */
export async function listIngresosDeProveedor(
  idProveedor: string,
): Promise<IngresoConResumen[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('ingreso_mercaderia')
    .select(
      `
      *,
      proveedor:proveedor(id_proveedor, nombre),
      detalle:ingreso_mercaderia_detalle(cantidad, costo_unitario)
    `,
    )
    .eq('id_proveedor', idProveedor)
    .is('cancelado_at', null)
    .order('fecha', { ascending: false })
  if (error) throw new Error(`listIngresosDeProveedor: ${error.message}`)

  return ((data ?? []) as Array<
    IngresoMercaderiaRow & {
      proveedor: Pick<ProveedorRow, 'id_proveedor' | 'nombre'> | null
      detalle: Array<{ cantidad: number; costo_unitario: number }>
    }
  >).map((row) => {
    const detalle = row.detalle ?? []
    const total_cantidad = detalle.reduce((acc, d) => acc + Number(d.cantidad), 0)
    const total_costo = detalle.reduce(
      (acc, d) => acc + Number(d.cantidad) * Number(d.costo_unitario),
      0,
    )
    const { detalle: _drop, ...rest } = row
    void _drop
    return {
      ...rest,
      total_lineas: detalle.length,
      total_cantidad,
      total_costo,
    }
  })
}

export async function getIngreso(id: string): Promise<
  | (IngresoMercaderiaRow & {
      proveedor: Pick<ProveedorRow, 'id_proveedor' | 'nombre' | 'telefono'> | null
      detalle: IngresoMercaderiaDetalleRow[]
    })
  | null
> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('ingreso_mercaderia')
    .select(`
      *,
      proveedor:proveedor(id_proveedor, nombre, telefono),
      detalle:ingreso_mercaderia_detalle(*)
    `)
    .eq('id_ingreso', id)
    .maybeSingle()
  if (error) throw new Error(`getIngreso: ${error.message}`)
  if (!data) return null
  return data as unknown as Awaited<ReturnType<typeof getIngreso>>
}

/**
 * Crea un ingreso "borrador" (confirmado=false) sin líneas todavía.
 * Devuelve el id_ingreso. Las líneas se agregan con `addIngresoDetalle`.
 * La confirmación (que genera los items físicos) usa `spConfirmarIngreso`.
 */
export async function createIngresoBorrador(input: {
  tenantId: string
  idProveedor: string | null
  tipoIngreso: TipoIngreso
  numeroRemito?: string | null
  observaciones?: string | null
  pdfUrl?: string | null
  idUsuarioAlta?: string | null
}): Promise<string> {
  const supabase = await createServerClient()
  const payload: IngresoMercaderiaInsert = {
    id_tenant: input.tenantId,
    id_proveedor: input.idProveedor ?? null,
    tipo_ingreso: input.tipoIngreso,
    numero_remito: input.numeroRemito ?? null,
    observaciones: input.observaciones ?? null,
    pdf_url: input.pdfUrl ?? null,
    id_usuario_alta: input.idUsuarioAlta ?? null,
  }
  const { data, error } = await supabase
    .from('ingreso_mercaderia').insert(payload).select('id_ingreso').single()
  if (error) throw new Error(`createIngresoBorrador: ${error.message}`)
  return (data as { id_ingreso: string }).id_ingreso
}

/**
 * ¿Ya existe un ingreso con este número de remito para el mismo proveedor?
 * Espeja el índice único parcial (00038): el remito es opcional y puede
 * repetirse entre proveedores distintos, pero no dentro del mismo. Los
 * ingresos sin proveedor se agrupan entre sí (id_proveedor null). Sirve para
 * dar un mensaje claro antes de insertar; el índice queda como backstop
 * anti-carrera.
 */
export async function remitoDuplicado(input: {
  idProveedor: string | null
  numeroRemito: string
}): Promise<boolean> {
  const supabase = await createServerClient()
  let query = supabase
    .from('ingreso_mercaderia')
    .select('id_ingreso', { count: 'exact', head: true })
    .eq('numero_remito', input.numeroRemito)
  query = input.idProveedor
    ? query.eq('id_proveedor', input.idProveedor)
    : query.is('id_proveedor', null)
  const { count, error } = await query
  if (error) throw new Error(`remitoDuplicado: ${error.message}`)
  return (count ?? 0) > 0
}

export async function addIngresoDetalle(input: {
  tenantId: string
  idIngreso: string
  idProducto: string
  cantidad: number
  costoUnitario: number
  talle?: string | null
  costoOriginalUsd?: number | null
  cotizacionAplicada?: number | null
  cotizacionFechaValor?: string | null
}): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('ingreso_mercaderia_detalle')
    .insert({
      id_tenant: input.tenantId,
      id_ingreso: input.idIngreso,
      id_producto: input.idProducto,
      cantidad: input.cantidad,
      costo_unitario: input.costoUnitario,
      talle: input.talle ?? null,
      costo_original_usd: input.costoOriginalUsd ?? null,
      cotizacion_aplicada: input.cotizacionAplicada ?? null,
      cotizacion_fecha_valor: input.cotizacionFechaValor ?? null,
    })
    .select('id_detalle')
    .single()
  if (error) throw new Error(`addIngresoDetalle: ${error.message}`)
  return (data as { id_detalle: string }).id_detalle
}

export type DetalleImportado = {
  id_detalle: string
  id_producto: string
  nombre: string
  cantidad: number
  costo_unitario: number
  talle: string | null
}

/**
 * Import masivo de un remito en UNA transacción (sp_importar_remito):
 * crea productos + costos + detalle, o vincula existentes. Atómico y en
 * un solo round-trip. Devuelve los detalles creados para el optimista.
 */
export async function spImportarRemito(input: {
  idIngreso: string
  moneda?: string
  cotizacionAplicada?: number | null
  cotizacionFechaValor?: string | null
  ip?: string | null
  lineas: Array<{
    esNuevo: boolean
    idProducto: string | null
    idCategoria: string | null
    nombre: string
    costoUnitario: number
    costoOriginalUsd?: number | null
    partes: Array<{ talle: string | null; cantidad: number }>
  }>
}): Promise<{ creados: number; vinculados: number; detalles: DetalleImportado[] }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_importar_remito', {
    p_id_ingreso: input.idIngreso,
    p_moneda: input.moneda ?? 'ARS',
    p_lineas: input.lineas,
    p_ip: input.ip ?? null,
    p_cotizacion_aplicada: input.cotizacionAplicada ?? null,
    p_cotizacion_fecha_valor: input.cotizacionFechaValor ?? null,
  })
  if (error) throw new Error(`sp_importar_remito: ${error.message}`)
  const r = (data ?? {}) as {
    creados?: number
    vinculados?: number
    detalles?: DetalleImportado[]
  }
  return {
    creados: r.creados ?? 0,
    vinculados: r.vinculados ?? 0,
    detalles: r.detalles ?? [],
  }
}

/**
 * Cancela/revierte un ingreso (sp_cancelar_ingreso, atómico):
 *  - Borrador → elimina cabecera + detalle.
 *  - Confirmado → solo si todos los ítems siguen 'disponible'; los da de
 *    baja y marca el ingreso como cancelado. Falla si alguno se movió.
 */
export async function spCancelarIngreso(input: {
  idIngreso: string
  motivo?: string | null
}): Promise<{ modo: 'borrador' | 'confirmado'; items_baja: number; productos_eliminados: number }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_cancelar_ingreso', {
    p_id_ingreso: input.idIngreso,
    p_motivo: input.motivo ?? null,
  })
  if (error) throw new Error(`sp_cancelar_ingreso: ${error.message}`)
  const r = (data ?? {}) as {
    modo?: 'borrador' | 'confirmado'
    items_baja?: number
    productos_eliminados?: number
  }
  return {
    modo: r.modo ?? 'confirmado',
    items_baja: r.items_baja ?? 0,
    productos_eliminados: r.productos_eliminados ?? 0,
  }
}

/**
 * Borra una línea del ingreso. `idIngreso` NO es decorativo: filtra por las dos
 * claves para que un id_detalle de otro ingreso no se pueda borrar pasándolo
 * por la action. La RLS acota al tenant, pero adentro del tenant no acota nada.
 */
export async function removeIngresoDetalle(
  idDetalle: string,
  idIngreso: string,
): Promise<void> {
  const supabase = await createServerClient()
  const { error, count } = await supabase
    .from('ingreso_mercaderia_detalle')
    .delete({ count: 'exact' })
    .eq('id_detalle', idDetalle)
    .eq('id_ingreso', idIngreso)
  if (error) throw new Error(`removeIngresoDetalle: ${error.message}`)
  // Sin filas borradas la línea no era de este ingreso (o no existe). Se
  // reporta en vez de devolver ok con un no-op silencioso.
  if ((count ?? 0) === 0) throw new Error('La línea no pertenece a este ingreso.')
}

/**
 * Confirma el ingreso: genera N item_producto (uno por unidad de cada línea),
 * cada uno con QR único (hex 24 chars). Devuelve la cantidad de items generados.
 * Idempotente: si ya está confirmado, devuelve 0.
 */
export async function spConfirmarIngreso(idIngreso: string): Promise<number> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_confirmar_ingreso', {
    p_id_ingreso: idIngreso,
  })
  if (error) throw new Error(`sp_confirmar_ingreso: ${error.message}`)
  return Number(data ?? 0)
}
