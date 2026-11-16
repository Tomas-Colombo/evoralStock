import { describe, expect, it } from 'vitest'
import {
  consultarAyudaChatSchema,
  calificarConsultaAyudaSchema,
} from './ayuda'

const VALID_UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

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

describe('consultarAyudaChatSchema (v2)', () => {
  const baseValido = {
    idConversacion: VALID_UUID,
    pregunta: '¿Cómo cargo una venta con cuotas?',
    historial: [],
  }

  it('acepta un payload válido mínimo con historial vacío', () => {
    const res = consultarAyudaChatSchema.safeParse(baseValido)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.pregunta).toBe('¿Cómo cargo una venta con cuotas?')
      expect(res.data.historial).toEqual([])
    }
  })

  it('acepta historial de hasta 4 turnos con citasPrevias válidas', () => {
    const res = consultarAyudaChatSchema.safeParse({
      ...baseValido,
      historial: [
        { rol: 'usuario', texto: 'Hola' },
        {
          rol: 'asistente',
          texto: 'Podés ir a ventas.',
          citasPrevias: ['venta-nueva', 'cliente-nuevo'],
        },
        { rol: 'usuario', texto: '¿Y el descuento?' },
        { rol: 'asistente', texto: 'Desde la misma pantalla.' },
      ],
    })
    expect(res.success).toBe(true)
  })

  it('rechaza historial con más de 4 turnos', () => {
    const historial5 = Array.from({ length: 5 }, (_, i) => ({
      rol: (i % 2 === 0 ? 'usuario' : 'asistente') as 'usuario' | 'asistente',
      texto: `Turno ${i + 1}`,
    }))
    const res = consultarAyudaChatSchema.safeParse({
      ...baseValido,
      historial: historial5,
    })
    expect(res.success).toBe(false)
  })

  it('rechaza citasPrevias con más de 6 elementos', () => {
    const res = consultarAyudaChatSchema.safeParse({
      ...baseValido,
      historial: [
        {
          rol: 'asistente',
          texto: 'Hola',
          citasPrevias: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
        },
      ],
    })
    expect(res.success).toBe(false)
  })

  it('rechaza cita previa con caracteres inválidos (no kebab-case)', () => {
    const res = consultarAyudaChatSchema.safeParse({
      ...baseValido,
      historial: [
        {
          rol: 'asistente',
          texto: 'Hola',
          citasPrevias: ['Venta_Nueva'],
        },
      ],
    })
    expect(res.success).toBe(false)
  })

  it('rechaza cita previa de más de 64 caracteres', () => {
    const res = consultarAyudaChatSchema.safeParse({
      ...baseValido,
      historial: [
        {
          rol: 'asistente',
          texto: 'Hola',
          citasPrevias: ['a'.repeat(65)],
        },
      ],
    })
    expect(res.success).toBe(false)
  })

  it('rechaza campos desconocidos (strictObject)', () => {
    const res = consultarAyudaChatSchema.safeParse({
      ...baseValido,
      focoId: 'no-permitido-en-v2',
    })
    expect(res.success).toBe(false)
  })
})
