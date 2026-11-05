import { redirect } from 'next/navigation'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'

export default async function ConsignacionesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await verifySession()
  try {
    await requireModuleRole(session, 'consignaciones', 'ver')
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.reason === 'no-session') redirect('/login')
      redirect(`/no-autorizado?e=${error.reason}`)
    }
    throw error
  }
  return <>{children}</>
}
