'use server'

import { redirect } from 'next/navigation'
import { AuthorizationError } from '@/lib/dal/errors'
import { debeCambiarClave, marcarClaveCambiada, verifySession } from '@/lib/dal/session'
import { createServerClient } from '@/lib/dal/supabase'

const MIN_PASSWORD_LENGTH = 8

export interface ChangePasswordActionState {
  ok: boolean
  error?: string
}

/**
 * Password-change Server Action (SECURITY-CRITICAL — design §5/§7, REQ-AUTH-
 * 05/06/07, spec 3.3/3.4). Re-verifies the CURRENT password via
 * `signInWithPassword` BEFORE ever calling `updateUser`; on re-verify
 * failure the function returns immediately and `updateUser` is never
 * reached (REQ-AUTH-06, non-negotiable per design).
 *
 * The audit RPC (`sp_change_password_user`, migration `00009`) is called
 * best-effort AFTER the password is already changed — its failure must not
 * flip a successful password change into a reported failure. No password
 * value is ever passed into the RPC or into `cambios` (the function inserts
 * an empty `cambios` jsonb).
 */
export async function changePasswordAction(
  _prevState: ChangePasswordActionState,
  formData: FormData,
): Promise<ChangePasswordActionState> {
  const currentPassword = String(formData.get('current_password') ?? '')
  const newPassword = String(formData.get('new_password') ?? '')
  const confirmNewPassword = String(formData.get('confirm_new_password') ?? '')

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    }
  }

  if (newPassword !== confirmNewPassword) {
    return { ok: false, error: 'New password and confirmation do not match' }
  }

  let session: Awaited<ReturnType<typeof verifySession>>
  try {
    session = await verifySession()
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: 'You must be signed in to change your password' }
    }
    throw error
  }

  const supabase = await createServerClient()

  // Re-verify identity with the CURRENT password first (REQ-AUTH-05/06,
  // spec 3.4) — MUST NOT proceed to updateUser if this fails.
  const { error: reverifyError } = await supabase.auth.signInWithPassword({
    email: session.user.email,
    password: currentPassword,
  })

  if (reverifyError) {
    return { ok: false, error: 'Current password is incorrect' }
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })

  if (updateError) {
    return { ok: false, error: 'Failed to update password' }
  }

  try {
    await supabase.rpc('sp_change_password_user', { p_id_usuario: session.user.id })
  } catch {
    // Best-effort audit trail (this slice's explicit instructions) — the
    // password change already succeeded above and must not be reported as
    // a failure just because the audit RPC round-trip errored.
  }

  // Primer ingreso con contraseña temporal: se quita la marca, se refresca el
  // JWT para que proxy.ts deje pasar y se entra a la app como tras el login.
  if (await debeCambiarClave()) {
    if (!(await marcarClaveCambiada(session.user.id))) {
      return { ok: false, error: 'Failed to update password' }
    }
    await supabase.auth.refreshSession()
    redirect('/ventas')
  }

  return { ok: true }
}
