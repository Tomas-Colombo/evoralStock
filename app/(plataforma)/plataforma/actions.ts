'use server'

import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireSuperAdmin } from '@/lib/dal/plataforma/guard'
import * as dal from '@/lib/dal/plataforma'
import {
  registrarCargoSchema,
  registrarPagoSchema,
  anularMovimientoSchema,
  togglePaqueteSchema,
  extraerReasonZod,
} from '@/lib/validation/plataforma'

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; reason: string }

/**
 * REQ-SA-04: Acción para registrar un cargo en cuenta corriente de un tenant.
 * Compuerta 1: requireSuperAdmin()
 * Compuerta 2: registrarCargoSchema.safeParse(input)
 * Compuerta 3: dal.registrarCargo(parsed.data)
 */
export async function registrarCargoTenantAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    // 1. Autorización: sólo superadmin
    await requireSuperAdmin()
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { ok: false, reason: err.reason }
    }
    throw err
  }

  // 2. Validación: schema estricto
  const parsed = registrarCargoSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: extraerReasonZod(parsed.error) }
  }

  // 3. Mutación en DAL con parsed.data (actor sale de la sesión verificada)
  const res = await dal.registrarCargo(parsed.data)
  if (!res.ok) {
    return res
  }

  revalidatePath('/plataforma')
  revalidatePath(`/plataforma/${parsed.data.idTenant}`)
  return res
}

/**
 * REQ-SA-05: Acción para registrar un pago de un tenant.
 * Compuerta 1: requireSuperAdmin()
 * Compuerta 2: registrarPagoSchema.safeParse(input)
 * Compuerta 3: dal.registrarPago(parsed.data)
 */
export async function registrarPagoTenantAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSuperAdmin()
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { ok: false, reason: err.reason }
    }
    throw err
  }

  const parsed = registrarPagoSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: extraerReasonZod(parsed.error) }
  }

  const res = await dal.registrarPago(parsed.data)
  if (!res.ok) {
    return res
  }

  revalidatePath('/plataforma')
  revalidatePath(`/plataforma/${parsed.data.idTenant}`)
  return res
}

/**
 * REQ-SA-06: Acción para anular un movimiento de cuenta corriente (cargo o pago).
 * Compuerta 1: requireSuperAdmin()
 * Compuerta 2: anularMovimientoSchema.safeParse(input)
 * Compuerta 3: dal.anularMovimiento(parsed.data)
 */
export async function anularMovimientoTenantAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    await requireSuperAdmin()
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { ok: false, reason: err.reason }
    }
    throw err
  }

  const parsed = anularMovimientoSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: extraerReasonZod(parsed.error) }
  }

  const res = await dal.anularMovimiento(parsed.data)
  if (!res.ok) {
    return res
  }

  revalidatePath('/plataforma')
  revalidatePath('/plataforma/[id]', 'page')
  return res
}

/**
 * REQ-SA-03: Acción para alternar módulos por paquete opcional.
 * Compuerta 1: requireSuperAdmin()
 * Compuerta 2: togglePaqueteSchema.safeParse(input)
 * Compuerta 3: dal.togglePaquete(parsed.data, null)
 */
export async function togglePaqueteTenantAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    await requireSuperAdmin()
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { ok: false, reason: err.reason }
    }
    throw err
  }

  const parsed = togglePaqueteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: extraerReasonZod(parsed.error) }
  }

  // La IP del cliente se pasa como null al no haber helper de extracción en las Server Actions
  const res = await dal.togglePaquete(parsed.data, null)
  if (!res.ok) {
    return res
  }

  revalidatePath('/plataforma')
  revalidatePath(`/plataforma/${parsed.data.idTenant}`)
  return res
}
