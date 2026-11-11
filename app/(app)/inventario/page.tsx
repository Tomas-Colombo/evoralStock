import Link from 'next/link'
import { BandAction } from '@/components/shell/BandAction'
import { Topbar } from '@/components/shell/Topbar'
import { Button } from '@/components/ui/Button'
import { verifySession } from '@/lib/dal/session'
import {
  getInventarioResumen,
  listProductosSinCostoPaginado,
  listProductosParaBuscador,
  PRODUCTOS_PAGE_SIZE,
} from '@/lib/dal/inventario/producto'
import { countProveedoresActivos, listProveedoresActivos } from '@/lib/dal/inventario/proveedor'
import { NuevoProductoModalButton } from './NuevoProductoModalButton'
import { listCategoriasActivas } from '@/lib/dal/inventario/categoria'
import {
  listAlertaReposicion,
  listAlertaRotacionVencida,
} from '@/lib/dal/reportes/reportes'
import { hasModuleAccess } from '@/lib/dal/guard'
import { obtenerStockPorTenencia } from '@/lib/dal/revendedoras'
import type { StockPorTenenciaRow } from '@/lib/types/revendedoras'
import { AlertasReposicion } from './AlertasReposicion'
import { ProductosTableClient } from './ProductosTableClient'

/**
 * Home del módulo Inventario. Muestra el listado de productos directamente
 * (con un buscador único + filtros y paginación), más alertas (§L105),
 * cifras rápidas y accesos directos a los demás sub-módulos.
 */
export default async function InventarioHome(props: {
  searchParams: Promise<{ q?: string; cat?: string; page?: string; tenencia?: string }>
}) {
  const session = await verifySession()
  const searchParams = await props.searchParams
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const tieneModuloRevendedoras = hasModuleAccess(session, 'revendedoras', 'ver')
  const puedeCargarCostos = hasModuleAccess(session, 'inventario', 'cargar_costos')

  const [
    { rows: productosPagina, total },
    catalogoBuscador,
    resumen,
    proveedoresActivos,
    categorias,
    alertasRepo,
    alertasRot,
    tenenciaList,
    proveedores,
  ] = await Promise.all([
    listProductosSinCostoPaginado({
      search: searchParams.q,
      idCategoria: searchParams.cat,
      page,
      pageSize: PRODUCTOS_PAGE_SIZE,
    }),
    listProductosParaBuscador(),
    getInventarioResumen(),
    countProveedoresActivos(),
    listCategoriasActivas(),
    listAlertaReposicion(),
    listAlertaRotacionVencida(),
    tieneModuloRevendedoras ? obtenerStockPorTenencia() : Promise.resolve([] as StockPorTenenciaRow[]),
    listProveedoresActivos(),
  ])

  let tenenciaStockMap: Record<string, StockPorTenenciaRow> | null = null
  if (tieneModuloRevendedoras) {
    tenenciaStockMap = {}
    for (const t of tenenciaList) {
      tenenciaStockMap[t.id_producto] = t
    }
  }

  return (
    <>
      <Topbar
        title="Inventario"
        subtitle={`${resumen.productosActivos} productos activos`}
        session={session}
        kpis={[
          { label: 'Stock disponible', value: resumen.stockDisponibleTotal.toLocaleString('es-AR') },
          { label: 'Productos activos', value: resumen.productosActivos.toString() },
          { label: 'Bajo mínimo', value: resumen.productosBajoMinimo.toString(), tone: resumen.productosBajoMinimo > 0 ? 'warn' : 'default' },
          { label: 'Proveedores', value: proveedoresActivos.toString() },
        ]}
        filters={
          <div className="flex items-center gap-2">
            <Link href="/inventario/categorias">
              <Button size="sm" variant="secondary">Categorías</Button>
            </Link>
            <NuevoProductoModalButton
              categorias={categorias}
              productos={catalogoBuscador}
              proveedores={proveedores}
              puedeCargarCostos={puedeCargarCostos}
            />
          </div>
        }
        actions={
          <>
            <BandAction
              href="/inventario/ingresos/nuevo"
              tone="primary"
              title="Nuevo ingreso"
              description="Cargar mercadería de proveedor y actualizar stock."
            />
            <BandAction href="/inventario/ficha" title="Escanear QR" description="Abre la ficha del producto" />
          </>
        }
      />
      <main className="flex-1 space-y-6 p-4 sm:p-6">
        {/* Alertas — jerarquía visual §L105 */}
        <AlertasReposicion alertas={alertasRepo} />

        {alertasRot.length > 0 && (
          <section className="rounded-lg border border-line bg-panel p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="flex items-center gap-2 font-display text-lg text-ink">
                <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full border-[1.5px] border-warn" />
                Rotación vencida
              </h3>
              <span className="text-xs text-muted">
                Evaluá devolver al proveedor ·{' '}
                <span className="font-mono text-warn-ink">
                  {alertasRot.length} ítem{alertasRot.length === 1 ? '' : 's'}
                </span>
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {alertasRot.slice(0, 6).map((a) => (
                <Link
                  key={a.id_item}
                  href={`/inventario/ficha/${encodeURIComponent(a.qr_code)}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-line bg-panel-2 px-3 py-2.5 text-sm transition-colors hover:border-line-2 hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{a.producto_nombre}</div>
                    <div className="text-xs text-muted truncate">{a.proveedor_nombre}</div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-xs tabular-nums">
                    <div>{a.dias_transcurridos}d</div>
                    <div className="text-warn-ink">+{a.dias_excedidos}</div>
                  </div>
                </Link>
              ))}
              {alertasRot.length > 6 && (
                <div className="md:col-span-2 text-center text-xs text-muted pt-1">
                  +{alertasRot.length - 6} más
                </div>
              )}
            </div>
          </section>
        )}

        {/* Productos — buscador único (escáner + SKU) + tabla */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="font-display text-lg">Productos</h3>
            <span className="font-mono text-xs tabular-nums text-muted">
              {total.toLocaleString('es-AR')} {total === 1 ? 'resultado' : 'resultados'}
            </span>
          </div>
          <ProductosTableClient
            rows={productosPagina}
            catalogo={catalogoBuscador}
            categorias={categorias}
            initialSearch={searchParams.q ?? ''}
            initialCategoria={searchParams.cat ?? ''}
            page={page}
            pageSize={PRODUCTOS_PAGE_SIZE}
            total={total}
            basePath="/inventario"
            scanHref="/inventario/ficha"
            tenenciaStock={tenenciaStockMap}
            initialTenencia={tieneModuloRevendedoras ? (searchParams.tenencia ?? '') : ''}
          />
        </section>
      </main>
    </>
  )
}
