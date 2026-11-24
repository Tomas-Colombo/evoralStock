import { verifySession } from '@/lib/dal/session'
import { listarMisDeclaraciones } from '@/lib/dal/revendedoras'
import { DeclaracionesRevendedoraView } from './DeclaracionesRevendedoraView'

export const metadata = {
  title: 'Mis declaraciones | Revendedor',
}

export default async function MisDeclaracionesPage() {
  const session = await verifySession()
  const res = await listarMisDeclaraciones(session, { limit: 100, offset: 0 })

  if (!res.ok) {
    return (
      <div className="p-6 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive">
        <p className="font-medium">No se pudieron cargar tus declaraciones.</p>
      </div>
    )
  }

  return <DeclaracionesRevendedoraView declaraciones={res.data.rows} />
}
