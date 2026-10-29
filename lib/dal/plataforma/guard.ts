import { AuthorizationError } from '@/lib/dal/errors'
import { createServerClient, createServiceClient } from '@/lib/dal/supabase'

export interface SuperAdminIdentity {
  id: string
  email: string
}

/**
 * Consulta la tabla `superadmin` mediante service-role para determinar
 * si el usuario especificado posee facultades de superadministrador global (DR-SA-01).
 *
 * Falla cerrada: ante cualquier error o id inválido devuelve false.
 */
export async function esSuperAdmin(idUsuario: string): Promise<boolean> {
  if (!idUsuario || typeof idUsuario !== 'string' || idUsuario.trim() === '') {
    return false
  }

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('superadmin')
      .select('id_auth_user')
      .eq('id_auth_user', idUsuario)
      .maybeSingle()

    if (error || !data) {
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Compuerta de autorización para el módulo de plataforma (REQ-SA-01 / DR-SA-01).
 *
 * 1. Valida al usuario de forma segura con `auth.getUser()`.
 * 2. Valida pertenencia activa a la tabla `superadmin` vía `esSuperAdmin()`.
 *
 * Lanza:
 *   - `AuthorizationError('no-session')` si no hay sesión válida o falla la autenticación.
 *   - `AuthorizationError('no-permission')` si el usuario no es superadmin.
 */
export async function requireSuperAdmin(): Promise<SuperAdminIdentity> {
  const supabase = await createServerClient()
  const { data: { user } = {}, error } = await supabase.auth.getUser()

  if (error || !user) {
    throw new AuthorizationError('no-session')
  }

  const isSuper = await esSuperAdmin(user.id)
  if (!isSuper) {
    throw new AuthorizationError('no-permission')
  }

  return {
    id: user.id,
    email: user.email ?? '',
  }
}
