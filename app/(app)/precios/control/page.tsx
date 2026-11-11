import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { hasModuleAccess, hasPermission } from '@/lib/dal/guard'
import { proyectarControlDePrecios } from '@/lib/precios/proyeccion'
import { listControlDePrecios } from '@/lib/dal/precios/resolucion'
import { countProductosCostoUsdVigentes } from '@/lib/dal/precios/cotizacion'
import { ControlDePreciosView } from './ControlDePreciosView'

export default async function ControlDePreciosPage() {
  const session = await verifySession()
  const canRevaluar = hasPermission(session, 'precios', 'editar_cotizacion')
  const puedeVerCostos = hasModuleAccess(session, 'inventario', 'ver_costos')
  const puedeVerMargenes = hasModuleAccess(session, 'precios', 'ver_margenes')
  const [rows, cantidadUsd] = await Promise.all([
    listControlDePrecios(),
    canRevaluar
      ? countProductosCostoUsdVigentes()
      : Promise.resolve({ revaluables: 0, omitidas: 0 }),
  ])
  const initial = proyectarControlDePrecios(rows, { puedeVerCostos, puedeVerMargenes })
  return (
    <>
      <Topbar title="Control de precios" session={session} backHref="/precios" />
      <main className="flex-1 p-4 sm:p-6">
        <ControlDePreciosView
          initial={initial}
          canRevaluar={canRevaluar}
          cantidadUsd={cantidadUsd}
          puedeVerCostos={puedeVerCostos}
          puedeVerMargenes={puedeVerMargenes}
        />
      </main>
    </>
  )
}
