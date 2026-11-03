import { describe, expect, it } from 'vitest'
import {
  consultarAyudaSchema,
  calificarConsultaAyudaSchema,
} from './ayuda'

const VALID_UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('consultarAyudaSchema', () => {
  const baseValido = {
    idConversacion: VALID_UUID,
    pregunta: '¿Cómo cargo una venta con cuotas?',
    historial: [],
    focoId: null,
  }

  it('acepta un payload válido mínimo con historial vacío y focoId null', () => {
    const res = consultarAyudaSchema.safeParse(baseValido)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.pregunta).toBe('¿Cómo cargo una venta con cuotas?')
      expect(res.data.focoId).toBeNull()
      expect(res.data.historial).toEqual([])
    }
  })

  it('acepta un payload con focoId string y mensajes de historial válidos', () => {
    const payload = {
      ...baseValido,
      focoId: 'ventas-nueva',
      historial: [
        { rol: 'usuario', texto: 'Hola' },
        { rol: 'asistente', texto: '¿En qué te puedo ayudar?' },
      ],
    }
    const res = consultarAyudaSchema.safeParse(payload)
    expect(res.success).toBe(true)
  })

  describe('límites de borde para pregunta (1..300 con trim)', () => {
    it('acepta pregunta de 1 carácter', () => {
      const res = consultarAyudaSchema.safeParse({ ...baseValido, pregunta: 'a' })
      expect(res.success).toBe(true)
    })

    it('acepta pregunta de exactamente 300 caracteres', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        pregunta: 'a'.repeat(300),
      })
      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data.pregunta).toHaveLength(300)
      }
    })

    it('rechaza pregunta de 301 caracteres', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        pregunta: 'a'.repeat(301),
      })
      expect(res.success).toBe(false)
    })

    it('aplica trim antes de medir y acepta 300 caracteres con espacios alrededor', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        pregunta: '   ' + 'a'.repeat(300) + '   ',
      })
      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data.pregunta).toBe('a'.repeat(300))
        expect(res.data.pregunta).toHaveLength(300)
      }
    })

    it('aplica trim antes de medir y rechaza 301 caracteres con espacios alrededor', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        pregunta: '   ' + 'a'.repeat(301) + '   ',
      })
      expect(res.success).toBe(false)
    })

    it('rechaza pregunta vacía', () => {
      const res = consultarAyudaSchema.safeParse({ ...baseValido, pregunta: '' })
      expect(res.success).toBe(false)
    })

    it('rechaza pregunta con solo espacios en blanco (trim a longitud 0)', () => {
      const res = consultarAyudaSchema.safeParse({ ...baseValido, pregunta: '     ' })
      expect(res.success).toBe(false)
    })
  })

  describe('límites de borde para historial (≤6 turnos de ≤500 caracteres)', () => {
    it('acepta historial con exactamente 6 mensajes', () => {
      const historial6 = Array.from({ length: 6 }, (_, i) => ({
        rol: (i % 2 === 0 ? 'usuario' : 'asistente') as 'usuario' | 'asistente',
        texto: `Mensaje ${i + 1}`,
      }))
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        historial: historial6,
      })
      expect(res.success).toBe(true)
    })

    it('rechaza historial con 7 mensajes', () => {
      const historial7 = Array.from({ length: 7 }, (_, i) => ({
        rol: (i % 2 === 0 ? 'usuario' : 'asistente') as 'usuario' | 'asistente',
        texto: `Mensaje ${i + 1}`,
      }))
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        historial: historial7,
      })
      expect(res.success).toBe(false)
    })

    it('acepta mensaje en historial con texto de exactamente 500 caracteres', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        historial: [{ rol: 'usuario', texto: 'x'.repeat(500) }],
      })
      expect(res.success).toBe(true)
    })

    it('rechaza mensaje en historial con texto de 501 caracteres', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        historial: [{ rol: 'usuario', texto: 'x'.repeat(501) }],
      })
      expect(res.success).toBe(false)
    })

    it('rechaza rol inválido en mensaje de historial', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        historial: [{ rol: 'sistema', texto: 'Hola' }],
      })
      expect(res.success).toBe(false)
    })

    it('rechaza campos desconocidos en mensaje de historial (strictObject)', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        historial: [{ rol: 'usuario', texto: 'Hola', extra: 123 }],
      })
      expect(res.success).toBe(false)
    })
  })

  describe('límites de borde para focoId (≤64 caracteres nullable)', () => {
    it('acepta focoId null', () => {
      const res = consultarAyudaSchema.safeParse({ ...baseValido, focoId: null })
      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data.focoId).toBeNull()
      }
    })

    it('acepta focoId de exactamente 64 caracteres', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        focoId: 'k'.repeat(64),
      })
      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data.focoId).toHaveLength(64)
      }
    })

    it('rechaza focoId de 65 caracteres', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        focoId: 'k'.repeat(65),
      })
      expect(res.success).toBe(false)
    })

    it('rechaza focoId omitido / undefined', () => {
      const sinFoco: Record<string, unknown> = { ...baseValido }
      delete sinFoco.focoId
      const res = consultarAyudaSchema.safeParse(sinFoco)
      expect(res.success).toBe(false)
    })
  })

  describe('validación de idConversacion y strictObject', () => {
    it('rechaza idConversacion que no sea UUID', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        idConversacion: 'no-es-uuid',
      })
      expect(res.success).toBe(false)
    })

    it('rechaza campos desconocidos en la raíz (strictObject)', () => {
      const res = consultarAyudaSchema.safeParse({
        ...baseValido,
        campoInesperado: true,
      })
      expect(res.success).toBe(false)
    })
  })
})

describe('calificarConsultaAyudaSchema', () => {
  it('acepta idConsulta uuid y util: true', () => {
    const res = calificarConsultaAyudaSchema.safeParse({
      idConsulta: VALID_UUID,
      util: true,
    })
    expect(res.success).toBe(true)
  })

  it('acepta idConsulta uuid y util: false', () => {
    const res = calificarConsultaAyudaSchema.safeParse({
      idConsulta: VALID_UUID,
      util: false,
    })
    expect(res.success).toBe(true)
  })

  it('rechaza idConsulta no uuid', () => {
    const res = calificarConsultaAyudaSchema.safeParse({
      idConsulta: 'invalido',
      util: true,
    })
    expect(res.success).toBe(false)
  })

  it('rechaza util que no sea booleano', () => {
    const res = calificarConsultaAyudaSchema.safeParse({
      idConsulta: VALID_UUID,
      util: 'si',
    })
    expect(res.success).toBe(false)
  })

  it('rechaza campos desconocidos (strictObject)', () => {
    const res = calificarConsultaAyudaSchema.safeParse({
      idConsulta: VALID_UUID,
      util: true,
      comentario: 'Muy útil',
    })
    expect(res.success).toBe(false)
  })
})
