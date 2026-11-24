import { redirect } from 'next/navigation'
import { verifySession, type Session } from '@/lib/dal/session'
import { capacidades } from '@/lib/modulos/capacidades'
import { requireModuleRole } from '@/lib/dal/guard'
import { AuthorizationError } from '@/lib/dal/errors'
import { ToastProvider } from '@/components/ui/Toast'
import { logoutAction } from '@/lib/auth/actions'
import { SidebarClient, type SidebarNavGroup } from '@/components/shell/SidebarClient'
import { Button } from '@/components/ui/Button'

const PORTAL_NAV: SidebarNavGroup[] = [
  {
    label: 'MI CUENTA',
    items: [
      { href: '/mi-cuenta', label: 'Resumen', icon: 'reportes' },
      { href: '/mi-cuenta/stock', label: 'Mi stock', icon: 'inventario' },
      { href: '/mi-cuenta/ventas', label: 'Mis ventas', icon: 'ventas' },
      { href: '/mi-cuenta/liquidaciones', label: 'Liquidaciones', icon: 'rendiciones' },
      { href: '/mi-cuenta/declaraciones', label: 'Declaraciones', icon: 'consignaciones' },
    ],
  },
]

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
      <div className="flex min-h-screen w-full bg-bg text-text">
        {/* Mismo menú lateral que la app: barra colapsable en escritorio y
            hamburguesa con cajón en el celular, con el logo del tenant. */}
        <SidebarClient
          groups={PORTAL_NAV}
          email={session.user.email}
          rolNombre={session.rolNombre}
          marca={session.marca}
        />
        <div className="flex min-w-0 flex-1 flex-col w-full">{children}</div>
      </div>
    </ToastProvider>
  )
}
