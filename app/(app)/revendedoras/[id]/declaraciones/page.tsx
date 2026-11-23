import { notFound } from 'next/navigation'
import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { requireModuleRole, hasPermission } from '@/lib/dal/guard'
import { obtenerRevendedora, listarDeclaracionesLocal } from '@/lib/dal/revendedoras'
import { RevendedoraTabs } from '../RevendedoraTabs'
import { DeclaracionesTableView } from '../../declaraciones/DeclaracionesTableView'

interface PageProps {
  params: Promise<{ id: string }>
}

export const metadata = {
  title: 'Declaraciones | Revendedor | Utopía',
}

export default async function DeclaracionesRevendedoraPage(props: PageProps) {
  const session = await verifySession()
  await requireModuleRole(session, 'revendedoras', 'ver')
  const puedeGestionar = hasPermission(session, 'revendedoras', 'crear')

  const { id } = await props.params
  const revendedora = await obtenerRevendedora(session, id)
  if (!revendedora) notFound()

  const res = await listarDeclaracionesLocal(session, {
    id_revendedora: id,
    page: 1,
    limit: 100,
    estado: 'todas',
  })

  const declaraciones = res.ok ? res.data.declaraciones : []

  return (
    <>
      <Topbar
        title={`${revendedora.nombre} ${revendedora.apellido}`}
        session={session}
        backHref="/revendedoras"
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6 max-w-5xl">
        <RevendedoraTabs idRevendedora={revendedora.id_revendedora} activeTab="declaraciones" />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold font-display tracking-tight">
              Declaraciones de venta de {revendedora.nombre}
            </h2>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent-fg/10 text-accent-fg">
              {declaraciones.length} {declaraciones.length === 1 ? 'declaración' : 'declaraciones'}
            </span>
          </div>

          <DeclaracionesTableView
            declaraciones={declaraciones}
            puedeGestionar={puedeGestionar}
          />
        </div>
      </main>
    </>
  )
}
