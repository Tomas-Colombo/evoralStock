'use server'

import { revalidatePath } from 'next/cache'
import { verifySession } from '@/lib/dal/session'
import { classifyAuthError, requireModuleRole } from '@/lib/dal/guard'
import { devolverItemsRevendedoraSchema } from '@/lib/validation/revendedoras'
import * as dal from '@/lib/dal/revendedoras'

export async function devolverItemsRevendedoraAction(input: unknown) {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'revendedoras', 'editar')

    const parsed = devolverItemsRevendedoraSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false as const, reason: 'payload-invalido' }
    }

    const res = await dal.devolverItemsRevendedora(parsed.data)
    if (res.ok) {
      revalidatePath('/revendedoras')
      revalidatePath(`/revendedoras/${parsed.data.id_revendedora}`, 'layout')
      revalidatePath('/inventario')
    }
    return res
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false as const, reason: auth.reason }
    throw err
  }
}
