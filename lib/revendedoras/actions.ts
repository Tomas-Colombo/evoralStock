'use server'

import { revalidatePath } from 'next/cache'
import { verifySession } from '@/lib/dal/session'
import { classifyAuthError, requireModuleRole } from '@/lib/dal/guard'
import * as dal from '@/lib/dal/revendedoras'
import { z } from 'zod'

export async function darAccesoRevendedoraAction(input: unknown) {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'revendedoras', 'editar')
    await requireModuleRole(session, 'administracion', 'crear')

    const schema = z.object({
      idRevendedora: z.string().uuid(),
      email: z.string().email().max(255),
      nombreCompleto: z.string().max(200),
      password: z.string().min(8)
    }).strict()

    const parsed = schema.safeParse(input)
    if (!parsed.success) {
      return { ok: false as const, reason: 'payload-invalido' }
    }

    const res = await dal.inviteRevendedora(session, parsed.data)
    if (res.ok) {
      revalidatePath('/revendedoras')
      revalidatePath('/administracion/usuarios')
    }
    return res
  } catch (error) {
    // We already do module guard properly above.
    const auth = classifyAuthError(error)
    if (auth.kind === 'auth') return { ok: false as const, reason: auth.reason }
    return { ok: false as const, reason: 'error-desconocido' }
  }
}
