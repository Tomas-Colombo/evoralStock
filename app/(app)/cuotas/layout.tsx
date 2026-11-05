import { redirect } from 'next/navigation'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'

// Cuotas vive como sub-módulo funcional de ventas: usamos el mismo código de
// módulo para gating (no hay 'cuotas' en el catálogo seed), igual que
// Clientes. Ver es suficiente para entrar; cobrar pide `editar` y marcar
// incobrable pide `eliminar`, y eso lo chequea cada action.
export default async function CuotasLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await verifySession()
  try {
    await requireModuleRole(session, 'ventas', 'ver')
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.reason === 'no-session') redirect('/login')
      redirect(`/no-autorizado?e=${error.reason}`)
    }
    throw error
  }
  return <>{children}</>
}
