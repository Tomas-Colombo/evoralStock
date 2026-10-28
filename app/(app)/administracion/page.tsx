import Link from 'next/link'
import { Topbar } from '@/components/shell/Topbar'
import { hasModuleAccess } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import {
  getConfiguracionQrLadoMm,
  listAuditoria,
  listRoles,
  listUsuarios,
} from '@/lib/dal/administracion/administracion'
import { CambiarPasswordCard } from './CambiarPasswordCard'
import { ConfiguracionLogoCard } from './ConfiguracionLogoCard'
import { ConfiguracionQrCard } from './ConfiguracionQrCard'
import { RolesModal } from './RolesModal'
import { Card } from '@/components/ui/Card'

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
  const [usuarios, roles, ultimasAcciones, ladoMm] = await Promise.all([
    listUsuarios(),
    listRoles(),
    listAuditoria({ limit: 15 }),
    getConfiguracionQrLadoMm(),
  ])
  const canEdit = hasModuleAccess(session, 'administracion', 'editar')

  // Roles no está acá: es un pop-up (`RolesModal`), no una ruta. Módulos
  // tampoco: lo que el cliente contrató lo decide el operador, no el admin
  // del tenant (antes podía habilitarse un módulo que no pagó).
  const cards = [
    { href: '/administracion/usuarios', label: 'Usuarios', value: usuarios.length.toString() },
    { href: '/administracion/auditoria', label: 'Auditoría', value: 'Ver' },
  ]

  return (
    <>
      <Topbar title="Administración" session={session} />
      <main className="flex-1 p-4 sm:p-6 space-y-6">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {cards.slice(0, 1).map(cardLink)}
          <RolesModal roles={roles} />
          {cards.slice(1).map(cardLink)}
        </section>

        <ConfiguracionLogoCard logoActual={session.marca.logoUrl} canEdit={canEdit} />
        <ConfiguracionQrCard ladoMmInicial={ladoMm} canEdit={canEdit} />
        <CambiarPasswordCard />

        <Card as="section" padding="none" className="overflow-x-auto">
          <div className="border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg">Últimas acciones auditadas</h3>
            <Link href="/administracion/auditoria" className="-mx-2 rounded-[4px] px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink">
              Ver historial completo
            </Link>
          </div>
          {ultimasAcciones.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">Sin registros aún.</div>
          ) : (
            <ul className="divide-y divide-border-2 text-sm">
              {ultimasAcciones.map((a) => (
                <li key={a.id_auditoria} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs uppercase text-muted">
                      {a.entidad} · {a.accion}
                    </div>
                    <div className="text-sm">
                      {a.actor_nombre || a.actor_email || '(sistema)'}
                    </div>
                  </div>
                  <div className="text-xs text-muted whitespace-nowrap">
                    {new Date(a.ts).toLocaleString('es-AR')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  )
}
