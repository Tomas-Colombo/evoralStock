import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { listRoles } from '@/lib/dal/administracion/administracion'
import { getRevendedorasLibres } from '../revendedorasLibres'
import { InvitarUsuarioForm } from './InvitarUsuarioForm'
import { Card } from '@/components/ui/Card'

export default async function NuevoUsuarioPage() {
  const session = await verifySession()
  const [roles, revs] = await Promise.all([
    listRoles(),
    getRevendedorasLibres(session),
  ])

  return (
    <>
      <Topbar title="Invitar usuario" session={session} backHref="/administracion/usuarios" />
      <main className="flex-1 p-4 sm:p-6">
        <Card padding="none" className="max-w-xl p-6">
          <InvitarUsuarioForm
            roles={roles.map((r) => ({ id: r.id_rol, nombre: r.nombre }))}
            revendedorasLibres={revs}
          />
        </Card>
      </main>
    </>
  )
}
