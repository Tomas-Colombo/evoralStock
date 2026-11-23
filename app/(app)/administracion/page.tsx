import Link from 'next/link'
import { Topbar } from '@/components/shell/Topbar'
import { hasModuleAccess } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { capacidades, modulosDePermisoVisibles } from '@/lib/modulos/capacidades'
import {
  listRoles,
  listUsuarios,
} from '@/lib/dal/administracion/administracion'
import {
  getEtiquetaConfig,
  listEtiquetaPlantillas,
} from '@/lib/dal/etiquetas/etiquetas'
import { CambiarPasswordCard } from './CambiarPasswordCard'
import { ConfiguracionLogoCard } from './ConfiguracionLogoCard'
import { ConfiguracionEtiquetasCard } from './ConfiguracionEtiquetasCard'
import { PlantillasEtiquetaCard } from './PlantillasEtiquetaCard'
import { RolesModal } from './RolesModal'

function cardLink(c: { href: string; label: string; value: string }) {
  return (
    <Link
      key={c.href}
      href={c.href}
      className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-line-2 hover:bg-card-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      <div className="text-sm text-muted">{c.label}</div>
      <div className="mt-1 font-display text-2xl">{c.value}</div>
    </Link>
  )
}

export default async function AdministracionHome() {
  const session = await verifySession()
  const cap = capacidades(session.modulosHabilitados)
  const modulosVisibles = modulosDePermisoVisibles(cap)
  const [usuarios, roles, etiquetaConfig, plantillas] = await Promise.all([
    listUsuarios(),
    listRoles(),
    getEtiquetaConfig(),
    listEtiquetaPlantillas(),
  ])
  const canCreate = hasModuleAccess(session, 'administracion', 'crear')
  const canEdit = hasModuleAccess(session, 'administracion', 'editar')
  const canDelete = hasModuleAccess(session, 'administracion', 'eliminar')

  // Roles no está acá: es un pop-up (`RolesModal`), no una ruta. Módulos
  // tampoco: lo que el cliente contrató lo decide el operador, no el admin
  // del tenant (antes podía habilitarse un módulo que no pagó).
  const cards = [
    { href: '/administracion/usuarios', label: 'Usuarios', value: usuarios.length.toString() },
    { href: '/administracion/auditoria', label: 'Auditoría', value: 'Ver' },
  ]

  return (
    <>
      <Topbar title="Configuración" session={session} />
      <main className="flex-1 p-4 sm:p-6 space-y-6">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {cards.slice(0, 1).map(cardLink)}
          <RolesModal
            roles={cap.revendedoras ? roles : roles.filter((r) => r.nombre !== 'Revendedora')}
            modulosVisibles={modulosVisibles}
          />
          {cards.slice(1).map(cardLink)}
        </section>

        <ConfiguracionLogoCard logoActual={session.marca.logoUrl} canEdit={canEdit} />
        <ConfiguracionEtiquetasCard inicial={etiquetaConfig} canEdit={canEdit} />
        <PlantillasEtiquetaCard
          plantillas={plantillas}
          config={etiquetaConfig}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
        />
        <CambiarPasswordCard />
      </main>
    </>
  )
}
