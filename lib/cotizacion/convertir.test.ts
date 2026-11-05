import { describe, expect, it } from 'vitest'
import { convertirUsdEnArs } from './convertir'

describe('convertirUsdEnArs', () => {
  it('convierte USD 100 con cotización 1500 a 150000.00 ARS', () => {
    expect(convertirUsdEnArs(100, 1500)).toBe(150000)
  })

  it('redondea a 2 decimales', () => {
    // 10.55 * 1420.35 = 14984.6925 -> 14984.69
    expect(convertirUsdEnArs(10.55, 1420.35)).toBe(14984.69)
    // 33.33 * 1546.5 = 51544.845 -> 51544.85
    expect(convertirUsdEnArs(33.33, 1546.5)).toBe(51544.85)
  })

  it('maneja 0 correctamente', () => {
    expect(convertirUsdEnArs(0, 1500)).toBe(0)
  })

  it('arroja error si alguno de los valores no es finito', () => {
    expect(() => convertirUsdEnArs(Number.NaN, 1500)).toThrow('monto-o-cotizacion-invalida')
    expect(() => convertirUsdEnArs(100, Number.POSITIVE_INFINITY)).toThrow('monto-o-cotizacion-invalida')
  })
})
