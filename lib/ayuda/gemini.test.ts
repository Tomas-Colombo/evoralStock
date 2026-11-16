import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleGenAI } from '@google/genai'
import type { PromptAyuda } from './tipos'

const mockGenerateContentStream = vi.fn()

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn(function () {
      return {
        models: {
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
import { ejecutarGeminiStream, nivelPensamiento } from './gemini'

describe('lib/ayuda/gemini', () => {
  const promptEjemplo: PromptAyuda = {
    instrucciones: 'Instrucciones secretas del sistema: PROMPT_SECRET_INSTRUCTIONS',
    turnos: [
      { rol: 'usuario', texto: 'Hola, primera pregunta: PROMPT_SECRET_USER_1' },
      { rol: 'asistente', texto: 'Respuesta previa: PROMPT_SECRET_MODEL_1' },
      { rol: 'usuario', texto: 'Segunda pregunta: PROMPT_SECRET_USER_2' },
    ],
  }

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

    it('cancelar el ReadableStream invoca return del iterador mockeado para detener upstream', async () => {
      const returnMock = vi.fn().mockResolvedValue({ done: true, value: undefined })

      const iteradorMock = {
        next: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: { text: 'Primer chunk' } })
          .mockResolvedValueOnce({ done: false, value: { text: 'Segundo chunk' } }),
        return: returnMock,
        [Symbol.asyncIterator]() {
          return this
        },
      }

      mockGenerateContentStream.mockResolvedValueOnce(iteradorMock)

      const resultado = await ejecutarGeminiStream({
        apiKey: cfgValida.apiKey,
        modelo: 'gemini-3-flash-preview',
        prompt: promptEjemplo,
        backoffMs: 0,
      })

      const reader = resultado.stream.getReader()
      const primerLectura = await reader.read()
      expect(primerLectura.value).toBe('Primer chunk')

      await reader.cancel('cancelado por cliente')
      expect(returnMock).toHaveBeenCalledTimes(1)
    })

    it('un error sin status cuyo mensaje contiene "5000" no reintenta', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const errorCon5000 = new Error('Invalid prompt: length 5000 exceeds maximum allowed limit')

      mockGenerateContentStream.mockRejectedValueOnce(errorCon5000)

      await expect(
        ejecutarGeminiStream({
          apiKey: cfgValida.apiKey,
          modelo: 'gemini-3-flash-preview',
          modeloFallback: 'gemini-2.5-flash',
          prompt: promptEjemplo,
          backoffMs: 0,
        }),
      ).rejects.toThrow()

      // Debe fallar de inmediato en el intento 1 sin reintentar ni ir al fallback
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)

      spyError.mockRestore()
    })
  })
})
