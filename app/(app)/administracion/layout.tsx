import { redirect } from 'next/navigation'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'

/**
 * §L134: "módulo independiente de Administración - NO LO VE EL NEGOCIO
 * PRINCIPAL". Solo accede quien tiene permiso `administracion.ver`.
 */
export default async function AdministracionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await verifySession()
  try {
    await requireModuleRole(session, 'administracion', 'ver')
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.reason === 'no-session') redirect('/login')
      redirect(`/no-autorizado?e=${error.reason}`)
    }
    throw error
  }
  return <>{children}</>
}
