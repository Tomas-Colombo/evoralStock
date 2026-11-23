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

const TARJETAS_CONFIG = [
  {
    href: '/precios/reglas',
    titulo: 'Reglas de precios',
    descripcion:
      'Margen, descuentos, recargos por forma de pago. Cascada: producto > categoría > proveedor > global.',
  },
  {
    href: '/precios/cuentas',
    titulo: 'Cuentas de cobro',
    descripcion:
      'Dónde entra la plata: caja, banco, billetera virtual. Y el tarifario de cada una: cuánto retiene el procesador y en cuántos días acredita.',
  },
  {
    href: '/precios/cotizacion',
    titulo: 'Cotización USD',
    descripcion:
      'Tipo de cambio oficial para conversión de costos: modo automático desde el BCRA o valor manual.',
  },
] as const

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
          {TARJETAS_CONFIG.map((t, i) => (
            <Link
              key={t.href}
              href={t.href}
              className="band-lift flex flex-col rounded-lg border border-line-2 bg-card p-5 transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-petrol focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="eyebrow text-petrol">Configurar</span>
                <span className="font-mono text-[11px] text-dim">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="mt-3 font-display text-xl">{t.titulo}</div>
              <p className="mb-5 mt-2 text-sm text-muted">{t.descripcion}</p>
              <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
                <span className="text-sm font-semibold text-petrol">Abrir</span>
                <span
                  aria-hidden
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-band text-band-ink"
                >
                  →
                </span>
              </div>
            </Link>
          ))}
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
