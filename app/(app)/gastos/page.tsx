import Link from 'next/link'
import { BandAction } from '@/components/shell/BandAction'
import { NuevoGastoModalButton } from './NuevoGastoModalButton'
import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import {
  listCategoriasGasto,
  listGastosPaginado,
  listPresupuestoMes,
  type GastosOrden,
} from '@/lib/dal/gastos/gasto'
import { PresupuestosMesTable } from './PresupuestosMesTable'
import { GastosTableClient } from './GastosTableClient'
import { Card } from '@/components/ui/Card'

const PAGE_SIZE = 20
const ORDENES: readonly GastosOrden[] = ['fecha_desc', 'fecha_asc', 'monto_desc', 'monto_asc'] as const

function parseOrden(v: string | undefined): GastosOrden {
  return (ORDENES as readonly string[]).includes(v ?? '') ? (v as GastosOrden) : 'fecha_desc'
}

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const desde = typeof params.desde === 'string' ? params.desde : ''
  const hasta = typeof params.hasta === 'string' ? params.hasta : ''
  const cat = typeof params.cat === 'string' ? params.cat : ''
  const orden = parseOrden(typeof params.orden === 'string' ? params.orden : undefined)
  const page = Math.max(1, Number(typeof params.page === 'string' ? params.page : '1') || 1)

  const session = await verifySession()
  const [gastosPage, presupuestos, categorias] = await Promise.all([
    listGastosPaginado({
      desde: desde || undefined,
      hasta: hasta || undefined,
      idCategoria: cat || undefined,
      orden,
      page,
      pageSize: PAGE_SIZE,
    }),
    listPresupuestoMes(),
    listCategoriasGasto({ soloActivas: true }),
  ])

  const totalMes = presupuestos.reduce((a, p) => a + p.gastado_mes, 0)
  const excedidos = presupuestos.filter((p) => p.alerta === 'excedido').length
  const cerca = presupuestos.filter((p) => p.alerta === 'cerca').length

  return (
    <>
      <Topbar
        title="Gastos"
        session={session}
        kpis={[
          { label: 'Gastado este mes', value: `$ ${totalMes.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` },
          { label: 'Categorías excedidas', value: excedidos.toString(), tone: excedidos > 0 ? 'warn' : 'default' },
          { label: 'Cerca del límite', value: cerca.toString(), tone: cerca > 0 ? 'warn' : 'default' },
          { label: 'Categorías activas', value: presupuestos.length.toString() },
        ]}
        actions={
          <>
            <NuevoGastoModalButton
              categorias={categorias.map((c) => ({ id: c.id_categoria_gasto, nombre: c.nombre }))}
            />
            <BandAction href="/gastos/presupuestos" title="Presupuestos" description="Límites por categoría" />
          </>
        }
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6">

        {/* Presupuestos por categoría */}
        <Card as="section" padding="none" className="overflow-x-auto">
          <div className="border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg">Presupuestos del mes</h3>
            <Link href="/gastos/presupuestos" className="-mx-2 rounded-[4px] px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink">
              Ajustar presupuestos
            </Link>
          </div>
          <PresupuestosMesTable rows={presupuestos} />
        </Card>

        {/* Últimos gastos */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg">Últimos gastos registrados</h3>
          </div>
          <GastosTableClient
            rows={gastosPage.rows}
            categorias={categorias.map((c) => ({ id: c.id_categoria_gasto, nombre: c.nombre }))}
            initialDesde={desde}
            initialHasta={hasta}
            initialCategoria={cat}
            initialOrden={orden}
            page={page}
            pageSize={PAGE_SIZE}
            total={gastosPage.total}
          />
        </section>
      </main>
    </>
  )
}
