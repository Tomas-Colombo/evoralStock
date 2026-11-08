'use server'

import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import {
  toggleClienteActivo,
  updateCliente,
} from '@/lib/dal/clientes/cliente'
import {
  spCobrarCuota,
  spMarcarCuotaIncobrable,
} from '@/lib/dal/cuotas/cuota'
import type {
  MedioPago,
  ResultadoIncobrable,
} from '@/lib/types/ventas'

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string }
type Guarded =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; error: string }

// clientes y cuotas no existen como permiso: se autorizan contra ventas (docs/modulos.md).
async function guardedVentas(accion: string): Promise<Guarded> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'ventas', accion)
    return { ok: true, tenantId: session.tenantId, userId: session.user.id }
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, error: e.reason }
    throw e
  }
}

export async function updateClienteAction(input: {
  id: string
  patch: {
    nombre?: string
    apellido?: string | null
    telefono?: string | null
    email?: string | null
    notas?: string | null
  }
}): Promise<ActionResult> {
  const g = await guardedVentas('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await updateCliente(input.id, input.patch)
    revalidatePath('/clientes')
    revalidatePath(`/clientes/${input.id}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function toggleClienteActivoAction(input: {
  id: string
  activo: boolean
}): Promise<ActionResult> {
  const g = await guardedVentas('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await toggleClienteActivo(input.id, input.activo)
    revalidatePath('/clientes')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Cuotas financiadas (00059) ──────────────────────────────────────

/**
 * Cobra una cuota, total o parcialmente. El SP genera el `pago_venta`: la
 * plata aparece en la caja del día en que ENTRÓ, no del día de la venta.
 */
export async function cobrarCuotaAction(input: {
  idCuota: string
  monto: number
  medio: MedioPago
  idCuentaDestino: string
  referencia?: string | null
}): Promise<ActionResult<{ idPago: string }>> {
  const g = await guardedVentas('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  if (!Number.isFinite(input.monto) || input.monto <= 0) {
    return { ok: false, reason: 'monto-invalido' }
  }
  if (!input.idCuentaDestino) return { ok: false, reason: 'pago-sin-cuenta' }
  try {
    const idPago = await spCobrarCuota({
      idCuota: input.idCuota,
      monto: input.monto,
      medio: input.medio,
      idCuentaDestino: input.idCuentaDestino,
      referencia: input.referencia ?? null,
    })
    revalidatePath('/cuotas')
    revalidatePath('/clientes')
    revalidatePath('/ventas')
    return { ok: true, data: { idPago } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

/**
 * Da por perdida una cuota y TODAS las posteriores del mismo plan, y registra
 * un gasto por el total impago.
 *
 * Pide `eliminar` y no `editar` a propósito: esto borra deuda del panel y
 * genera un asiento de pérdida. Es el verbo más fuerte del catálogo de
 * permisos (ver supabase/seed.sql) y `PERMISOS_VENDEDOR` no lo tiene — un
 * vendedor no puede hacer desaparecer lo que un cliente debe.
 */
export async function marcarCuotaIncobrableAction(input: {
  idCuota: string
  motivo: string
}): Promise<ActionResult<ResultadoIncobrable>> {
  const g = await guardedVentas('eliminar')
  if (!g.ok) return { ok: false, reason: g.error }
  if (input.motivo.trim().length < 3) return { ok: false, reason: 'motivo-requerido' }
  try {
    const res = await spMarcarCuotaIncobrable(input.idCuota, input.motivo.trim())
    revalidatePath('/cuotas')
    revalidatePath('/clientes')
    revalidatePath('/gastos')
    revalidatePath('/reportes')
    return { ok: true, data: res }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}
