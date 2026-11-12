'use client'

import React, { useState } from 'react'
import type { FinanzasSerieMensualRow } from '@/lib/types/reportes'
import { Button } from '@/components/ui/Button'
import { formatearMesCorto } from '@/lib/reportes/mes'
import { DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Card } from '@/components/ui/Card'

function formatMoneyCompact(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`
  return `$${Math.round(value)}`
}

function formatMoneyFull(value: number | null | undefined) {
  if (value == null) return 'Sin permiso'
  return Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value)
}

interface GraficoTendenciaProps {
  serie: FinanzasSerieMensualRow[]
  tieneGastos: boolean
}

export function GraficoTendencia({ serie, tieneGastos }: GraficoTendenciaProps) {
  const [verTabla, setVerTabla] = useState(false)

  if (!serie || serie.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-panel border border-border rounded-lg text-muted">
        No hay datos para la tendencia.
      </div>
    )
  }

  // Use ventas_netas for max scale
  const maxVentas = Math.max(...serie.map(s => s.ventas_netas), 1)
  
  // A round upper bound for the Y axis
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVentas)))
  const yMax = Math.ceil(maxVentas / (magnitude / 2)) * (magnitude / 2)
  
  const width = 800
  const height = 300
  const padding = { top: 20, right: 20, bottom: 40, left: 60 }
  
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  
  const barWidth = Math.min(40, chartWidth / serie.length - 10)
  const gap = (chartWidth - serie.length * barWidth) / (serie.length + 1)

  return (
    <Card as="section" padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between p-4 border-b border-border bg-panel gap-2">
        <h2 id="h2-tendencia" className="font-display text-lg">Tendencia (12 meses)</h2>
        <Button onClick={() => setVerTabla(!verTabla)} variant="secondary" size="sm">
          {verTabla ? 'Ver gráfico' : 'Ver como tabla'}
        </Button>
      </div>

      <div className="p-4">
        {verTabla ? (
          <div className="overflow-x-auto">
            <DataTable className="text-right">
              <THead>
                <Th className="p-2">Mes</Th>
                <Th align="right" className="p-2">Ventas netas</Th>
                <Th align="right" className="p-2">Cobrado neto</Th>
                <Th align="right" className="p-2">Ganancia {tieneGastos ? 'final' : ''}</Th>
              </THead>
              <TBody>
                {serie.map(s => (
                  <Tr key={s.mes}>
                    <Td align="left" className="p-2 font-medium text-ink">{formatearMesCorto(s.mes)}</Td>
                    <Td className="p-2">{formatMoneyFull(s.ventas_netas)}</Td>
                    <Td className="p-2">{formatMoneyFull(s.cobrado_neto)}</Td>
                    <Td className="p-2">{formatMoneyFull(tieneGastos ? s.ganancia_final : s.ganancia_sobre_ventas)}</Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          </div>
        ) : (
          <figure className="relative w-full aspect-[21/9] min-h-[250px]" role="img" aria-label="Gráfico de barras mostrando tendencia de ventas, cobros y ganancias de los últimos 12 meses">
            <figcaption className="sr-only">Tendencia de ingresos y rentabilidad</figcaption>
            
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full text-ink font-sans">
              {/* Ejes */}
              <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="currentColor" className="text-border" strokeWidth="1" />
              <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="currentColor" className="text-border" strokeWidth="1" />
              
              {/* Líneas horizontales de referencia */}
              {[0, 0.5, 1].map(ratio => {
                const y = padding.top + chartHeight * (1 - ratio)
                return (
                  <g key={ratio} className="text-muted">
                    <line x1={padding.left - 5} y1={y} x2={width - padding.right} y2={y} stroke="currentColor" className="text-border border-dashed" strokeDasharray="4 4" />
                    <text x={padding.left - 10} y={y + 4} textAnchor="end" fontSize="12" fill="currentColor">
                      {formatMoneyCompact(yMax * ratio)}
                    </text>
                  </g>
                )
              })}

              {/* Barras */}
              {serie.map((s, i) => {
                const x = padding.left + gap + i * (barWidth + gap)
                
                // Calculamos alturas
                const vH = Math.max(0, (s.ventas_netas / yMax) * chartHeight)
                const cH = Math.max(0, (s.cobrado_neto / yMax) * chartHeight)
                const gananciaVal = tieneGastos ? s.ganancia_final : s.ganancia_sobre_ventas
                const gH = gananciaVal != null ? Math.max(0, (gananciaVal / yMax) * chartHeight) : 0

                return (
                  <g key={s.mes} className="transition-all duration-300 ease-in-out hover:opacity-80">
                    <title>
                      {formatearMesCorto(s.mes)}: Ventas {formatMoneyFull(s.ventas_netas)} | Cobrado {formatMoneyFull(s.cobrado_neto)} | Ganancia {formatMoneyFull(tieneGastos ? s.ganancia_final : s.ganancia_sobre_ventas)}
                    </title>
                    
                    {/* Ventas netas (fondo más ancho) */}
                    <rect 
                      x={x} 
                      y={height - padding.bottom - vH} 
                      width={barWidth} 
                      height={vH} 
                      fill="var(--color-muted)" 
                      opacity="0.2"
                      rx="2"
                    />
                    
                    {/* Cobrado neto (barra principal) */}
                    <rect 
                      x={x + barWidth * 0.15} 
                      y={height - padding.bottom - cH} 
                      width={barWidth * 0.7} 
                      height={cH} 
                      fill="var(--color-muted)" 
                      opacity="0.55"
                      rx="2"
                    />
                    
                    {/* Ganancia (encima, otro color) */}
                    <rect 
                      x={x + barWidth * 0.25} 
                      y={height - padding.bottom - gH} 
                      width={barWidth * 0.5} 
                      height={gH} 
                      fill="var(--color-ink)"
                      rx="1"
                    />

                    <text 
                      x={x + barWidth / 2} 
                      y={height - padding.bottom + 20} 
                      textAnchor="middle" 
                      fontSize="12" 
                      fill="currentColor"
                      className="text-muted font-medium"
                    >
                      {formatearMesCorto(s.mes)}
                    </text>
                  </g>
                )
              })}
            </svg>
            
            <div className="absolute top-2 right-4 flex gap-4 text-xs bg-card/80 p-2 rounded backdrop-blur">
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-muted opacity-30 rounded-sm"></div>Ventas netas</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-muted opacity-55 rounded-sm"></div>Cobrado neto</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-ink rounded-sm"></div>Ganancia</div>
            </div>
          </figure>
        )}
      </div>
    </Card>
  )
}
