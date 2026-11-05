import { redirect } from 'next/navigation'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'

/**
 * Gate del módulo Inventario. Doble chequeo (REQ-AG-03): módulo habilitado
 * para el tenant Y permiso `ver` en el rol del usuario. Fail-closed:
 *   - no-session       → /no-autorizado?e=no-session
 *   - module-disabled  → /no-autorizado?e=module-disabled
 *   - no-permission    → /no-autorizado?e=no-permission
 */
export default async function InventarioLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await verifySession()
  try {
    await requireModuleRole(session, 'inventario', 'ver')
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(`/no-autorizado?e=${error.reason}`)
    }
    throw error
  }

  return <>{children}</>
}
