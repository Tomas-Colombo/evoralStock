import { redirect } from 'next/navigation'
import { verifySession } from '@/lib/dal/session'
import { primeraRutaPermitida } from '@/lib/modulos/rutas'

interface RaizPageProps {
  searchParams?: Promise<{ e?: string }>
}

/**
 * La raíz redirige a la primera sección a la que el rol tiene acceso de lectura,
 * según el orden de módulos del Sidebar. Si el usuario no tiene acceso a ningún
 * módulo, redirige a /no-autorizado.
 */
export default async function RaizPage(props: RaizPageProps) {
  const session = await verifySession()
  const ruta = primeraRutaPermitida(session)

  if (!ruta) {
    const sp = await props.searchParams
    redirect(sp?.e ? `/no-autorizado?e=${encodeURIComponent(sp.e)}` : '/no-autorizado')
  }

  redirect(ruta)
}
