import React from 'react'
import type { FinanzasFlujoRow } from '@/lib/types/reportes'
import { DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Card } from '@/components/ui/Card'

function formatMoney(value: number | null | undefined) {
  if (value == null) return '—'
  return Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
    .format(value)
    .replace(/\u00A0/g, ' ')
}

interface BloqueMovimientoPlataProps {
  flujo: FinanzasFlujoRow
  tieneGastos: boolean
  tieneConsignacion?: boolean
}

export function BloqueMovimientoPlata({
  flujo,
  tieneGastos,
  tieneConsignacion = false,
}: BloqueMovimientoPlataProps) {
  const porAcreditarList = Object.entries(flujo.por_acreditar ?? {})
    .map(([cuenta, monto]) => ({ cuenta, monto }))
    .filter(x => x.monto > 0)

  return (
    <Card as="section" padding="none" aria-labelledby="h2-flujo" className="overflow-hidden">
      <div className="p-4 border-b border-border bg-panel">
        <h2 id="h2-flujo" className="font-display text-lg">Movimiento de plata</h2>
      </div>
      
      <div className="overflow-x-auto">
        <DataTable>
          <THead className="sr-only">
            <Th>Concepto</Th>
            <Th>Detalle</Th>
            <Th align="right">Monto</Th>
          </THead>
          <TBody>
            <Tr>
              <Td className="font-medium text-ink">Cobrado</Td>
              <Td className="text-muted hidden sm:table-cell">Plata que entró (ventas y saldos)</Td>
              <Td align="right" className="font-medium">{formatMoney(flujo.cobrado)}</Td>
            </Tr>
            {flujo.devuelto_clientes > 0 && (
              <Tr>
                <Td className="text-alerta-ink">Devuelto a clientes</Td>
                <Td className="text-muted hidden sm:table-cell">Reintegros por devoluciones o anulaciones</Td>
                <Td align="right" className="text-alerta-ink">
                  -{formatMoney(flujo.devuelto_clientes)}
                </Td>
              </Tr>
            )}
            {flujo.costo_procesamiento > 0 && (
              <Tr>
                <Td className="text-alerta-ink">Comisiones y retenciones</Td>
                <Td className="text-muted hidden sm:table-cell">Costo de procesadores de pago</Td>
                <Td align="right" className="text-alerta-ink">
                  -{formatMoney(flujo.costo_procesamiento)}
                </Td>
              </Tr>
            )}
            <Tr className="bg-panel/30">
              <Td className="text-ink">Compras de mercadería</Td>
              <Td className="text-muted hidden sm:table-cell">Se asumen pagadas al recibirlas</Td>
              <Td align="right">
                {flujo.compras_mercaderia > 0 ? '-' : ''}{formatMoney(flujo.compras_mercaderia)}
              </Td>
            </Tr>
            {tieneConsignacion && (
              <Tr>
                <Td className="text-ink">Pagos a proveedores</Td>
                <Td className="text-muted hidden sm:table-cell">Rendiciones pagadas</Td>
                <Td align="right">
                  {flujo.pagos_proveedores > 0 ? '-' : ''}{formatMoney(flujo.pagos_proveedores)}
                </Td>
              </Tr>
            )}
            {tieneGastos && (
              <Tr>
                <Td className="text-ink">Gastos operativos</Td>
                <Td className="text-muted hidden sm:table-cell">Pagos por gastos del negocio</Td>
                <Td align="right">
                  {flujo.gastos > 0 ? '-' : ''}{formatMoney(flujo.gastos)}
                </Td>
              </Tr>
            )}
            <Tr className="bg-panel font-bold text-base">
              <Td className="text-ink">Flujo neto del período</Td>
              <Td className="text-muted hidden sm:table-cell">Diferencia entre entradas y salidas</Td>
              <Td align="right">{formatMoney(flujo.flujo_neto)}</Td>
            </Tr>
          </TBody>
        </DataTable>
      </div>

      {porAcreditarList.length > 0 && (
        <div className="p-4 bg-panel-2 border-t border-border">
          <h3 className="text-sm font-medium text-ink mb-2">Por acreditar de este período</h3>
          <ul className="space-y-1">
            {porAcreditarList.map(({ cuenta, monto }) => (
              <li key={cuenta} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{cuenta}</span>
                <span className="tabular-nums font-medium">{formatMoney(monto)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
