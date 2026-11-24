import { redirect } from 'next/navigation'
import { verifySession } from '@/lib/dal/session'
import { listarMisDeclaraciones } from '@/lib/dal/revendedoras'
import type { EstadoFiltroDeclaraciones } from '@/lib/types/revendedoras'
import { FiltroPeriodo } from '@/components/shell/FiltroPeriodo'
import { PageBand } from '@/components/shell/PageBand'
import {
  PORTAL_PAGE_SIZE,
  parsearBusquedaPortal,
  parsearEstadoPortal,
  parsearPaginaPortal,
  parsearPeriodoPortal,
  urlPortalConFiltros,
} from '../filtros'
import { DeclaracionesRevendedoraView } from './DeclaracionesRevendedoraView'

export const metadata = {
  title: 'Mis declaraciones | Revendedor',
}

const ESTADOS_DECLARACIONES: readonly EstadoFiltroDeclaraciones[] = [
  'pendiente',
  'confirmada',
  'rechazada',
  'retirada',
]

export default async function MisDeclaracionesPage(props: {
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
  const estado = parsearEstadoPortal(searchParams.estado, ESTADOS_DECLARACIONES)
  const q = parsearBusquedaPortal(searchParams.q)
  const pagina = parsearPaginaPortal(searchParams.pagina)

  const res = await listarMisDeclaraciones(session, {
    limit: PORTAL_PAGE_SIZE,
    offset: (pagina - 1) * PORTAL_PAGE_SIZE,
    desde,
    hasta,
    estado,
    q,
  })

  const filtroPeriodo = (
    <FiltroPeriodo
      ariaLabel="Filtrar declaraciones por período y estado"
      idPrefix="mi-cuenta-declaraciones"
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
            { value: 'pendiente', label: 'Pendiente' },
            { value: 'confirmada', label: 'Confirmada' },
            { value: 'rechazada', label: 'Rechazada' },
            { value: 'retirada', label: 'Retirada' },
          ],
        },
      ]}
    />
  )

  if (!res.ok) {
    return (
      <>
        <PageBand
          breadcrumb={['Mi cuenta', 'Declaraciones']}
          title="Declaraciones de venta"
          subtitle="Artículos que declaraste como vendidos pendientes de confirmar por el local."
          filters={filtroPeriodo}
        />
        <main className="flex-1 p-4 sm:p-6 space-y-6">
          <div className="p-6 rounded-lg border border-destructive/30 bg-card text-destructive">
            <p className="font-medium">No se pudieron cargar tus declaraciones.</p>
          </div>
        </main>
      </>
    )
  }

  if (res.data.rows.length === 0 && pagina > 1) {
    redirect(urlPortalConFiltros('/mi-cuenta/declaraciones', { desde, hasta, estado, q }))
  }

  return (
    <>
      <PageBand
        breadcrumb={['Mi cuenta', 'Declaraciones']}
        title="Declaraciones de venta"
        subtitle={`Artículos que declaraste como vendidos pendientes de confirmar por el local · ${res.data.total} ${res.data.total === 1 ? 'declaración' : 'declaraciones'}`}
        filters={filtroPeriodo}
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6">
        <DeclaracionesRevendedoraView
          declaraciones={res.data.rows}
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
