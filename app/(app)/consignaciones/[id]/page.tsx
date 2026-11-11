import { notFound } from 'next/navigation'
import { Topbar } from '@/components/shell/Topbar'
import { Badge } from '@/components/ui/Badge'
import { hasModuleAccess, hasPermission } from '@/lib/dal/guard'
import { proyectarConsignacionConDetalle } from '@/lib/inventario/proyeccion-costos'
import { verifySession } from '@/lib/dal/session'
import {
  getConsignacionConDetalle,
  listItemsElegiblesConsignacion,
} from '@/lib/dal/consignaciones/consignacion'
import {
  ESTADO_CONSIGNACION_LABEL,
  ESTADO_CONSIGNACION_VARIANT,
} from '@/lib/types/consignaciones'
import { ConsignacionDetalleView } from './ConsignacionDetalleView'
import { safeBackHref } from '@/lib/utils/safeBackHref'

export default async function ConsignacionDetallePage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const session = await verifySession()
  const { id } = await props.params
  const { from } = await props.searchParams
  const puedeVerCostos = hasModuleAccess(session, 'inventario', 'ver_costos')
  const consRaw = await getConsignacionConDetalle(id)
  const cons = proyectarConsignacionConDetalle(consRaw, puedeVerCostos)
  if (!cons) notFound()

  // Ítems que se pueden apartar en este lote — alimentan el buscador con
  // sugerencias por nombre/SKU/QR. Solo hace falta con el lote abierto.
  const itemsElegibles =
    cons.estado === 'cerrada' || !cons.proveedor
      ? []
      : await listItemsElegiblesConsignacion(cons.proveedor.id_proveedor)

  return (
    <>
      <Topbar
        title={`Consignación ${new Date(cons.fecha).toLocaleDateString('es-AR')}`}
        session={session}
        backHref={safeBackHref(from, '/consignaciones')}
        actions={
          <Badge variant={ESTADO_CONSIGNACION_VARIANT[cons.estado]}>{ESTADO_CONSIGNACION_LABEL[cons.estado]}</Badge>
        }
      />
      <main className="flex-1 p-4 sm:p-6">
        <ConsignacionDetalleView
          cons={cons}
          itemsElegibles={itemsElegibles}
          puedeEliminar={hasPermission(session, 'consignaciones', 'eliminar')}
          volverHref={safeBackHref(from, '/consignaciones')}
          puedeVerCostos={puedeVerCostos}
        />
      </main>
    </>
  )
}
