import { notFound } from 'next/navigation'
import { z } from 'zod'
import { obtenerTenantDetalle } from '@/lib/dal/plataforma'
import type { TenantPlataformaDetalle } from '@/lib/types/plataforma'
import { TenantDetalleView } from './TenantDetalleView'

const idSchema = z.string().uuid()

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TenantDetallePage({ params }: PageProps) {
  const { id } = await params
  const parsed = idSchema.safeParse(id)
  if (!parsed.success) {
    notFound()
  }

  let detalle: TenantPlataformaDetalle
  try {
    detalle = await obtenerTenantDetalle(parsed.data)
  } catch (error) {
    if (error instanceof Error && error.message === 'tenant-inexistente') {
      notFound()
    }
    throw error
  }

  return <TenantDetalleView detalle={detalle} />
}
