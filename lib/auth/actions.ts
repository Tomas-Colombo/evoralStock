'use server'

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/dal/supabase'

/**
 * Sign out the current user. `signOut()` clears the Supabase auth cookies
 * through the SSR cookie adapter, then we redirect to the login screen.
 *
 * Shell-level action: available to EVERY authenticated user regardless of
 * role, because every shell (app, plataforma, revendedora) offers it, outside any module guard. No `requireModuleRole` here — logging out is never privileged.
 */
export async function logoutAction(): Promise<void> {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
