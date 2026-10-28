'use server'

import { verifySession } from '@/lib/dal/session'
import { classifyAuthError, requireModuleRole } from '@/lib/dal/guard'
import { restablecerClaveUsuario } from '@/lib/dal/administracion/acceso'
import { restablecerClaveSchema } from '@/lib/validation/acceso'

export async function restablecerClaveAction(input: unknown) {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'administracion', 'editar')

    const parsed = restablecerClaveSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false as const, reason: parsed.error.issues[0]?.message ?? 'payload-invalido' }
    }

    return await restablecerClaveUsuario(session.tenantId, parsed.data.idUsuario, parsed.data.password)
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false as const, reason: auth.reason }
    throw err
  }
}
