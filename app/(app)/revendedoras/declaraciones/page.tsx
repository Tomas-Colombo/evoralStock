import Link from 'next/link'
import { verifySession } from '@/lib/dal/session'
import { requireModuleRole, hasPermission } from '@/lib/dal/guard'
import { Topbar } from '@/components/shell/Topbar'
import { listarDeclaracionesLocal } from '@/lib/dal/revendedoras'
import { declaracionesLocalQuerySchema } from '@/lib/validation/revendedoras'
import { DeclaracionesTableView } from './DeclaracionesTableView'

interface PageProps {
  searchParams: Promise<{ estado?: string; page?: string }>
}

export const metadata = {
  title: 'Bandeja de declaraciones | Revendedor | Utopía',
}

const ESTADOS = [
  { valor: 'todas', label: 'Todas' },
  { valor: 'pendiente', label: 'Pendientes' },
  { valor: 'confirmada', label: 'Confirmadas' },
  { valor: 'rechazada', label: 'Rechazadas' },
  { valor: 'retirada', label: 'Retiradas' },
]

export default async function DeclaracionesBandejaPage(props: PageProps) {
  const session = await verifySession()
  await requireModuleRole(session, 'revendedoras', 'ver')
  const puedeGestionar = hasPermission(session, 'revendedoras', 'crear')

  const rawParams = await props.searchParams
  const parsed = declaracionesLocalQuerySchema.safeParse(rawParams)
  const query = parsed.success ? parsed.data : { page: 1, limit: 50, estado: 'todas' as const }

  const res = await listarDeclaracionesLocal(session, query)

  if (!res.ok) {
    return (
      <>
        <Topbar
          title="Bandeja de declaraciones"
          session={session}
          backHref="/revendedoras"
        />
        <main className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl">
          <div className="p-6 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
            <p className="font-medium">No se pudieron cargar las declaraciones.</p>
          </div>
        </main>
      </>
    )
  }

  const declaraciones = res.data.declaraciones
  const estadoActual = query.estado

  return (
    <>
      <Topbar
        title="Bandeja de declaraciones"
        session={session}
        backHref="/revendedoras"
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold font-display tracking-tight">Declaraciones de venta</h1>
            <p className="text-sm text-muted mt-1">
              Revisión y confirmación de ventas autodeclaradas por las revendedoras.
            </p>
          </div>
        </div>

        {/* Filtros de estado */}
        <div className="flex overflow-x-auto gap-2 border-b border-border pb-2">
          {ESTADOS.map((e) => {
            const isActive = estadoActual === e.valor
            return (
              <Link
                key={e.valor}
                href={e.valor === 'todas' ? '/revendedoras/declaraciones' : `/revendedoras/declaraciones?estado=${e.valor}`}
                className={`min-h-[44px] inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-block text-block-ink shadow-sm'
                    : 'text-muted hover:text-text hover:bg-hover'
                }`}
              >
                {e.label}
              </Link>
            )
          })}
        </div>

        <DeclaracionesTableView
          declaraciones={declaraciones}
          puedeGestionar={puedeGestionar}
        />
      </main>
    </>
  )
}
