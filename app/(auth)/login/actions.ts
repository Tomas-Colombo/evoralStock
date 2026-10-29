'use server'

import { redirect } from 'next/navigation'
import { esSuperAdmin } from '@/lib/dal/plataforma/guard'
import { createServerClient } from '@/lib/dal/supabase'

export interface LoginActionState {
  ok: boolean
  error?: string
}

/**
 * Login Server Action (design §5, REQ-AUTH-01/02, DR-SA-02, REQ-SA-01).
 * Delegates to Supabase Auth's cookie-based `signInWithPassword` via the
 * `@supabase/ssr` server client — the Auth Hook (migration `00008`) stamps
 * the `tenant_id` claim on the resulting JWT for tenant users.
 *
 * Flujo post-login (DR-SA-02):
 *  1. Con claim tenant_id: continúa el flujo estándar (`redirect('/ventas')`).
 *  2. Sin tenant_id y `esSuperAdmin(user.id)`: desvía al panel global (`redirect('/plataforma')`).
 *  3. Sin tenant_id y no super admin: cierra sesión (`signOut()`) y retorna error genérico.
 *
 * On failure, the raw Supabase error is never surfaced to the client (it
 * can reveal whether an email exists) — always a generic message (spec 3.2).
 */
export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    return { ok: false, error: 'El correo electrónico y la contraseña son obligatorios' }
  }

  const supabase = await createServerClient()
  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !signInData.user) {
    return { ok: false, error: 'Credenciales inválidas' }
  }

  // Comprobar claim tenant_id (DR-SA-02)
  const token = signInData.session?.access_token
  const { data: claimsData } = await supabase.auth.getClaims(token)
  const claims = claimsData?.claims as { tenant_id?: string; app_metadata?: { tenant_id?: string } } | undefined
  const tenantId =
    claims?.tenant_id ??
    claims?.app_metadata?.tenant_id ??
    (signInData.user.app_metadata?.tenant_id as string | undefined)

  if (tenantId) {
    // El vendedor arranca en su módulo de trabajo, no en un dashboard.
    redirect('/ventas')
  }

  // Sin tenant_id: chequear si es super admin
  const isSuper = await esSuperAdmin(signInData.user.id)
  if (isSuper) {
    redirect('/plataforma')
  }

  // Sin tenant_id ni super admin: cerrar sesión y fallar cerrado con error genérico
  await supabase.auth.signOut()
  return { ok: false, error: 'Credenciales inválidas' }
}
