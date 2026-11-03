import { describe, expect, it } from 'vitest'
import { esquemaSalida, salidaSchema } from './salida'

interface EsquemaOpenAPI {
  type: string
  required: string[]
  properties: {
    respuesta: { type: string }
    entradaId: { type: string; format?: string; enum?: string[]; nullable?: boolean }
    necesitaDetalle: { type: string }
  }
}

describe('salida', () => {
  const idsPermitidos = ['venta-nueva', 'ayuda-uso', 'gasto-nuevo']

  it('REQ-AYUDA-05 Feliz: esquemaSalida produce schema OpenAPI con enum y required', () => {
    const esquema = esquemaSalida(idsPermitidos) as EsquemaOpenAPI
    expect(esquema.type).toBe('OBJECT')
    expect(esquema.required).toEqual(['respuesta', 'entradaId'])
    expect(esquema.properties.respuesta.type).toBe('STRING')
    expect(esquema.properties.entradaId.type).toBe('STRING')
    expect(esquema.properties.entradaId.format).toBe('enum')
    expect(esquema.properties.entradaId.enum).toEqual(idsPermitidos)
    expect(esquema.properties.entradaId.nullable).toBe(true)
    expect(esquema.properties.necesitaDetalle.type).toBe('BOOLEAN')
  })

  it('REQ-AYUDA-05 Feliz: salida válida con id permitido y respuesta breve', () => {
    const schema = salidaSchema(idsPermitidos)
    const parse = schema.safeParse({
      respuesta: 'Para cargar una venta, andá a Ventas.',
      entradaId: 'venta-nueva',
      necesitaDetalle: false,
    })

    expect(parse.success).toBe(true)
    if (parse.success) {
      expect(parse.data.entradaId).toBe('venta-nueva')
      expect(parse.data.respuesta).toBe('Para cargar una venta, andá a Ventas.')
    }
  })

  it('REQ-AYUDA-05 Feliz: salida válida con entradaId null', () => {
    const schema = salidaSchema(idsPermitidos)
    const parse = schema.safeParse({
      respuesta: 'No sé cómo responder a eso.',
      entradaId: null,
    })

    expect(parse.success).toBe(true)
  })

  it('REQ-AYUDA-05 N1: entradaId fuera del enum del request es rechazado', () => {
    const schema = salidaSchema(idsPermitidos)
    const parse = schema.safeParse({
      respuesta: 'Andá a configuración.',
      entradaId: 'configuracion-avanzada',
    })

    expect(parse.success).toBe(false)
  })

  it('REQ-AYUDA-05 N2: payload no objeto o sin respuesta es rechazado', () => {
    const schema = salidaSchema(idsPermitidos)

    expect(schema.safeParse(null).success).toBe(false)
    expect(schema.safeParse('texto plano').success).toBe(false)
    expect(schema.safeParse({ entradaId: 'venta-nueva' }).success).toBe(false)
    expect(schema.safeParse({ respuesta: 123, entradaId: 'venta-nueva' }).success).toBe(false)
  })

  it('REQ-AYUDA-05 N3: respuesta mayor a 2000 caracteres es rechazada', () => {
    const schema = salidaSchema(idsPermitidos)
    const parse = schema.safeParse({
      respuesta: 'a'.repeat(2001),
      entradaId: 'venta-nueva',
    })

    expect(parse.success).toBe(false)
  })
})
