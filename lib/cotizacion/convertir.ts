/**
 * Convierte un monto en USD a su equivalente en pesos argentinos (ARS)
 * aplicando la cotización especificada y redondeando a 2 decimales.
 *
 * Helper puro y único para conversiones de costo cambiario.
 */
export function convertirUsdEnArs(montoUsd: number, cotizacion: number): number {
  if (!Number.isFinite(montoUsd) || !Number.isFinite(cotizacion)) {
    throw new Error('monto-o-cotizacion-invalida')
  }
  // Multiplicación en enteros escalados para evitar pérdida de precisión de IEEE 754
  const factorUsd = Math.round(montoUsd * 100)
  const factorCot = Math.round(cotizacion * 10_000)
  const producto = factorUsd * factorCot
  return Math.round(producto / 10_000) / 100
}
