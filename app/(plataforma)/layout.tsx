import { notFound, redirect } from 'next/navigation'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireSuperAdmin } from '@/lib/dal/plataforma/guard'

/**
 * Shell layout para el panel de plataforma (superadmin).
 *
 * Exige sesión activa y pertenencia a la tabla `superadmin` (DR-SA-01).
 * Falla cerrada:
 *   - 'no-session'    → redirect('/login')
 *   - 'no-permission' → notFound()
 */
export default async function PlataformaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  try {
    await requireSuperAdmin()
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.reason === 'no-session') {
        redirect('/login')
      }
      notFound()
    }
    throw error
  }

  return <>{children}</>
}
