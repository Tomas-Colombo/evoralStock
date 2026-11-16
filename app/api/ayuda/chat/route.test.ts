import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthorizationError } from '@/lib/dal/errors'
import type { EventoStreamAyuda } from '@/lib/ayuda/tipos'

const {
  verifySessionMock,
  requireModuleRoleMock,
  reservarCuotaAyudaMock,
  registrarConsultaAyudaMock,
  leerConfigAyudaMock,
  ejecutarGeminiStreamMock,
  afterMock,
} = vi.hoisted(() => ({
  verifySessionMock: vi.fn(),
  requireModuleRoleMock: vi.fn(),
  reservarCuotaAyudaMock: vi.fn(),
  registrarConsultaAyudaMock: vi.fn(),
  leerConfigAyudaMock: vi.fn(),
  ejecutarGeminiStreamMock: vi.fn(),
  afterMock: vi.fn((fn: () => unknown) => {
    void fn()
  }),
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: afterMock,
  }
})

vi.mock('@/lib/dal/session', () => ({
  verifySession: verifySessionMock,
}))

vi.mock('@/lib/dal/guard', () => ({
  requireModuleRole: requireModuleRoleMock,
  AuthorizationError,
}))

vi.mock('@/lib/dal/ayuda', () => ({
  reservarCuotaAyuda: reservarCuotaAyudaMock,
  registrarConsultaAyuda: registrarConsultaAyudaMock,
}))

vi.mock('@/lib/ayuda/config', () => ({
  leerConfigAyuda: leerConfigAyudaMock,
}))

vi.mock('@/lib/ayuda/gemini', () => ({
  ejecutarGeminiStream: ejecutarGeminiStreamMock,
}))

const VALID_UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

function crearRequest(body: unknown, headers?: Record<string, string>, signal?: AbortSignal): NextRequest {
  return new NextRequest('http://localhost:3000/api/ayuda/chat', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  })
}

async function leerEventosSSE(res: Response): Promise<EventoStreamAyuda[]> {
  const reader = res.body?.getReader()
  if (!reader) return []
  const decoder = new TextDecoder()
  let buffer = ''
  const eventos: EventoStreamAyuda[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lineas = buffer.split('\n\n')
    buffer = lineas.pop() ?? ''
    for (const linea of lineas) {
      const match = linea.match(/^data: (.*)$/m)
      if (match) {
        eventos.push(JSON.parse(match[1]))
      }
    }
  }

  if (buffer.trim().length > 0) {
    const match = buffer.match(/^data: (.*)$/m)
    if (match) {
      eventos.push(JSON.parse(match[1]))
    }
  }

  return eventos
}

describe('POST /api/ayuda/chat', () => {
  const validBody = {
    idConversacion: VALID_UUID,
    pregunta: '¿Cómo hago una nueva venta con cuotas?',
    historial: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()

    verifySessionMock.mockResolvedValue({
      tenantId: 'tenant-1',
      idRevendedora: null,
      rolId: 'rol-1',
      modulosHabilitados: ['ayuda', 'ventas'],
      permisos: { ayuda: ['consultar'], ventas: ['ver', 'crear'] },
    })

    requireModuleRoleMock.mockResolvedValue(undefined)

    leerConfigAyudaMock.mockReturnValue({
      apiKey: 'test-api-key',
      modelo: 'gemini-model-test',
      modeloFallback: 'gemini-fallback-test',
    })

    reservarCuotaAyudaMock.mockResolvedValue({ ok: true })

    registrarConsultaAyudaMock.mockResolvedValue({ ok: true, id: 'consulta-123' })
  })

  // 1. Compuerta Origin
  describe('Compuerta 1: Origin', () => {
    it('rechaza con 403 origin-invalido si Origin está ausente SIN llamar a verifySession (N1)', async () => {
      const { POST } = await import('./route')
      const req = new NextRequest('http://localhost:3000/api/ayuda/chat', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify(validBody),
      })

      const res = await POST(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'origin-invalido' })
      expect(verifySessionMock).not.toHaveBeenCalled()
    })

    it('rechaza con 403 origin-invalido si Origin no coincide con Host', async () => {
      const { POST } = await import('./route')
      const req = crearRequest(validBody, { origin: 'http://malicious.com' })

      const res = await POST(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'origin-invalido' })
      expect(verifySessionMock).not.toHaveBeenCalled()
    })

    it('acepta Origin coincidente con x-forwarded-host', async () => {
      const { POST } = await import('./route')
      const req = new NextRequest('http://localhost:3000/api/ayuda/chat', {
        method: 'POST',
        headers: {
          origin: 'https://mi-tienda.utopia.com',
          'x-forwarded-host': 'mi-tienda.utopia.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...validBody,
          pregunta: 'pregunta fuera de dominio xysdfksdf',
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
      expect(verifySessionMock).toHaveBeenCalled()
    })
  })

  // 2. Compuerta verifySession
  describe('Compuerta 2: verifySession', () => {
    it('rechaza con 401 no-permission si idRevendedora no es nulo SIN llamar a requireModuleRole', async () => {
      verifySessionMock.mockResolvedValueOnce({
        tenantId: 'tenant-1',
        idRevendedora: 'rev-1',
        rolId: 'rol-rev',
        modulosHabilitados: ['ayuda'],
        permisos: { ayuda: ['consultar'] },
      })

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'no-permission' })
      expect(requireModuleRoleMock).not.toHaveBeenCalled()
    })

    it('rechaza con 401 no-permission si verifySession falla', async () => {
      verifySessionMock.mockRejectedValueOnce(new AuthorizationError('no-session'))

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'no-permission' })
      expect(requireModuleRoleMock).not.toHaveBeenCalled()
    })
  })

  // 3. Compuerta requireModuleRole
  describe('Compuerta 3: requireModuleRole', () => {
    it('rechaza con 403 no-permission si el operador no tiene permiso ayuda.consultar', async () => {
      requireModuleRoleMock.mockRejectedValueOnce(new AuthorizationError('no-permission'))

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('rechaza con 403 module-disabled si el módulo ayuda está deshabilitado', async () => {
      requireModuleRoleMock.mockRejectedValueOnce(new AuthorizationError('module-disabled'))

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'module-disabled' })
    })
  })

  // Config ausente después de compuerta 3
  describe('Configuración ausente (después de compuerta 3)', () => {
    it('devuelve 503 ayuda-no-disponible si leerConfigAyuda retorna null', async () => {
      leerConfigAyudaMock.mockReturnValueOnce(null)

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      expect(res.status).toBe(503)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'ayuda-no-disponible' })
    })
  })

  // 4. Compuerta Zod
  describe('Compuerta 4: Validación Zod (payload-invalido)', () => {
    it('rechaza con 400 payload-invalido si la pregunta está vacía', async () => {
      const { POST } = await import('./route')
      const req = crearRequest({ ...validBody, pregunta: '   ' })

      const res = await POST(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'payload-invalido' })
    })

    it('rechaza con 400 payload-invalido si el JSON es inválido', async () => {
      const { POST } = await import('./route')
      const req = crearRequest('{ "incompleto": ', { 'content-type': 'application/json' })

      const res = await POST(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'payload-invalido' })
    })

    it('rechaza con 400 payload-invalido si hay campos desconocidos', async () => {
      const { POST } = await import('./route')
      const req = crearRequest({ ...validBody, focoId: 'v1-campo' })

      const res = await POST(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'payload-invalido' })
    })
  })

  // 6. Retrieval BM25 y flujo sin_llm
  describe('Compuerta 6: BM25 y flujo sin_llm (sin reserva de cuota)', () => {
    it('corte por score < UMBRAL_MINIMO_BM25 emite sugerencias y fin SIN llamar a reservar cuota', async () => {
      const { POST } = await import('./route')
      const req = crearRequest({
        ...validBody,
        pregunta: 'receta para preparar café con leche en casa',
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')

      const eventos = await leerEventosSSE(res)

      expect(reservarCuotaAyudaMock).not.toHaveBeenCalled()
      expect(ejecutarGeminiStreamMock).not.toHaveBeenCalled()

      expect(eventos).toHaveLength(2)
      expect(eventos[0].tipo).toBe('sugerencias')
      expect((eventos[0] as { tipo: 'sugerencias'; entradas: unknown[] }).entradas.length).toBeLessThanOrEqual(3)

      expect(eventos[1]).toEqual({
        tipo: 'fin',
        idConsulta: 'consulta-123',
        resultado: 'sin_llm',
      })

      expect(registrarConsultaAyudaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          idConversacion: VALID_UUID,
          resultado: 'sin_llm',
          entradasCitadas: [],
          respuesta: null,
        }),
      )
    })
  })

  // 7. Reserva de cuota
  describe('Compuerta 7: Reserva de cuota (cuota-excedida)', () => {
    it('devuelve 429 cuota-excedida si reservarCuotaAyuda falla', async () => {
      reservarCuotaAyudaMock.mockResolvedValueOnce({ ok: false, reason: 'cuota-excedida' })

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      expect(res.status).toBe(429)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'cuota-excedida' })
      expect(ejecutarGeminiStreamMock).not.toHaveBeenCalled()
    })
  })

  // 8. Gemini falla antes del primer chunk
  describe('Gemini falla antes del primer chunk', () => {
    it('devuelve 502 ayuda-error si ejecutarGeminiStream lanza excepción', async () => {
      ejecutarGeminiStreamMock.mockRejectedValueOnce(new Error('Provider 500'))

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      expect(res.status).toBe(502)
      const data = await res.json()
      expect(data).toEqual({ ok: false, reason: 'ayuda-error' })
    })
  })

  // 9. Flujo feliz con LLM
  describe('Flujo feliz con LLM', () => {
    it('emite texto, link y fin con idConsulta y resultado respondida', async () => {
      const mockStream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('Para crear una venta andá a ')
          controller.enqueue('[[ventas-registrar-venta]]')
          controller.enqueue(' y cargá los productos.')
          controller.close()
        },
      })

      ejecutarGeminiStreamMock.mockResolvedValueOnce({
        stream: mockStream,
        getMeta: () => ({
          modelo: 'gemini-model-test',
          usage: {
            tokensInput: 120,
            tokensOutput: 45,
            tokensCached: 0,
            tokensThinking: 0,
          },
        }),
      })

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')

      const eventos = await leerEventosSSE(res)

      expect(reservarCuotaAyudaMock).toHaveBeenCalledTimes(1)
      expect(registrarConsultaAyudaMock).toHaveBeenCalledTimes(1)

      const eventosTexto = eventos.filter((e) => e.tipo === 'texto')
      const eventosLink = eventos.filter((e) => e.tipo === 'link')
      const eventoFin = eventos.find((e) => e.tipo === 'fin')

      expect(eventosTexto.length).toBeGreaterThan(0)
      expect(eventosLink).toHaveLength(1)
      expect(eventosLink[0]).toEqual({
        tipo: 'link',
        id: 'ventas-registrar-venta',
        titulo: 'Cómo registrar una venta',
        ruta: '/ventas/nueva',
      })

      expect(eventoFin).toEqual({
        tipo: 'fin',
        idConsulta: 'consulta-123',
        resultado: 'respondida',
      })

      expect(registrarConsultaAyudaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          idConversacion: VALID_UUID,
          resultado: 'respondida',
          entradasCitadas: ['ventas-registrar-venta'],
          respuesta: 'Para crear una venta andá a Cómo registrar una venta y cargá los productos.',
          modelo: 'gemini-model-test',
          tokensInput: 120,
          tokensOutput: 45,
        }),
      )
    })

    it('emite resultado sin_cita si el modelo no incluye citas válidas a la guía', async () => {
      const mockStream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('Esta es una respuesta general explicativa sin citar pantallas.')
          controller.close()
        },
      })

      ejecutarGeminiStreamMock.mockResolvedValueOnce({
        stream: mockStream,
        getMeta: () => ({
          modelo: 'gemini-model-test',
          usage: { tokensInput: 100, tokensOutput: 30 },
        }),
      })

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      const eventos = await leerEventosSSE(res)

      const eventoFin = eventos.find((e) => e.tipo === 'fin')
      expect(eventoFin).toEqual({
        tipo: 'fin',
        idConsulta: 'consulta-123',
        resultado: 'sin_cita',
      })

      expect(registrarConsultaAyudaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          resultado: 'sin_cita',
          entradasCitadas: [],
        }),
      )
    })
  })

  // 10. Deduplicación de citas y recorte a 5000
  describe('Dedupe de citas y recorte a 5000', () => {
    it('deduplica citas por primera aparición con tope 6 y recorta texto a 5000', async () => {
      const longText = 'x'.repeat(6000)
      const mockStream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('[[ventas-registrar-venta]]')
          controller.enqueue('[[ventas-registrar-venta]]')
          controller.enqueue('[[ventas-clientes-crear]]')
          controller.enqueue(longText)
          controller.close()
        },
      })

      ejecutarGeminiStreamMock.mockResolvedValueOnce({
        stream: mockStream,
        getMeta: () => ({
          modelo: 'gemini-model-test',
          usage: {},
        }),
      })

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      await leerEventosSSE(res)

      expect(registrarConsultaAyudaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          entradasCitadas: ['ventas-registrar-venta', 'ventas-clientes-crear'],
          respuesta: expect.any(String),
        }),
      )

      const callArgs = registrarConsultaAyudaMock.mock.calls[0][0]
      expect(callArgs.respuesta.length).toBe(5000)
    })
  })

  // 11. Error a mitad de stream
  describe('Error a mitad de stream', () => {
    it('emite evento de error, no emite fin, y registra en after() con tipoError stream', async () => {
      const mockStream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('Inicio de la respuesta...')
          controller.error(new Error('Connection broken mid-stream'))
        },
      })

      ejecutarGeminiStreamMock.mockResolvedValueOnce({
        stream: mockStream,
        getMeta: () => ({
          modelo: 'gemini-model-test',
          usage: { tokensInput: 80, tokensOutput: 10 },
        }),
      })

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      const eventos = await leerEventosSSE(res)

      const eventoError = eventos.find((e) => e.tipo === 'error')
      const eventoFin = eventos.find((e) => e.tipo === 'fin')

      expect(eventoError).toEqual({
        tipo: 'error',
        reason: 'ayuda-error',
      })
      expect(eventoFin).toBeUndefined()

      expect(registrarConsultaAyudaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          resultado: 'error',
          tipoError: 'stream',
          modelo: 'gemini-model-test',
        }),
      )
    })
  })

  // 12. Registro fallido (fail-open)
  describe('Registro fallido (fail-open)', () => {
    it('loguea console.error y emite fin con idConsulta null si registrarConsultaAyuda falla', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      registrarConsultaAyudaMock.mockResolvedValueOnce({ ok: false, reason: 'error-db' })

      const mockStream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('Respuesta completada.')
          controller.close()
        },
      })

      ejecutarGeminiStreamMock.mockResolvedValueOnce({
        stream: mockStream,
        getMeta: () => ({
          modelo: 'gemini-model-test',
          usage: {},
        }),
      })

      const { POST } = await import('./route')
      const req = crearRequest(validBody)

      const res = await POST(req)
      const eventos = await leerEventosSSE(res)

      expect(spyError).toHaveBeenCalledWith('ayuda: error al registrar consulta')
      const eventoFin = eventos.find((e) => e.tipo === 'fin')
      expect(eventoFin).toEqual({
        tipo: 'fin',
        idConsulta: null,
        resultado: 'sin_cita',
      })

      spyError.mockRestore()
    })
  })

  // 13. Cancelación
  describe('Cancelación por cliente', () => {
    it('registra en after() con tipoError cancelado si el cliente aborta la señal', async () => {
      const abortController = new AbortController()

      const mockStream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('Inicio...')
          abortController.abort()
          controller.error(new Error('Aborted'))
        },
      })

      ejecutarGeminiStreamMock.mockResolvedValueOnce({
        stream: mockStream,
        getMeta: () => ({
          modelo: 'gemini-model-test',
          usage: {},
        }),
      })

      const { POST } = await import('./route')
      const req = crearRequest(validBody, {}, abortController.signal)

      const res = await POST(req)
      await leerEventosSSE(res)

      expect(registrarConsultaAyudaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          resultado: 'error',
          tipoError: 'cancelado',
        }),
      )
    })
  })
})
