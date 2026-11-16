import { describe, expect, it } from 'vitest'
import type { EntradaGuia, MensajeHistorial } from './tipos'
import { armarPrompt, armarPromptV2 } from './prompt'

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
      // sin detalles
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

  it('REQ-AYUDA-07: solo las entradas con detalles llevan la marca "| con detalles" y las instrucciones mencionan necesitaDetalle', () => {
    const prompt = armarPrompt({
      entradas: fixtureEntradas,
      foco: null,
      historial: [],
      pregunta: '¿Cómo cargo una venta?',
    })

    expect(prompt.instrucciones).toContain('ventas-crear | Crear venta | Ir a ventas · Click en nueva venta | con detalles')
    expect(prompt.instrucciones).toContain('gasto-nuevo | Registrar gasto | Ir a gastos · Click en nuevo gasto')
    expect(prompt.instrucciones).not.toContain('gasto-nuevo | Registrar gasto | Ir a gastos · Click en nuevo gasto | con detalles')
    expect(prompt.instrucciones).toContain('necesitaDetalle true')
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
  })
})

describe('armarPromptV2', () => {
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
    },
  ]

  it('REQ-AYUDA-V2-06 Feliz: arma prompt con texto plano sin Markdown, citas [[id]] y detalles incluidos', () => {
    const historial: MensajeHistorial[] = [
      { rol: 'usuario', texto: 'Hola' },
      { rol: 'asistente', texto: 'Hola, ¿en qué te ayudo?' },
    ]
    const prompt = armarPromptV2({
      entradas: fixtureEntradas,
      historial,
      pregunta: '¿Cómo aplico un descuento?',
    })

    // Instrucciones exigen texto plano y citas [[id]]
    expect(prompt.instrucciones).toContain('texto plano puro, SIN formato Markdown')
    expect(prompt.instrucciones).toContain('[[id]]')
    expect(prompt.instrucciones).toContain('[[id-de-la-entrada]]')
    expect(prompt.instrucciones).not.toContain('[[venta-nueva]]')
    expect(prompt.instrucciones).toContain('NO uses negritas (**)')

    // Entradas completas con pasos y detalles
    expect(prompt.instrucciones).toContain('Entrada: ventas-crear | Crear venta')
    expect(prompt.instrucciones).toContain('Pasos: Ir a ventas · Click en nueva venta')
    expect(prompt.instrucciones).toContain('Descuentos: Se aplican sobre el total antes de impuestos.')
    expect(prompt.instrucciones).toContain('Entrada: gasto-nuevo | Registrar gasto')

    // Turnos respetan historial y pregunta final
    expect(prompt.turnos).toHaveLength(3)
    expect(prompt.turnos[0]).toEqual(historial[0])
    expect(prompt.turnos[1]).toEqual(historial[1])
    expect(prompt.turnos[2]).toEqual({
      rol: 'usuario',
      texto: 'Pregunta del usuario: ¿Cómo aplico un descuento?',
    })
  })

  it('REQ-AYUDA-V2-06 N1: dos consultas distintas con las mismas entradas comparten idéntico prefijo de instrucciones byte a byte', () => {
    const prompt1 = armarPromptV2({
      entradas: fixtureEntradas,
      historial: [],
      pregunta: '¿Cómo cargo una venta?',
    })

    const prompt2 = armarPromptV2({
      entradas: fixtureEntradas,
      historial: [{ rol: 'usuario', texto: '¿Dónde anoto gastos?' }],
      pregunta: '¿Y los comprobantes?',
    })

    expect(prompt1.instrucciones).toBe(prompt2.instrucciones)
  })

  it('REQ-AYUDA-V2-06 N2: el prompt no contiene rutas URL (strings que empiecen con /)', () => {
    const prompt = armarPromptV2({
      entradas: fixtureEntradas,
      historial: [{ rol: 'usuario', texto: 'Consulta previa' }],
      pregunta: '¿Cómo hago una venta?',
    })

    // Las rutas /ventas y /gastos de fixtureEntradas no deben aparecer
    expect(prompt.instrucciones).not.toContain('/ventas')
    expect(prompt.instrucciones).not.toContain('/gastos')
    // Ningún patrón de ruta URL en instrucciones
    expect(prompt.instrucciones.match(/\/[a-zA-Z0-9_-]+/)).toBeNull()

    // Tampoco en los turnos
    for (const turno of prompt.turnos) {
      expect(turno.texto.match(/\/[a-zA-Z0-9_-]+/)).toBeNull()
    }
  })
})
