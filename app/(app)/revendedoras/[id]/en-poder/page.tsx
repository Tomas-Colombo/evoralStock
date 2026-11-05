import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { requireModuleRole } from '@/lib/dal/guard'
import { obtenerRevendedora, listarItemsEnPoderRevendedora } from '@/lib/dal/revendedoras'
import { RevendedoraTabs } from '../RevendedoraTabs'
import { ItemsEnPoderTable } from './ItemsEnPoderTable'
import { Card } from '@/components/ui/Card'

interface PageProps {
  params: Promise<{ id: string }>
}

export const metadata = {
  title: 'En su poder | Revendedoras | Utopía',
}

export default async function ItemsEnPoderPage(props: PageProps) {
  const session = await verifySession()
  await requireModuleRole(session, 'revendedoras', 'ver')

  const { id } = await props.params
  const revendedora = await obtenerRevendedora(session, id)
  if (!revendedora) notFound()

  const res = await listarItemsEnPoderRevendedora(id)
  const items = res.ok ? res.data : []

  const totalCantidad = items.length
  const totalMonto = items.reduce((acc, it) => acc + Number(it.precio_venta || 0), 0)

  return (
    <>
      <Topbar
        title={`${revendedora.nombre} ${revendedora.apellido}`}
        session={session}
        backHref="/revendedoras"
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6 max-w-5xl">
        <RevendedoraTabs idRevendedora={revendedora.id_revendedora} activeTab="en_poder" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <div className="text-xs font-medium text-muted uppercase tracking-wider">
              Piezas en su poder
            </div>
            <div className="mt-2 text-2xl font-bold font-mono">{totalCantidad}</div>
            <div className="mt-1 text-xs text-muted">artículos activamente en consignación</div>
          </Card>

          <Card>
            <div className="text-xs font-medium text-muted uppercase tracking-wider">
              Valor estimado en poder
            </div>
            <div className="mt-2 text-2xl font-bold font-mono">
              $ {Number(totalMonto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </div>
            <div className="mt-1 text-xs text-muted">a precio de venta al público</div>
          </Card>
        </div>

        {items.length === 0 ? (
          <Card padding="none" className="border-dashed p-10 text-center">
            <p className="font-display text-lg mb-2">Sin artículos en su poder</p>
            <p className="text-sm text-muted mb-4">
              La revendedora no tiene actualmente artículos en consignación.
            </p>
            <Link
              href={`/revendedoras/${revendedora.id_revendedora}/consignaciones/nueva`}
              className="inline-flex items-center rounded-md bg-block px-4 py-2 text-sm font-semibold text-block-ink"
            >
              Nueva consignación
            </Link>
          </Card>
        ) : (
          <ItemsEnPoderTable items={items} />
        )}
      </main>
    </>
  )
}
