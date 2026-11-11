import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Topbar } from '@/components/shell/Topbar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { hasModuleAccess } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { proyectarIngresoDetalle } from '@/lib/inventario/proyeccion-costos'
import { omitirCostoProducto } from '@/lib/inventario/proyeccion-costos'
import { getIngreso } from '@/lib/dal/inventario/ingreso'
import { listCategoriasActivas } from '@/lib/dal/inventario/categoria'
import { listQrsByIngreso } from '@/lib/dal/inventario/item'
import { listProductosConDetalle } from '@/lib/dal/inventario/producto'
import { leerCotizacionVigente } from '@/lib/dal/precios/cotizacion'
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
  const puedeVerCostos = hasModuleAccess(session, 'inventario', 'ver_costos')
  const puedeCargarCostos = hasModuleAccess(session, 'inventario', 'cargar_costos')
  const ingresoRaw = await getIngreso(id)
  const ingreso = proyectarIngresoDetalle(ingresoRaw, puedeVerCostos)
  if (!ingreso) notFound()

  const [productos, categorias, qrs, cotizacion] = await Promise.all([
    listProductosConDetalle({ soloActivos: true }),
    listCategoriasActivas(),
    ingreso.confirmado ? listQrsByIngreso(id) : Promise.resolve([] as string[]),
    // La cotización es pública y el borrador la necesita para estimar líneas en USD.
    leerCotizacionVigente().catch(() => null),
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
          productos={puedeCargarCostos || puedeVerCostos ? productos : productos.map(omitirCostoProducto)}
          categorias={categorias}
          qrs={qrs}
          cotizacion={cotizacion}
          puedeVerCostos={puedeVerCostos}
          puedeCargarCostos={puedeCargarCostos}
        />
      </main>
    </>
  )
}
