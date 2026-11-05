import { describe, expect, it } from 'vitest'
import {
  actualizarCotizacionSchema,
  cambiarModoCotizacionSchema,
} from './cotizacion'

describe('actualizarCotizacionSchema', () => {
  it('acepta un valor positivo y finito razonable', () => {
    const res = actualizarCotizacionSchema.safeParse({ valor: 1546.5 })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.valor).toBe(1546.5)
    }
  })

  it('acepta el valor máximo razonable (10.000.000)', () => {
    const res = actualizarCotizacionSchema.safeParse({ valor: 10_000_000 })
    expect(res.success).toBe(true)
  })

  it('rechaza valor 0 o negativo', () => {
    expect(actualizarCotizacionSchema.safeParse({ valor: 0 }).success).toBe(false)
    expect(actualizarCotizacionSchema.safeParse({ valor: -100 }).success).toBe(false)
  })

  it('rechaza valor que no sea finito (Infinity, NaN)', () => {
    expect(actualizarCotizacionSchema.safeParse({ valor: Infinity }).success).toBe(false)
    expect(actualizarCotizacionSchema.safeParse({ valor: NaN }).success).toBe(false)
  })

  it('rechaza valor que exceda el máximo razonable', () => {
    expect(actualizarCotizacionSchema.safeParse({ valor: 10_000_000.01 }).success).toBe(false)
  })

  it('rechaza campos desconocidos por strictObject', () => {
    expect(actualizarCotizacionSchema.safeParse({ valor: 1500, extra: 'invalido' }).success).toBe(false)
  })

  it('rechaza valores de tipo incorrecto o faltantes', () => {
    expect(actualizarCotizacionSchema.safeParse({ valor: '1500' }).success).toBe(false)
    expect(actualizarCotizacionSchema.safeParse({}).success).toBe(false)
    expect(actualizarCotizacionSchema.safeParse(null).success).toBe(false)
  })
})

describe('cambiarModoCotizacionSchema', () => {
  it('acepta modos válidos automatica y manual', () => {
    expect(cambiarModoCotizacionSchema.safeParse({ modo: 'automatica' }).success).toBe(true)
    expect(cambiarModoCotizacionSchema.safeParse({ modo: 'manual' }).success).toBe(true)
  })

  it('rechaza modos desconocidos', () => {
    expect(cambiarModoCotizacionSchema.safeParse({ modo: 'otro' }).success).toBe(false)
    expect(cambiarModoCotizacionSchema.safeParse({ modo: 'auto' }).success).toBe(false)
  })

  it('rechaza campos desconocidos por strictObject', () => {
    expect(cambiarModoCotizacionSchema.safeParse({ modo: 'manual', hack: true }).success).toBe(false)
  })

  it('rechaza payload sin modo o nulo', () => {
    expect(cambiarModoCotizacionSchema.safeParse({}).success).toBe(false)
    expect(cambiarModoCotizacionSchema.safeParse(null).success).toBe(false)
  })
})
