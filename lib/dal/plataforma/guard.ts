import 'server-only'
import { cache } from 'react'

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
 * Obtiene la identidad del superadministrador autenticado actualmente (REQ-SA-01 / DR-SA-01).
 *
 * Valida la existencia del usuario con `auth.getUser()` y confirma si figura en la tabla `superadmin`.
 * Falla cerrada: ante cualquier error o si el usuario no es superadmin, retorna `null`.
 */
export const superAdminActual = cache(async (): Promise<SuperAdminIdentity | null> => {
  try {
    const supabase = await createServerClient()
    const { data: { user } = {}, error } = await supabase.auth.getUser()

    if (error || !user) {
      return null
    }

    const isSuper = await esSuperAdmin(user.id)
    if (!isSuper) {
      return null
    }

    return {
      id: user.id,
      email: user.email ?? '',
    }
  } catch {
    return null
  }
})

/**
 * Compuerta de autorización para el módulo de plataforma (REQ-SA-01 / DR-SA-01).
 *
 * Construida encima de `superAdminActual()` con falla cerrada discriminada:
 *   - `AuthorizationError('no-session')` si no hay sesión válida o falla la autenticación.
 *   - `AuthorizationError('no-permission')` si el usuario está autenticado pero no es superadmin.
 */
export const requireSuperAdmin = cache(async (): Promise<SuperAdminIdentity> => {
  const sa = await superAdminActual()
  if (sa) {
    return sa
  }

  // Falla cerrada: distinguir si el rechazo se debe a falta de sesión o falta de permisos
  try {
    const supabase = await createServerClient()
    const { data: { user } = {}, error } = await supabase.auth.getUser()

    if (error || !user) {
      throw new AuthorizationError('no-session')
    }
  } catch (err) {
    if (err instanceof AuthorizationError) throw err
    throw new AuthorizationError('no-session')
  }

  throw new AuthorizationError('no-permission')
})
