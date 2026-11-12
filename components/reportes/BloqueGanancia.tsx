'use client'

import React from 'react'
import type { FinanzasResultadosRow } from '@/lib/types/reportes'

function formatMoney(value: number | null | undefined) {
  if (value == null) return 'Sin permiso'
  return Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
    .format(value)
    .replace(/\u00A0/g, ' ')
}

interface BloqueGananciaProps {
  resultados: FinanzasResultadosRow
  tieneGastos: boolean
}

import { escapeCsvField, downloadCsv, csvNegative } from '@/lib/utils/csv'
import { DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

export function BloqueGanancia({ resultados, tieneGastos }: BloqueGananciaProps) {
  const exportarCSV = () => {
    const csvRows = [
      'Concepto,Monto',
      `${escapeCsvField('Vendiste (neto)')},${resultados.ventas_netas}`,
      `${escapeCsvField('Menos costo de mercadería')},${resultados.costo_mercaderia != null ? csvNegative(resultados.costo_mercaderia) : 'Sin permiso'}`,
      `${escapeCsvField('Ganancia antes de gastos')},${resultados.ganancia_sobre_ventas ?? 'Sin permiso'}`
    ]
    if (tieneGastos) {
      csvRows.push(
        `${escapeCsvField('Menos gastos')},${csvNegative(resultados.gastos)}`,
        `${escapeCsvField('Ganancia final')},${resultados.ganancia_final ?? 'Sin permiso'}`
      )
    }

    downloadCsv(`ganancia-${resultados.mes}.csv`, csvRows.join('\n'))
  }

  return (
    <Card as="section" padding="none" aria-labelledby="h2-ganancia" className="overflow-hidden">
      <div className="p-4 border-b border-border bg-panel flex flex-wrap justify-between items-center gap-2">
        <h2 id="h2-ganancia" className="font-display text-lg">Cómo se arma tu ganancia</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={exportarCSV}
        >
          Exportar CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <DataTable>
          <THead className="sr-only">
            <Th>Concepto</Th>
            <Th>Explicación</Th>
            <Th align="right">Monto</Th>
          </THead>
          <TBody>
            <Tr>
              <Td className="font-medium text-ink">Vendiste (neto)</Td>
              <Td className="text-muted hidden sm:table-cell">Ventas del período menos anulaciones</Td>
              <Td align="right" className="font-medium">{formatMoney(resultados.ventas_netas)}</Td>
            </Tr>
            <Tr>
              <Td className="text-alerta-ink">Menos costo de mercadería</Td>
              <Td className="text-muted hidden sm:table-cell">Lo que te costaron los productos que vendiste</Td>
              <Td align="right" className="text-alerta-ink">
                {resultados.costo_mercaderia != null && resultados.costo_mercaderia > 0 ? '-' : ''}{formatMoney(resultados.costo_mercaderia)}
              </Td>
            </Tr>
            <Tr className={tieneGastos ? 'bg-panel/50' : 'bg-panel font-medium text-base'}>
              <Td className="text-ink">Ganancia antes de gastos</Td>
              <Td className="text-muted hidden sm:table-cell"></Td>
              <Td align="right">{formatMoney(resultados.ganancia_sobre_ventas)}</Td>
            </Tr>
            {tieneGastos && (
              <>
                <Tr>
                  <Td className="text-alerta-ink">Menos gastos</Td>
                  <Td className="text-muted hidden sm:table-cell">Egresos operativos cargados en el período</Td>
                  <Td align="right" className="text-alerta-ink">
                    {resultados.gastos > 0 ? '-' : ''}{formatMoney(resultados.gastos)}
                  </Td>
                </Tr>
                <Tr className="bg-panel font-bold text-base">
                  <Td className="text-ink">Ganancia final</Td>
                  <Td className="text-muted hidden sm:table-cell">Lo que te quedó limpio</Td>
                  <Td align="right">{formatMoney(resultados.ganancia_final)}</Td>
                </Tr>
              </>
            )}
          </TBody>
        </DataTable>
      </div>
    </Card>
  )
}
