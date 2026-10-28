import { createServiceClient } from '../supabase'

/**
 * Restablece la contraseña de alguien que se la olvidó, con el mismo formato
 * que el alta: la escribe el administrador y la persona tiene que cambiarla
 * apenas entra (`debe_cambiar_clave`, que lee proxy.ts).
 *
 * Service role porque Auth Admin lo exige, y por eso mismo bypassa RLS: el
 * usuario se busca filtrando por el tenant de la sesión antes de tocarlo, así
 * un id de otro tenant nunca llega a `updateUserById`.
 */
export async function restablecerClaveUsuario(
  tenantId: string,
  idUsuario: string,
  password: string,
): Promise<{ ok: true; data: { email: string; nombre: string } } | { ok: false; reason: string }> {
  const admin = createServiceClient()

  const { data: usuario, error: rowError } = await admin
    .from('usuario')
    .select('email, nombre_completo')
    .eq('id_usuario', idUsuario)
    .eq('id_tenant', tenantId)
    .maybeSingle()
  if (rowError) return { ok: false, reason: 'error-actualizar-password' }
  if (!usuario) return { ok: false, reason: 'usuario-not-found' }

  const { error } = await admin.auth.admin.updateUserById(idUsuario, {
    password,
    app_metadata: { debe_cambiar_clave: true },
  })
  if (error) return { ok: false, reason: 'error-actualizar-password' }

  return {
    ok: true,
    data: { email: usuario.email as string, nombre: (usuario.nombre_completo as string | null) ?? '' },
  }
}
