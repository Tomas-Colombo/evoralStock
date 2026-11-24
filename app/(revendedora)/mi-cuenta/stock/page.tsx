import { redirect } from 'next/navigation'
import { verifySession } from '@/lib/dal/session'
import { listarMiStock } from '@/lib/dal/revendedoras'
import type { EstadoFiltroStock } from '@/lib/types/revendedoras'
import {
  PORTAL_PAGE_SIZE,
  parsearBusquedaPortal,
  parsearEstadoPortal,
  parsearPaginaPortal,
  urlPortalConFiltros,
} from '../filtros'
import { StockRevendedoraView } from './StockRevendedoraView'

export const metadata = {
  title: 'Mi stock | Revendedor',
}

const ESTADOS_STOCK: readonly EstadoFiltroStock[] = ['con_pendiente', 'sin_declaracion']

export default async function MiStockPage(props: {
  searchParams: Promise<{ estado?: string; q?: string; pagina?: string }>
}) {
  const session = await verifySession()
  const searchParams = await props.searchParams

  const estado = parsearEstadoPortal(searchParams.estado, ESTADOS_STOCK)
  const q = parsearBusquedaPortal(searchParams.q)
  const pagina = parsearPaginaPortal(searchParams.pagina)

  const res = await listarMiStock(session, {
    limit: PORTAL_PAGE_SIZE,
    offset: (pagina - 1) * PORTAL_PAGE_SIZE,
    estado,
    q,
  })

  if (!res.ok) {
    return (
      <div className="p-6 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive">
        <p className="font-medium">No se pudo cargar el stock en tu poder.</p>
      </div>
    )
  }

  if (res.data.rows.length === 0 && pagina > 1) {
    redirect(urlPortalConFiltros('/mi-cuenta/stock', { estado, q }))
  }

  return (
    <StockRevendedoraView
      items={res.data.rows}
      total={res.data.total}
      pagina={pagina}
      pageSize={PORTAL_PAGE_SIZE}
      estado={estado ?? ''}
      q={q ?? ''}
    />
  )
}
