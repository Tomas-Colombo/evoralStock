import { describe, expect, it } from 'vitest'
import type { Permiso } from '@/lib/types/administracion'
import { consultarAyuda } from './consultar'
import type { ModeloAyuda, PromptAyuda } from './tipos'

function crearFakeModelo(
  respuestas: Array<
    | { ok: true; salida: unknown }
    | { ok: false; error: 'sin-clave' | 'timeout' | 'proveedor' | 'formato' }
  >,
) {
  let indice = 0
  const promptsRecibidos: Array<{ prompt: PromptAyuda; idsPermitidos: readonly string[] }> = []

  const fake: ModeloAyuda = async (prompt, idsPermitidos) => {
    promptsRecibidos.push({ prompt, idsPermitidos })
    const res = respuestas[indice++] ?? {
      ok: true,
      salida: { respuesta: 'Respuesta por defecto', entradaId: null },
    }
    return res
  }

  return {
    modelo: fake,
    get llamadas() {
      return promptsRecibidos.length
    },
    prompts: promptsRecibidos,
  }
}

describe('consultarAyuda', () => {
  const permisosConAyuda = new Set<Permiso>(['ayuda.consultar'])

  it('REQ-AYUDA-07 Feliz: foco null y necesitaDetalle=true dispara 2da llamada con foco', async () => {
    const fake = crearFakeModelo([
      {
        ok: true,
        salida: {
          respuesta: 'Te muestro cómo usar la ayuda.',
          entradaId: 'ayuda-uso',
          necesitaDetalle: true,
        },
      },
      {
        ok: true,
        salida: {
          respuesta: 'Detalle ampliado de uso de ayuda.',
          entradaId: 'ayuda-uso',
          necesitaDetalle: false,
        },
      },
    ])

    const res = await consultarAyuda(
      {
        pregunta: '¿Cómo funciona la ayuda?',
        historial: [],
        focoId: null,
        permisos: permisosConAyuda,
      },
      fake.modelo,
    )

    expect(fake.llamadas).toBe(2)
    // Primera llamada sin foco
    expect(fake.prompts[0].prompt.turnos[0].texto).toContain('Entrada en foco: ninguna')
    // Segunda llamada con foco en ayuda-uso
    expect(fake.prompts[1].prompt.turnos[0].texto).toContain('Entrada en foco: ayuda-uso')

    expect(res).toEqual({
      resultado: 'respondida',
      texto: 'Detalle ampliado de uso de ayuda.',
      entrada: {
        id: 'ayuda-uso',
        titulo: 'Cómo consultar al asistente de ayuda',
      },
    })
  })

  it('REQ-AYUDA-07 N1: si la 2da llamada también pide detalle, no hay 3ra llamada (máximo 2)', async () => {
    const fake = crearFakeModelo([
      {
        ok: true,
        salida: {
          respuesta: 'Paso inicial',
          entradaId: 'ayuda-uso',
          necesitaDetalle: true,
        },
      },
      {
        ok: true,
        salida: {
          respuesta: 'Paso 2 pero sigue pidiendo detalle',
          entradaId: 'ayuda-uso',
          necesitaDetalle: true,
        },
      },
    ])

    const res = await consultarAyuda(
      {
        pregunta: '¿Cómo funciona?',
        historial: [],
        focoId: null,
        permisos: permisosConAyuda,
      },
      fake.modelo,
    )

    expect(fake.llamadas).toBe(2)
    expect(res.resultado).toBe('respondida')
    if (res.resultado === 'respondida') {
      expect(res.texto).toBe('Paso 2 pero sigue pidiendo detalle')
    }
  })

  it('REQ-AYUDA-07 N2: necesitaDetalle con entradaId igual al foco realiza solo 1 llamada', async () => {
    const fake = crearFakeModelo([
      {
        ok: true,
        salida: {
          respuesta: 'Ya está en foco la ayuda.',
          entradaId: 'ayuda-uso',
          necesitaDetalle: true,
        },
      },
    ])

    const res = await consultarAyuda(
      {
        pregunta: 'Dame más detalles de la ayuda',
        historial: [],
        focoId: 'ayuda-uso',
        permisos: permisosConAyuda,
      },
      fake.modelo,
    )

    expect(fake.llamadas).toBe(1)
    expect(res.resultado).toBe('respondida')
    if (res.resultado === 'respondida') {
      expect(res.texto).toBe('Ya está en foco la ayuda.')
    }
  })

  it('REQ-AYUDA-07 N3: si la 2da llamada falla con timeout, se utiliza la 1ra respuesta', async () => {
    const fake = crearFakeModelo([
      {
        ok: true,
        salida: {
          respuesta: 'Primera respuesta válida.',
          entradaId: 'ayuda-uso',
          necesitaDetalle: true,
        },
      },
      {
        ok: false,
        error: 'timeout',
      },
    ])

    const res = await consultarAyuda(
      {
        pregunta: '¿Cómo se usa?',
        historial: [],
        focoId: null,
        permisos: permisosConAyuda,
      },
      fake.modelo,
    )

    expect(fake.llamadas).toBe(2)
    expect(res).toEqual({
      resultado: 'respondida',
      texto: 'Primera respuesta válida.',
      entrada: {
        id: 'ayuda-uso',
        titulo: 'Cómo consultar al asistente de ayuda',
      },
    })
  })

  it('REQ-AYUDA-07: si la 2da llamada devuelve formato inválido, se usa la 1ra respuesta', async () => {
    const fake = crearFakeModelo([
      {
        ok: true,
        salida: {
          respuesta: 'Primera respuesta válida.',
          entradaId: 'ayuda-uso',
          necesitaDetalle: true,
        },
      },
      {
        ok: true,
        salida: {
          respuesta: 'Respuesta con formato roto',
          entradaId: 'no-existe-en-enum',
        },
      },
    ])

    const res = await consultarAyuda(
      {
        pregunta: '¿Cómo se usa?',
        historial: [],
        focoId: null,
        permisos: permisosConAyuda,
      },
      fake.modelo,
    )

    expect(fake.llamadas).toBe(2)
    expect(res.resultado).toBe('respondida')
    if (res.resultado === 'respondida') {
      expect(res.texto).toBe('Primera respuesta válida.')
    }
  })

  it('Sin entradas permitidas devuelve fuera_de_opciones sin llamar al modelo', async () => {
    const fake = crearFakeModelo([])

    const res = await consultarAyuda(
      {
        pregunta: '¿Cómo hago algo?',
        historial: [],
        focoId: null,
        permisos: new Set<Permiso>(), // Sin permisos
      },
      fake.modelo,
    )

    expect(fake.llamadas).toBe(0)
    expect(res).toEqual({ resultado: 'fuera_de_opciones' })
  })

  it('focoId fuera de las permitidas se trata como null', async () => {
    const fake = crearFakeModelo([
      {
        ok: true,
        salida: {
          respuesta: 'Respuesta sin foco',
          entradaId: 'ayuda-uso',
        },
      },
    ])

    await consultarAyuda(
      {
        pregunta: 'Consulta con foco inexistente',
        historial: [],
        focoId: 'id-que-no-existe-en-la-guia',
        permisos: permisosConAyuda,
      },
      fake.modelo,
    )

    expect(fake.llamadas).toBe(1)
    expect(fake.prompts[0].prompt.turnos[0].texto).toContain('Entrada en foco: ninguna')
  })

  it('Error del modelo en 1ra llamada se propaga directamente', async () => {
    const fake = crearFakeModelo([
      {
        ok: false,
        error: 'proveedor',
      },
    ])

    const res = await consultarAyuda(
      {
        pregunta: 'Consulta que falla en proveedor',
        historial: [],
        focoId: null,
        permisos: permisosConAyuda,
      },
      fake.modelo,
    )

    expect(fake.llamadas).toBe(1)
    expect(res).toEqual({
      resultado: 'error',
      error: 'proveedor',
    })
  })

  it('Salida con formato inválido en 1ra llamada devuelve error formato', async () => {
    const fake = crearFakeModelo([
      {
        ok: true,
        salida: {
          respuesta: 'Texto',
          entradaId: 'id-invalido-fuera-de-enum',
        },
      },
    ])

    const res = await consultarAyuda(
      {
        pregunta: 'Consulta con salida rota',
        historial: [],
        focoId: null,
        permisos: permisosConAyuda,
      },
      fake.modelo,
    )

    expect(fake.llamadas).toBe(1)
    expect(res).toEqual({
      resultado: 'error',
      error: 'formato',
    })
  })

  it('REQ-AYUDA-05: respuesta vacía o con solo espacios termina en error formato en consultarAyuda', async () => {
    const fake = crearFakeModelo([
      {
        ok: true,
        salida: {
          respuesta: '   ',
          entradaId: 'ayuda-uso',
        },
      },
    ])

    const res = await consultarAyuda(
      {
        pregunta: 'Consulta con respuesta en blanco',
        historial: [],
        focoId: null,
        permisos: permisosConAyuda,
      },
      fake.modelo,
    )

    expect(fake.llamadas).toBe(1)
    expect(res).toEqual({
      resultado: 'error',
      error: 'formato',
    })
  })
})
