import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { requireModuleRole } from '@/lib/dal/guard'
import { NuevaRevendedoraForm } from './NuevaRevendedoraForm'
import { Card } from '@/components/ui/Card'
import { getPermisosNuevaRevendedora } from '../permisos'

export const metadata = {
  title: 'Nueva revendedora | Utopía',
}

export default async function NuevaRevendedoraPage() {
  const session = await verifySession()
  await requireModuleRole(session, 'revendedoras', 'crear')

  const { canGrantAccess, canEditComision } = getPermisosNuevaRevendedora(session)

  return (
    <>
      <Topbar title="Nueva revendedora" session={session} backHref="/revendedoras" />
      <main className="flex-1 p-4 sm:p-6">
        <Card padding="none" className="max-w-xl p-6">
          <NuevaRevendedoraForm
            canGrantAccess={canGrantAccess}
            canEditComision={canEditComision}
          />
        </Card>
      </main>
    </>
  )
}
