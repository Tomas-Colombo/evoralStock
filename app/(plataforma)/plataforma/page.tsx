import { listarTenantsPaginado } from '@/lib/dal/plataforma'
import { parseFiltrosTenants } from '@/lib/validation/plataforma'
import { PAGE_SIZE_PLATAFORMA } from '@/lib/types/plataforma'
import { TenantsView } from './TenantsView'

interface PageProps {
  searchParams: Promise<{
    q?: string
    estado?: string
    deuda?: string
    orden?: string
    page?: string
  }>
}

export default async function PlataformaPage(props: PageProps) {
  const searchParams = await props.searchParams
  const filtros = parseFiltrosTenants(searchParams)

  // 1. Obtener primera query con filtros y página
  let { rows, total } = await listarTenantsPaginado({
    page: filtros.page,
    pageSize: PAGE_SIZE_PLATAFORMA,
    q: filtros.q,
    estado: filtros.estado,
    deuda: filtros.deuda,
    orden: filtros.orden,
  })

  // D6: Si page supera el total, mostrar la última página
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE_PLATAFORMA))
  let effectivePage = filtros.page
  if (filtros.page > totalPages) {
    effectivePage = totalPages
    const reconsulta = await listarTenantsPaginado({
      page: effectivePage,
      pageSize: PAGE_SIZE_PLATAFORMA,
      q: filtros.q,
      estado: filtros.estado,
      deuda: filtros.deuda,
      orden: filtros.orden,
    })
    rows = reconsulta.rows
    total = reconsulta.total
  }

  return (
    <TenantsView
      tenants={rows}
      total={total}
      page={effectivePage}
      pageSize={PAGE_SIZE_PLATAFORMA}
      filtros={filtros}
    />
  )
}
