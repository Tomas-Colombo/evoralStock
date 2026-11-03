import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PanelAyuda } from './PanelAyuda'
import { ToastProvider } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'

const { consultarAyudaActionMock, calificarConsultaAyudaActionMock } = vi.hoisted(() => ({
  consultarAyudaActionMock: vi.fn(),
  calificarConsultaAyudaActionMock: vi.fn(),
}))

vi.mock('@/app/(app)/ayuda/actions', () => ({
  consultarAyudaAction: consultarAyudaActionMock,
  calificarConsultaAyudaAction: calificarConsultaAyudaActionMock,
}))

function renderPanel() {
  return render(
    <ToastProvider>
      <PanelAyuda />
    </ToastProvider>,
  )
}

describe('PanelAyuda (REQ-AYUDA-12 / §6 UI)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consultarAyudaActionMock.mockResolvedValue({
      ok: true,
      idConsulta: 'uuid-consulta-1',
      resultado: {
        resultado: 'respondida',
        texto: 'Para registrar una venta, andá a Ventas.',
        entrada: {
          id: 'ventas-nueva',
          titulo: 'Nueva venta',
          ruta: '/ventas',
        },
      },
    })
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

  it('N4: dos envíos seguidos con la action pendiente → una sola llamada', async () => {
    let resolverAction: (val: unknown) => void = () => {}
    const promesaPendiente = new Promise((resolve) => {
      resolverAction = resolve
    })
    consultarAyudaActionMock.mockReturnValue(promesaPendiente)

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: '¿Cómo cargo una venta?' } })

    const botonEnviar = screen.getByRole('button', { name: 'Enviar' })

    // Doble click o envío mientras la action está en vuelo
    fireEvent.click(botonEnviar)
    fireEvent.click(botonEnviar)
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(consultarAyudaActionMock).toHaveBeenCalledTimes(1)

    // Al resolver, se procesa la respuesta
    resolverAction({
      ok: true,
      idConsulta: 'uuid-1',
      resultado: {
        resultado: 'respondida',
        texto: 'Pasos para venta.',
        entrada: { id: 'ventas-nueva', titulo: 'Nueva venta' },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Pasos para venta.')).toBeInTheDocument()
    })
  })

  it('turno fallido: la burbuja desaparece, el texto vuelve al textarea y se ve el mensaje de error', async () => {
    consultarAyudaActionMock.mockResolvedValueOnce({
      ok: false,
      reason: 'ayuda-error',
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Pregunta que fallará' } })

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      // Se muestra el error en el panel
      expect(screen.getByRole('alert')).toHaveTextContent(mensajeDeError('ayuda-error'))
    })

    // La burbuja del usuario ya no está en el listado
    expect(screen.queryByText('Pregunta que fallará', { selector: 'div.bg-block' })).not.toBeInTheDocument()

    // El texto volvió al textarea
    expect(textarea).toHaveValue('Pregunta que fallará')
  })

  it('fuera_de_opciones → tarjeta fija sin texto del modelo', async () => {
    consultarAyudaActionMock.mockResolvedValueOnce({
      ok: true,
      idConsulta: 'uuid-2',
      resultado: {
        resultado: 'fuera_de_opciones',
      },
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: '¿Cuál es el sentido de la vida?' } })

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(
        screen.getByText('No tengo esa respuesta. Preguntale al administrador de tu negocio.'),
      ).toBeInTheDocument()
    })
  })

  it('"¿Te sirvió?" llama a calificar con { idConsulta, util }, y no se muestra con idConsulta null', async () => {
    // Caso 1: idConsulta presente
    consultarAyudaActionMock.mockResolvedValueOnce({
      ok: true,
      idConsulta: 'uuid-consulta-42',
      resultado: {
        resultado: 'respondida',
        texto: 'Texto de ayuda con ruta.',
        entrada: {
          id: 'precios-ver',
          titulo: 'Control de precios',
          ruta: '/precios',
        },
      },
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: '¿Dónde veo los precios?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByText('¿Te sirvió?')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Ir a Control de precios' })).toHaveAttribute('href', '/precios')
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

    // Caso 2: idConsulta null → no se muestra "¿Te sirvió?"
    consultarAyudaActionMock.mockResolvedValueOnce({
      ok: true,
      idConsulta: null,
      resultado: {
        resultado: 'respondida',
        texto: 'Otra respuesta sin registro en DB.',
        entrada: {
          id: 'ayuda-uso',
          titulo: 'Uso de la ayuda',
        },
      },
    })

    fireEvent.change(textarea, { target: { value: 'Pregunta sin idConsulta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByText('Otra respuesta sin registro en DB.')).toBeInTheDocument()
    })

    // Solo debe haber un "¿Te sirvió?" (el del primer mensaje)
    const calificarBloques = screen.getAllByText('¿Te sirvió?')
    expect(calificarBloques).toHaveLength(1)
  })

  it('el historial que se envía tiene ≤6 mensajes y textos ≤500', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')

    // Generar más de 6 turnos para probar el recorte
    for (let i = 1; i <= 5; i++) {
      consultarAyudaActionMock.mockResolvedValueOnce({
        ok: true,
        idConsulta: `id-${i}`,
        resultado: {
          resultado: 'respondida',
          texto: `Respuesta ${i}: ${'x'.repeat(600)}`,
          entrada: { id: `entrada-${i}`, titulo: `Titulo ${i}` },
        },
      })

      fireEvent.change(textarea, { target: { value: `Pregunta ${i}: ${'y'.repeat(600)}` } })
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

      await waitFor(() => {
        expect(screen.getByText(new RegExp(`Respuesta ${i}:`))).toBeInTheDocument()
      })
    }

    // Turno 6
    consultarAyudaActionMock.mockResolvedValueOnce({
      ok: true,
      idConsulta: 'id-6',
      resultado: {
        resultado: 'respondida',
        texto: 'Respuesta 6',
        entrada: { id: 'entrada-6', titulo: 'Titulo 6' },
      },
    })

    fireEvent.change(textarea, { target: { value: 'Pregunta 6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(consultarAyudaActionMock).toHaveBeenCalledTimes(6)
    })

    const ultimaLlamada = consultarAyudaActionMock.mock.calls[5][0]
    expect(ultimaLlamada.historial.length).toBeLessThanOrEqual(6)
    for (const msg of ultimaLlamada.historial) {
      expect(msg.texto.length).toBeLessThanOrEqual(500)
    }

    // Solo envía las 4 claves permitidas por consultarAyudaSchema
    expect(Object.keys(ultimaLlamada).sort()).toEqual(
      ['focoId', 'historial', 'idConversacion', 'pregunta'].sort(),
    )
  })

  it('botón Nueva conversación regenera idConversacion y limpia el chat', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Primera pregunta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(screen.getByText('Para registrar una venta, andá a Ventas.')).toBeInTheDocument()
    })

    const primeraLlamadaIdConv = consultarAyudaActionMock.mock.calls[0][0].idConversacion

    // Click en Nueva conversación
    fireEvent.click(screen.getByRole('button', { name: 'Nueva conversación' }))

    expect(screen.queryByText('Para registrar una venta, andá a Ventas.')).not.toBeInTheDocument()
    expect(screen.getByText('¿En qué te puedo ayudar hoy?')).toBeInTheDocument()

    // Nueva pregunta envía un nuevo idConversacion
    fireEvent.change(textarea, { target: { value: 'Segunda pregunta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => {
      expect(consultarAyudaActionMock).toHaveBeenCalledTimes(2)
    })

    const segundaLlamadaIdConv = consultarAyudaActionMock.mock.calls[1][0].idConversacion
    expect(segundaLlamadaIdConv).not.toEqual(primeraLlamadaIdConv)
  })

  it('Shift+Enter no envía la pregunta; Enter sin Shift envía', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))

    const textarea = screen.getByPlaceholderText('¿Qué querés hacer?')
    fireEvent.change(textarea, { target: { value: 'Texto de prueba' } })

    // Shift+Enter no envía
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(consultarAyudaActionMock).not.toHaveBeenCalled()

    // Enter sin Shift envía
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(consultarAyudaActionMock).toHaveBeenCalledTimes(1)
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

  it('si calificar falla muestra toast con mensajeDeError sin romper el panel', async () => {
    calificarConsultaAyudaActionMock.mockResolvedValueOnce({
      ok: false,
      reason: 'consulta-no-encontrada',
    })

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
})
