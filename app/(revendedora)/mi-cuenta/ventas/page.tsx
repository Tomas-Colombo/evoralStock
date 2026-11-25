import { redirect } from 'next/navigation'
import { verifySession } from '@/lib/dal/session'
import { listarMisVentas } from '@/lib/dal/revendedoras'
import type { EstadoFiltroVentas } from '@/lib/types/revendedoras'
import { FiltroPeriodo } from '@/components/shell/FiltroPeriodo'
import { PageBand } from '@/components/shell/PageBand'
import { VenderBandAction } from '../VenderBandAction'
import {
  PORTAL_PAGE_SIZE,
  parsearBusquedaPortal,
  parsearEstadoPortal,
  parsearPaginaPortal,
  parsearPeriodoPortal,
  urlPortalConFiltros,
} from '../filtros'
import { VentasRevendedoraView } from './VentasRevendedoraView'

export const metadata = {
  title: 'Mis ventas | Revendedor',
}

const ESTADOS_VENTAS: readonly EstadoFiltroVentas[] = ['liquidada', 'pendiente', 'anulada']

export default async function MisVentasPage(props: {
  searchParams: Promise<{
    desde?: string
    hasta?: string
    estado?: string
    q?: string
    pagina?: string
  }>
}) {
  const session = await verifySession()
  const searchParams = await props.searchParams

  const { desde, hasta } = parsearPeriodoPortal(searchParams.desde, searchParams.hasta)
  const estado = parsearEstadoPortal(searchParams.estado, ESTADOS_VENTAS)
  const q = parsearBusquedaPortal(searchParams.q)
  const pagina = parsearPaginaPortal(searchParams.pagina)

  const res = await listarMisVentas(session, {
    limit: PORTAL_PAGE_SIZE,
    offset: (pagina - 1) * PORTAL_PAGE_SIZE,
    desde,
    hasta,
    estado,
    q,
  })

  const filtroPeriodo = (
    <FiltroPeriodo
      ariaLabel="Filtrar ventas por período y estado"
      idPrefix="mi-cuenta-ventas"
      desde={desde ?? ''}
      hasta={hasta ?? ''}
      extras={[
        {
          param: 'estado',
          label: 'Estado',
          value: estado ?? '',
          ancho: 'w-40',
          options: [
            { value: '', label: 'Todos' },
            { value: 'liquidada', label: 'Liquidada' },
            { value: 'pendiente', label: 'No liquidada' },
            { value: 'anulada', label: 'Anulada' },
          ],
        },
      ]}
    />
  )

  if (!res.ok) {
    return (
      <>
        <PageBand
          breadcrumb={['Mi cuenta', 'Mis ventas']}
          title="Artículos vendidos"
          subtitle="Detalle por artículo de las ventas registradas y confirmadas a tu nombre."
          filters={filtroPeriodo}
        />
        <main className="flex-1 p-4 sm:p-6 space-y-6">
          <div className="p-6 rounded-lg border border-destructive/30 bg-card text-destructive">
            <p className="font-medium">No se pudieron cargar tus ventas.</p>
          </div>
        </main>
      </>
    )
  }

  if (res.data.rows.length === 0 && pagina > 1) {
    redirect(urlPortalConFiltros('/mi-cuenta/ventas', { desde, hasta, estado, q }))
  }

  return (
    <>
      <PageBand
        breadcrumb={['Mi cuenta', 'Mis ventas']}
        title="Mis ventas"
        subtitle={`Ventas registradas a tu nombre · ${res.data.total} ${res.data.total === 1 ? 'venta' : 'ventas'}`}
        filters={filtroPeriodo}
        actions={<VenderBandAction />}
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6">
        <VentasRevendedoraView
          ventas={res.data.rows}
          total={res.data.total}
          pagina={pagina}
          pageSize={PORTAL_PAGE_SIZE}
          desde={desde ?? ''}
          hasta={hasta ?? ''}
          estado={estado ?? ''}
          q={q ?? ''}
        />
      </main>
    </>
  )
}
