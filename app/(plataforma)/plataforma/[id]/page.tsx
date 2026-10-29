import { notFound } from 'next/navigation'
import { z } from 'zod'
import { obtenerTenantDetalle } from '@/lib/dal/plataforma'
import { hpageSchema } from '@/lib/validation/plataforma'
import type { TenantPlataformaDetalle } from '@/lib/types/plataforma'
import { TenantDetalleView } from './TenantDetalleView'

const idSchema = z.string().uuid()

interface PageProps {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ hpage?: string }>
}

export default async function TenantDetallePage({ params, searchParams }: PageProps) {
  const { id } = await params
  const parsed = idSchema.safeParse(id)
  if (!parsed.success) {
    notFound()
  }

  const sp = searchParams ? await searchParams : {}
  const hpage = hpageSchema.parse(sp.hpage)

  let detalle: TenantPlataformaDetalle
  try {
    detalle = await obtenerTenantDetalle(parsed.data, { hpage })
  } catch (error) {
    if (error instanceof Error && error.message === 'tenant-inexistente') {
      notFound()
    }
    throw error
  }

  return <TenantDetalleView detalle={detalle} />
}
