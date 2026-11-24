import { redirect } from 'next/navigation'
import { verifySession } from '@/lib/dal/session'
import { listarMisVentas } from '@/lib/dal/revendedoras'
import type { EstadoFiltroVentas } from '@/lib/types/revendedoras'
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

const ESTADOS_VENTAS: readonly EstadoFiltroVentas[] = ['liquidada', 'pendiente']

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

  if (!res.ok) {
    return (
      <div className="p-6 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive">
        <p className="font-medium">No se pudieron cargar tus ventas.</p>
      </div>
    )
  }

  if (res.data.rows.length === 0 && pagina > 1) {
    redirect(urlPortalConFiltros('/mi-cuenta/ventas', { desde, hasta, estado, q }))
  }

  return (
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
  )
}
