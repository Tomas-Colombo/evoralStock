import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PanelAyuda } from './PanelAyuda'
import { ToastProvider } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'

const { calificarConsultaAyudaActionMock } = vi.hoisted(() => ({
  calificarConsultaAyudaActionMock: vi.fn(),
}))

vi.mock('@/app/(app)/ayuda/actions', () => ({
  calificarConsultaAyudaAction: calificarConsultaAyudaActionMock,
}))

const fetchMock = vi.fn()
globalThis.fetch = fetchMock

function renderPanel() {
  return render(
    <ToastProvider>
      <PanelAyuda />
    </ToastProvider>,
  )
}

function mockStreamResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  })
}

function createControlledStream() {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream({
    start(c) {
      controller = c
    },
  })

  return {
    stream,
    push(chunk: string) {
      controller.enqueue(encoder.encode(chunk))
    },
    close() {
      controller.close()
    },
    error(err: unknown) {
      controller.error(err)
    },
    asResponse(status = 200) {
      return new Response(stream, {
        status,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      })
    },
  }
}

describe('PanelAyuda (Fase 5 streaming / REQ-AYUDA-V2-09, 13 / DR-AYUDA-V2-1, 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    calificarConsultaAyudaActionMock.mockResolvedValue({ ok: true })
  })

  it('al abrir el foco va al textarea; al cerrar vuelve al botón', async () => {
    renderPanel()

    const boton = screen.getByRole('button', { name: 'Ayuda' })
    expect(screen.queryByRole('dialog', { name: 'Ayuda' })).not.toBeInTheDocument()

    fireEvent.click(boton)

    const dialog = screen.getByRole('dialog', { name: 'Ayuda' })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'false')

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    expect(textarea).toHaveFocus()

    const botonCerrar = screen.getByRole('button', { name: 'Cerrar' })
    fireEvent.click(botonCerrar)

    expect(screen.queryByRole('dialog', { name: 'Ayuda' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ayuda' })).toHaveFocus()
  })

  it('N3: Escape dentro del panel lo cierra; Escape en document sin foco en el panel no lo cierra', async () => {
    renderPanel()

    const boton = screen.getByRole('button', { name: 'Ayuda' })
    fireEvent.click(boton)

    const dialog = screen.getByRole('dialog', { name: 'Ayuda' })
    expect(dialog).toBeInTheDocument()

    // Escape en document / body fuera del panel NO debe cerrarlo
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Ayuda' })).toBeInTheDocument()

    // Escape dentro del panel lo cierra
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Ayuda' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ayuda' })).toHaveFocus()
  })

  it('Shift+Enter no envía la pregunta; Enter sin Shift envía', async () => {
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Respuesta"}\n\n',
        'data: {"tipo":"fin","idConsulta":null,"resultado":"respondida"}\n\n',
      ]),
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Texto de prueba' } })

    // Shift+Enter no envía
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(fetchMock).not.toHaveBeenCalled()

    // Enter sin Shift envía
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('muestra aviso de datos de clientes y contador de caracteres con límite 300', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    expect(screen.getByText('No escribas datos de clientes.')).toBeInTheDocument()
    expect(screen.getByText('0/300')).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    expect(textarea).toHaveAttribute('maxLength', '300')

    fireEvent.change(textarea, { target: { value: 'Hola mundo' } })
    expect(screen.getByText('10/300')).toBeInTheDocument()
  })

  it('dos envíos seguidos con stream en curso → una sola llamada (botón deshabilitado durante stream)', async () => {
    const controlled = createControlledStream()
    fetchMock.mockResolvedValueOnce(controlled.asResponse())

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: '¿Cómo registro una venta?' } })

    const botonEnviar = screen.getByRole('button', { name: 'Enviar' })
    fireEvent.click(botonEnviar)

    // Intento de doble envío mientras el stream está en vuelo
    fireEvent.click(botonEnviar)
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(botonEnviar).toBeDisabled()

    // Emitir eventos y cerrar
    controlled.push('data: {"tipo":"texto","contenido":"Pasos para venta."}\n\n')
    controlled.push('data: {"tipo":"fin","idConsulta":"c-1","resultado":"respondida"}\n\n')
    controlled.close()

    await waitFor(() => {
      expect(screen.getByText('Pasos para venta.')).toBeInTheDocument()
      expect(textarea).not.toBeDisabled()
    })
  })

  it('texto progresivo: se acumulan los chunks de texto en tiempo real', async () => {
    const controlled = createControlledStream()
    fetchMock.mockResolvedValueOnce(controlled.asResponse())

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Hola' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    controlled.push('data: {"tipo":"texto","contenido":"Hola "}\n\n')

    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeInTheDocument()
    })

    controlled.push('data: {"tipo":"texto","contenido":"mundo desde el stream."}\n\n')

    await waitFor(() => {
      expect(screen.getByText('Hola mundo desde el stream.')).toBeInTheDocument()
    })

    controlled.push('data: {"tipo":"fin","idConsulta":null,"resultado":"respondida"}\n\n')
    controlled.close()

    await waitFor(() => {
      expect(screen.getByText('Hola mundo desde el stream.')).toBeInTheDocument()
    })
  })

  it('evento partido entre chunks: se ensambla correctamente sin perder datos', async () => {
    const controlled = createControlledStream()
    fetchMock.mockResolvedValueOnce(controlled.asResponse())

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Pregunta chunk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    // Chunk 1 incompleto
    controlled.push('data: {"tipo":"texto","conte')
    // Esperar brevemente
    await new Promise((r) => setTimeout(r, 20))
    // Chunk 2 completa el JSON
    controlled.push('nido":"texto ensamblado"}\n\n')
    controlled.push('data: {"tipo":"fin","idConsulta":null,"resultado":"respondida"}\n\n')
    controlled.close()

    await waitFor(() => {
      expect(screen.getByText('texto ensamblado')).toBeInTheDocument()
    })
  })

  it('link renderizado como <a> con href correcto', async () => {
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Para registrar una venta, andá a "}\n\n',
        'data: {"tipo":"link","id":"ventas-nueva","titulo":"Nueva venta","ruta":"/ventas/nueva"}\n\n',
        'data: {"tipo":"texto","contenido":" y completá los datos."}\n\n',
        'data: {"tipo":"fin","idConsulta":"c-1","resultado":"respondida"}\n\n',
      ]),
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: '¿Cómo vendo?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Nueva venta' })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', '/ventas/nueva')
      expect(link.tagName).toBe('A')
      expect(screen.getByText(/Para registrar una venta, andá a/)).toBeInTheDocument()
      expect(screen.getByText(/y completá los datos\./)).toBeInTheDocument()
    })
  })

  it('"<script>" como texto literal (REQ-09 N2): no inyecta HTML ni ejecuta scripts', async () => {
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"<script>alert(\\"xss\\")</script>"}\n\n',
        'data: {"tipo":"fin","idConsulta":null,"resultado":"respondida"}\n\n',
      ]),
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Prueba XSS' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument()
    })

    // Asegura que no se creó ninguna etiqueta script en el DOM
    const scripts = document.querySelectorAll('script:not([src])')
    expect(scripts).toHaveLength(0)
  })

  it('sin_cita (DR-1): conserva el texto visible y renderiza al pie la tarjeta fija de v1', async () => {
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Puedo explicarte el concepto, pero no hay pantalla directa."}\n\n',
        'data: {"tipo":"fin","idConsulta":"c-sin-cita","resultado":"sin_cita"}\n\n',
      ]),
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Concepto sin pantalla' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      // Texto conservado
      expect(
        screen.getByText('Puedo explicarte el concepto, pero no hay pantalla directa.'),
      ).toBeInTheDocument()
      // Tarjeta fija de v1 al pie
      expect(
        screen.getByText('No tengo esa respuesta. Preguntale al administrador de tu negocio.'),
      ).toBeInTheDocument()
    })
  })

  it('sin_llm sin sugerencias: pide reformular en vez de mostrar links', async () => {
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"sugerencias","entradas":[]}\n\n',
        'data: {"tipo":"fin","idConsulta":null,"resultado":"sin_llm"}\n\n',
      ]),
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'pregunta ajena' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(
        screen.getByText('No encontré nada sobre eso en la guía. Probá con otras palabras.'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('Quizás te sirvan estas opciones:')).not.toBeInTheDocument()
  })

  it('sin_llm con sugerencias: renderiza la lista de links de orientación', async () => {
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"sugerencias","entradas":[{"id":"v-1","titulo":"Facturación y cobro","ruta":"/ventas"},{"id":"c-1","titulo":"Control de clientes","ruta":"/clientes"}]}\n\n',
        'data: {"tipo":"fin","idConsulta":null,"resultado":"sin_llm"}\n\n',
      ]),
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'pregunta fuera de umbral' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Facturación y cobro' })).toHaveAttribute(
        'href',
        '/ventas',
      )
      expect(screen.getByRole('link', { name: 'Control de clientes' })).toHaveAttribute(
        'href',
        '/clientes',
      )
    })
  })

  it('429 cuota-excedida: muestra aviso visible y deshabilita el input hasta recargar', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ ok: false, reason: 'cuota-excedida' }),
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Consulta con cuota' } })

    const botonEnviar = screen.getByRole('button', { name: 'Enviar' })
    fireEvent.click(botonEnviar)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(mensajeDeError('cuota-excedida'))
      expect(textarea).toBeDisabled()
      expect(botonEnviar).toBeDisabled()
    })

    // La burbuja de usuario se removió al fallar pre-stream
    expect(screen.queryByText('Consulta con cuota', { selector: 'div.bg-block' })).not.toBeInTheDocument()
    // El texto volvió al textarea
    expect(textarea).toHaveValue('Consulta con cuota')

    // Al tocar "Nueva conversación", el input sigue deshabilitado (hasta recargar)
    fireEvent.click(screen.getByRole('button', { name: 'Nueva conversación' }))
    expect(textarea).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(mensajeDeError('cuota-excedida'))
  })

  it('error a mitad del stream: conserva el texto recibido y muestra el mensaje de error', async () => {
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Primeros pasos recibidos correctamente."}\n\n',
        'data: {"tipo":"error","reason":"ayuda-error"}\n\n',
      ]),
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Pregunta con error a mitad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByText('Primeros pasos recibidos correctamente.')).toBeInTheDocument()
      expect(screen.getByText(mensajeDeError('ayuda-error'))).toBeInTheDocument()
    })

    // La burbuja de usuario NO se remueve porque ya hubo datos transmitidos
    expect(
      screen.getByText('Pregunta con error a mitad', { selector: 'div.bg-block' }),
    ).toBeInTheDocument()
  })

  it('error de stream aparece una sola vez (dentro del mensaje, sin banner global)', async () => {
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Respuesta que falla."}\n\n',
        'data: {"tipo":"error","reason":"ayuda-error"}\n\n',
      ]),
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Pregunta error único' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByText('Respuesta que falla.')).toBeInTheDocument()
      expect(screen.getByText(mensajeDeError('ayuda-error'))).toBeInTheDocument()
    })

    // El error de stream va únicamente dentro del mensaje: no existe banner global duplicado
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getAllByText(mensajeDeError('ayuda-error'))).toHaveLength(1)
  })

  it('abort al cerrar: cancela el stream con AbortController al cerrar el panel, cierra el mensaje y no entra al historial siguiente', async () => {
    const controlled = createControlledStream()
    let capturedSignal: AbortSignal | null | undefined

    fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal
      init?.signal?.addEventListener('abort', () => {
        controlled.error(new DOMException('The user aborted a request.', 'AbortError'))
      })
      return Promise.resolve(controlled.asResponse())
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Pregunta que se abortará' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(capturedSignal).toBeDefined()
    })
    expect(capturedSignal?.aborted).toBe(false)

    // Emitir fragmento parcial antes del corte
    controlled.push('data: {"tipo":"texto","contenido":"Fragmento antes de abortar."}\n\n')

    await waitFor(() => {
      expect(screen.getByText('Fragmento antes de abortar.')).toBeInTheDocument()
    })

    // Cerrar el panel
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(capturedSignal?.aborted).toBe(true)

    // Reabrir el panel: el mensaje de asistente está cerrado (enProgreso: false, esEnlatada: true) y visible
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))
    expect(screen.getByText('Fragmento antes de abortar.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByPlaceholderText('¿Qué querés hacer?')).not.toBeDisabled()
    })

    const textareaNuevo = screen.getByPlaceholderText('¿Qué querés hacer?')

    // Nueva pregunta: la pregunta abortada NO entra al historial
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Respuesta nueva."}\n\n',
        'data: {"tipo":"fin","idConsulta":null,"resultado":"respondida"}\n\n',
      ]),
    )

    fireEvent.change(textareaNuevo, { target: { value: 'Siguiente pregunta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    const bodyLlamada2 = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    // El historial debe estar vacío: ni la pregunta abortada ni el asistente parcial entraron
    expect(bodyLlamada2.historial).toEqual([])
  })

  it('calificar con el idConsulta de fin y sin botones si es null', async () => {
    // Caso 1: con idConsulta
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Respuesta útil."}\n\n',
        'data: {"tipo":"fin","idConsulta":"uuid-consulta-42","resultado":"respondida"}\n\n',
      ]),
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: '¿Dónde veo los precios?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByText('¿Te sirvió?')).toBeInTheDocument()
    })

    const botonSi = screen.getByRole('button', { name: 'Sí' })
    const botonNo = screen.getByRole('button', { name: 'No' })

    // Votar Sí
    fireEvent.click(botonSi)
    await waitFor(() => {
      expect(calificarConsultaAyudaActionMock).toHaveBeenCalledWith({
        idConsulta: 'uuid-consulta-42',
        util: true,
      })
      expect(botonSi).toHaveAttribute('data-variant', 'primary')
    })

    // Cambiar a No
    fireEvent.click(botonNo)
    await waitFor(() => {
      expect(calificarConsultaAyudaActionMock).toHaveBeenCalledWith({
        idConsulta: 'uuid-consulta-42',
        util: false,
      })
      expect(botonNo).toHaveAttribute('data-variant', 'primary')
    })

    // Caso 2: con idConsulta null → no se muestra "¿Te sirvió?" para ese nuevo mensaje
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Otra respuesta sin registro en DB."}\n\n',
        'data: {"tipo":"fin","idConsulta":null,"resultado":"respondida"}\n\n',
      ]),
    )

    fireEvent.change(textarea, { target: { value: 'Pregunta sin idConsulta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByText('Otra respuesta sin registro en DB.')).toBeInTheDocument()
    })

    // Solo debe haber un "¿Te sirvió?" (el del primer mensaje)
    const calificarBloques = screen.getAllByText('¿Te sirvió?')
    expect(calificarBloques).toHaveLength(1)
  })

  it('historial: envía ≤4 mensajes, textos ≤500, citasPrevias de links y excluye enlatadas', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')

    // Turno 1: respondida con links
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Paso 1."}\n\n',
        'data: {"tipo":"link","id":"ventas-nueva","titulo":"Ventas","ruta":"/ventas"}\n\n',
        'data: {"tipo":"fin","idConsulta":"c-1","resultado":"respondida"}\n\n',
      ]),
    )
    fireEvent.change(textarea, { target: { value: 'Pregunta 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(screen.getByText('Paso 1.')).toBeInTheDocument())

    // Turno 2: sin_cita (enlatada / tarjeta fija)
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Paso 2 sin cita."}\n\n',
        'data: {"tipo":"fin","idConsulta":"c-2","resultado":"sin_cita"}\n\n',
      ]),
    )
    fireEvent.change(textarea, { target: { value: 'Pregunta 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(screen.getByText('Paso 2 sin cita.')).toBeInTheDocument())

    // Turno 3: sugerencias (enlatada)
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"sugerencias","entradas":[{"id":"s-1","titulo":"Sug 1","ruta":"/sug"}]}\n\n',
        'data: {"tipo":"fin","idConsulta":null,"resultado":"sin_llm"}\n\n',
      ]),
    )
    fireEvent.change(textarea, { target: { value: 'Pregunta 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sug 1' })).toBeInTheDocument())

    // Turno 4: respondida con link largo para probar slice ≤500
    const textoLargo = 'a'.repeat(600)
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        `data: {"tipo":"texto","contenido":"${textoLargo}"}\n\n`,
        'data: {"tipo":"link","id":"clientes-nuevo","titulo":"Clientes","ruta":"/clientes"}\n\n',
        'data: {"tipo":"fin","idConsulta":"c-4","resultado":"respondida"}\n\n',
      ]),
    )
    fireEvent.change(textarea, { target: { value: 'Pregunta 4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument())

    // Turno 5: comprobar el payload enviado
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Final"}\n\n',
        'data: {"tipo":"fin","idConsulta":"c-5","resultado":"respondida"}\n\n',
      ]),
    )
    fireEvent.change(textarea, { target: { value: 'Pregunta 5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))

    const ultimaPeticion = JSON.parse(fetchMock.mock.calls[4][1].body as string)
    const { historial } = ultimaPeticion

    // Historial tiene a lo sumo 4 turnos (en este caso Turno 1 y Turno 4 completos = 4 mensajes)
    expect(historial.length).toBeLessThanOrEqual(4)

    // Ninguna respuesta enlatada (sin_cita ni sugerencias) está en el historial
    for (const msg of historial) {
      expect(msg.texto.length).toBeLessThanOrEqual(500)
      if (msg.rol === 'asistente') {
        expect(msg.texto).not.toContain('Paso 2 sin cita.')
        expect(msg.citasPrevias).toBeDefined()
      }
    }

    // Turno 2 y Turno 3 están completamente excluidos (tanto usuario como asistente)
    expect(historial.some((m: { texto: string }) => m.texto === 'Pregunta 2')).toBe(false)
    expect(historial.some((m: { texto: string }) => m.texto === 'Pregunta 3')).toBe(false)

    // Turno 1 y Turno 4 están presentes
    expect(historial[0]).toEqual({ rol: 'usuario', texto: 'Pregunta 1' })
    expect(historial[1]).toMatchObject({ rol: 'asistente', citasPrevias: ['ventas-nueva'] })
    expect(historial[2]).toEqual({ rol: 'usuario', texto: 'Pregunta 4' })
    expect(historial[3]).toMatchObject({ rol: 'asistente', citasPrevias: ['clientes-nuevo'] })
  })

  it('historial sin turnos de usuario seguidos: si una respuesta se excluye, se excluye también su pregunta', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')

    // Turno 1: respondida válida con link
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Respuesta 1."}\n\n',
        'data: {"tipo":"link","id":"v-1","titulo":"Ventas","ruta":"/ventas"}\n\n',
        'data: {"tipo":"fin","idConsulta":"c-1","resultado":"respondida"}\n\n',
      ]),
    )
    fireEvent.change(textarea, { target: { value: 'Pregunta 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(screen.getByText('Respuesta 1.')).toBeInTheDocument())

    // Turno 2: sin_cita (excluida)
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Respuesta 2 sin cita."}\n\n',
        'data: {"tipo":"fin","idConsulta":"c-2","resultado":"sin_cita"}\n\n',
      ]),
    )
    fireEvent.change(textarea, { target: { value: 'Pregunta 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(screen.getByText('Respuesta 2 sin cita.')).toBeInTheDocument())

    // Turno 3: sugerencias (excluida)
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"sugerencias","entradas":[{"id":"s-1","titulo":"Sug 1","ruta":"/sug"}]}\n\n',
        'data: {"tipo":"fin","idConsulta":null,"resultado":"sin_llm"}\n\n',
      ]),
    )
    fireEvent.change(textarea, { target: { value: 'Pregunta 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sug 1' })).toBeInTheDocument())

    // Turno 4: comprobar el payload enviado
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Respuesta 4."}\n\n',
        'data: {"tipo":"fin","idConsulta":"c-4","resultado":"respondida"}\n\n',
      ]),
    )
    fireEvent.change(textarea, { target: { value: 'Pregunta 4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

    const bodyLlamada4 = JSON.parse(fetchMock.mock.calls[3][1].body as string)
    const { historial } = bodyLlamada4

    // Historial solo contiene el Turno 1 (usuario + asistente).
    // Ni Pregunta 2 ni Pregunta 3 deben figurar porque sus respuestas fueron excluidas.
    expect(historial).toHaveLength(2)
    expect(historial[0]).toEqual({ rol: 'usuario', texto: 'Pregunta 1' })
    expect(historial[1]).toMatchObject({ rol: 'asistente', citasPrevias: ['v-1'] })

    // No hay dos turnos de usuario seguidos: siempre alternan
    for (let i = 0; i < historial.length - 1; i++) {
      expect(historial[i].rol).not.toEqual(historial[i + 1].rol)
    }
  })

  it('botón Nueva conversación regenera idConversacion y limpia el chat', async () => {
    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Primera respuesta."}\n\n',
        'data: {"tipo":"fin","idConsulta":"c-1","resultado":"respondida"}\n\n',
      ]),
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Primera pregunta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByText('Primera respuesta.')).toBeInTheDocument()
    })

    const primeraPeticion = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const primeraIdConv = primeraPeticion.idConversacion

    // Click en Nueva conversación
    fireEvent.click(screen.getByRole('button', { name: 'Nueva conversación' }))

    expect(screen.queryByText('Primera respuesta.')).not.toBeInTheDocument()
    expect(screen.getByText('¿En qué te puedo ayudar hoy?')).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Segunda respuesta."}\n\n',
        'data: {"tipo":"fin","idConsulta":"c-2","resultado":"respondida"}\n\n',
      ]),
    )

    fireEvent.change(textarea, { target: { value: 'Segunda pregunta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    const segundaPeticion = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    const segundaIdConv = segundaPeticion.idConversacion
    expect(segundaIdConv).not.toEqual(primeraIdConv)
  })

  it('si calificar falla muestra toast con mensajeDeError sin romper el panel', async () => {
    calificarConsultaAyudaActionMock.mockResolvedValueOnce({
      ok: false,
      reason: 'consulta-no-encontrada',
    })

    fetchMock.mockResolvedValueOnce(
      mockStreamResponse([
        'data: {"tipo":"texto","contenido":"Respuesta para calificar"}\n\n',
        'data: {"tipo":"fin","idConsulta":"uuid-fallido","resultado":"respondida"}\n\n',
      ]),
    )

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Pregunta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByText('¿Te sirvió?')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Sí' }))

    await waitFor(() => {
      expect(screen.getByText(mensajeDeError('consulta-no-encontrada'))).toBeInTheDocument()
    })

    // El panel sigue montado y funcional
    expect(screen.getByRole('dialog', { name: 'Ayuda' })).toBeInTheDocument()
  })

  it('error antes del stream: la burbuja desaparece, el texto vuelve al textarea y se ve el error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, reason: 'ayuda-error' }),
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Pregunta que fallará' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(mensajeDeError('ayuda-error'))
    })

    expect(screen.queryByText('Pregunta que fallará', { selector: 'div.bg-block' })).not.toBeInTheDocument()
    expect(textarea).toHaveValue('Pregunta que fallará')
    expect(textarea).toHaveFocus()
  })
})
