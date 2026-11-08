'use server'

import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession, type Session } from '@/lib/dal/session'
import { capacidades, tiposIngresoPermitidos } from '@/lib/modulos/capacidades'
import {
  crearIngresoCompletoSchema,
  extraerReasonZod,
} from '@/lib/validation/inventario'
import {
  createCategoria,
  toggleCategoriaActiva,
  updateCategoria,
} from '@/lib/dal/inventario/categoria'
import {
  spCrearStockDirecto,
  spCreateProducto,
  spSetCostoProducto,
  updateProducto,
} from '@/lib/dal/inventario/producto'
import {
  type CotizacionVigente,
  getCotizacionVigente,
  leerCotizacionVigente,
} from '@/lib/dal/precios/cotizacion'
import { convertirUsdEnArs } from '@/lib/cotizacion/convertir'
import {
  spAsignarTallesAProducto,
  spTransicionItem,
} from '@/lib/dal/inventario/item'
import { spRegistrarAjusteInventario } from '@/lib/dal/consignaciones/consignacion'
import {
  addIngresoDetalle,
  createIngresoBorrador,
  removeIngresoDetalle,
  remitoDuplicado,
  spCancelarIngreso,
  spConfirmarIngreso,
  spImportarRemito,
} from '@/lib/dal/inventario/ingreso'
import {
  excedeOperacion,
  MAX_PDF_BYTES,
  MAX_UNIDADES_OPERACION,
  montoInvalido,
  unidadesInvalidas,
} from '@/lib/inventario/limites'
import { extraerRemitoDesdePdf } from '@/lib/inventario/remito-pdf.server'
import { pareceUnPdf, type ParsedRemito } from '@/lib/inventario/remito-pdf'
import type { EstadoItem, TipoIngreso } from '@/lib/types/inventario'

/**
 * Server Actions del módulo Inventario.
 *
 * Contrato: cada acción devuelve `{ ok: true, ... }` o
 * `{ ok: false, reason: string }`. Nunca tira al cliente — atrapamos
 * AuthorizationError y devolvemos su `reason`. El caller (form/hook)
 * decide qué toast/redirect mostrar.
 */

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string }

async function guarded(
  accion: string,
): Promise<{ tenantId: string; userId: string; session: Session } | { error: string }> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'inventario', accion)
    return { tenantId: session.tenantId, userId: session.user.id, session }
  } catch (error) {
    if (error instanceof AuthorizationError) return { error: error.reason }
    throw error
  }
}

/**
 * Helper compartido para resolver cotización vigente y convertir líneas de carga en USD a ARS.
 * Mantiene una sola consulta de cotización por acción y propaga cotizacionDesactualizada.
 */
async function resolverConversionCarga<T extends { costoUnitario: number }>(
  moneda: string | undefined | null,
  lineas: T[],
): Promise<
  | {
      ok: true
      esUsd: boolean
      cotizacionValor: number | null
      cotizacionFechaValor: string | null
      cotizacionDesactualizada: boolean
      lineas: (T & { costoOriginalUsd?: number | null })[]
    }
  | { ok: false; reason: string }
> {
  const esUsd = moneda === 'USD'
  if (!esUsd) {
    return {
      ok: true,
      esUsd: false,
      cotizacionValor: null,
      cotizacionFechaValor: null,
      cotizacionDesactualizada: false,
      lineas,
    }
  }

  try {
    const cot = await getCotizacionVigente()
    if (!cot || !cot.valor || cot.valor <= 0 || !cot.fechaValor) {
      return { ok: false, reason: 'sin-cotizacion-dolar' }
    }
    const lineasConvertidas = lineas.map((linea) => {
      const costoOriginal = linea.costoUnitario
      const costoArs = convertirUsdEnArs(costoOriginal, cot.valor)
      return {
        ...linea,
        costoUnitario: costoArs,
        costoOriginalUsd: costoOriginal,
      }
    })
    return {
      ok: true,
      esUsd: true,
      cotizacionValor: cot.valor,
      cotizacionFechaValor: cot.fechaValor,
      cotizacionDesactualizada: Boolean(cot.desactualizada),
      lineas: lineasConvertidas,
    }
  } catch (e) {
    const msg = (e as Error).message
    return { ok: false, reason: msg.includes('sin-cotizacion-dolar') ? 'sin-cotizacion-dolar' : msg }
  }
}

// ─── Categorías ──────────────────────────────────────────────────────

/** Normaliza talles: trim, saca vacíos y duplicados (case-insensitive). */
function normalizarTalles(talles?: string[] | null): string[] {
  if (!talles) return []
  const vistos = new Set<string>()
  const out: string[] = []
  for (const t of talles) {
    const v = t.trim()
    if (!v) continue
    const k = v.toLowerCase()
    if (vistos.has(k)) continue
    vistos.add(k)
    out.push(v)
  }
  return out
}

export async function createCategoriaAction(input: {
  nombre: string
  descripcion?: string | null
  talles?: string[]
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('crear')
  if ('error' in g) return { ok: false, reason: g.error }

  try {
    const row = await createCategoria({
      tenantId: g.tenantId,
      nombre: input.nombre.trim(),
      descripcion: input.descripcion?.trim() || null,
      talles: normalizarTalles(input.talles),
    })
    revalidatePath('/inventario/categorias')
    revalidatePath('/inventario')
    return { ok: true, data: { id: row.id_categoria } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function updateCategoriaAction(
  id: string,
  patch: {
    nombre?: string
    descripcion?: string | null
    talles?: string[]
  },
): Promise<ActionResult> {
  const g = await guarded('editar')
  if ('error' in g) return { ok: false, reason: g.error }
  try {
    await updateCategoria(id, {
      ...(patch.nombre !== undefined ? { nombre: patch.nombre.trim() } : {}),
      ...(patch.descripcion !== undefined ? { descripcion: patch.descripcion?.trim() || null } : {}),
      ...(patch.talles !== undefined ? { talles: normalizarTalles(patch.talles) } : {}),
    })
    revalidatePath('/inventario/categorias')
    revalidatePath('/inventario')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function toggleCategoriaActivaAction(input: {
  id: string
  activa: boolean
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if ('error' in g) return { ok: false, reason: g.error }
  try {
    await toggleCategoriaActiva(input.id, input.activa)
    revalidatePath('/inventario/categorias')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Productos ───────────────────────────────────────────────────────

export async function createProductoAction(input: {
  idCategoria: string
  nombre: string
  sku?: string | null
  stockMinimo?: number
  descripcion?: string | null
  costoInicial?: number | null
  moneda?: string
  // Proveedor opcional: si viene, el stock inicial se carga como un ingreso
  // dinámico de tipo "compra" vinculado a ese proveedor (igual que un ingreso
  // de mercadería). Si va vacío, el stock se crea con alta directa.
  idProveedor?: string | null
  // Stock inicial opcional: crea items físicos por talle. Si va vacío, el
  // producto se crea sin unidades (comportamiento anterior).
  stock?: Array<{ talle: string | null; cantidad: number }>
}): Promise<ActionResult<{ id: string; itemsCreados: number; cotizacionDesactualizada?: boolean }>> {
  const g = await guarded('crear')
  if ('error' in g) return { ok: false, reason: g.error }

  // Se valida ANTES de crear nada: si el stock viene mal, no queremos dejar
  // el producto creado y fallar recién al generar las unidades.
  const stock = (input.stock ?? []).filter((s) => s.cantidad !== 0)
  let totalUnidades = 0
  for (const s of stock) {
    const err = unidadesInvalidas(s.cantidad, `talle ${s.talle ?? 'sin talle'}`)
    if (err) return { ok: false, reason: err }
    totalUnidades += s.cantidad
  }
  if (totalUnidades > MAX_UNIDADES_OPERACION) {
    return { ok: false, reason: excedeOperacion(totalUnidades) }
  }

  const conversion = await resolverConversionCarga(
    input.moneda,
    input.costoInicial != null && input.costoInicial > 0 ? [{ costoUnitario: input.costoInicial }] : [],
  )
  if (!conversion.ok) return conversion

  const { esUsd, cotizacionValor, cotizacionFechaValor, cotizacionDesactualizada } = conversion
  const costoArs = conversion.lineas[0]?.costoUnitario ?? input.costoInicial ?? 0
  const costoOriginalUsd = conversion.lineas[0]?.costoOriginalUsd ?? null
  const cotizacionAplicada = cotizacionValor

  try {
    const id = await spCreateProducto({
      idCategoria: input.idCategoria,
      nombre: input.nombre.trim(),
      sku: input.sku?.trim() || null,
      stockMinimo: input.stockMinimo ?? 0,
      descripcion: input.descripcion?.trim() || null,
    })
    if (input.costoInicial != null && input.costoInicial > 0) {
      await spSetCostoProducto({
        idProducto: id,
        costo: esUsd ? costoArs : input.costoInicial,
        moneda: input.moneda ?? 'ARS',
        motivo: 'costo inicial',
        costoOriginalUsd,
        cotizacionAplicada,
        cotizacionFechaValor,
      })
    }
    let itemsCreados = 0
    if (stock.length > 0) {
      if (input.idProveedor) {
        // Ingreso "compra" dinámico: crea el borrador, agrega una línea por
        // talle y lo confirma para generar los ítems físicos vinculados al
        // proveedor. Mismo circuito que /inventario/ingresos.
        const idIngreso = await createIngresoBorrador({
          tenantId: g.tenantId,
          idProveedor: input.idProveedor,
          tipoIngreso: 'compra',
          observaciones: 'Ingreso automático al alta del producto',
          idUsuarioAlta: g.userId,
        })
        for (const s of stock) {
          await addIngresoDetalle({
            tenantId: g.tenantId,
            idIngreso,
            idProducto: id,
            cantidad: s.cantidad,
            costoUnitario: esUsd ? costoArs : (input.costoInicial ?? 0),
            talle: s.talle,
            costoOriginalUsd,
            cotizacionAplicada,
            cotizacionFechaValor,
          })
        }
        itemsCreados = await spConfirmarIngreso(idIngreso)
        revalidatePath('/inventario/ingresos')
      } else {
        itemsCreados = await spCrearStockDirecto({
          idProducto: id,
          costo: esUsd ? costoArs : (input.costoInicial ?? 0),
          items: stock,
        })
      }
    }
    revalidatePath('/inventario')
    return { ok: true, data: { id, itemsCreados, cotizacionDesactualizada } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function updateProductoAction(
  id: string,
  patch: {
    nombre?: string
    sku?: string | null
    descripcion?: string | null
    stock_minimo?: number
    id_categoria?: string
    activo?: boolean
  },
): Promise<ActionResult> {
  const g = await guarded('editar')
  if ('error' in g) return { ok: false, reason: g.error }
  try {
    await updateProducto(id, patch)
    revalidatePath('/inventario')
    revalidatePath('/inventario')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

/**
 * Asigna talles retroactivamente a ítems que se ingresaron sin talle y
 * siguen `disponible`. El RPC valida el cupo (no puede exceder los
 * disponibles-sin-talle), asigna FIFO y registra ajuste + auditoría.
 */
export async function asignarTallesProductoAction(input: {
  idProducto: string
  distribucion: Array<{ talle: string; cantidad: number }>
}): Promise<ActionResult<{ actualizados: number }>> {
  const g = await guarded('editar')
  if ('error' in g) return { ok: false, reason: g.error }
  try {
    const { actualizados } = await spAsignarTallesAProducto(input)
    revalidatePath('/inventario')
    revalidatePath(`/inventario/productos/${input.idProducto}/ficha`)
    return { ok: true, data: { actualizados } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Items ───────────────────────────────────────────────────────────

export async function transicionItemAction(input: {
  idItem: string
  /**
   * QR del ítem, tal como viene en la URL (sin decodificar). Es la clave de la
   * ruta de la ficha, y `revalidatePath` trabaja sobre el pathname, no sobre el
   * `id_item`. Los QR son 24 chars hex (`gen_random_bytes(12)`), así que crudo
   * y decodificado coinciden; se pasa crudo para que el path sea exactamente el
   * que la cache tiene indexado.
   */
  qr: string
  estadoHasta: EstadoItem
  tipoMovimiento: string
  referenciaId?: string | null
  referenciaTipo?: string | null
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if ('error' in g) return { ok: false, reason: g.error }
  try {
    // El `qr` de más no llega al RPC: `spTransicionItem` mapea campo por campo.
    await spTransicionItem(input)
    // Antes esto decía `revalidatePath('/inventario/ficha')`, que NO es la
    // ficha del ítem: es la página de búsqueda estática que vive en ese path
    // exacto. La ficha es `/inventario/ficha/[qr]`, y un path plano nunca
    // matchea un segmento dinámico (ver `revalidatePath.md` §Parameters: con
    // segmento dinámico el `type` es obligatorio, o se pasa el path literal).
    // Mismo criterio que el resto del archivo, que pasa paths literales.
    revalidatePath(`/inventario/ficha/${input.qr}`)
    // Y faltaba el listado: una baja o una devolución cambia el stock, así que
    // `/inventario` quedaba viejo. Todas las demás transiciones de este archivo
    // ya lo revalidan.
    revalidatePath('/inventario')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Ingresos ────────────────────────────────────────────────────────

// `addIngresoDetalleAction` se eliminó: no la llamaba nadie. El alta manual de
// una línea en IngresoDetalleView usa `importarRemitoAction`, que es la que
// resuelve el vínculo producto-nuevo/existente. El DAL `addIngresoDetalle`
// sigue vivo, lo usa `createProductoAction` para el stock inicial.

export async function removeIngresoDetalleAction(input: {
  idIngreso: string
  idDetalle: string
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if ('error' in g) return { ok: false, reason: g.error }
  try {
    await removeIngresoDetalle(input.idDetalle, input.idIngreso)
    revalidatePath(`/inventario/ingresos/${input.idIngreso}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

/**
 * Cancela/revierte un ingreso. Borrador → se elimina; confirmado → da de
 * baja los ítems (solo si ninguno se movió) y lo marca cancelado.
 */
export async function cancelarIngresoAction(input: {
  idIngreso: string
  motivo?: string | null
}): Promise<ActionResult<{ modo: 'borrador' | 'confirmado'; itemsBaja: number; productosEliminados: number }>> {
  const g = await guarded('eliminar')
  if ('error' in g) return { ok: false, reason: g.error }
  try {
    const r = await spCancelarIngreso({ idIngreso: input.idIngreso, motivo: input.motivo ?? null })
    revalidatePath('/inventario/ingresos')
    revalidatePath('/inventario')
    return {
      ok: true,
      data: { modo: r.modo, itemsBaja: r.items_baja, productosEliminados: r.productos_eliminados },
    }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

/**
 * Confirmar ingreso = generar items físicos con QR único.
 * Idempotente en DB (sp_confirmar_ingreso devuelve 0 si ya está confirmado).
 */
export async function confirmarIngresoAction(input: {
  idIngreso: string
}): Promise<ActionResult<{ itemsGenerados: number }>> {
  const g = await guarded('crear')
  if ('error' in g) return { ok: false, reason: g.error }
  try {
    const count = await spConfirmarIngreso(input.idIngreso)
    revalidatePath('/inventario/ingresos')
    revalidatePath('/inventario')
    revalidatePath('/inventario')
    return { ok: true, data: { itemsGenerados: count } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Import de remito PDF ─────────────────────────────────────────────

/**
 * Parsea un remito PDF (en memoria; NO se guarda el archivo) y devuelve
 * las líneas detectadas para precargarlas en la planilla de import.
 */
export async function parseRemitoPdfAction(
  form: FormData,
): Promise<ActionResult<ParsedRemito>> {
  const g = await guarded('crear')
  if ('error' in g) return { ok: false, reason: g.error }
  try {
    const file = form.get('file')
    if (!(file instanceof File)) return { ok: false, reason: 'archivo-invalido' }
    if (file.size === 0) return { ok: false, reason: 'El archivo está vacío.' }
    // Antes de `arrayBuffer()`: el tamaño se conoce sin materializar los bytes.
    if (file.size > MAX_PDF_BYTES) {
      return {
        ok: false,
        reason: `El PDF pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es ${MAX_PDF_BYTES / 1024 / 1024} MB.`,
      }
    }
    if (file.type && file.type !== 'application/pdf') return { ok: false, reason: 'no-es-pdf' }

    const bytes = new Uint8Array(await file.arrayBuffer())
    // La firma es el chequeo que vale; el `file.type` de arriba es un atajo
    // barato que además se puede mandar vacío desde un cliente hecho a mano.
    if (!pareceUnPdf(bytes)) return { ok: false, reason: 'no-es-pdf' }

    const parsed = await extraerRemitoDesdePdf(bytes)
    return { ok: true, data: parsed }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

type DetalleCreado = {
  id_detalle: string
  id_producto: string
  nombre: string
  cantidad: number
  costo_unitario: number
  talle: string | null
}

/** Línea de remito tal como la manda la UI (cantidad + desglose por talle). */
type LineaRemitoInput = {
  esNuevo: boolean
  idProducto: string | null
  // Categoría del producto nuevo (requerida si esNuevo). Es por línea:
  // cada producto puede ir a una categoría distinta.
  idCategoria: string | null
  nombre: string
  cantidad: number
  costoUnitario: number
  // Desglose por talle opcional; si va, crea una línea de detalle por talle.
  talles?: Array<{ talle: string | null; cantidad: number }>
}

/** Línea normalizada para sp_importar_remito (partes = una línea por talle). */
type LineaRemitoSp = {
  esNuevo: boolean
  idProducto: string | null
  idCategoria: string | null
  nombre: string
  costoUnitario: number
  partes: Array<{ talle: string | null; cantidad: number }>
}

/**
 * Valida y normaliza las líneas a la forma que espera sp_importar_remito.
 * La cantidad de la línea manda: el desglose por talle distribuye esas
 * unidades y lo no asignado queda "sin talle". Devuelve un mensaje claro
 * (en TS, antes de tocar la DB) o las líneas listas para el SP.
 */
function normalizarLineasRemito(
  lineas: LineaRemitoInput[],
): { ok: true; lineas: LineaRemitoSp[] } | { ok: false; reason: string } {
  if (lineas.length === 0) return { ok: false, reason: 'sin-lineas' }

  const out: LineaRemitoSp[] = []
  let totalUnidades = 0
  for (const l of lineas) {
    const nombre = l.nombre.trim()
    if (!nombre) return { ok: false, reason: 'hay una línea sin nombre de producto' }
    const errCantidad = unidadesInvalidas(l.cantidad, nombre)
    if (errCantidad) return { ok: false, reason: errCantidad }
    const errCosto = montoInvalido(l.costoUnitario, nombre)
    if (errCosto) return { ok: false, reason: errCosto }
    if (l.esNuevo && !l.idCategoria) return { ok: false, reason: `falta categoría para "${nombre}"` }
    if (!l.esNuevo && !l.idProducto) return { ok: false, reason: `falta elegir producto para "${nombre}"` }

    // Las partes en cero son filas vacías del formulario y se descartan;
    // cualquier otro valor raro (negativo, fraccionario, gigante) corta.
    const breakdown = (l.talles ?? []).filter((t) => t.cantidad !== 0)
    for (const t of breakdown) {
      const errTalle = unidadesInvalidas(t.cantidad, `${nombre} · talle ${t.talle ?? 'sin talle'}`)
      if (errTalle) return { ok: false, reason: errTalle }
    }
    const asignado = breakdown.reduce((a, t) => a + t.cantidad, 0)
    if (asignado > l.cantidad) {
      return { ok: false, reason: `los talles superan la cantidad en "${nombre}"` }
    }

    totalUnidades += l.cantidad
    if (totalUnidades > MAX_UNIDADES_OPERACION) {
      return { ok: false, reason: excedeOperacion(totalUnidades) }
    }
    const resto = l.cantidad - asignado
    const partes =
      breakdown.length > 0
        ? [...breakdown, ...(resto > 0 ? [{ talle: null as string | null, cantidad: resto }] : [])]
        : [{ talle: null as string | null, cantidad: l.cantidad }]

    out.push({
      esNuevo: l.esNuevo,
      idProducto: l.esNuevo ? null : l.idProducto,
      idCategoria: l.esNuevo ? l.idCategoria : null,
      nombre,
      costoUnitario: l.costoUnitario,
      partes,
    })
  }
  return { ok: true, lineas: out }
}

/**
 * Import masivo desde la planilla de precarga. Por cada línea:
 *  - `esNuevo` → crea el producto (marcado es_nuevo=true) + costo inicial.
 *  - si no, usa el `idProducto` vinculado a un producto existente.
 * Luego agrega la línea de detalle al ingreso borrador.
 */
export async function importarRemitoAction(input: {
  idIngreso: string
  moneda?: string
  lineas: LineaRemitoInput[]
}): Promise<ActionResult<{ creados: number; vinculados: number; detalles: DetalleCreado[]; cotizacionDesactualizada?: boolean }>> {
  const g = await guarded('crear')
  if ('error' in g) return { ok: false, reason: g.error }

  const norm = normalizarLineasRemito(input.lineas)
  if (!norm.ok) return norm

  const conversion = await resolverConversionCarga(input.moneda as 'ARS' | 'USD' | undefined, norm.lineas)
  if (!conversion.ok) return conversion
  const { cotizacionValor, cotizacionFechaValor, cotizacionDesactualizada, lineas: lineasParaDal } = conversion

  try {
    const res = await spImportarRemito({
      idIngreso: input.idIngreso,
      moneda: input.moneda,
      cotizacionAplicada: cotizacionValor,
      cotizacionFechaValor,
      lineas: lineasParaDal,
    })
    revalidatePath(`/inventario/ingresos/${input.idIngreso}`)
    revalidatePath('/inventario')
    revalidatePath('/inventario')
    return {
      ok: true,
      data: {
        creados: res.creados,
        vinculados: res.vinculados,
        detalles: res.detalles,
        cotizacionDesactualizada,
      },
    }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

/**
 * Alta de ingreso en UNA sola pantalla: crea la cabecera, importa todas las
 * líneas y lo confirma (genera los ítems físicos con QR) en un solo flujo.
 * No deja borradores: si el import o la confirmación fallan, se elimina la
 * cabecera recién creada para no dejar basura.
 *
 * El número de remito es opcional pero único por proveedor (índice 00038):
 * lo chequeamos antes para dar un mensaje claro.
 */
export async function crearIngresoCompletoAction(input: {
  idProveedor: string | null
  tipoIngreso: TipoIngreso
  numeroRemito?: string | null
  observaciones?: string | null
  moneda?: string
  lineas: LineaRemitoInput[]
}): Promise<ActionResult<{ id: string; itemsGenerados: number; cotizacionDesactualizada?: boolean }>> {
  const g = await guarded('crear')
  if ('error' in g) return { ok: false, reason: g.error }

  const cap = capacidades(g.session.modulosHabilitados)
  const tipos = tiposIngresoPermitidos(cap)
  const schema = crearIngresoCompletoSchema(tipos)
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: extraerReasonZod(parsed.error) }
  }

  const norm = normalizarLineasRemito(parsed.data.lineas as LineaRemitoInput[])
  if (!norm.ok) return norm

  const numeroRemito = parsed.data.numeroRemito?.trim() || null
  const idProveedor = parsed.data.idProveedor || null

  const conversion = await resolverConversionCarga(parsed.data.moneda as 'ARS' | 'USD' | undefined, norm.lineas)
  if (!conversion.ok) return conversion
  const { cotizacionValor, cotizacionFechaValor, cotizacionDesactualizada, lineas: lineasParaDal } = conversion

  if (numeroRemito) {
    try {
      const dup = await remitoDuplicado({ idProveedor, numeroRemito })
      if (dup) {
        return {
          ok: false,
          reason: `Ya existe un ingreso con el remito "${numeroRemito}" para este proveedor.`,
        }
      }
    } catch (e) {
      return { ok: false, reason: (e as Error).message }
    }
  }

  let idIngreso: string
  try {
    idIngreso = await createIngresoBorrador({
      tenantId: g.tenantId,
      idProveedor,
      tipoIngreso: parsed.data.tipoIngreso,
      numeroRemito,
      observaciones: parsed.data.observaciones?.trim() || null,
      idUsuarioAlta: g.userId,
    })
  } catch (e) {
    // Backstop del índice único: si dos cargas compiten, una recibe la
    // violación de unicidad. La traducimos a un mensaje de negocio.
    const msg = (e as Error).message
    if (msg.includes('module-disabled')) return { ok: false, reason: 'module-disabled' }
    if (/ingreso_mercaderia_remito_uniq|duplicate key/i.test(msg)) {
      return {
        ok: false,
        reason: `Ya existe un ingreso con el remito "${numeroRemito}" para este proveedor.`,
      }
    }
    return { ok: false, reason: msg }
  }

  try {
    await spImportarRemito({
      idIngreso,
      moneda: parsed.data.moneda,
      cotizacionAplicada: cotizacionValor,
      cotizacionFechaValor,
      lineas: lineasParaDal,
    })
    const itemsGenerados = await spConfirmarIngreso(idIngreso)
    revalidatePath('/inventario/ingresos')
    revalidatePath('/inventario')
    return { ok: true, data: { id: idIngreso, itemsGenerados, cotizacionDesactualizada } }
  } catch (e) {
    // Rollback pragmático: el ingreso quedó como borrador sin confirmar (o a
    // medias). Lo borramos para no dejar un ingreso huérfano.
    try {
      await spCancelarIngreso({ idIngreso, motivo: 'alta fallida' })
    } catch {
      // Si la limpieza falla, priorizamos reportar el error original.
    }
    const msg = (e as Error).message
    if (msg.includes('module-disabled')) return { ok: false, reason: 'module-disabled' }
    return { ok: false, reason: msg }
  }
}

/**
 * Lectura pura de la cotización vigente para visualización de formularios en inventario.
 * Autoriza con inventario.ver, no consulta al BCRA ni escribe en base de datos.
 */
export async function leerCotizacionVigenteAction(): Promise<
  ActionResult<CotizacionVigente | null>
> {
  const g = await guarded('ver')
  if ('error' in g) return { ok: false, reason: g.error }
  try {
    const cot = await leerCotizacionVigente()
    return { ok: true, data: cot }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Ajuste de inventario (Etapa 6, §L86) ───────────────────────────

export async function registrarAjusteInventarioAction(input: {
  idItem: string
  cantidadSistema: number
  cantidadContada: number
  observaciones: string
  darDeBaja?: boolean
}): Promise<ActionResult<{ idMovimiento: string }>> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'inventario', 'editar')
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, reason: e.reason }
    throw e
  }
  if (!input.observaciones?.trim()) return { ok: false, reason: 'observaciones-requeridas' }
  try {
    const id = await spRegistrarAjusteInventario({
      idItem: input.idItem,
      cantidadSistema: input.cantidadSistema,
      cantidadContada: input.cantidadContada,
      observaciones: input.observaciones.trim(),
      darDeBaja: input.darDeBaja ?? false,
    })
    revalidatePath('/inventario/productos')
    revalidatePath('/inventario')
    return { ok: true, data: { idMovimiento: id } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}
