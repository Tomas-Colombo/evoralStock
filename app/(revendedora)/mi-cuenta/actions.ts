'use server'

import { revalidatePath } from 'next/cache'
import { verifySession } from '@/lib/dal/session'
import { classifyAuthError, requireModuleRole } from '@/lib/dal/guard'
import { AuthorizationError } from '@/lib/dal/errors'
import {
  anularVentaRevendedoraSchema,
  registrarVentaRevendedoraSchema,
  resolverItemStockSchema,
} from '@/lib/validation/revendedoras'
import * as dal from '@/lib/dal/revendedoras'

export async function registrarVentaRevendedoraAction(input: unknown) {
  try {
    const session = await verifySession()
    if (!session.idRevendedora) {
      throw new AuthorizationError('no-permission')
    }
    await requireModuleRole(session, 'revendedoras', 'vender')

    const parsed = registrarVentaRevendedoraSchema.safeParse(input)
    if (!parsed.success) {
      const firstMsg = parsed.error.issues[0]?.message
      return {
        ok: false as const,
        reason: firstMsg === 'lineas-vacias' ? 'lineas-vacias' : 'payload-invalido',
      }
    }

    const res = await dal.registrarVentaRevendedora(session, parsed.data)
    if (!res.ok) {
      return res
    }

    revalidatePath('/mi-cuenta')
    revalidatePath('/mi-cuenta/stock')
    revalidatePath('/mi-cuenta/ventas')
    return { ok: true as const, data: res.data }
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false as const, reason: auth.reason }
    throw err
  }
}

export async function buscarItemStockRevendedoraAction(input: unknown) {
  try {
    const session = await verifySession()
    if (!session.idRevendedora) {
      throw new AuthorizationError('no-permission')
    }
    await requireModuleRole(session, 'revendedoras', 'vender')

    const parsed = resolverItemStockSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false as const, reason: 'payload-invalido' }
    }

    return await dal.resolverItemStockRevendedora(session, parsed.data)
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false as const, reason: auth.reason }
    throw err
  }
}

export async function anularVentaRevendedoraAction(input: unknown) {
  try {
    const session = await verifySession()
    if (!session.idRevendedora) {
      throw new AuthorizationError('no-permission')
    }
    await requireModuleRole(session, 'revendedoras', 'vender')

    const parsed = anularVentaRevendedoraSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false as const, reason: 'payload-invalido' }
    }

    const res = await dal.anularVentaRevendedora(session, parsed.data)
    if (!res.ok) {
      return res
    }

    revalidatePath('/mi-cuenta')
    revalidatePath('/mi-cuenta/stock')
    revalidatePath('/mi-cuenta/ventas')
    return { ok: true as const }
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false as const, reason: auth.reason }
    throw err
  }
}
