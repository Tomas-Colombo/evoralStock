import { describe, expect, it } from 'vitest'
import type { EntradaGuia, EventoStreamAyuda } from './tipos'
import { TransformStreamAyuda, crearParserStream } from './stream'

async function leerStream(
  stream: TransformStream<string, EventoStreamAyuda>,
  chunks: string[],
): Promise<EventoStreamAyuda[]> {
  const eventos: EventoStreamAyuda[] = []
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()

  const writePromise = (async () => {
    for (const chunk of chunks) {
      await writer.write(chunk)
    }
    await writer.close()
  })()

  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      eventos.push(value)
    }
  })()

  await Promise.all([writePromise, readPromise])
  return eventos
}

describe('lib/ayuda/stream — TransformStreamAyuda (REQ-AYUDA-V2-08)', () => {
  const fixtureEntradas: EntradaGuia[] = [
    {
      id: 'venta-nueva',
      titulo: 'Nueva venta',
      pasos: ['Ir a ventas', 'Click en nueva venta'],
      ruta: '/ventas/nueva',
      permisos: ['ventas.ver', 'ventas.crear'],
    },
    {
      id: 'gastos-nuevo',
      titulo: 'Registrar gasto',
      pasos: ['Ir a gastos', 'Click en nuevo gasto'],
      ruta: '/gastos/nuevo',
      permisos: ['gastos.ver', 'gastos.crear'],
    },
  ]

  it('REQ-AYUDA-V2-08 Feliz: modelo emite chunk con [[venta-nueva]] → emite evento link con ruta oficial de la guía', async () => {
    const parser = new TransformStreamAyuda(fixtureEntradas)
    const eventos = await leerStream(parser, [
      'Podés registrar la operación desde [[venta-nueva]] y luego cobrarla.',
    ])

    expect(eventos).toEqual([
      { tipo: 'texto', contenido: 'Podés registrar la operación desde ' },
      {
        tipo: 'link',
        id: 'venta-nueva',
        titulo: 'Nueva venta',
        ruta: '/ventas/nueva',
      },
      { tipo: 'texto', contenido: ' y luego cobrarla.' },
    ])
    expect(parser.idsCitados).toEqual(['venta-nueva'])
  })

  it('REQ-AYUDA-V2-08 N1: delimitador partido entre dos chunks ([ al final de chunk 1 y [id]] al inicio de chunk 2)', async () => {
    const parser = new TransformStreamAyuda(fixtureEntradas)
    const eventos = await leerStream(parser, [
      'Podés consultar [',
      '[venta-nueva]] para ver las opciones.',
    ])

    expect(eventos).toEqual([
      { tipo: 'texto', contenido: 'Podés consultar ' },
      {
        tipo: 'link',
        id: 'venta-nueva',
        titulo: 'Nueva venta',
        ruta: '/ventas/nueva',
      },
      { tipo: 'texto', contenido: ' para ver las opciones.' },
    ])
    expect(parser.idsCitados).toEqual(['venta-nueva'])
  })

  it('REQ-AYUDA-V2-08 N1 variante: identificador partido entre dos chunks ([[venta- y nueva]])', async () => {
    const parser = new TransformStreamAyuda(fixtureEntradas)
    const eventos = await leerStream(parser, [
      'Entrá en [[venta-',
      'nueva]] ahora mismo.',
    ])

    expect(eventos).toEqual([
      { tipo: 'texto', contenido: 'Entrá en ' },
      {
        tipo: 'link',
        id: 'venta-nueva',
        titulo: 'Nueva venta',
        ruta: '/ventas/nueva',
      },
      { tipo: 'texto', contenido: ' ahora mismo.' },
    ])
    expect(parser.idsCitados).toEqual(['venta-nueva'])
  })

  it('REQ-AYUDA-V2-08 N2: corchete abierto sin cerrar que supera 80 caracteres se emite como texto literal', async () => {
    const parser = new TransformStreamAyuda(fixtureEntradas)
    const textoLargo = '[[' + 'a'.repeat(85) + ' y sigue texto normal'
    const eventos = await leerStream(parser, [textoLargo])

    // El buffer desborda los 80 caracteres y se emite como texto literal
    const textos = eventos.filter((e) => e.tipo === 'texto').map((e) => (e as { contenido: string }).contenido)
    const textoCompleto = textos.join('')

    expect(textoCompleto).toBe(textoLargo)
    expect(parser.idsCitados).toEqual([])
  })

  it('REQ-AYUDA-V2-08 N3: cita con id inexistente o no autorizado [[pantalla-fantasma]] se descarta', async () => {
    const parser = new TransformStreamAyuda(fixtureEntradas)
    const eventos = await leerStream(parser, [
      'Revisá [[pantalla-fantasma]] o probá de nuevo.',
    ])

    expect(eventos).toEqual([
      { tipo: 'texto', contenido: 'Revisá ' },
      { tipo: 'texto', contenido: ' o probá de nuevo.' },
    ])
    expect(parser.idsCitados).toEqual([])
  })

  it('emite un [ suelto seguido de otra cosa en el acto como texto literal', async () => {
    const parser = new TransformStreamAyuda(fixtureEntradas)
    const eventos = await leerStream(parser, [
      'El precio [con descuento] es menor.',
    ])

    expect(eventos).toEqual([
      { tipo: 'texto', contenido: 'El precio ' },
      { tipo: 'texto', contenido: '[' },
      { tipo: 'texto', contenido: 'con descuento] es menor.' },
    ])
    expect(parser.idsCitados).toEqual([])
  })

  it('vierte en flush un [ pendiente al final del stream', async () => {
    const parser = new TransformStreamAyuda(fixtureEntradas)
    const eventos = await leerStream(parser, [
      'Texto que termina en [',
    ])

    expect(eventos).toEqual([
      { tipo: 'texto', contenido: 'Texto que termina en ' },
      { tipo: 'texto', contenido: '[' },
    ])
    expect(parser.idsCitados).toEqual([])
  })

  it('vierte en flush un [[identificador-incompleto al final del stream', async () => {
    const parser = new TransformStreamAyuda(fixtureEntradas)
    const eventos = await leerStream(parser, [
      'Texto que termina en [[venta-incompleta',
    ])

    expect(eventos).toEqual([
      { tipo: 'texto', contenido: 'Texto que termina en ' },
      { tipo: 'texto', contenido: '[[venta-incompleta' },
    ])
    expect(parser.idsCitados).toEqual([])
  })

  it('expone los ids citados en orden de aparición sin deduplicar', async () => {
    const { stream, idsCitados } = crearParserStream(fixtureEntradas)
    const eventos = await leerStream(stream, [
      'Primero [[venta-nueva]], después [[gastos-nuevo]], y otra vez [[venta-nueva]].',
    ])

    expect(eventos.filter((e) => e.tipo === 'link')).toHaveLength(3)
    expect(idsCitados).toEqual(['venta-nueva', 'gastos-nuevo', 'venta-nueva'])
  })

  it('si la entrada citada no tiene ruta emite { tipo: "texto", contenido: entrada.titulo } y cuenta el id en idsCitados', async () => {
    const entradasConSinRuta: EntradaGuia[] = [
      ...fixtureEntradas,
      {
        id: 'ayuda-general',
        titulo: 'Ayuda General',
        pasos: ['Consultar al administrador'],
        permisos: ['ayuda.consultar'],
      },
    ]

    const parser = new TransformStreamAyuda(entradasConSinRuta)
    const eventos = await leerStream(parser, [
      'Podés consultar [[ayuda-general]] para más detalles.',
    ])

    expect(eventos).toEqual([
      { tipo: 'texto', contenido: 'Podés consultar ' },
      { tipo: 'texto', contenido: 'Ayuda General' },
      { tipo: 'texto', contenido: ' para más detalles.' },
    ])
    expect(parser.idsCitados).toEqual(['ayuda-general'])
  })
})
