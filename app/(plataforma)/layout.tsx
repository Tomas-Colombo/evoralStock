import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireSuperAdmin, type SuperAdminIdentity } from '@/lib/dal/plataforma/guard'
import { logoutAction } from '@/lib/auth/actions'
import { ToastProvider } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'

export const dynamic = 'force-dynamic'

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
  let admin: SuperAdminIdentity
  try {
    admin = await requireSuperAdmin()
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.reason === 'no-session') {
        redirect('/login')
      }
      notFound()
    }
    throw error
  }

  return (
    <ToastProvider>
      <div className="flex min-h-screen w-full flex-col bg-bg text-text">
        <header
          role="banner"
          aria-label="Cabecera de plataforma"
          className="border-b border-line bg-panel px-4 py-3 sm:px-6 shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
        >
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link
                href="/plataforma"
                className="font-display text-lg font-bold tracking-tight text-ink hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                Plataforma
              </Link>
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden font-mono text-xs text-muted sm:inline-block">
                {admin.email}
              </span>
              <form action={logoutAction}>
                <Button variant="secondary" size="sm" type="submit">
                  Cerrar sesión
                </Button>
              </form>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col p-4 sm:p-6">
          {children}
        </main>
      </div>
    </ToastProvider>
  )
}
