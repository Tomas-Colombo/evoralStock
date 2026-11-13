import { describe, expect, it } from 'vitest'
import { calcularLayout } from './layout'

describe('layout', () => {
  it('calcula hoja automática con valores por defecto (reproduce ImprimirEtiquetasClient)', () => {
    // Valores de hoy: QR de 35mm + 2mm padding = 37mm de ancho.
    // Alto estimado con nombre y talle: 45mm. Hoja A4 con margen 10mm y separación 2mm.
    const res = calcularLayout({
      plantilla: {
        ancho_mm: 37,
        alto_mm: 45,
        mostrar_nombre: true,
        mostrar_talle: true,
      },
    })

    expect(res.impresoraTipo).toBe('hoja')
    // Ancho útil = 210 - 20 = 190mm. (190 + 2) / (37 + 2) = 192 / 39 = 4.92 -> 4 columnas
    expect(res.columnas).toBe(4)
    expect(res.reglaPage).toBe('size: 210mm 297mm; margin: 10mm;')
    // 37 - 2 = 35mm de ancho. 45 - 2 - (4+3) = 36mm alto disponible. Min(35, 36) = 35mm
    expect(res.tamanoCodigo).toEqual({ anchoMm: 35, altoMm: 35 })
    expect(res.avisos).toEqual([])
    expect(res.puedeImprimir).toBe(true)
  })

  it('respeta columnas forzadas cuando entran en la hoja', () => {
    const res = calcularLayout({
      plantilla: {
        ancho_mm: 40,
        alto_mm: 30,
      },
      config: {
        impresora_tipo: 'hoja',
        margen_mm: 10,
        separacion_mm: 2,
        columnas: 3,
      },
    })

    expect(res.columnas).toBe(3)
    // 3 * 40 + 2 * 2 = 124mm <= 190mm
    expect(res.avisos).toEqual([])
    expect(res.puedeImprimir).toBe(true)
  })

  it('emite etiqueta-no-entra-en-hoja cuando las columnas forzadas superan el ancho útil (REQ-ETQ-04 N3)', () => {
    const res = calcularLayout({
      plantilla: {
        ancho_mm: 60,
        alto_mm: 40,
      },
      config: {
        impresora_tipo: 'hoja',
        margen_mm: 10,
        separacion_mm: 5,
        columnas: 4, // 4 * 60 + 3 * 5 = 255mm > 190mm útil
      },
    })

    expect(res.columnas).toBe(4)
    expect(res.avisos).toContain('etiqueta-no-entra-en-hoja')
    expect(res.puedeImprimir).toBe(false)
  })

  it('emite etiqueta-no-entra-en-hoja si una sola etiqueta supera las dimensiones útiles de la hoja', () => {
    const res = calcularLayout({
      plantilla: {
        ancho_mm: 200,
        alto_mm: 50,
      },
      config: {
        impresora_tipo: 'hoja',
        margen_mm: 10, // Ancho útil = 190mm. 200mm no entra
      },
    })

    expect(res.avisos).toContain('etiqueta-no-entra-en-hoja')
    expect(res.puedeImprimir).toBe(false)
  })

  it('calcula rollo con tamaño exacto de plantilla y offsets (REQ-ETQ-04)', () => {
    const res = calcularLayout({
      plantilla: {
        ancho_mm: 50,
        alto_mm: 30,
      },
      config: {
        impresora_tipo: 'rollo',
        offset_x_mm: 2,
        offset_y_mm: -3,
      },
    })

    expect(res.impresoraTipo).toBe('rollo')
    expect(res.columnas).toBe(1)
    expect(res.anchoPaginaMm).toBe(50)
    expect(res.altoPaginaMm).toBe(30)
    expect(res.reglaPage).toBe('size: 50mm 30mm; margin: 0;')
    expect(res.offsets).toEqual({ xMm: 2, yMm: -3 })
    expect(res.avisos).toEqual([])
    expect(res.puedeImprimir).toBe(true)
  })

  it('emite etiqueta-chica-para-codigo cuando la simbología 1D no entra en el ancho de la plantilla (REQ-ETQ-05 N2)', () => {
    // Code 128 requiere al menos 30mm de ancho. En plantilla "Bijou 25x15" no entra.
    const res = calcularLayout({
      plantilla: {
        ancho_mm: 25,
        alto_mm: 15,
      },
      simbologia: 'code128',
    })

    expect(res.avisos).toContain('etiqueta-chica-para-codigo')
    expect(res.puedeImprimir).toBe(false)
  })

  it('permite QR y DataMatrix en plantillas pequeñas donde 1D no entra', () => {
    // DataMatrix tiene minAnchoMm: 10. En 25x15 entra sin aviso.
    const res = calcularLayout({
      plantilla: {
        ancho_mm: 25,
        alto_mm: 15,
      },
      simbologia: 'datamatrix',
    })

    expect(res.avisos).toEqual([])
    expect(res.puedeImprimir).toBe(true)
  })
})
