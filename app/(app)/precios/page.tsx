import Link from 'next/link'
import { BandAction } from '@/components/shell/BandAction'
import { Topbar } from '@/components/shell/Topbar'
import { hasModuleAccess } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { listReglasPrecio } from '@/lib/dal/precios/regla'
import { getPreciosResumen } from '@/lib/dal/precios/resolucion'
import { listGananciaPorProducto } from '@/lib/dal/reportes/reportes'
import { listCategoriasActivas } from '@/lib/dal/inventario/categoria'
import { listProductosParaBuscador } from '@/lib/dal/inventario/producto'
import { normalizar } from '@/lib/inventario/producto-match'
import { GananciaProyectadaClient } from './GananciaProyectadaClient'

const GANANCIA_PAGE_SIZE = 20

export default async function PreciosHome(props: {
  searchParams: Promise<{ gq?: string; gcat?: string; gpage?: string }>
}) {
  const session = await verifySession()
  const puedeVerMargenes = hasModuleAccess(session, 'precios', 'ver_margenes')
  const sp = await props.searchParams
  const page = Math.max(1, Number.parseInt(sp.gpage ?? '1', 10) || 1)

  const [reglas, resumen, ganancia, categorias, catalogo] = await Promise.all([
    listReglasPrecio(),
    getPreciosResumen(),
    puedeVerMargenes ? listGananciaPorProducto() : Promise.resolve([]),
    listCategoriasActivas(),
    puedeVerMargenes ? listProductosParaBuscador() : Promise.resolve([]),
  ])

  const { desactualizados, sinPrecio, conRegla } = resumen

  const term = normalizar(sp.gq ?? '')
  const filtradas = ganancia.filter((g) => {
    if (sp.gcat && g.id_categoria !== sp.gcat) return false
    if (term) {
      const okNombre = normalizar(g.nombre).includes(term)
      const okSku = g.sku ? normalizar(g.sku).includes(term) : false
      if (!okNombre && !okSku) return false
    }
    return true
  })
  const total = filtradas.length
  const from = (page - 1) * GANANCIA_PAGE_SIZE
  const pageRows = filtradas.slice(from, from + GANANCIA_PAGE_SIZE)

  return (
    <>
      <Topbar
        title="Precios y Cuentas"
        subtitle="Cascada de precios: producto › categoría › proveedor › global"
        session={session}
        actions={
          <BandAction
            href="/precios/control"
            tone="primary"
            title="Control de precios"
            description="Ver productos desactualizados y aplicar recálculo (individual o masivo)."
          />
        }
        kpis={[
          { label: 'Reglas activas', value: reglas.length.toString() },
          { label: 'Precios desactualizados', value: desactualizados.toString(), tone: desactualizados > 0 ? 'warn' : 'default' },
          { label: 'Sin precio', value: sinPrecio.toString(), tone: sinPrecio > 0 ? 'warn' : 'default' },
          { label: 'Con margen aplicado', value: conRegla.toString() },
        ]}
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6">

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Link
            href="/precios/reglas"
            className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-line-2 hover:bg-card-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <div className="text-sm text-muted">Configurar</div>
            <div className="mt-1 font-display text-xl">Reglas de precios</div>
            <p className="mt-2 text-sm text-muted">
              Margen, descuentos, recargos por forma de pago. Cascada: producto &gt; categoría &gt; proveedor &gt; global.
            </p>
          </Link>
          <Link
            href="/precios/cuentas"
            className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-line-2 hover:bg-card-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <div className="text-sm text-muted">Configurar</div>
            <div className="mt-1 font-display text-xl">Cuentas de cobro</div>
            <p className="mt-2 text-sm text-muted">
              Dónde entra la plata: caja, banco, billetera virtual. Y el
              tarifario de cada una: cuánto retiene el procesador y en cuántos
              días acredita.
            </p>
          </Link>
          <Link
            href="/precios/cotizacion"
            className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-line-2 hover:bg-card-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <div className="text-sm text-muted">Configurar</div>
            <div className="mt-1 font-display text-xl">Cotización USD</div>
            <p className="mt-2 text-sm text-muted">
              Tipo de cambio oficial para conversión de costos: modo automático desde el BCRA o valor manual.
            </p>
          </Link>
        </section>

        {puedeVerMargenes && (
          <section className="space-y-3">
            <h2 className="font-display text-lg">Ganancia proyectada por producto</h2>
            <GananciaProyectadaClient
              rows={pageRows}
              catalogo={catalogo}
              categorias={categorias}
              initialSearch={sp.gq ?? ''}
              initialCategoria={sp.gcat ?? ''}
              page={page}
              pageSize={GANANCIA_PAGE_SIZE}
              total={total}
            />
          </section>
        )}
      </main>
    </>
  )
}
