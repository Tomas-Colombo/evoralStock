import { describe, expect, it } from 'vitest'
import {
  crearEtiquetaPlantillaSchema,
  editarEtiquetaPlantillaSchema,
  eliminarEtiquetaPlantillaSchema,
  etiquetaConfigSchema,
  marcarEtiquetaPlantillaPredeterminadaSchema,
} from './etiquetas'

const UUID_VALIDO = 'e5b7b14d-6161-460d-8ea8-3a9bcf5ec260'

describe('etiquetaConfigSchema (REQ-ETQ-01 y REQ-ETQ-04)', () => {
  const configValida = {
    metodo: 'qr' as const,
    impresora_tipo: 'hoja' as const,
    margen_mm: 10,
    separacion_mm: 2,
    columnas: null,
    offset_x_mm: 0,
    offset_y_mm: 0,
  }

  it('acepta una configuración válida con columnas automáticas', () => {
    const r = etiquetaConfigSchema.safeParse(configValida)
    expect(r.success).toBe(true)
  })

  it('acepta todas las simbologías del catálogo (REQ-ETQ-01)', () => {
    for (const metodo of ['qr', 'datamatrix', 'code128', 'ean13']) {
      expect(etiquetaConfigSchema.safeParse({ ...configValida, metodo }).success).toBe(true)
    }
  })

  it('rechaza una simbología fuera del catálogo con etiqueta-config-invalida (REQ-ETQ-01 N2)', () => {
    const r = etiquetaConfigSchema.safeParse({ ...configValida, metodo: 'pdf417' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('etiqueta-config-invalida')
    }
  })

  it('rechaza valores fuera de rango para margen, separación, columnas y offsets (REQ-ETQ-04 N2)', () => {
    // margen_mm (0 a 20)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, margen_mm: -1 }).success).toBe(false)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, margen_mm: 21 }).success).toBe(false)

    // separacion_mm (0 a 20)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, separacion_mm: -1 }).success).toBe(false)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, separacion_mm: 21 }).success).toBe(false)

    // columnas (1 a 10 o null)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, columnas: 0 }).success).toBe(false)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, columnas: 11 }).success).toBe(false)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, columnas: 4 }).success).toBe(true)

    // offset_x_mm (-10 a 10)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, offset_x_mm: -11 }).success).toBe(false)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, offset_x_mm: 11 }).success).toBe(false)

    // offset_y_mm (-10 a 10)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, offset_y_mm: -11 }).success).toBe(false)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, offset_y_mm: 11 }).success).toBe(false)
  })

  it('acepta medidas con hasta 2 decimales y rechaza más de 2 (numeric(5,2))', () => {
    // 0.5 es válido
    expect(etiquetaConfigSchema.safeParse({ ...configValida, margen_mm: 0.5 }).success).toBe(true)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, separacion_mm: 2.25 }).success).toBe(true)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, offset_x_mm: -1.5 }).success).toBe(true)
    expect(etiquetaConfigSchema.safeParse({ ...configValida, offset_y_mm: 3.75 }).success).toBe(true)

    // 0.123 (3 decimales) es rechazado con etiqueta-config-invalida
    const r = etiquetaConfigSchema.safeParse({ ...configValida, margen_mm: 0.123 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('etiqueta-config-invalida')
    }
  })

  it('rechaza claves adicionales por strictObject', () => {
    const r = etiquetaConfigSchema.safeParse({ ...configValida, extra: 'invalido' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('campo-desconocido')
    }
  })
})

describe('crearEtiquetaPlantillaSchema (REQ-ETQ-03)', () => {
  const plantillaValida = {
    nombre: 'Remera 40x30',
    ancho_mm: 40,
    alto_mm: 30,
    mostrar_nombre: true,
    mostrar_talle: true,
    mostrar_sku: false,
    mostrar_texto_codigo: false,
  }

  it('acepta una plantilla válida dentro de los límites', () => {
    const r = crearEtiquetaPlantillaSchema.safeParse(plantillaValida)
    expect(r.success).toBe(true)
  })

  it('rechaza nombres inválidos con plantilla-nombre-invalido y aplica trim antes de min/max (REQ-ETQ-03 N7)', () => {
    // Vacío
    const rVacio = crearEtiquetaPlantillaSchema.safeParse({ ...plantillaValida, nombre: '' })
    expect(rVacio.success).toBe(false)
    if (!rVacio.success) {
      expect(rVacio.error.issues[0]?.message).toBe('plantilla-nombre-invalido')
    }

    // Solo espacios: trim() lo deja en vacío y falla min(1) con plantilla-nombre-invalido
    const rEspacios = crearEtiquetaPlantillaSchema.safeParse({ ...plantillaValida, nombre: '    ' })
    expect(rEspacios.success).toBe(false)
    if (!rEspacios.success) {
      expect(rEspacios.error.issues[0]?.message).toBe('plantilla-nombre-invalido')
    }

    // Más de 40 caracteres
    const rLargo = crearEtiquetaPlantillaSchema.safeParse({ ...plantillaValida, nombre: 'a'.repeat(41) })
    expect(rLargo.success).toBe(false)
    if (!rLargo.success) {
      expect(rLargo.error.issues[0]?.message).toBe('plantilla-nombre-invalido')
    }

    // Espacios al borde: trim() previo los elimina y acepta el nombre limpio
    const rTrim = crearEtiquetaPlantillaSchema.safeParse({ ...plantillaValida, nombre: '  Remera 40x30  ' })
    expect(rTrim.success).toBe(true)
    if (rTrim.success) {
      expect(rTrim.data.nombre).toBe('Remera 40x30')
    }
  })

  it('rechaza medidas fuera de rango con plantilla-medidas-invalidas (REQ-ETQ-03 N3)', () => {
    // ancho_mm (15 a 300)
    const anchoChico = crearEtiquetaPlantillaSchema.safeParse({ ...plantillaValida, ancho_mm: 14 })
    expect(anchoChico.success).toBe(false)
    if (!anchoChico.success) {
      expect(anchoChico.error.issues[0]?.message).toBe('plantilla-medidas-invalidas')
    }

    const anchoGrande = crearEtiquetaPlantillaSchema.safeParse({ ...plantillaValida, ancho_mm: 301 })
    expect(anchoGrande.success).toBe(false)

    // alto_mm (10 a 300)
    const altoChico = crearEtiquetaPlantillaSchema.safeParse({ ...plantillaValida, alto_mm: 9 })
    expect(altoChico.success).toBe(false)
    if (!altoChico.success) {
      expect(altoChico.error.issues[0]?.message).toBe('plantilla-medidas-invalidas')
    }

    const altoGrande = crearEtiquetaPlantillaSchema.safeParse({ ...plantillaValida, alto_mm: 301 })
    expect(altoGrande.success).toBe(false)
  })

  it('rechaza claves adicionales por strictObject', () => {
    const r = crearEtiquetaPlantillaSchema.safeParse({ ...plantillaValida, extra: 123 })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('campo-desconocido')
    }
  })
})

describe('editarEtiquetaPlantillaSchema (REQ-ETQ-03)', () => {
  it('valida id UUID correcto junto con los datos de la plantilla', () => {
    const r = editarEtiquetaPlantillaSchema.safeParse({
      id: UUID_VALIDO,
      nombre: 'Bijou 25x15',
      ancho_mm: 25,
      alto_mm: 15,
      mostrar_nombre: false,
      mostrar_talle: true,
      mostrar_sku: false,
      mostrar_texto_codigo: true,
    })
    expect(r.success).toBe(true)
  })

  it('rechaza id que no sea UUID válido', () => {
    const r = editarEtiquetaPlantillaSchema.safeParse({
      id: 'no-es-un-uuid',
      nombre: 'Bijou 25x15',
      ancho_mm: 25,
      alto_mm: 15,
      mostrar_nombre: false,
      mostrar_talle: true,
      mostrar_sku: false,
      mostrar_texto_codigo: true,
    })
    expect(r.success).toBe(false)
  })
})

describe('eliminar y marcar predeterminada', () => {
  it('valida UUID en eliminarEtiquetaPlantillaSchema', () => {
    expect(eliminarEtiquetaPlantillaSchema.safeParse({ id: UUID_VALIDO }).success).toBe(true)
    expect(eliminarEtiquetaPlantillaSchema.safeParse({ id: 'invalido' }).success).toBe(false)
  })

  it('valida UUID en marcarEtiquetaPlantillaPredeterminadaSchema', () => {
    expect(marcarEtiquetaPlantillaPredeterminadaSchema.safeParse({ id: UUID_VALIDO }).success).toBe(true)
    expect(marcarEtiquetaPlantillaPredeterminadaSchema.safeParse({ id: 'invalido' }).success).toBe(false)
  })
})
