import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleGenAI } from '@google/genai'
import type { PromptAyuda } from './tipos'

const mockGenerateContent = vi.fn()
const mockGenerateContentStream = vi.fn()

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn(function () {
      return {
        models: {
          generateContent: mockGenerateContent,
          generateContentStream: mockGenerateContentStream,
        },
      }
    }),
    ThinkingLevel: {
      MINIMAL: 'MINIMAL',
      LOW: 'LOW',
      MEDIUM: 'MEDIUM',
      HIGH: 'HIGH',
    },
  }
})

// Importamos gemini después del mock
import { crearModeloGemini, ejecutarGeminiStream, nivelPensamiento } from './gemini'

describe('lib/ayuda/gemini', () => {
  const promptEjemplo: PromptAyuda = {
    instrucciones: 'Instrucciones secretas del sistema: PROMPT_SECRET_INSTRUCTIONS',
    turnos: [
      { rol: 'usuario', texto: 'Hola, primera pregunta: PROMPT_SECRET_USER_1' },
      { rol: 'asistente', texto: 'Respuesta previa: PROMPT_SECRET_MODEL_1' },
      { rol: 'usuario', texto: 'Segunda pregunta: PROMPT_SECRET_USER_2' },
    ],
  }

  const idsPermitidos: readonly [string, ...string[]] = ['ventas-nueva', 'gastos-nuevo']
  const cfgValida = {
    apiKey: 'clave-gemini-super-secreta',
    modelo: 'gemini-3-flash-preview',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('nivelPensamiento', () => {
    it('devuelve thinkingLevel: MINIMAL para Gemini 3+ (DR-AYUDA-8)', () => {
      expect(nivelPensamiento('gemini-3-flash-preview')).toEqual({
        thinkingLevel: 'MINIMAL',
      })
      expect(nivelPensamiento('gemini-3.5-flash')).toEqual({
        thinkingLevel: 'MINIMAL',
      })
    })

    it('devuelve thinkingBudget: 0 para gemini-2.5-* según los tipos del SDK (DR-AYUDA-8)', () => {
      expect(nivelPensamiento('gemini-2.5-flash')).toEqual({
        thinkingBudget: 0,
      })
      expect(nivelPensamiento('gemini-2.5-pro')).toEqual({
        thinkingBudget: 0,
      })
    })
  })

  describe('crearModeloGemini — caso feliz', () => {
    it('llama a generateContent con la configuración correcta y devuelve JSON parseado', async () => {
      const modelo = crearModeloGemini(cfgValida)
      const mockSalida = {
        respuesta: 'Podés cargar una venta en la sección ventas',
        entradaId: 'ventas-nueva',
      }

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockSalida),
      })

      const resultado = await modelo(promptEjemplo, idsPermitidos)

      expect(resultado).toEqual({
        ok: true,
        salida: mockSalida,
      })

      expect(GoogleGenAI).toHaveBeenCalledWith({
        apiKey: 'clave-gemini-super-secreta',
        httpOptions: {
          timeout: 10_000,
          retryOptions: { attempts: 1 },
        },
      })

      expect(mockGenerateContent).toHaveBeenCalledTimes(1)
      const callArgs = mockGenerateContent.mock.calls[0][0]
      expect(callArgs.model).toBe('gemini-3-flash-preview')
      expect(callArgs.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hola, primera pregunta: PROMPT_SECRET_USER_1' }] },
        { role: 'model', parts: [{ text: 'Respuesta previa: PROMPT_SECRET_MODEL_1' }] },
        { role: 'user', parts: [{ text: 'Segunda pregunta: PROMPT_SECRET_USER_2' }] },
      ])
      expect(callArgs.config.systemInstruction).toBe(promptEjemplo.instrucciones)
      expect(callArgs.config.temperature).toBe(0.2)
      expect(callArgs.config.responseMimeType).toBe('application/json')
      expect(callArgs.config.responseSchema).toBeDefined()
      expect(callArgs.config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' })
      expect(callArgs.config.abortSignal).toBeDefined()
      // Solo el cliente tiene httpOptions, no generateContent config
      expect(callArgs.config.httpOptions).toBeUndefined()
    })
  })

  describe('REQ-AYUDA-08 — Errores tipados y log mínimo', () => {
    it('Feliz: 503 del proveedor → error "proveedor", log con status: 503', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const modelo = crearModeloGemini(cfgValida)

      const error503 = Object.assign(new Error('Service Unavailable'), {
        name: 'ApiError',
        status: 503,
      })
      mockGenerateContent.mockRejectedValueOnce(error503)

      const resultado = await modelo(promptEjemplo, idsPermitidos)

      expect(resultado).toEqual({
        ok: false,
        error: 'proveedor',
      })

      expect(spyError).toHaveBeenCalledWith(
        'ayuda: proveedor',
        expect.objectContaining({
          modelo: 'gemini-3-flash-preview',
          status: 503,
          nombre: 'ApiError',
          mensaje: 'Service Unavailable',
        }),
      )

      spyError.mockRestore()
    })

    it('N1: abort por timeout → error "timeout"', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const modelo = crearModeloGemini(cfgValida)

      const errorAbort = new DOMException('The operation was aborted', 'AbortError')
      mockGenerateContent.mockRejectedValueOnce(errorAbort)

      const resultado = await modelo(promptEjemplo, idsPermitidos)

      expect(resultado).toEqual({
        ok: false,
        error: 'timeout',
      })

      expect(spyError).toHaveBeenCalledWith(
        'ayuda: timeout',
        expect.objectContaining({
          modelo: 'gemini-3-flash-preview',
          nombre: 'AbortError',
        }),
      )

      spyError.mockRestore()
    })

    it('N2: sin GEMINI_API_KEY → error "sin-clave" sin llamar a la red', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const modelo = crearModeloGemini({ apiKey: '', modelo: 'gemini-3-flash-preview' })

      const resultado = await modelo(promptEjemplo, idsPermitidos)

      expect(resultado).toEqual({
        ok: false,
        error: 'sin-clave',
      })

      expect(mockGenerateContent).not.toHaveBeenCalled()
      expect(spyError).toHaveBeenCalledWith(
        'ayuda: sin-clave',
        expect.objectContaining({
          modelo: 'gemini-3-flash-preview',
          nombre: 'SinClaveError',
        }),
      )

      spyError.mockRestore()
    })

    it('JSON inválido ("Hola, para cargar un gasto") devuelve error "formato" y nunca loguea el texto del modelo', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const modelo = crearModeloGemini(cfgValida)

      mockGenerateContent.mockResolvedValueOnce({
        text: 'Hola, para cargar un gasto',
      })

      const resultado = await modelo(promptEjemplo, idsPermitidos)

      expect(resultado).toEqual({
        ok: false,
        error: 'formato',
      })

      expect(spyError).toHaveBeenCalledWith(
        'ayuda: formato',
        expect.objectContaining({
          modelo: 'gemini-3-flash-preview',
          nombre: 'SyntaxError',
          mensaje: 'JSON inválido',
        }),
      )

      for (const callArgs of spyError.mock.calls) {
        for (const arg of callArgs) {
          const serializado = typeof arg === 'string' ? arg : JSON.stringify(arg)
          expect(serializado).not.toContain('Hola')
          expect(serializado).not.toContain('gasto')
        }
      }

      spyError.mockRestore()
    })

    it('N3: spy de console.error no recibe ningún argumento instanceof Error ni el texto del prompt ni la clave a través de los caminos proveedor, timeout y formato', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const modelo = crearModeloGemini(cfgValida)

      // 1. Camino proveedor (503 con mensaje de error)
      mockGenerateContent.mockRejectedValueOnce(
        Object.assign(new Error('503 Service Unavailable with clave-gemini-super-secreta leak attempt'), {
          status: 503,
        }),
      )
      await modelo(promptEjemplo, idsPermitidos)

      // 2. Camino timeout
      mockGenerateContent.mockRejectedValueOnce(new DOMException('Timed out', 'AbortError'))
      await modelo(promptEjemplo, idsPermitidos)

      // 3. Camino formato (JSON inválido con respuesta de texto)
      mockGenerateContent.mockResolvedValueOnce({
        text: 'Hola, para cargar un gasto: RESPUESTA_DEL_MODELO_A_IGNORAR',
      })
      await modelo(promptEjemplo, idsPermitidos)

      // 4. Camino formato (texto undefined)
      mockGenerateContent.mockResolvedValueOnce({
        text: undefined,
      })
      await modelo(promptEjemplo, idsPermitidos)

      // Verificamos todas las llamadas generadas
      expect(spyError.mock.calls.length).toBeGreaterThanOrEqual(4)

      for (const callArgs of spyError.mock.calls) {
        for (const arg of callArgs) {
          // Ningún argumento puede ser instanceof Error
          expect(arg instanceof Error).toBe(false)

          // Ningún argumento puede contener el prompt
          const serializado = typeof arg === 'string' ? arg : JSON.stringify(arg)
          expect(serializado).not.toContain('PROMPT_SECRET_INSTRUCTIONS')
          expect(serializado).not.toContain('PROMPT_SECRET_USER_1')
          expect(serializado).not.toContain('PROMPT_SECRET_MODEL_1')
          expect(serializado).not.toContain('PROMPT_SECRET_USER_2')

          // Tampoco debe exponerse la clave de API
          expect(serializado).not.toContain('clave-gemini-super-secreta')

          // Tampoco la respuesta del modelo
          expect(serializado).not.toContain('RESPUESTA_DEL_MODELO_A_IGNORAR')
        }
      }

      spyError.mockRestore()
    })

    it('respuesta con text undefined devuelve error "formato"', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const modelo = crearModeloGemini(cfgValida)

      mockGenerateContent.mockResolvedValueOnce({
        text: undefined,
      })

      const resultado = await modelo(promptEjemplo, idsPermitidos)

      expect(resultado).toEqual({
        ok: false,
        error: 'formato',
      })

      expect(spyError).toHaveBeenCalledWith(
        'ayuda: formato',
        expect.objectContaining({
          modelo: 'gemini-3-flash-preview',
          nombre: 'FormatoError',
        }),
      )

      spyError.mockRestore()
    })
  })

  describe('ejecutarGeminiStream (REQ-AYUDA-V2-07)', () => {
    async function* simularStreamChunks(
      items: Array<{ text?: string; usageMetadata?: Record<string, unknown> }>,
    ) {
      for (const item of items) {
        yield item
      }
    }

    async function* simularStreamConError(
      itemsPrevios: Array<{ text?: string; usageMetadata?: Record<string, unknown> }>,
      error: unknown,
    ) {
      for (const item of itemsPrevios) {
        yield item
      }
      throw error
    }

    async function consumirStream(stream: ReadableStream<string>): Promise<string[]> {
      const chunks: string[] = []
      const reader = stream.getReader()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      return chunks
    }

    it('REQ-AYUDA-V2-07 Feliz: llamada exitosa genera stream directo, propaga signal, maxOutputTokens 1000 y thinkingConfig', async () => {
      const controller = new AbortController()

      mockGenerateContentStream.mockResolvedValueOnce(
        simularStreamChunks([
          { text: 'Podés registrar la operación desde ' },
          {
            text: '[[venta-nueva]] en pocos pasos.',
            usageMetadata: {
              promptTokenCount: 150,
              candidatesTokenCount: 45,
              cachedContentTokenCount: 100,
              thoughtsTokenCount: 15,
            },
          },
        ]),
      )

      const resultado = await ejecutarGeminiStream({
        apiKey: cfgValida.apiKey,
        modelo: 'gemini-3-flash-preview',
        prompt: promptEjemplo,
        signal: controller.signal,
        backoffMs: 0,
      })

      expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)
      const callArgs = mockGenerateContentStream.mock.calls[0][0]
      expect(callArgs.model).toBe('gemini-3-flash-preview')
      expect(callArgs.config.maxOutputTokens).toBe(1000)
      expect(callArgs.config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' })
      expect(callArgs.config.abortSignal).toBe(controller.signal)
      expect(callArgs.config.systemInstruction).toBe(promptEjemplo.instrucciones)
      expect(callArgs.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hola, primera pregunta: PROMPT_SECRET_USER_1' }] },
        { role: 'model', parts: [{ text: 'Respuesta previa: PROMPT_SECRET_MODEL_1' }] },
        { role: 'user', parts: [{ text: 'Segunda pregunta: PROMPT_SECRET_USER_2' }] },
      ])

      const chunks = await consumirStream(resultado.stream)
      expect(chunks).toEqual([
        'Podés registrar la operación desde ',
        '[[venta-nueva]] en pocos pasos.',
      ])

      const meta = resultado.getMeta()
      expect(meta).toEqual({
        modelo: 'gemini-3-flash-preview',
        usage: {
          tokensInput: 150,
          tokensOutput: 45,
          tokensCached: 100,
          tokensThinking: 15,
        },
      })
    })

    it('REQ-AYUDA-V2-07 N1: error 503 antes del primer byte → 1 reintento con backoff y luego fallback a GEMINI_MODEL_FALLBACK', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})

      const error503 = Object.assign(new Error('Service Unavailable'), { status: 503 })

      // Intento 1: falla 503 en llamada directa
      mockGenerateContentStream.mockRejectedValueOnce(error503)

      // Intento 2 (reintento del principal): falla 503 en primer chunk del stream
      mockGenerateContentStream.mockResolvedValueOnce(simularStreamConError([], error503))

      // Intento 3 (fallback a GEMINI_MODEL_FALLBACK): exitoso
      mockGenerateContentStream.mockResolvedValueOnce(
        simularStreamChunks([
          {
            text: 'Respuesta desde modelo fallback [[gastos-nuevo]]',
            usageMetadata: {
              promptTokenCount: 120,
              candidatesTokenCount: 30,
              cachedContentTokenCount: 0,
              thoughtsTokenCount: 0,
            },
          },
        ]),
      )

      const resultado = await ejecutarGeminiStream({
        apiKey: cfgValida.apiKey,
        modelo: 'gemini-3-flash-preview',
        modeloFallback: 'gemini-2.5-flash',
        prompt: promptEjemplo,
        backoffMs: 0,
      })

      expect(mockGenerateContentStream).toHaveBeenCalledTimes(3)
      expect(mockGenerateContentStream.mock.calls[0][0].model).toBe('gemini-3-flash-preview')
      expect(mockGenerateContentStream.mock.calls[1][0].model).toBe('gemini-3-flash-preview')
      expect(mockGenerateContentStream.mock.calls[2][0].model).toBe('gemini-2.5-flash')

      const chunks = await consumirStream(resultado.stream)
      expect(chunks).toEqual(['Respuesta desde modelo fallback [[gastos-nuevo]]'])

      const meta = resultado.getMeta()
      expect(meta.modelo).toBe('gemini-2.5-flash')
      expect(meta.usage.tokensInput).toBe(120)

      spyError.mockRestore()
    })

    it('REQ-AYUDA-V2-07 N1 variante: error 429 antes del primer byte se recupera en el reintento sin ir a fallback', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const error429 = Object.assign(new Error('Too Many Requests'), { status: 429 })

      // Intento 1: falla 429
      mockGenerateContentStream.mockRejectedValueOnce(error429)

      // Intento 2: reintento exitoso
      mockGenerateContentStream.mockResolvedValueOnce(
        simularStreamChunks([{ text: 'Recuperado en el reintento' }]),
      )

      const resultado = await ejecutarGeminiStream({
        apiKey: cfgValida.apiKey,
        modelo: 'gemini-3-flash-preview',
        modeloFallback: 'gemini-2.5-flash',
        prompt: promptEjemplo,
        backoffMs: 0,
      })

      expect(mockGenerateContentStream).toHaveBeenCalledTimes(2)
      expect(mockGenerateContentStream.mock.calls[0][0].model).toBe('gemini-3-flash-preview')
      expect(mockGenerateContentStream.mock.calls[1][0].model).toBe('gemini-3-flash-preview')

      const chunks = await consumirStream(resultado.stream)
      expect(chunks).toEqual(['Recuperado en el reintento'])
      expect(resultado.getMeta().modelo).toBe('gemini-3-flash-preview')

      spyError.mockRestore()
    })

    it('REQ-AYUDA-V2-07 N2: fallo a mitad del streaming (después del primer byte) → sin reintento ni fallback; sale al consumidor', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const error500 = Object.assign(new Error('Internal Server Error mid-stream'), { status: 500 })

      mockGenerateContentStream.mockResolvedValueOnce(
        simularStreamConError(
          [{ text: 'Primer chunk exitoso antes del error.' }],
          error500,
        ),
      )

      const resultado = await ejecutarGeminiStream({
        apiKey: cfgValida.apiKey,
        modelo: 'gemini-3-flash-preview',
        modeloFallback: 'gemini-2.5-flash',
        prompt: promptEjemplo,
        backoffMs: 0,
      })

      // mockGenerateContentStream se llamó exactamente 1 vez (sin reintentos)
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)

      const reader = resultado.stream.getReader()
      const primerLectura = await reader.read()
      expect(primerLectura.value).toBe('Primer chunk exitoso antes del error.')
      expect(primerLectura.done).toBe(false)

      // La siguiente lectura debe rechazar con el error sanitizado sin reintentos posteriores
      await expect(reader.read()).rejects.toThrow()
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)

      spyError.mockRestore()
    })

    it('errores sanitizados solo contienen status o error.name y nunca exponen la API key', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const errorConApiKey = Object.assign(
        new Error(`Failed with key ${cfgValida.apiKey}`),
        { status: 401, name: 'GoogleApiAuthError' },
      )

      mockGenerateContentStream.mockRejectedValueOnce(errorConApiKey)

      let capturado: unknown
      try {
        await ejecutarGeminiStream({
          apiKey: cfgValida.apiKey,
          modelo: 'gemini-3-flash-preview',
          prompt: promptEjemplo,
          backoffMs: 0,
        })
      } catch (err) {
        capturado = err
      }

      expect(capturado).toBeDefined()
      expect((capturado as { name: string }).name).toBe('GoogleApiAuthError')
      expect((capturado as { status: number }).status).toBe(401)
      expect((capturado as Error).message).not.toContain(cfgValida.apiKey)

      for (const callArgs of spyError.mock.calls) {
        const serializado = JSON.stringify(callArgs)
        expect(serializado).not.toContain(cfgValida.apiKey)
      }

      spyError.mockRestore()
    })
  })
})
