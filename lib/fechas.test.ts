import { describe, expect, it } from 'vitest'
import {
  aFechaLocal,
  anioActual,
  esFechaValida,
  formatearFecha,
  hoyRango,
  inicioDelDia,
  inicioDelDiaSiguiente,
  mesActual,
  mesAnterior,
  periodoAnterior,
} from './fechas'

describe('aFechaLocal', () => {
  it('usa el día local y no corre al siguiente de noche', () => {
    // El caso que rompe `toISOString()`: 23:30 local en una zona con offset
    // negativo (Argentina) ya es el día siguiente en UTC.
    expect(aFechaLocal(new Date(2026, 7, 2, 23, 30))).toBe('2026-08-02')
  })

  it('usa el día local y no retrocede de madrugada', () => {
    expect(aFechaLocal(new Date(2026, 7, 2, 0, 15))).toBe('2026-08-02')
  })

  it('rellena mes y día con cero', () => {
    expect(aFechaLocal(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('mesActual', () => {
  it('va del día 1 al último día del mes', () => {
    expect(mesActual(new Date(2026, 7, 15))).toEqual({
      desde: '2026-08-01',
      hasta: '2026-08-31',
    })
  })

  it('resuelve meses de 30 días', () => {
    expect(mesActual(new Date(2026, 8, 15)).hasta).toBe('2026-09-30')
  })

  it('resuelve febrero en año bisiesto', () => {
    expect(mesActual(new Date(2028, 1, 10)).hasta).toBe('2028-02-29')
  })

  it('resuelve febrero en año no bisiesto', () => {
    expect(mesActual(new Date(2026, 1, 10)).hasta).toBe('2026-02-28')
  })
})

describe('mesAnterior', () => {
  it('devuelve el mes previo completo', () => {
    expect(mesAnterior(new Date(2026, 7, 15))).toEqual({
      desde: '2026-07-01',
      hasta: '2026-07-31',
    })
  })

  it('cruza el cambio de año hacia atrás', () => {
    expect(mesAnterior(new Date(2026, 0, 10))).toEqual({
      desde: '2025-12-01',
      hasta: '2025-12-31',
    })
  })
})

describe('periodoAnterior', () => {
  it('calcula periodo de 1 dia', () => {
    const r = periodoAnterior('2023-10-15', '2023-10-15')
    expect(r.desde).toBe('2023-10-14')
    expect(r.hasta).toBe('2023-10-14')
  })

  it('calcula periodo de un mes', () => {
    const r = periodoAnterior('2023-10-01', '2023-10-31')
    // 31 days difference. From 2023-10-01 back 31 days is 2023-08-31
    expect(r.desde).toBe('2023-08-31')
    expect(r.hasta).toBe('2023-09-30')
  })
})

describe('hoyRango y anioActual', () => {
  it('hoy es un rango de un solo día', () => {
    expect(hoyRango(new Date(2026, 7, 2, 18))).toEqual({
      desde: '2026-08-02',
      hasta: '2026-08-02',
    })
  })

  it('el año va del 1 de enero al 31 de diciembre', () => {
    expect(anioActual(new Date(2026, 7, 2))).toEqual({
      desde: '2026-01-01',
      hasta: '2026-12-31',
    })
  })
})

describe('esFechaValida', () => {
  it('acepta una fecha real', () => {
    expect(esFechaValida('2026-08-02')).toBe(true)
  })

  it('rechaza vacío o undefined', () => {
    expect(esFechaValida(undefined)).toBe(false)
    expect(esFechaValida('')).toBe(false)
  })

  it('rechaza formatos que no son YYYY-MM-DD', () => {
    expect(esFechaValida('02/08/2026')).toBe(false)
    expect(esFechaValida('2026-8-2')).toBe(false)
  })

  it('rechaza días que no existen aunque el formato sea correcto', () => {
    expect(esFechaValida('2026-02-31')).toBe(false)
    expect(esFechaValida('2026-13-01')).toBe(false)
  })
})

describe('bordes del rango', () => {
  it('el borde inferior arranca a las 00:00 del día', () => {
    expect(inicioDelDia('2026-08-01')).toBe('2026-08-01T00:00:00')
  })

  it('el borde superior es el día SIGUIENTE, para no perder el último día', () => {
    // Con un tope inclusivo '2026-08-31' se perderían todas las ventas de ese
    // día, porque `fecha` es timestamptz y resolvería a las 00:00:00.
    expect(inicioDelDiaSiguiente('2026-08-31')).toBe('2026-09-01T00:00:00')
  })

  it('cruza el cambio de año', () => {
    expect(inicioDelDiaSiguiente('2026-12-31')).toBe('2027-01-01T00:00:00')
  })

  it('cruza el 29 de febrero bisiesto', () => {
    expect(inicioDelDiaSiguiente('2028-02-28')).toBe('2028-02-29T00:00:00')
    expect(inicioDelDiaSiguiente('2028-02-29')).toBe('2028-03-01T00:00:00')
  })

  it('cruza el 28 de febrero no bisiesto', () => {
    expect(inicioDelDiaSiguiente('2026-02-28')).toBe('2026-03-01T00:00:00')
  })
})

describe('formatearFecha', () => {
  it('formatea YYYY-MM-DD sin corrimiento UTC', () => {
    expect(formatearFecha('2026-11-25')).toBe(new Date(2026, 10, 25).toLocaleDateString('es-AR'))
    expect(formatearFecha('2026-01-01')).toBe(new Date(2026, 0, 1).toLocaleDateString('es-AR'))
  })

  it('devuelve — si es null, undefined o vacío', () => {
    expect(formatearFecha(null)).toBe('—')
    expect(formatearFecha(undefined)).toBe('—')
    expect(formatearFecha('')).toBe('—')
  })
})
