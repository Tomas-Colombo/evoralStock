import { notFound } from 'next/navigation'
import { Topbar } from '@/components/shell/Topbar'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { obtenerRevendedora } from '@/lib/dal/revendedoras'
import { listProductosSinCosto } from '@/lib/dal/inventario/producto'
import { NuevaConsignacionRevendedoraForm } from './NuevaConsignacionRevendedoraForm'
import { Card } from '@/components/ui/Card'

export default async function NuevaConsignacionRevendedoraPage(props: {
  params: Promise<{ id: string }>
}) {
  const session = await verifySession()
  await requireModuleRole(session, 'revendedoras', 'crear')

  const { id } = await props.params
  const [revendedora, productos] = await Promise.all([
    obtenerRevendedora(session, id),
    listProductosSinCosto({ soloActivos: true }),
  ])
  if (!revendedora) notFound()

  // Solo lo que hay en el local: lo demás no se puede consignar.
  const catalogo = productos
    .filter((p) => p.stock_disponible > 0)
    .map((p) => ({
      id_producto: p.id_producto,
      nombre: p.nombre,
      sku: p.sku,
      stock_disponible: p.stock_disponible,
    }))

  return (
    <>
      <Topbar
        title={`Nueva consignación · ${revendedora.nombre} ${revendedora.apellido}`}
        session={session}
        backHref={`/revendedoras/${id}/consignaciones`}
      />
      <main className="flex-1 p-4 sm:p-6">
        <Card padding="none" className="max-w-4xl p-6">
          <NuevaConsignacionRevendedoraForm
            idRevendedora={id}
            nombreRevendedora={`${revendedora.nombre} ${revendedora.apellido}`}
            catalogo={catalogo}
          />
        </Card>
      </main>
    </>
  )
}
