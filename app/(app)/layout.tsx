import { redirect } from 'next/navigation'
import { PanelAyuda } from '@/components/ayuda/PanelAyuda'
import { Sidebar } from '@/components/shell/Sidebar'
import { ayudaDisponible } from '@/lib/ayuda/config'
import { hasModuleAccess } from '@/lib/dal/guard'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthorizationError } from '@/lib/dal/errors'
import { superAdminActual } from '@/lib/dal/plataforma/guard'
import { verifySession } from '@/lib/dal/session'
import { getTenantSubdomainFromHeaders, verifyTenantMatch } from '@/lib/dal/tenant'

/**
 * Root layout for the authenticated multi-tenant app shell.
 *
 * Every route under `app/(app)/**` lives inside a tenant subdomain and
 * a verified session. This layout enforces BOTH before any child page
 * renders:
 *   1. `verifySession()` — user is logged in and JWT carries `tenant_id`.
 *   2. `verifyTenantMatch()` — session's tenant matches the subdomain
 *      the proxy resolved (defense against session-tenant desync).
 *
 * Per-module authorization (`requireModuleRole(session, 'inventario', 'ver')`)
 * lives inside each module's own layout, not here — this shell only
 * gates access to the app surface at all.
 */
export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let session: Awaited<ReturnType<typeof verifySession>>
  try {
    session = await verifySession()
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.reason === 'no-session') {
        const sa = await superAdminActual()
        if (sa) {
          redirect('/plataforma')
        }
      }
      redirect('/login')
    }
    throw error
  }

  if (session.idRevendedora) {
    redirect('/mi-cuenta')
  }

  // In production every request under (app) is served from a tenant
  // subdomain — the proxy injects the header and `verifyTenantMatch`
  // must succeed. In localhost/dev without a subdomain the proxy
  // returns null; we degrade to session-only trust so `npm run dev`
  // stays usable. The JWT already binds the session to `tenantId`,
  // and RLS enforces isolation regardless.
  const subdomain = await getTenantSubdomainFromHeaders()
  if (subdomain) {
    try {
      await verifyTenantMatch(subdomain)
    } catch (error) {
      if (error instanceof AuthorizationError) redirect('/login?e=tenant-mismatch')
      throw error
    }
  }

  return (
    <ToastProvider>
      <div className="flex min-h-screen w-full bg-bg text-text">
        <Sidebar session={session} />
        <div className="flex min-w-0 flex-1 flex-col w-full">{children}</div>
      </div>
      {hasModuleAccess(session, 'ayuda', 'consultar') && ayudaDisponible() && <PanelAyuda />}
    </ToastProvider>
  )
}
