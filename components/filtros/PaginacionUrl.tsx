'use client'

import { Pagination } from '@/components/ui/Pagination'
import { useFiltrosUrl } from './useFiltrosUrl'

export interface PaginacionUrlProps {
  page: number
  pageSize: number
  total: number
  /** Nombre del query param de página (default `'pagina'`). */
  param?: string
}

/**
 * Paginación conectada a la URL. La página 1 borra el param para mantener
 * URLs limpias.
 */
export function PaginacionUrl({
  page,
  pageSize,
  total,
  param = 'pagina',
}: PaginacionUrlProps) {
  const { aplicar, pendiente } = useFiltrosUrl({ paramPagina: param })

  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={total}
      onPageChange={(nueva) => aplicar({ [param]: nueva <= 1 ? null : String(nueva) })}
      disabled={pendiente}
    />
  )
}
