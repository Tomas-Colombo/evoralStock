import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Topbar } from '@/components/shell/Topbar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { verifySession } from '@/lib/dal/session'
import { getIngreso } from '@/lib/dal/inventario/ingreso'
import { listCategoriasActivas } from '@/lib/dal/inventario/categoria'
import { listQrsByIngreso } from '@/lib/dal/inventario/item'
import { listProductosConDetalle } from '@/lib/dal/inventario/producto'
import { getCotizacionVigente } from '@/lib/dal/precios/cotizacion'
import { buildEtiquetasIngresoHref } from '@/lib/inventario/etiquetas'
import { IngresoDetalleView } from './IngresoDetalleView'
import { safeBackHref } from '@/lib/utils/safeBackHref'

export default async function IngresoDetallePage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const session = await verifySession()
  const { id } = await props.params
  const { from } = await props.searchParams
  const ingreso = await getIngreso(id)
  if (!ingreso) notFound()

  const [productos, categorias, qrs, cotizacion] = await Promise.all([
    listProductosConDetalle({ soloActivos: true }),
    listCategoriasActivas(),
    ingreso.confirmado ? listQrsByIngreso(id) : Promise.resolve([] as string[]),
    getCotizacionVigente().catch(() => null),
  ])

  const imprimirHref =
    ingreso.confirmado && qrs.length > 0
      ? buildEtiquetasIngresoHref(ingreso.id_ingreso)
      : null

  return (
    <>
      <Topbar
        title={`Ingreso ${new Date(ingreso.fecha).toLocaleDateString('es-AR')}`}
        session={session}
        backHref={safeBackHref(from, '/inventario/ingresos')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {imprimirHref && (
              <Link href={imprimirHref}>
                <Button size="sm" variant="secondary">
                  Imprimir etiquetas ({qrs.length})
                </Button>
              </Link>
            )}
            <Badge variant={ingreso.confirmado ? 'success' : 'neutral'}>
              {ingreso.confirmado ? 'Confirmado' : 'Borrador'}
            </Badge>
          </div>
        }
      />
      <main className="flex-1 p-4 sm:p-6">
        <IngresoDetalleView
          ingreso={ingreso}
          productos={productos}
          categorias={categorias}
          qrs={qrs}
          cotizacion={cotizacion}
        />
      </main>
    </>
  )
}
