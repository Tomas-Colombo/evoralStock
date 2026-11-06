import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { hasPermission } from '@/lib/dal/guard'
import { listControlDePrecios } from '@/lib/dal/precios/resolucion'
import { countProductosCostoUsdVigentes } from '@/lib/dal/precios/cotizacion'
import { ControlDePreciosView } from './ControlDePreciosView'

export default async function ControlDePreciosPage() {
  const session = await verifySession()
  const canRevaluar = hasPermission(session, 'precios', 'editar_cotizacion')
  const [rows, cantidadUsd] = await Promise.all([
    listControlDePrecios(),
    canRevaluar
      ? countProductosCostoUsdVigentes()
      : Promise.resolve({ revaluables: 0, omitidas: 0 }),
  ])
  return (
    <>
      <Topbar title="Control de precios" session={session} backHref="/precios" />
      <main className="flex-1 p-4 sm:p-6">
        <ControlDePreciosView
          initial={rows}
          canRevaluar={canRevaluar}
          cantidadUsd={cantidadUsd}
        />
      </main>
    </>
  )
}
