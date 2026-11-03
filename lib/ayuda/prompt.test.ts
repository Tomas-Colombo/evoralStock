import { describe, expect, it } from 'vitest'
import type { EntradaGuia, MensajeHistorial } from './tipos'
import { armarPrompt } from './prompt'

describe('armarPrompt', () => {
  const fixtureEntradas: EntradaGuia[] = [
    {
      id: 'ventas-crear',
      titulo: 'Crear venta',
      pasos: ['Ir a ventas', 'Click en nueva venta'],
      ruta: '/ventas',
      permisos: ['ventas.ver', 'ventas.crear'],
      detalles: [
        { tema: 'Descuentos', texto: 'Se aplican sobre el total antes de impuestos.' },
      ],
    },
    {
      id: 'gasto-nuevo',
      titulo: 'Registrar gasto',
      pasos: ['Ir a gastos', 'Click en nuevo gasto'],
      ruta: '/gastos',
      permisos: ['gastos.ver', 'gastos.crear'],
      detalles: [
        { tema: 'Comprobantes', texto: 'Adjuntar PDF o foto de la factura.' },
      ],
    },
  ]

  it('REQ-AYUDA-04 Feliz: dos preguntas distintas producen mismas instrucciones byte a byte', () => {
    const prompt1 = armarPrompt({
      entradas: fixtureEntradas,
      foco: null,
      historial: [],
      pregunta: '¿Cómo cargo una venta?',
    })

    const prompt2 = armarPrompt({
      entradas: fixtureEntradas,
      foco: fixtureEntradas[0],
      historial: [{ rol: 'usuario', texto: 'Hola' }],
      pregunta: '¿Y los gastos?',
    })

    expect(prompt1.instrucciones).toBe(prompt2.instrucciones)
  })

  it('REQ-AYUDA-04 N1: el índice y las instrucciones no contienen ninguna ruta', () => {
    const prompt = armarPrompt({
      entradas: fixtureEntradas,
      foco: null,
      historial: [],
      pregunta: '¿Cómo hago una venta?',
    })

    expect(prompt.instrucciones).not.toContain('/ventas')
    expect(prompt.instrucciones).not.toContain('/gastos')
    expect(prompt.instrucciones.match(/\/[a-zA-Z0-9_-]+/)).toBeNull()
  })

  it('REQ-AYUDA-04 N2: sin foco produce "Entrada en foco: ninguna" y sin bloque de detalles', () => {
    const prompt = armarPrompt({
      entradas: fixtureEntradas,
      foco: null,
      historial: [],
      pregunta: '¿Dónde veo las cosas?',
    })

    const turnoFinal = prompt.turnos[prompt.turnos.length - 1]
    expect(turnoFinal.texto).toContain('Entrada en foco: ninguna')
    expect(turnoFinal.texto).toContain('Detalles: ninguno')
    expect(turnoFinal.texto).toContain('Pregunta del usuario: ¿Dónde veo las cosas?')
    expect(turnoFinal.texto).not.toContain('Descuentos')
    expect(turnoFinal.texto).not.toContain('Comprobantes')
  })

  it('REQ-AYUDA-04 N3: historial de 6 respeta orden y roles', () => {
    const historial: MensajeHistorial[] = [
      { rol: 'usuario', texto: 'Pregunta 1' },
      { rol: 'asistente', texto: 'Respuesta 1' },
      { rol: 'usuario', texto: 'Pregunta 2' },
      { rol: 'asistente', texto: 'Respuesta 2' },
      { rol: 'usuario', texto: 'Pregunta 3' },
      { rol: 'asistente', texto: 'Respuesta 3' },
    ]

    const prompt = armarPrompt({
      entradas: fixtureEntradas,
      foco: null,
      historial,
      pregunta: 'Pregunta 4 final',
    })

    expect(prompt.turnos.length).toBe(7)
    for (let i = 0; i < 6; i++) {
      expect(prompt.turnos[i]).toEqual(historial[i])
    }
    const final = prompt.turnos[6]
    expect(final.rol).toBe('usuario')
    expect(final.texto).toContain('Pregunta del usuario: Pregunta 4 final')
  })

  it('REQ-AYUDA-04 con foco: incluye solo los detalles de la entrada en foco', () => {
    const prompt = armarPrompt({
      entradas: fixtureEntradas,
      foco: fixtureEntradas[0],
      historial: [],
      pregunta: '¿Qué onda los descuentos?',
    })

    const turnoFinal = prompt.turnos[0]
    expect(turnoFinal.texto).toContain('Entrada en foco: ventas-crear')
    expect(turnoFinal.texto).toContain('Descuentos: Se aplican sobre el total antes de impuestos.')
    expect(turnoFinal.texto).not.toContain('Comprobantes')
  })
})
