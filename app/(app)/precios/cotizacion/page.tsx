import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { hasPermission } from '@/lib/dal/guard'
import { leerCotizacionVigente, type CotizacionVigente } from '@/lib/dal/precios/cotizacion'
import { CotizacionView } from './CotizacionView'

export default async function PreciosCotizacionPage() {
  const session = await verifySession()
  const canEdit = hasPermission(session, 'precios', 'editar_cotizacion')

  let cotizacion: CotizacionVigente | null = null
  try {
    cotizacion = await leerCotizacionVigente()
  } catch {
    cotizacion = null
  }

  return (
    <>
      <Topbar
        title="Cotización USD"
        session={session}
        backHref="/precios"
      />
      <main className="flex-1 p-4 sm:p-6 max-w-4xl space-y-6">
        <CotizacionView initial={cotizacion} canEdit={canEdit} />
      </main>
    </>
  )
}
