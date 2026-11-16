import { describe, expect, it } from 'vitest'
import type { EntradaGuia, MensajeHistorial } from './tipos'
import { armarPromptV2 } from './prompt'

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
