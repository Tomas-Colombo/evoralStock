import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Topbar } from '@/components/shell/Topbar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { verifySession } from '@/lib/dal/session'
import { getReservaConDetalle } from '@/lib/dal/reservas/reserva'
import {
  ESTADO_RESERVA_LABEL,
  ESTADO_RESERVA_VARIANT,
  nombreCliente,
} from '@/lib/types/ventas'
import { ReservaDetalleActions } from './ReservaDetalleActions'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Card } from '@/components/ui/Card'

export default async function ReservaDetallePage(props: {
  params: Promise<{ id: string }>
}) {
  const session = await verifySession()
  const { id } = await props.params
  const reserva = await getReservaConDetalle(id)
  if (!reserva) notFound()

  return (
    <>
      <Topbar
        title={`Reserva ${new Date(reserva.fecha).toLocaleDateString('es-AR')}`}
        session={session}
        backHref="/ventas/reservas"
        actions={
          <Badge variant={ESTADO_RESERVA_VARIANT[reserva.estado_reserva]}>
            {ESTADO_RESERVA_LABEL[reserva.estado_reserva]}
          </Badge>
        }
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6">
        <Card className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <div className="text-xs uppercase font-mono text-muted">Cliente</div>
            <div className="mt-1">{nombreCliente(reserva.cliente)}</div>
          </div>
          <div>
            <div className="text-xs uppercase font-mono text-muted">Fecha</div>
            <div className="mt-1">{new Date(reserva.fecha).toLocaleString('es-AR')}</div>
          </div>
          <div>
            <div className="text-xs uppercase font-mono text-muted">Vence</div>
            <div className="mt-1">{new Date(reserva.fecha_vencimiento).toLocaleString('es-AR')}</div>
          </div>
          <div className="flex flex-wrap items-end justify-end gap-2">
            {reserva.estado_reserva === 'activa' && (
              <>
                <Link href={`/ventas/nueva?reserva=${reserva.id_reserva}`}>
                  <Button size="sm">Convertir en venta</Button>
                </Link>
                <ReservaDetalleActions idReserva={reserva.id_reserva} />
              </>
            )}
          </div>
        </Card>

        <TableFrame>
          <DataTable>
            <THead>
              <Th>Producto</Th>
              <Th>QR</Th>
              <Th align="right">Precio snapshot</Th>
              <Th>Estado ítem</Th>
              <Th>Estado línea</Th>
            </THead>
            <TBody>
              {reserva.lineas.map((l) => (
                <Tr key={l.id_detalle_reserva}>
                  <Td>
                    <div className="font-medium">{l.producto?.nombre ?? '—'}</div>
                    {l.producto?.sku && (
                      <div className="text-xs font-mono text-muted">{l.producto.sku}</div>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{l.item?.qr_code ?? '—'}</Td>
                  <Td align="right" className="font-mono">
                    $ {Number(l.precio_snapshot).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </Td>
                  <Td className="capitalize text-xs">{l.item?.estado_item ?? '—'}</Td>
                  <Td>
                    <Badge variant={ESTADO_RESERVA_VARIANT[l.estado]}>{ESTADO_RESERVA_LABEL[l.estado]}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </DataTable>
        </TableFrame>

        {reserva.observaciones && (
          <div className="rounded-lg border border-border bg-card-2 p-4 text-sm">
            <div className="text-xs uppercase font-mono text-muted mb-1">Observaciones</div>
            <div>{reserva.observaciones}</div>
          </div>
        )}
      </main>
    </>
  )
}
