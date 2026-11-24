import { verifySession } from '@/lib/dal/session'
import { listarMiStock } from '@/lib/dal/revendedoras'
import { StockRevendedoraView } from './StockRevendedoraView'

export const metadata = {
  title: 'Mi stock | Revendedor',
}

export default async function MiStockPage() {
  const session = await verifySession()
  const res = await listarMiStock(session, { limit: 100, offset: 0 })

  if (!res.ok) {
    return (
      <div className="p-6 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive">
        <p className="font-medium">No se pudo cargar el stock en tu poder.</p>
      </div>
    )
  }

  return <StockRevendedoraView items={res.data.rows} />
}
