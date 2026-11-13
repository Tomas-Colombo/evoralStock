import 'server-only'
import { createServerClient } from '@/lib/dal/supabase'
import { errorDeRpc } from '@/lib/dal/errors'
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
      detalle:ingreso_mercaderia_detalle(cantidad, ingreso_detalle_costo(costo_unitario))
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
      detalle: Array<{
        cantidad: number
        ingreso_detalle_costo?: { costo_unitario?: number | string | null } | Array<{ costo_unitario?: number | string | null }> | null
      }>
    }
  >).map((row) => {
    const detalle = (row.detalle ?? []).map((d) => {
      const embed = Array.isArray(d.ingreso_detalle_costo) ? d.ingreso_detalle_costo[0] : d.ingreso_detalle_costo
      const raw = embed?.costo_unitario
      return {
        cantidad: d.cantidad,
        costo_unitario: raw != null ? Number(raw) : null,
      }
    })
    const total_cantidad = detalle.reduce((acc, d) => acc + Number(d.cantidad), 0)
    const costo_pendiente = detalle.some((d) => d.costo_unitario == null)
    const total_costo = costo_pendiente
      ? null
      : detalle.reduce(
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
      costo_pendiente,
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
      detalle:ingreso_mercaderia_detalle(cantidad, ingreso_detalle_costo(costo_unitario))
    `,
    )
    .eq('id_proveedor', idProveedor)
    .is('cancelado_at', null)
    .order('fecha', { ascending: false })
  if (error) throw new Error(`listIngresosDeProveedor: ${error.message}`)

  return ((data ?? []) as Array<
    IngresoMercaderiaRow & {
      proveedor: Pick<ProveedorRow, 'id_proveedor' | 'nombre'> | null
      detalle: Array<{
        cantidad: number
        ingreso_detalle_costo?: { costo_unitario?: number | string | null } | Array<{ costo_unitario?: number | string | null }> | null
      }>
    }
  >).map((row) => {
    const detalle = (row.detalle ?? []).map((d) => {
      const embed = Array.isArray(d.ingreso_detalle_costo) ? d.ingreso_detalle_costo[0] : d.ingreso_detalle_costo
      const raw = embed?.costo_unitario
      return {
        cantidad: d.cantidad,
        costo_unitario: raw != null ? Number(raw) : null,
      }
    })
    const total_cantidad = detalle.reduce((acc, d) => acc + Number(d.cantidad), 0)
    const costo_pendiente = detalle.some((d) => d.costo_unitario == null)
    const total_costo = costo_pendiente
      ? null
      : detalle.reduce(
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
      costo_pendiente,
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
      detalle:ingreso_mercaderia_detalle(id_detalle, id_tenant, id_ingreso, id_producto,
        cantidad, talle, created_at,
        ingreso_detalle_costo(costo_unitario, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor))
    `)
    .eq('id_ingreso', id)
    .maybeSingle()
  if (error) throw new Error(`getIngreso: ${error.message}`)
  if (!data) return null

  const row = data as unknown as {
    detalle?: Array<
      Omit<IngresoMercaderiaDetalleRow, 'costo_unitario'> & {
        ingreso_detalle_costo?: {
          costo_unitario?: number | string | null
          costo_original_usd?: number | string | null
          cotizacion_aplicada?: number | string | null
          cotizacion_fecha_valor?: string | null
        } | Array<{
          costo_unitario?: number | string | null
          costo_original_usd?: number | string | null
          cotizacion_aplicada?: number | string | null
          cotizacion_fecha_valor?: string | null
        }> | null
      }
    >
    [k: string]: unknown
  }

  const detalleAplanado = (row.detalle ?? []).map((d) => {
    const embed = Array.isArray(d.ingreso_detalle_costo) ? d.ingreso_detalle_costo[0] : d.ingreso_detalle_costo
    const rawCosto = embed?.costo_unitario
    const { ingreso_detalle_costo: _drop, ...rest } = d
    void _drop
    return {
      ...rest,
      costo_unitario: rawCosto != null ? Number(rawCosto) : null,
    }
  })

  return {
    ...row,
    detalle: detalleAplanado,
  } as unknown as Awaited<ReturnType<typeof getIngreso>>
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
  costoUnitario?: number | null
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
      talle: input.talle ?? null,
    })
    .select('id_detalle')
    .single()
  if (error) throw new Error(`addIngresoDetalle: ${error.message}`)
  const idDetalle = (data as { id_detalle: string }).id_detalle

  if (input.costoUnitario != null) {
    const { error: errCosto } = await supabase
      .from('ingreso_detalle_costo')
      .insert({
        id_detalle: idDetalle,
        id_tenant: input.tenantId,
        costo_unitario: input.costoUnitario,
        costo_original_usd: input.costoOriginalUsd ?? null,
        cotizacion_aplicada: input.cotizacionAplicada ?? null,
        cotizacion_fecha_valor: input.cotizacionFechaValor ?? null,
      })
    if (errCosto) throw new Error(`addIngresoDetalle (costo): ${errCosto.message}`)
  }

  return idDetalle
}

export type DetalleImportado = {
  id_detalle: string
  id_producto: string
  nombre: string
  cantidad: number
  costo_unitario: number | null
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
    costoUnitario?: number | null
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
  if (error) throw new Error(errorDeRpc('sp_importar_remito', error))
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
 * Completa costos de líneas pendientes (costo_unitario null) en ingresos confirmados.
 */
export async function spCompletarCostoIngreso(input: {
  idIngreso: string
  lineas: Array<{ idDetalle: string; costoUnitario: number }>
  ip?: string | null
}): Promise<number> {
  const supabase = await createServerClient()
  const payloadLineas = input.lineas.map((l) => ({
    id_detalle: l.idDetalle,
    costo_unitario: l.costoUnitario,
  }))
  const { data, error } = await supabase.rpc('sp_completar_costo_ingreso', {
    p_id_ingreso: input.idIngreso,
    p_lineas: payloadLineas,
    p_ip: input.ip ?? null,
  })
  if (error) throw new Error(errorDeRpc('sp_completar_costo_ingreso', error))
  return Number(data ?? 0)
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
  if (error) throw new Error(errorDeRpc('sp_cancelar_ingreso', error))
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
  if (error) throw new Error(errorDeRpc('sp_confirmar_ingreso', error))
  return Number(data ?? 0)
}
