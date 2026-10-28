import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Topbar } from '@/components/shell/Topbar'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { obtenerRevendedora, listarItemsEnPoderRevendedora } from '@/lib/dal/revendedoras'
import { Card } from '@/components/ui/Card'
import { DevolucionRevendedoraForm } from './DevolucionRevendedoraForm'

export const metadata = {
  title: 'Devolución | Revendedoras | Utopía',
}

export default async function DevolucionRevendedoraPage(props: { params: Promise<{ id: string }> }) {
  const session = await verifySession()
  await requireModuleRole(session, 'revendedoras', 'editar')

  const { id } = await props.params
  const [revendedora, res] = await Promise.all([
    obtenerRevendedora(session, id),
    listarItemsEnPoderRevendedora(id),
  ])
  if (!revendedora) notFound()

  const nombre = `${revendedora.nombre} ${revendedora.apellido}`
  const items = res.ok ? res.data : []

  return (
    <>
      <Topbar title={`Devolución · ${nombre}`} session={session} backHref="/revendedoras" />
      <main className="flex-1 p-4 sm:p-6">
        {items.length === 0 ? (
          <Card padding="none" className="max-w-4xl border-dashed p-10 text-center">
            <p className="font-display text-lg mb-2">Sin piezas para devolver</p>
            <p className="text-sm text-muted mb-4">{nombre} no tiene mercadería en su poder.</p>
            <Link
              href="/revendedoras"
              className="inline-flex items-center rounded-md bg-block px-4 py-2 text-sm font-semibold text-block-ink"
            >
              Volver a revendedoras
            </Link>
          </Card>
        ) : (
          <Card padding="none" className="max-w-4xl p-6">
            <DevolucionRevendedoraForm idRevendedora={id} nombreRevendedora={nombre} items={items} />
          </Card>
        )}
      </main>
    </>
  )
}
