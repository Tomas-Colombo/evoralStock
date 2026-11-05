import { redirect } from 'next/navigation'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'

// Clientes vive como sub-módulo funcional de ventas: usamos el mismo
// código de módulo para gating (no hay 'clientes' en el catálogo seed).
export default async function ClientesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await verifySession()
  try {
    await requireModuleRole(session, 'ventas', 'ver')
  } catch (error) {
    if (error instanceof AuthorizationError) {
      redirect(`/no-autorizado?e=${error.reason}`)
    }
    throw error
  }
  return <>{children}</>
}
