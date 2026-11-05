import { redirect } from 'next/navigation'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'

// Proveedores vive como sub-módulo funcional de inventario: usamos el mismo
// código de módulo para gating (no hay 'proveedores' en el catálogo seed).
export default async function ProveedoresLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await verifySession()
  try {
    await requireModuleRole(session, 'inventario', 'ver')
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.reason === 'no-session') redirect('/login')
      redirect(`/no-autorizado?e=${error.reason}`)
    }
    throw error
  }
  return <>{children}</>
}
