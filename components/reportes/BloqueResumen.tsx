import type { BandKpi } from '@/components/shell/PageBand'
import { VariacionBadge } from './VariacionBadge'
import type { FinanzasResultadosRow, FinanzasFlujoRow, FinanzasPosicion } from '@/lib/types/reportes'

function formatMoney(value: number | null | undefined) {
  if (value == null) return '—'
  return Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
    .format(value)
    .replace(/\u00A0/g, ' ')
}

function formatMoneyOrSinPermiso(value: number | null | undefined) {
  if (value == null) return 'Sin permiso'
  return Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
    .format(value)
    .replace(/\u00A0/g, ' ')
}

function variacionPct(actual: number | null, previo: number | null): number | null {
  if (actual === null || previo === null || previo === 0) return null
  return (actual - previo) / Math.abs(previo)
}

interface ResumenKpisInput {
  resultados: FinanzasResultadosRow
  resultadosPrev: FinanzasResultadosRow | null
  flujo: FinanzasFlujoRow
  flujoPrev: FinanzasFlujoRow | null
  posicion: FinanzasPosicion | null
  tieneGastos: boolean
}

/**
 * Los cuatro números de arriba del tablero. Viven en la franja de la página
 * (`PageBand`), así que esto devuelve datos y no JSX de layout.
 */
export function resumenKpis({
  resultados,
  resultadosPrev,
  flujo,
  flujoPrev,
  posicion,
  tieneGastos,
}: ResumenKpisInput): BandKpi[] {
  const varVentas = resultadosPrev ? variacionPct(resultados.ventas_netas, resultadosPrev.ventas_netas) : null

  // ganancia_final si hay módulo de gastos, ganancia_sobre_ventas si no
  const gananciaActual = tieneGastos ? resultados.ganancia_final : resultados.ganancia_sobre_ventas
  const gananciaPrev = resultadosPrev
    ? tieneGastos ? resultadosPrev.ganancia_final : resultadosPrev.ganancia_sobre_ventas
    : null
  const varGanancia = gananciaPrev !== null ? variacionPct(gananciaActual, gananciaPrev) : null

  const varCobros = flujoPrev ? variacionPct(flujo.neto_cobros, flujoPrev.neto_cobros) : null

  // Por cobrar es un stock a la fecha: no tiene "previo" en la arquitectura actual.
  const porCobrar = posicion?.por_cobrar?.a_cobrar ?? null

  return [
    { label: 'Vendiste', value: formatMoney(resultados.ventas_netas), sub: <VariacionBadge variacion={varVentas} /> },
    {
      label: tieneGastos ? 'Te quedó de ganancia' : 'Ganancia (antes de gastos)',
      value: formatMoneyOrSinPermiso(gananciaActual),
      sub: <VariacionBadge variacion={varGanancia} />,
    },
    { label: 'Entró a caja', value: formatMoney(flujo.neto_cobros), sub: <VariacionBadge variacion={varCobros} /> },
    { label: 'Te deben', value: formatMoney(porCobrar), sub: <VariacionBadge variacion={null} /> },
  ]
}
