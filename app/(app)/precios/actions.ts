'use server'

import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import {
  spBajaReglaPrecio,
  spCreateReglaPrecio,
  spExtenderVigenciaRegla,
} from '@/lib/dal/precios/regla'
import {
  listPlanesCuotas,
  setPlanCuotasActivo,
  upsertPlanCuotas,
} from '@/lib/dal/precios/cuotas'
import {
  spRecalcularBatch,
  spRecalcularPrecioVenta,
} from '@/lib/dal/precios/resolucion'
import {
  createCuentaDestino,
  setCuentaPredeterminada,
  updateCuentaDestino,
} from '@/lib/dal/ventas/cuenta-destino'
import {
  cerrarVigenciaArancel,
  createArancelCobro,
  updateArancelCobro,
} from '@/lib/dal/ventas/arancel'
import type { MedioPago, TipoCuentaDestino } from '@/lib/types/ventas'
import { hoyISO } from '@/lib/utils/hoy'
import {
  cerrarVigenciaRecargo,
  createRecargoCuotas,
  updateRecargoCuotas,
} from '@/lib/dal/precios/recargo'
import {
  CUOTAS_MAX,
  CUOTAS_MIN,
  type AlcanceRegla,
  type FormaPago,
  type MedioPagoRecargo,
  type PlanCuotasRow,
  type TipoRegla,
  type TipoValorRegla,
} from '@/lib/types/precios'

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string }

type Guarded =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; error: string }

async function guarded(accion: string): Promise<Guarded> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'precios', accion)
    return { ok: true, tenantId: session.tenantId, userId: session.user.id }
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: error.reason }
    throw error
  }
}

// ─── Reglas ──────────────────────────────────────────────────────────

export async function createReglaAction(input: {
  nombre: string
  tipo_regla: TipoRegla
  tipo_valor: TipoValorRegla
  valor: number
  alcance: AlcanceRegla
  id_producto?: string | null
  id_categoria?: string | null
  id_proveedor?: string | null
  forma_pago?: FormaPago | null
  prioridad?: number
  acumulable?: boolean
  fecha_inicio?: string | null
  fecha_hasta?: string | null
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('crear')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    const id = await spCreateReglaPrecio(input)
    revalidatePath('/precios/reglas')
    revalidatePath('/precios/control')
    revalidatePath('/precios')
    return { ok: true, data: { id } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function bajaReglaAction(idRegla: string): Promise<ActionResult> {
  const g = await guarded('eliminar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spBajaReglaPrecio(idRegla)
    revalidatePath('/precios/reglas')
    revalidatePath('/precios/control')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function extenderVigenciaReglaAction(input: {
  idRegla: string
  fechaHasta: string
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spExtenderVigenciaRegla(input.idRegla, input.fechaHasta)
    revalidatePath('/precios/reglas')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Planes de cuotas ────────────────────────────────────────────────

/**
 * Las acciones de cuotas devuelven la lista completa ya refrescada: el modal
 * se abre sobre pantallas que ya tenían los planes en props (nueva regla,
 * nueva venta) y así se actualizan sin recargar la página.
 */
type PlanesResult = ActionResult<{ planes: PlanCuotasRow[] }>

/** Las páginas que consumen planes activos en su desplegable. */
function revalidarPlanes() {
  revalidatePath('/precios/reglas')
  revalidatePath('/precios/reglas/nueva')
  revalidatePath('/ventas/nueva')
}

export async function crearPlanCuotasAction(cuotas: number): Promise<PlanesResult> {
  const g = await guarded('crear')
  if (!g.ok) return { ok: false, reason: g.error }
  if (!Number.isInteger(cuotas) || cuotas < CUOTAS_MIN || cuotas > CUOTAS_MAX) {
    return { ok: false, reason: `cuotas-fuera-de-rango (${CUOTAS_MIN}-${CUOTAS_MAX})` }
  }
  try {
    await upsertPlanCuotas(g.tenantId, cuotas)
    revalidarPlanes()
    return { ok: true, data: { planes: await listPlanesCuotas() } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function setPlanCuotasActivoAction(
  cuotas: number,
  activo: boolean,
): Promise<PlanesResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await setPlanCuotasActivo(cuotas, activo)
    revalidarPlanes()
    return { ok: true, data: { planes: await listPlanesCuotas() } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Recalcular precio ───────────────────────────────────────────────

export async function recalcularPrecioAction(
  idProducto: string,
): Promise<ActionResult<{ precio: number | null }>> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    const precio = await spRecalcularPrecioVenta(idProducto)
    revalidatePath('/precios/control')
    revalidatePath('/inventario/productos')
    return { ok: true, data: { precio } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function recalcularBatchAction(
  ids: string[],
): Promise<ActionResult<{ resultados: Record<string, number | null> }>> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  if (ids.length === 0) return { ok: false, reason: 'ids-vacios' }
  if (ids.length > 500)
    return { ok: false, reason: 'demasiados-productos-en-un-batch' }
  try {
    const resultados = await spRecalcularBatch(ids)
    revalidatePath('/precios/control')
    revalidatePath('/inventario/productos')
    return { ok: true, data: { resultados } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Cuentas destino ─────────────────────────────────────────────────

/**
 * Alta de cuenta con su costo de cobro en un solo paso. Separarlo obligaba a
 * crear la cuenta, buscarla en la tabla y volver a entrar para configurarla —
 * tres pantallas para una sola decisión, y una cuenta a medio configurar en
 * el medio.
 *
 * Los aranceles se cargan después de la cuenta porque la referencian. Si uno
 * falla, la cuenta YA quedó creada: se devuelve `ok` con `arancelesFallidos`
 * para avisarlo, en vez de dejar al usuario sin cuenta por un porcentaje mal
 * tipeado.
 */
export async function crearCuentaDestinoAction(input: {
  nombre: string
  tipo: TipoCuentaDestino
  titular?: string | null
  identificador?: string | null
  retenciones?: {
    ret_iva_pct: number
    ret_ganancias_pct: number
    ret_iibb_pct: number
    imp_deb_cred_pct: number
  }
  aranceles?: Array<{
    medio: MedioPago
    arancelPct: number
    ivaArancelPct: number
    diasAcreditacion: number
  }>
}): Promise<ActionResult<{ id: string; arancelesFallidos: number }>> {
  const g = await guarded('crear')
  if (!g.ok) return { ok: false, reason: g.error }
  if (input.nombre.trim().length < 2) return { ok: false, reason: 'nombre-invalido' }

  const ret = input.retenciones
  if (ret) {
    for (const pct of Object.values(ret)) {
      if (!porcentajeValido(pct)) return { ok: false, reason: 'porcentaje-invalido' }
    }
  }
  for (const a of input.aranceles ?? []) {
    if (!porcentajeValido(a.arancelPct) || !porcentajeValido(a.ivaArancelPct)) {
      return { ok: false, reason: 'porcentaje-invalido' }
    }
    if (a.diasAcreditacion < 0) return { ok: false, reason: 'dias-invalidos' }
  }

  try {
    const row = await createCuentaDestino({
      id_tenant: g.tenantId,
      nombre: input.nombre.trim(),
      tipo: input.tipo,
      titular: input.titular?.trim() || null,
      identificador: input.identificador?.trim() || null,
      ...(ret ?? {}),
    })

    let arancelesFallidos = 0
    for (const a of input.aranceles ?? []) {
      try {
        await createArancelCobro(g.tenantId, {
          id_cuenta_destino: row.id_cuenta_destino,
          medio: a.medio,
          // Comodín: aplica a cualquier plan. El tarifario por plan se afina
          // después, desde el panel de la cuenta.
          cuotas: null,
          arancel_pct: a.arancelPct,
          iva_arancel_pct: a.ivaArancelPct,
          dias_acreditacion: a.diasAcreditacion,
        })
      } catch {
        arancelesFallidos++
      }
    }

    revalidatePath('/precios/cuentas')
    revalidatePath('/ventas/nueva')
    return { ok: true, data: { id: row.id_cuenta_destino, arancelesFallidos } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function actualizarCuentaDestinoAction(input: {
  id: string
  patch: {
    nombre?: string
    tipo?: TipoCuentaDestino
    titular?: string | null
    identificador?: string | null
    activo?: boolean
    ret_iva_pct?: number
    ret_ganancias_pct?: number
    ret_iibb_pct?: number
    imp_deb_cred_pct?: number
  }
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  for (const pct of [
    input.patch.ret_iva_pct,
    input.patch.ret_ganancias_pct,
    input.patch.ret_iibb_pct,
    input.patch.imp_deb_cred_pct,
  ]) {
    if (pct !== undefined && !porcentajeValido(pct)) {
      return { ok: false, reason: 'porcentaje-invalido' }
    }
  }
  try {
    await updateCuentaDestino(input.id, input.patch)
    revalidatePath('/precios/cuentas')
    revalidatePath('/ventas/nueva')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Aranceles de cobro (00057) ──────────────────────────────────────

/** Un porcentaje de arancel/retención: no negativo y no mayor a 100. */
function porcentajeValido(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 100
}

export async function crearArancelCobroAction(input: {
  idCuentaDestino: string
  medio: MedioPago
  cuotas?: number | null
  arancelPct: number
  ivaArancelPct?: number
  diasAcreditacion?: number
  notas?: string | null
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('crear')
  if (!g.ok) return { ok: false, reason: g.error }
  if (!porcentajeValido(input.arancelPct)) return { ok: false, reason: 'porcentaje-invalido' }
  if (input.ivaArancelPct !== undefined && !porcentajeValido(input.ivaArancelPct)) {
    return { ok: false, reason: 'porcentaje-invalido' }
  }
  if (input.diasAcreditacion !== undefined && input.diasAcreditacion < 0) {
    return { ok: false, reason: 'dias-invalidos' }
  }
  // El plan de cuotas sólo tiene sentido en crédito: en cualquier otro medio
  // haría que el lookup del tarifario no matchee nunca.
  if (input.cuotas != null && input.medio !== 'tarjeta_credito') {
    return { ok: false, reason: 'cuotas-medio-invalido' }
  }
  try {
    const row = await createArancelCobro(g.tenantId, {
      id_cuenta_destino: input.idCuentaDestino,
      medio: input.medio,
      cuotas: input.cuotas ?? null,
      arancel_pct: input.arancelPct,
      iva_arancel_pct: input.ivaArancelPct,
      dias_acreditacion: input.diasAcreditacion,
      notas: input.notas ?? null,
    })
    revalidatePath('/precios/cuentas')
    revalidatePath('/ventas/nueva')
    return { ok: true, data: { id: row.id_arancel_cobro } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function actualizarArancelCobroAction(input: {
  id: string
  patch: {
    arancel_pct?: number
    iva_arancel_pct?: number
    dias_acreditacion?: number
    notas?: string | null
  }
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  if (input.patch.arancel_pct !== undefined && !porcentajeValido(input.patch.arancel_pct)) {
    return { ok: false, reason: 'porcentaje-invalido' }
  }
  if (
    input.patch.iva_arancel_pct !== undefined &&
    !porcentajeValido(input.patch.iva_arancel_pct)
  ) {
    return { ok: false, reason: 'porcentaje-invalido' }
  }
  if (input.patch.dias_acreditacion !== undefined && input.patch.dias_acreditacion < 0) {
    return { ok: false, reason: 'dias-invalidos' }
  }
  try {
    await updateArancelCobro(input.id, input.patch)
    revalidatePath('/precios/cuentas')
    revalidatePath('/ventas/nueva')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function cerrarVigenciaArancelAction(input: {
  id: string
  hasta?: string
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    // `toISOString()` daba la fecha UTC: de noche en Argentina cerraba la
    // vigencia con el día siguiente.
    await cerrarVigenciaArancel(input.id, input.hasta ?? hoyISO())
    revalidatePath('/precios/cuentas')
    revalidatePath('/ventas/nueva')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function marcarCuentaPredeterminadaAction(input: {
  id: string
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await setCuentaPredeterminada(input.id)
    revalidatePath('/precios/cuentas')
    revalidatePath('/ventas/nueva')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Recargo por cuotas (00063) ──────────────────────────────────────
// La contracara del arancel: lo que se le cobra de más al cliente por pagar
// en partes. Mismas reglas de vigencia que el tarifario — no se borra nada,
// se cierra y se da de alta el reemplazo.

export async function crearRecargoCuotasAction(input: {
  cuotas: number
  idCuentaDestino?: string | null
  medio?: MedioPagoRecargo | null
  propia?: boolean
  tipoValor?: TipoValorRegla
  valor: number
  notas?: string | null
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('crear')
  if (!g.ok) return { ok: false, reason: g.error }
  if (!Number.isInteger(input.cuotas) || input.cuotas < CUOTAS_MIN || input.cuotas > CUOTAS_MAX) {
    return { ok: false, reason: 'cuotas-invalidas' }
  }
  if (!recargoValido(input.valor, input.tipoValor ?? 'porcentaje')) {
    return { ok: false, reason: 'valor-invalido' }
  }
  // Una fila no puede nombrar un procesador Y decir que financia el comercio:
  // el check de la tabla lo rechaza, pero el error de constraint no le dice
  // nada al operador. Se corta acá con un motivo legible.
  if (input.propia && (input.idCuentaDestino || input.medio)) {
    return { ok: false, reason: 'propia-con-procesador' }
  }
  try {
    const row = await createRecargoCuotas(g.tenantId, {
      cuotas: input.cuotas,
      idCuentaDestino: input.idCuentaDestino ?? null,
      medio: input.medio ?? null,
      propia: input.propia ?? false,
      tipoValor: input.tipoValor ?? 'porcentaje',
      valor: input.valor,
      notas: input.notas ?? null,
    })
    revalidarRecargos()
    return { ok: true, data: { id: row.id_recargo_cuotas } }
  } catch (e) {
    const msg = (e as Error).message
    // El unique index parcial de 00063 sólo mira las filas vigentes.
    if (msg.includes('recargo_cuotas_vigente_uk')) {
      return { ok: false, reason: 'recargo-duplicado' }
    }
    return { ok: false, reason: msg }
  }
}

/** Corrección de una fila mal cargada. Para un cambio real, cerrar y dar de alta. */
export async function actualizarRecargoCuotasAction(input: {
  id: string
  tipoValor?: TipoValorRegla
  valor?: number
  notas?: string | null
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  if (
    input.valor !== undefined &&
    !recargoValido(input.valor, input.tipoValor ?? 'porcentaje')
  ) {
    return { ok: false, reason: 'valor-invalido' }
  }
  try {
    await updateRecargoCuotas(input.id, {
      ...(input.tipoValor !== undefined ? { tipo_valor: input.tipoValor } : {}),
      ...(input.valor !== undefined ? { valor: input.valor } : {}),
      ...(input.notas !== undefined ? { notas: input.notas } : {}),
    })
    revalidarRecargos()
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function cerrarVigenciaRecargoAction(input: {
  id: string
  hasta: string
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await cerrarVigenciaRecargo(input.id, input.hasta)
    revalidarRecargos()
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

/**
 * Un porcentaje no puede pasar de 100 (sería más que duplicar el precio, y en
 * la práctica siempre es un cero de más). El monto fijo no tiene tope, pero
 * tampoco puede ser negativo: eso sería un descuento, que es otra cosa.
 */
function recargoValido(valor: number, tipo: TipoValorRegla): boolean {
  if (!Number.isFinite(valor) || valor < 0) return false
  return tipo !== 'porcentaje' || valor <= 100
}

function revalidarRecargos(): void {
  revalidatePath('/precios/cuentas')
  // El recargo cambia el PRECIO, así que el carrito abierto queda viejo.
  revalidatePath('/ventas/nueva')
}
