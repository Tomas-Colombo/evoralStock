import { BandAction } from '@/components/shell/BandAction'
import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { hasPermission } from '@/lib/dal/guard'
import { obtenerPanelRevendedoras } from '@/lib/dal/revendedoras'
import { panelRevendedorasQuerySchema } from '@/lib/validation/revendedoras'
import { RevendedorasPanelView } from './RevendedorasPanelView'
import { NuevaRevendedoraModalButton } from './NuevaRevendedoraModalButton'
import { getPermisosNuevaRevendedora } from './permisos'

export const metadata = {
  title: 'Revendedoras | Utopía',
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function RevendedorasPage(props: PageProps) {
  const session = await verifySession()
  const rawParams = await props.searchParams

  const parsed = panelRevendedorasQuerySchema.safeParse(rawParams)
  const query = parsed.success
    ? parsed.data
    : panelRevendedorasQuerySchema.parse({})

  const limit = 25
  const offset = (query.page - 1) * limit

  const res = await obtenerPanelRevendedoras({
    desde: query.desde,
    hasta: query.hasta,
    estado: query.estado,
    cuenta: query.cuenta,
    q: query.q,
    orden: query.orden,
    limit,
    offset,
  })

  const panelData = res.ok
    ? res.data
    : {
        totales: {
          en_poder: 0,
          en_local: 0,
          adeudado_total: 0,
          liquidaciones_pendientes_monto: 0,
          liquidaciones_pendientes_cant: 0,
        },
        revendedoras: [],
        total: 0,
      }

  const canCreate = hasPermission(session, 'revendedoras', 'crear')
  const canEdit = hasPermission(session, 'revendedoras', 'editar')
  const { canGrantAccess, canEditComision } = getPermisosNuevaRevendedora(session)

  return (
    <>
      <Topbar
        title="Revendedoras"
        session={session}
        kpis={[
          {
            label: 'Mercadería en revendedoras',
            value: panelData.totales.en_poder.toString(),
            sub: `${panelData.totales.en_local} en el local`,
          },
          {
            label: 'Total adeudado al local',
            value: `$ ${Number(panelData.totales.adeudado_total).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`,
            tone: Number(panelData.totales.adeudado_total) > 0 ? 'warn' : 'default',
            sub: 'Saldo pendiente de cobro',
          },
          {
            label: 'Liquidaciones pendientes',
            value: `$ ${Number(panelData.totales.liquidaciones_pendientes_monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`,
            sub: `${panelData.totales.liquidaciones_pendientes_cant} por cobrar`,
          },
        ]}
        actions={
          <>
            {canCreate && (
              <NuevaRevendedoraModalButton
                canGrantAccess={canGrantAccess}
                canEditComision={canEditComision}
              />
            )}
            <BandAction href="/revendedoras/declaraciones" title="Declaraciones" description="Ventas declaradas por revisar" />
            <BandAction href="/revendedoras/comisiones" title="Reglas de comisión" />
          </>
        }
      />
      <main className="flex-1 p-4 sm:p-6">
        <RevendedorasPanelView
          data={panelData.revendedoras}
          total={panelData.total}
          canAsignar={canCreate}
          canDevolver={canEdit}
          filtros={{
            desde: query.desde,
            hasta: query.hasta,
            estado: query.estado,
            cuenta: query.cuenta,
            q: query.q,
            orden: query.orden,
            page: query.page,
          }}
        />
      </main>
    </>
  )
}
