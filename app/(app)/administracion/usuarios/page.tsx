import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { listRoles, listUsuarios } from '@/lib/dal/administracion/administracion'
import { getRevendedorasLibres } from './revendedorasLibres'
import { InvitarUsuarioModalButton } from './InvitarUsuarioModalButton'
import { UsuariosView } from './UsuariosView'

export default async function UsuariosAdminPage() {
  const session = await verifySession()
  const [usuarios, roles, revendedorasLibres] = await Promise.all([
    listUsuarios(),
    listRoles(),
    getRevendedorasLibres(session),
  ])
  const rolesParaForm = roles.map((r) => ({ id: r.id_rol, nombre: r.nombre }))

  return (
    <>
      <Topbar
        title="Usuarios"
        session={session}
        backHref="/administracion"
        actions={
          <InvitarUsuarioModalButton
            roles={rolesParaForm}
            revendedorasLibres={revendedorasLibres}
          />
        }
      />
      <main className="flex-1 p-4 sm:p-6">
        <UsuariosView
          initial={usuarios}
          roles={rolesParaForm}
        />
      </main>
    </>
  )
}
