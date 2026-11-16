'use server'

import { classifyAuthError, requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { calificarConsultaAyudaSchema } from '@/lib/validation/ayuda'
import { calificarConsultaAyuda } from '@/lib/dal/ayuda'

export type CalificarConsultaAyudaActionResult =
  | { ok: true }
  | { ok: false; reason: string }

export async function calificarConsultaAyudaAction(
  input: unknown,
): Promise<CalificarConsultaAyudaActionResult> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'ayuda', 'consultar')

    const parsed = calificarConsultaAyudaSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, reason: 'payload-invalido' }
    }

    return await calificarConsultaAyuda(parsed.data)
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false, reason: auth.reason }
    throw err
  }
}
