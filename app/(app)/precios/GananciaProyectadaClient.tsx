'use client'

import { BusquedaUrl } from '@/components/filtros/BusquedaUrl'
import { PaginacionUrl } from '@/components/filtros/PaginacionUrl'
import { SelectUrl } from '@/components/filtros/SelectUrl'
import { Table, type Column } from '@/components/ui/Table'
import { TableFrame } from '@/components/ui/TableParts'
import type { ProductoBuscadorItem } from '@/lib/dal/inventario/producto'
import type { CategoriaRow } from '@/lib/types/inventario'
import type { GananciaPorProductoRow } from '@/lib/types/reportes'

export function GananciaProyectadaClient({
  rows,
  categorias,
  initialSearch,
  initialCategoria,
  page,
  pageSize,
  total,
}: {
  rows: GananciaPorProductoRow[]
  catalogo?: ProductoBuscadorItem[]
  categorias: CategoriaRow[]
  initialSearch: string
  initialCategoria: string
  page: number
  pageSize: number
  total: number
  basePath?: string
}) {
  const fmtMoney = (n: number | null) =>
    n == null ? '—' : `$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`

  const columns: Column<GananciaPorProductoRow>[] = [
    {
      key: 'nombre',
      label: 'Producto',
      render: (r) => (
        <div>
          <div className="font-medium">{r.nombre}</div>
          {r.sku && <div className="text-xs font-mono text-muted">{r.sku}</div>}
        </div>
      ),
    },
    {
      key: 'categoria',
      label: 'Categoría',
      render: (r) => r.categoria_nombre ?? <span className="text-muted">—</span>,
    },
    {
      key: 'costo',
      label: 'Costo',
      align: 'right',
      render: (r) => <span className="font-mono text-muted">{fmtMoney(r.costo_vigente)}</span>,
    },
    {
      key: 'precio',
      label: 'Precio venta',
      align: 'right',
      render: (r) => <span className="font-mono">{fmtMoney(r.precio_venta)}</span>,
    },
    {
      key: 'ganancia',
      label: 'Ganancia u.',
      align: 'right',
      render: (r) => <span className="font-mono">{fmtMoney(r.ganancia_unitaria)}</span>,
    },
    {
      key: 'margen',
      label: 'Margen',
      align: 'right',
      render: (r) => (
        <span className="font-mono">
          {r.margen_pct != null ? `${r.margen_pct}%` : '—'}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <BusquedaUrl
            param="gq"
            valor={initialSearch}
            placeholder="Buscar por nombre o SKU"
            paramPagina="gpage"
          />
        </div>
        <div className="w-full sm:w-56">
          <SelectUrl
            id="ganancia-categoria"
            param="gcat"
            valor={initialCategoria}
            ariaLabel="Categoría"
            paramPagina="gpage"
            opciones={[
              { value: '', label: 'Todas las categorías' },
              ...categorias.map((c) => ({
                value: c.id_categoria,
                label: c.nombre,
              })),
            ]}
          />
        </div>
      </div>

      <TableFrame>
        <Table
          columns={columns}
          data={rows}
          getRowId={(r) => r.id_producto}
          emptyState="Sin productos que coincidan con los filtros"
        />
      </TableFrame>

      <PaginacionUrl
        page={page}
        pageSize={pageSize}
        total={total}
        param="gpage"
      />
    </div>
  )
}
