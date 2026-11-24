import { redirect } from 'next/navigation'
import { verifySession } from '@/lib/dal/session'
import { listarMisLiquidaciones } from '@/lib/dal/revendedoras'
import type { EstadoFiltroLiquidaciones } from '@/lib/types/revendedoras'
import {
  PORTAL_PAGE_SIZE,
  parsearEstadoPortal,
  parsearPaginaPortal,
  parsearPeriodoPortal,
  urlPortalConFiltros,
} from '../filtros'
import { LiquidacionesRevendedoraView } from './LiquidacionesRevendedoraView'

export const metadata = {
  title: 'Mis liquidaciones | Revendedor',
}

const ESTADOS_LIQUIDACIONES: readonly EstadoFiltroLiquidaciones[] = ['pendiente', 'pagada']

export default async function MisLiquidacionesPage(props: {
  searchParams: Promise<{ desde?: string; hasta?: string; estado?: string; pagina?: string }>
}) {
  const session = await verifySession()
  const searchParams = await props.searchParams

  const { desde, hasta } = parsearPeriodoPortal(searchParams.desde, searchParams.hasta)
  const estado = parsearEstadoPortal(searchParams.estado, ESTADOS_LIQUIDACIONES)
  const pagina = parsearPaginaPortal(searchParams.pagina)

  const res = await listarMisLiquidaciones(session, {
    limit: PORTAL_PAGE_SIZE,
    offset: (pagina - 1) * PORTAL_PAGE_SIZE,
    desde,
    hasta,
    estado,
  })

  if (!res.ok) {
    return (
      <div className="p-6 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive">
        <p className="font-medium">No se pudieron cargar tus liquidaciones.</p>
      </div>
    )
  }

  if (res.data.rows.length === 0 && pagina > 1) {
    redirect(urlPortalConFiltros('/mi-cuenta/liquidaciones', { desde, hasta, estado }))
  }

  return (
    <LiquidacionesRevendedoraView
      liquidaciones={res.data.rows}
      total={res.data.total}
      pagina={pagina}
      pageSize={PORTAL_PAGE_SIZE}
      desde={desde ?? ''}
      hasta={hasta ?? ''}
      estado={estado ?? ''}
    />
  )
}
