import { notFound } from 'next/navigation'
import { obtenerTenantDetalle } from '@/lib/dal/plataforma'
import type { TenantPlataformaDetalle } from '@/lib/types/plataforma'
import { TenantDetalleView } from './TenantDetalleView'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TenantDetallePage({ params }: PageProps) {
  const { id } = await params
  if (!id || !UUID_REGEX.test(id)) {
    notFound()
  }

  let detalle: TenantPlataformaDetalle
  try {
    detalle = await obtenerTenantDetalle(id)
  } catch {
    notFound()
  }

  return <TenantDetalleView detalle={detalle} />
}
