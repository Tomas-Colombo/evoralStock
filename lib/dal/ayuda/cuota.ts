import 'server-only'

import { createServerClient } from '@/lib/dal/supabase'
import { extractErrorSlug, type ReglaSlug } from '@/lib/dal/revendedoras/slug-error'

export const REGLAS_SLUG_CUOTA: readonly ReglaSlug[] = [
  { slug: 'no-permission' },
  { slug: 'no-tenant' },
  { slug: 'module-disabled' },
  { slug: 'cuota-excedida' },
]

export async function reservarCuotaAyuda(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  try {
    const supabase = await createServerClient()
    const { error } = await supabase.rpc('sp_reservar_cuota_ayuda')

    if (error) {
      return { ok: false, reason: extractErrorSlug(error, REGLAS_SLUG_CUOTA) }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, reason: extractErrorSlug(err, REGLAS_SLUG_CUOTA) }
  }
}
