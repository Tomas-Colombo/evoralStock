'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CameraIcon } from '@/components/ui/CameraIcon'
import { BuscadorProductos, type SugerenciaProducto } from '@/components/inventario/BuscadorProductos'
import { Pagination } from '@/components/ui/Pagination'
import { Table, type Column } from '@/components/ui/Table'
import { normalizar } from '@/lib/inventario/producto-match'
import type { ProductoBuscadorItem } from '@/lib/dal/inventario/producto'
import type { CategoriaRow, ProductoConDetalle } from '@/lib/types/inventario'
import type { StockPorTenenciaRow } from '@/lib/types/revendedoras'
import { EditarProductoModal } from './EditarProductoModal'
import { Select } from '@/components/ui/Select'

export function ProductosTableClient({
  rows,
  catalogo,
  categorias,
  initialSearch,
  initialCategoria,
  page,
  pageSize,
  total,
  basePath = '/inventario/productos',
  scanHref,
  tenenciaStock,
  initialTenencia,
}: {
  rows: ProductoConDetalle[]
  /** Catálogo liviano (id/nombre/sku) que alimenta las sugerencias en vivo. */
  catalogo: ProductoBuscadorItem[]
  categorias: CategoriaRow[]
  initialSearch: string
  initialCategoria: string
  page: number
  pageSize: number
  total: number
  /** Ruta a la que se sincronizan los filtros. La home de inventario reusa
   *  esta tabla, así que el listado vive en `/inventario`, no en `/inventario/productos`. */
  basePath?: string
  /** Si se pasa, muestra un botón de cámara (escaneo) en la barra de búsqueda. */
  scanHref?: string
  /** Stock por tenencia para mostrar columna y filtro (condicionado a módulo revendedoras). */
  tenenciaStock?: Record<string, StockPorTenenciaRow> | null
  initialTenencia?: string
}) {
  const router = useRouter()
  const [q, setQ] = useState(initialSearch)
  const [cat, setCat] = useState(initialCategoria)
  const [tenencia, setTenencia] = useState(initialTenencia ?? '')
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<ProductoConDetalle | null>(null)

  // Sugerencias por nombre o SKU (mismo criterio normalizado que ventas).
  const sugerencias = useMemo<SugerenciaProducto[]>(() => {
    const term = normalizar(q)
    if (!term) return []
    return catalogo
      .filter(
        (p) =>
          normalizar(p.nombre).includes(term) ||
          (p.sku ? normalizar(p.sku).includes(term) : false),
      )
      .slice(0, 8)
      .map((p) => ({ id: p.id_producto, nombre: p.nombre, sku: p.sku }))
  }, [catalogo, q])

  const displayedRows = useMemo(() => {
    if (!tenenciaStock || !tenencia) return rows
    if (tenencia === 'central') {
      return rows.filter((r) => r.stock_disponible > 0)
    }
    if (tenencia === 'revendedoras') {
      return rows.filter((r) => (tenenciaStock[r.id_producto]?.en_revendedoras ?? 0) > 0)
    }
    return rows
  }, [rows, tenenciaStock, tenencia])

  function navigate(params: URLSearchParams) {
    const qs = params.toString()
    startTransition(() => {
      router.push(qs ? `${basePath}?${qs}` : basePath)
    })
  }

  // Cambiar filtros vuelve a la página 1: el `page` actual dejaría de tener
  // sentido con un conjunto de resultados distinto.
  function applyFilters(nextQ = q, nextCat = cat, nextTenencia = tenencia) {
    const params = new URLSearchParams()
    if (nextQ.trim()) params.set('q', nextQ.trim())
    if (nextCat) params.set('cat', nextCat)
    if (tenenciaStock && nextTenencia) params.set('tenencia', nextTenencia)
    navigate(params)
  }

  function goToPage(nextPage: number) {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (cat) params.set('cat', cat)
    if (tenenciaStock && tenencia) params.set('tenencia', tenencia)
    if (nextPage > 1) params.set('page', String(nextPage))
    navigate(params)
  }

  const columns: Column<ProductoConDetalle>[] = [
    { key: 'nombre', label: 'Producto', render: (r) => <span className="font-semibold text-ink">{r.nombre}</span> },
    {
      key: 'sku',
      label: 'SKU',
      render: (r) => (r.sku ? <span className="font-mono text-xs text-muted">{r.sku}</span> : <span className="text-dim">—</span>),
    },
    {
      key: 'categoria',
      label: 'Categoría',
      render: (r) => r.categoria?.nombre ?? <span className="text-dim">—</span>,
    },
    {
      key: 'precio_venta',
      label: 'Precio de venta',
      align: 'right',
      render: (r) =>
        r.precio_venta != null ? (
          <span className="font-mono">
            $ {r.precio_venta.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'stock_disponible',
      label: 'Stock / Mín.',
      align: 'right',
      render: (r) => {
        const tieneMinimo = r.stock_minimo > 0
        const bajo = tieneMinimo && r.stock_disponible < r.stock_minimo
        return (
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
            <span className={`whitespace-nowrap font-mono ${bajo ? 'text-warn-ink' : ''}`}>
              {tieneMinimo
                ? `${r.stock_disponible} / ${r.stock_minimo}`
                : r.stock_disponible}
            </span>
            {bajo && (
              <Badge variant="warning">
                <span className="whitespace-nowrap">Bajo</span>
              </Badge>
            )}
          </div>
        )
      },
    },
    ...(tenenciaStock
      ? [
          {
            key: 'tenencia',
            label: 'Tenencia',
            align: 'right' as const,
            render: (r: ProductoConDetalle) => {
              const t = tenenciaStock[r.id_producto]
              const enRev = t ? t.en_revendedoras : 0
              return (
                <div className="flex flex-col items-end text-xs">
                  <span className="font-mono text-muted">Central: {r.stock_disponible}</span>
                  {enRev > 0 && (
                    <span className="font-mono font-semibold text-ink">
                      En rev.: {enRev}
                    </span>
                  )}
                </div>
              )
            },
          },
        ]
      : []),
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (r) => (
        <div className="-mr-2 flex items-center justify-end gap-0.5 whitespace-nowrap">
          <Link
            href={`/inventario/productos/${r.id_producto}/ficha`}
            className="rounded-[4px] px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            Ver
          </Link>
          <Link
            href={`/inventario/ingresos/nuevo?producto=${r.id_producto}`}
            className="rounded-[4px] px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            title="Cargar un ingreso prellenado con este producto"
          >
            Restock
          </Link>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setEditing(r)}
          >
            Editar
          </Button>
        </div>
      ),
    },
  ]

  // Chips de lo que ya está aplicado (la URL), no de lo que se está tipeando:
  // así el chip nunca miente sobre lo que muestra la tabla.
  const categoriaActiva = initialCategoria
    ? categorias.find((c) => c.id_categoria === initialCategoria)?.nombre ?? null
    : null
  const tenenciaActiva =
    tenenciaStock && initialTenencia
      ? initialTenencia === 'central'
        ? 'Stock central'
        : initialTenencia === 'revendedoras'
          ? 'En revendedoras'
          : null
      : null
  const hayFiltros = Boolean(initialSearch || categoriaActiva || tenenciaActiva)

  function limpiarFiltros() {
    setQ('')
    setCat('')
    setTenencia('')
    applyFilters('', '', '')
  }

  // Elegir una sugerencia filtra la tabla a ese producto.
  function elegirSugerencia(s: SugerenciaProducto) {
    setQ(s.nombre)
    applyFilters(s.nombre)
  }

  // Texto libre sin sugerencia: si no matcheó ningún nombre/SKU lo tratamos
  // como un código (QR) y vamos a la ficha; si no hay ruta de escaneo,
  // caemos al filtro server por nombre/SKU.
  function buscarLibre(texto: string) {
    if (scanHref) {
      startTransition(() => {
        router.push(`${scanHref}/${encodeURIComponent(texto)}`)
      })
      return
    }
    applyFilters(texto)
  }

  return (
    <div className="space-y-3">
      {/* Buscador con sugerencias en vivo (nombre/SKU/QR), igual que el carrito
          de venta. Sincronizamos con la URL solo al enviar/elegir, para no
          golpear el server en cada tecla. */}
      <BuscadorProductos
        id="inv-buscador"
        label="Buscar producto"
        hint="Nombre, SKU o QR. Enter filtra; un QR abre la ficha."
        placeholder="Buscar por nombre, SKU o QR"
        value={q}
        onChange={setQ}
        sugerencias={sugerencias}
        onElegir={elegirSugerencia}
        onSubmit={buscarLibre}
        disabled={pending}
        actions={
          <>
            <Select
              value={cat}
              onChange={(e) => {
                setCat(e.target.value)
                applyFilters(q, e.target.value)
              }}
              className="w-auto"
            >
              <option value="">Todas las categorías</option>
              {categorias.map((c) => (
                <option key={c.id_categoria} value={c.id_categoria}>
                  {c.nombre}
                </option>
              ))}
            </Select>
            {tenenciaStock && (
              <Select
                value={tenencia}
                onChange={(e) => {
                  setTenencia(e.target.value)
                  applyFilters(q, cat, e.target.value)
                }}
                className="w-auto"
              >
                <option value="">Todas las tenencias</option>
                <option value="central">Stock central</option>
                <option value="revendedoras">En revendedoras</option>
              </Select>
            )}
            <Button variant="neutral" onClick={() => applyFilters()} className="shrink-0">
              Aplicar
            </Button>
            {scanHref && (
              <Link
                href={scanHref}
                aria-label="Escanear con cámara"
                title="Escanear con cámara"
                className="inline-flex shrink-0 items-center gap-2 rounded-md border border-line-2 px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                <CameraIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Escanear</span>
              </Link>
            )}
          </>
        }
      />

      {hayFiltros && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="eyebrow text-muted">Filtrando</span>
          {initialSearch && <FiltroChip>“{initialSearch}”</FiltroChip>}
          {categoriaActiva && <FiltroChip>{categoriaActiva}</FiltroChip>}
          {tenenciaActiva && <FiltroChip>{tenenciaActiva}</FiltroChip>}
          <Button
            variant="bare"
            type="button"
            onClick={limpiarFiltros}
            disabled={pending}
            className="rounded-[4px] px-2 py-1 font-medium text-muted underline decoration-line-2 underline-offset-2 transition-colors hover:text-ink hover:decoration-ink"
          >
            Limpiar filtros
          </Button>
        </div>
      )}

      <div
        className={`overflow-x-auto rounded-lg border border-line bg-panel shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-opacity ${
          pending ? 'opacity-70' : ''
        }`}
      >
        <Table
          columns={columns}
          data={displayedRows}
          loading={pending}
          getRowId={(r) => r.id_producto}
          emptyState="Sin productos que coincidan con los filtros"
        />
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={goToPage}
        disabled={pending}
      />

      <EditarProductoModal
        open={editing !== null}
        producto={editing}
        categorias={categorias}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

function FiltroChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-[16rem] items-center truncate rounded-full border border-line-2 bg-panel px-2.5 py-0.5 text-xs text-ink">
      {children}
    </span>
  )
}
