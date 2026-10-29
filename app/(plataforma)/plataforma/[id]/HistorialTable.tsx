'use client'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusMark'
import {
  DataTable,
  TableFrame,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/TableParts'
import type { MovimientoCuentaCorriente } from '@/lib/types/plataforma'
import { formatearMoneda } from '@/lib/utils/moneda'
import { MEDIOS_PAGO_LABELS } from './NuevoPagoModal'

function formatearFechaImputacion(fecha: string, tipo: 'cargo' | 'pago'): string {
  if (!fecha) return '—'
  if (tipo === 'cargo' && /^\d{4}-\d{2}/.test(fecha)) {
    const periodoIso = fecha.slice(0, 7)
    return new Date(`${periodoIso}-01T00:00:00`).toLocaleDateString('es-AR', {
      month: 'long',
      year: 'numeric',
    })
  }
  const limpia = fecha.split('T')[0]
  return new Date(`${limpia}T00:00:00`).toLocaleDateString('es-AR')
}

interface HistorialTableProps {
  historial: MovimientoCuentaCorriente[]
  isPending: boolean
  onSolicitarAnular: (movimiento: MovimientoCuentaCorriente) => void
  onAbrirNuevoCargo: () => void
  onAbrirNuevoPago: () => void
}

export function HistorialTable({
  historial,
  isPending,
  onSolicitarAnular,
  onAbrirNuevoCargo,
  onAbrirNuevoPago,
}: HistorialTableProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">
            Historial de cuenta corriente
          </h2>
          <p className="text-xs text-muted">
            Movimientos registrados entre la plataforma y el comercio.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={onAbrirNuevoCargo}
          >
            Nuevo cargo
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={onAbrirNuevoPago}
          >
            Nuevo pago
          </Button>
        </div>
      </div>

      <TableFrame>
        <DataTable>
          <THead>
            <Th>Tipo</Th>
            <Th>Fecha / Período</Th>
            <Th>Concepto o medio</Th>
            <Th align="right">Monto</Th>
            <Th>Estado</Th>
            <Th align="right">
              <span className="sr-only">Acciones</span>
            </Th>
          </THead>
          <TBody>
            {historial.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="py-12 text-center text-sm text-muted">
                  Sin movimientos registrados todavía.
                </Td>
              </Tr>
            ) : (
              historial.map((m) => {
                const esCargo = m.tipo === 'cargo'
                return (
                  <Tr
                    key={m.id}
                    className={
                      m.anulado
                        ? 'bg-card-3/40 opacity-60'
                        : 'hover:bg-hover'
                    }
                  >
                    <Td>
                      <span
                        className={`font-semibold ${
                          esCargo ? 'text-ink' : 'text-ok'
                        }`}
                      >
                        {esCargo ? 'Cargo' : 'Pago'}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-muted">
                        {formatearFechaImputacion(m.fechaImputacion, m.tipo)}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex flex-col">
                        <span className="text-ink">
                          {esCargo
                            ? m.concepto || m.detalle
                            : MEDIOS_PAGO_LABELS[m.medio ?? 'otro'] ?? m.medio ?? 'Pago'}
                        </span>
                        {!esCargo && m.nota && (
                          <span className="text-xs text-muted">{m.nota}</span>
                        )}
                      </div>
                    </Td>
                    <Td align="right">
                      <span
                        className={`font-figure font-medium ${
                          m.anulado
                            ? 'line-through text-muted'
                            : esCargo
                              ? 'text-text'
                              : 'text-ok'
                        }`}
                      >
                        {esCargo ? '+ ' : '- '}
                        {formatearMoneda(m.monto)}
                      </span>
                    </Td>
                    <Td>
                      {m.anulado ? (
                        <Badge variant="danger">Anulado</Badge>
                      ) : (
                        <StatusDot tone="ok">Vigente</StatusDot>
                      )}
                    </Td>
                    <Td align="right">
                      {!m.anulado ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => onSolicitarAnular(m)}
                        >
                          Anular
                        </Button>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </Td>
                  </Tr>
                )
              })
            )}
          </TBody>
        </DataTable>
      </TableFrame>
    </div>
  )
}
