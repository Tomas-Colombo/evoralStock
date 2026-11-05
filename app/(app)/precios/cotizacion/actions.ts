'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import {
  actualizarCotizacionSchema,
  cambiarModoCotizacionSchema,
} from '@/lib/validation/cotizacion'
import {
  sincronizarCotizacionBcra,
  spRevaluarCostosUsd,
  spSetCotizacionManual,
  spSetModoCotizacion,
} from '@/lib/dal/precios/cotizacion'
import { getClientIp } from '@/lib/utils/ip'

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string }

const emptyPayloadSchema = z.strictObject({})

/**
 * Server Action: Fija cotización manual y cambia el modo a 'manual'.
 * 3 compuertas: requireModuleRole('precios', 'editar_cotizacion') -> Zod -> DAL.
 */
export async function actualizarCotizacionManualAction(
  rawInput: unknown,
): Promise<ActionResult> {
  try {
    // 1. Autorización
    const session = await verifySession()
    await requireModuleRole(session, 'precios', 'editar_cotizacion')

    // 2. Validación Zod
    const parsed = actualizarCotizacionSchema.safeParse(rawInput)
    if (!parsed.success) {
      return { ok: false, reason: 'cotizacion-manual-invalida' }
    }

    const ip = await getClientIp()

    // 3. Mutación en DAL
    await spSetCotizacionManual({ valor: parsed.data.valor, ip })

    revalidatePath('/precios')
    revalidatePath('/precios/cotizacion')
    return { ok: true }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, reason: error.reason }
    }
    return { ok: false, reason: (error as Error).message }
  }
}

/**
 * Server Action: Cambia el modo de cotización ('automatica' | 'manual').
 * 3 compuertas: requireModuleRole('precios', 'editar_cotizacion') -> Zod -> DAL.
 */
export async function cambiarModoCotizacionAction(
  rawInput: unknown,
): Promise<ActionResult> {
  try {
    // 1. Autorización
    const session = await verifySession()
    await requireModuleRole(session, 'precios', 'editar_cotizacion')

    // 2. Validación Zod
    const parsed = cambiarModoCotizacionSchema.safeParse(rawInput)
    if (!parsed.success) {
      return { ok: false, reason: 'modo-cotizacion-invalido' }
    }

    const ip = await getClientIp()

    // 3. Mutación en DAL
    await spSetModoCotizacion({ modo: parsed.data.modo, ip })

    revalidatePath('/precios')
    revalidatePath('/precios/cotizacion')
    return { ok: true }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, reason: error.reason }
    }
    return { ok: false, reason: (error as Error).message }
  }
}

/**
 * Server Action: Fuerza la sincronización de la cotización oficial con la API del BCRA.
 * 3 compuertas: requireModuleRole('precios', 'editar_cotizacion') -> Zod -> DAL.
 */
export async function sincronizarCotizacionBcraAction(
  rawInput?: unknown,
): Promise<ActionResult> {
  try {
    // 1. Autorización
    const session = await verifySession()
    await requireModuleRole(session, 'precios', 'editar_cotizacion')

    // 2. Validación Zod
    const parsed = emptyPayloadSchema.safeParse(rawInput ?? {})
    if (!parsed.success) {
      return { ok: false, reason: 'payload-invalido' }
    }

    // 3. Mutación en DAL
    const res = await sincronizarCotizacionBcra()
    if (!res.ok) {
      return { ok: false, reason: res.reason }
    }

    revalidatePath('/precios')
    revalidatePath('/precios/cotizacion')
    return { ok: true }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, reason: error.reason }
    }
    return { ok: false, reason: (error as Error).message }
  }
}

/**
 * Server Action: Revalúa masivamente los costos vigentes en USD al tipo de cambio actual.
 * 3 compuertas: requireModuleRole('precios', 'editar_cotizacion') -> Zod -> DAL.
 */
export async function revaluarCostosUsdAction(
  rawInput?: unknown,
): Promise<ActionResult<{ revaluados: number; omitidos_sin_original: number }>> {
  try {
    // 1. Autorización
    const session = await verifySession()
    await requireModuleRole(session, 'precios', 'editar_cotizacion')

    // 2. Validación Zod
    const parsed = emptyPayloadSchema.safeParse(rawInput ?? {})
    if (!parsed.success) {
      return { ok: false, reason: 'payload-invalido' }
    }

    const ip = await getClientIp()

    // 3. Mutación en DAL
    const data = await spRevaluarCostosUsd({ ip })

    revalidatePath('/precios')
    revalidatePath('/precios/control')
    revalidatePath('/inventario')
    return { ok: true, data }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, reason: error.reason }
    }
    return { ok: false, reason: (error as Error).message }
  }
}
