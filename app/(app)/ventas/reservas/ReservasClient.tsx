'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ReservaMark } from '@/components/ui/StatusMark'
import { useToast } from '@/components/ui/Toast'
import {
  ESTADO_RESERVA_LABEL,
  ESTADO_RESERVA_VARIANT,
  nombreCliente,
  type ReservaRow,
} from '@/lib/types/ventas'
import { vencerReservasAction } from '../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Card } from '@/components/ui/Card'

type Row = ReservaRow & {
  cliente: { id_cliente: string; nombre: string } | null
  items_count: number
}

export function ReservasClient({ rows }: { rows: Row[] }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  function vencer() {
    start(async () => {
      const res = await vencerReservasAction()
      if (!res.ok) return toast.error('No se pudo procesar', mensajeDeError(res.reason))
      toast.success(
        res.data?.vencidas
          ? `${res.data.vencidas} reserva(s) marcadas como vencidas`
          : 'No había reservas para vencer',
      )
      router.refresh()
    })
  }

  return (
    <>
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={vencer} disabled={pending}>
          Purgar vencidas
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card padding="none" className="border-dashed p-10 text-center">
          <p className="font-display text-lg mb-2">Sin reservas</p>
          <p className="text-sm text-muted mb-4">
            Creá una reserva para bloquear ítems por un plazo determinado.
          </p>
          <Link
            href="/ventas/reservas/nueva"
            className="inline-flex items-center rounded-md bg-block px-4 py-2 text-sm font-semibold text-block-ink"
          >
            Nueva reserva
          </Link>
        </Card>
      ) : (
        <TableFrame>
          <DataTable>
            <THead>
              <Th>Cliente</Th>
              <Th>Fecha</Th>
              <Th>Vence</Th>
              <Th align="right">Ítems</Th>
              <Th>Estado</Th>
              <Th></Th>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id_reserva}>
                  <Td>{nombreCliente(r.cliente)}</Td>
                  <Td>{new Date(r.fecha).toLocaleDateString('es-AR')}</Td>
                  <Td>
                    {new Date(r.fecha_vencimiento).toLocaleDateString('es-AR')}
                  </Td>
                  <Td align="right" className="font-mono">{r.items_count}</Td>
                  <Td>
                    {r.estado_reserva === 'activa' ? (
                      <ReservaMark
                        label={ESTADO_RESERVA_LABEL.activa}
                        vence={new Date(r.fecha_vencimiento).toLocaleDateString('es-AR')}
                      />
                    ) : (
                      <Badge variant={ESTADO_RESERVA_VARIANT[r.estado_reserva]}>
                        {ESTADO_RESERVA_LABEL[r.estado_reserva]}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center justify-end gap-3">
                      {/* Acceso directo al mostrador: abre la venta con los
                          ítems, el cliente y las observaciones de la reserva
                          ya cargados. */}
                      {r.estado_reserva === 'activa' && (
                        <Link href={`/ventas/nueva?reserva=${r.id_reserva}`}>
                          <Button size="sm">Vender</Button>
                        </Link>
                      )}
                      <Link
                        href={`/ventas/reservas/${r.id_reserva}`}
                        className="-mx-2 rounded-[4px] px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      >
                        Abrir
                      </Link>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </DataTable>
        </TableFrame>
      )}
    </>
  )
}
