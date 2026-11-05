import { redirect } from 'next/navigation'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'

// Gastos es su propio módulo del catálogo (00055): se habilita y se permisa
// por separado de rendiciones.
export default async function GastosLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await verifySession()
  try {
    await requireModuleRole(session, 'gastos', 'ver')
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.reason === 'no-session') redirect('/login')
      redirect(`/no-autorizado?e=${error.reason}`)
    }
    throw error
  }
  return <>{children}</>
}
