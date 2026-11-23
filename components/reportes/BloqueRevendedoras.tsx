'use client'

import React from 'react'
import type {
  PerfilRevendedoraRow,
  CumplimientoObjetivosRow,
  ResumenCanalRow,
} from '@/lib/types/reportes'
import { escapeCsvField, downloadCsv, csvNegative } from '@/lib/utils/csv'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

function formatMoney(value: number | null | undefined) {
  if (value == null) return '—'
  return Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
    .format(value)
    .replace(/\u00A0/g, ' ')
}

interface BloqueRevendedorasProps {
  resumenCanal: ResumenCanalRow | null
  perfiles: PerfilRevendedoraRow[]
  objetivos: CumplimientoObjetivosRow[]
  desde: string
  hasta: string
}

export function BloqueRevendedoras({
  resumenCanal,
  perfiles,
  objetivos,
  desde,
  hasta,
}: BloqueRevendedorasProps) {
  const objetivosMap = new Map<string, CumplimientoObjetivosRow>()
  for (const obj of objetivos) {
    objetivosMap.set(obj.id_revendedora, obj)
  }

  const exportarCSV = () => {
    const headers = [
      'Revendedora',
      'Estado',
      'Piezas en poder',
      'Valor en poder',
      'Total vendido',
      'Comision liquidada',
      'Comision estimada',
      'Adeudado al local',
      'Ticket promedio',
      'Rotacion %',
      'Tramo actual %',
      'Proximo tramo %',
      'Falta para proximo',
    ]

    const rows = perfiles.map((p) => {
      const obj = objetivosMap.get(p.id_revendedora)
      return [
        escapeCsvField(`${p.apellido}, ${p.nombre}`),
        escapeCsvField(p.estado),
        p.piezas_en_poder,
        p.valor_en_poder,
        p.total_vendido,
        p.comision_liquidada,
        p.comision_estimada,
        escapeCsvField(p.adeudado > 0 ? csvNegative(p.adeudado) : p.adeudado),
        p.ticket_promedio,
        `${p.rotacion_pct}%`,
        obj ? `${obj.porcentaje_actual}%` : '—',
        obj?.proximo_porcentaje != null ? `${obj.proximo_porcentaje}%` : '—',
        obj?.falta_para_proximo != null ? obj.falta_para_proximo : (obj?.id_regla ? 'Máximo alcanzado' : 'Sin regla'),
      ].join(',')
    })

    const csvContent = [headers.join(','), ...rows].join('\n')
    downloadCsv(`reporte-revendedoras-${desde}-a-${hasta}.csv`, csvContent)
  }

  return (
    <Card as="section" padding="none" aria-labelledby="h2-revendedoras" className="overflow-hidden space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 id="h2-revendedoras" className="font-display text-xl font-bold text-ink">
            Canal Revendedor
          </h2>
          <p className="text-sm text-muted">
            Desempeño, comisiones, stock en consignación y cumplimiento de metas del período.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={exportarCSV}
          disabled={perfiles.length === 0}
          className="self-start sm:self-auto"
        >
          Exportar CSV
        </Button>
      </div>

      {/* Tarjetas comparativas de canal y stock */}
      {resumenCanal && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-panel p-4 rounded-lg border border-border">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Ventas en Local</p>
            <p className="text-2xl font-bold tabular-nums text-ink">{formatMoney(resumenCanal.ventas_local_monto)}</p>
            <p className="text-xs text-muted mt-1">{resumenCanal.ventas_local_cant} ventas registradas</p>
          </div>

          <div className="bg-panel p-4 rounded-lg border border-border">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Ventas por Revendedoras</p>
            <p className="text-2xl font-bold tabular-nums text-ink">{formatMoney(resumenCanal.ventas_revendedora_monto)}</p>
            <p className="text-xs text-muted mt-1">
              {resumenCanal.ventas_revendedora_cant} ventas · {formatMoney(resumenCanal.comision_revendedora_monto)} en comisiones
            </p>
          </div>

          <div className="bg-panel p-4 rounded-lg border border-border">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Stock Central</p>
            <p className="text-2xl font-bold tabular-nums text-ink">{resumenCanal.stock_central_cant} piezas</p>
            <p className="text-xs text-muted mt-1">Valor potencial: {formatMoney(resumenCanal.stock_central_valor)}</p>
          </div>

          <div className="bg-panel p-4 rounded-lg border border-border">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Stock en Revendedoras</p>
            <p className="text-2xl font-bold tabular-nums text-ink">{resumenCanal.stock_revendedoras_cant} piezas</p>
            <p className="text-xs text-muted mt-1">Valor en poder: {formatMoney(resumenCanal.stock_revendedoras_valor)}</p>
          </div>
        </div>
      )}

      {/* Tabla detallada de Revendedoras y Objetivos */}
      <TableFrame>
        <DataTable>
          <THead>
            <Th scope="col">Revendedora</Th>
            <Th align="right" scope="col">Vendido período</Th>
            <Th align="right" scope="col">Comisión (Liq. / Est.)</Th>
            <Th align="right" scope="col">Adeudado</Th>
            <Th align="center" scope="col">Rotación</Th>
            <Th scope="col">Meta de ventas</Th>
          </THead>
          <TBody>
            {perfiles.length === 0 ? (
              <Tr>
                <Td align="center" colSpan={6} className="px-4 py-8 text-muted">
                  No hay revendedoras registradas en este período.
                </Td>
              </Tr>
            ) : (
              perfiles.map((p) => {
                const obj = objetivosMap.get(p.id_revendedora)
                return (
                  <Tr key={p.id_revendedora}>
                    <Td>
                      <div className="font-medium text-ink">
                        {p.apellido}, {p.nombre}
                      </div>
                      <div className="text-xs text-muted">
                        {p.piezas_en_poder} piezas en poder ({formatMoney(p.valor_en_poder)})
                      </div>
                    </Td>
                    <Td align="right">
                      <div className="font-medium text-ink">{formatMoney(p.total_vendido)}</div>
                      <div className="text-xs text-muted">{p.cantidad_ventas} ventas (prom. {formatMoney(p.ticket_promedio)})</div>
                    </Td>
                    <Td align="right">
                      <div className="text-ink font-medium">{formatMoney(p.comision_liquidada)} liq.</div>
                      <div className="text-xs text-muted">{formatMoney(p.comision_estimada)} est.</div>
                    </Td>
                    <Td align="right">
                      <span className={`font-semibold ${p.adeudado > 0 ? 'text-alerta-ink' : 'text-ink'}`}>
                        {formatMoney(p.adeudado)}
                      </span>
                    </Td>
                    <Td align="center">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-panel-2 border border-border">
                        {p.rotacion_pct}%
                      </span>
                    </Td>
                    <Td>
                      {obj ? (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-ink">Tramo actual: {obj.porcentaje_actual}%</span>
                            {obj.proximo_porcentaje != null && (
                              <span className="text-muted">Próx: {obj.proximo_porcentaje}%</span>
                            )}
                          </div>
                          {obj.proximo_tramo_desde != null ? (
                            <p className="text-xs text-muted">
                              Faltan <span className="font-semibold text-ink">{formatMoney(obj.falta_para_proximo)}</span> para alcanzar {formatMoney(obj.proximo_tramo_desde)}
                            </p>
                          ) : obj.id_regla ? (
                            <p className="text-xs text-verde font-medium">
                              Máximo objetivo alcanzado
                            </p>
                          ) : (
                            <p className="text-xs text-muted">Sin regla activa</p>
                          )}
                        </div>
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
    </Card>
  )
}
