import { redirect } from 'next/navigation'
import { verifySession, type Session } from '@/lib/dal/session'
import { capacidades } from '@/lib/modulos/capacidades'
import { requireModuleRole } from '@/lib/dal/guard'
import { AuthorizationError } from '@/lib/dal/errors'
import { ToastProvider } from '@/components/ui/Toast'
import { ThemeToggle } from '@/components/theming/ThemeToggle'
import { logoutAction } from '@/lib/auth/actions'
import { PortalNav } from './PortalNav'
import { Button } from '@/components/ui/Button'

export default async function RevendedoraLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let session: Session
  try {
    session = await verifySession()
  } catch (err) {
    if (err instanceof AuthorizationError) redirect('/login')
    throw err
  }

  // Si entra un operador (sin claim de revendedora), redirigir al panel del local
  if (!session.idRevendedora) {
    redirect('/revendedoras')
  }

  // Módulo apagado: pantalla clara sin 500
  const moduloHabilitado = capacidades(session.modulosHabilitados).revendedoras
  if (!moduloHabilitado) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-bg text-text text-center">
        <div className="max-w-md w-full p-8 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] space-y-4">
          <div className="w-12 h-12 rounded-full bg-warn-bg text-warn-ink flex items-center justify-center mx-auto text-2xl font-bold">
            !
          </div>
          <h1 className="text-xl font-bold font-display">Módulo deshabilitado</h1>
          <p className="text-sm text-muted">
            El módulo de revendedoras no está habilitado para este negocio. Si pensás que es un error, comunicate con el local.
          </p>
          <form action={logoutAction} className="pt-2">
            <Button
              variant="secondary"
              type="submit"
              className="min-h-[44px] min-w-[44px]"
            >
              Cerrar sesión
            </Button>
          </form>
        </div>
      </div>
    )
  }

  try {
    await requireModuleRole(session, 'revendedoras', 'ver_propio')
  } catch (err) {
    if (err instanceof AuthorizationError) redirect('/login?e=no-permission')
    throw err
  }

  return (
    <ToastProvider>
      <div className="min-h-screen bg-bg text-text flex flex-col">
        {/* Header superior móvil / desktop */}
        <header className="band-scope sticky top-0 z-30 bg-band px-4 py-3 text-band-ink">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-display text-lg text-band-ink">
                Portal Revendedoras
              </span>
              <span className="eyebrow rounded-full border border-band-line px-2 py-0.5 text-band-muted">
                Revendedora
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              <form action={logoutAction}>
                <Button
                  variant="secondary"
                  size="sm"
                  type="submit"
                  aria-label="Cerrar sesión"
                  title="Cerrar sesión"
                  className="min-h-[44px] min-w-[44px]"
                >
                  Salir
                </Button>
              </form>
            </div>
          </div>
        </header>

        {/* Contenido principal móvil primero */}
        <div className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 space-y-6">
          <PortalNav />
          <main className="space-y-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  )
}
