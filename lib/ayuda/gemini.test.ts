import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptAyuda } from './tipos'

const mockGenerateContent = vi.fn()

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn(function () {
      return {
        models: {
          generateContent: mockGenerateContent,
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
import { crearModeloGemini, nivelPensamiento } from './gemini'

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
      expect(callArgs.config.httpOptions).toEqual({
        timeout: 10_000,
        retryOptions: { attempts: 1 },
      })
      expect(callArgs.config.abortSignal).toBeDefined()
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

    it('N3: spy de console.error no recibe ningún argumento instanceof Error ni el texto del prompt ni la clave', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const modelo = crearModeloGemini(cfgValida)

      // Provocamos un fallo con mensaje que podría contener datos
      const errorConMensajeLargo = new Error('Error de red al procesar la petición con clave expuesta')
      mockGenerateContent.mockRejectedValueOnce(errorConMensajeLargo)

      await modelo(promptEjemplo, idsPermitidos)

      expect(spyError).toHaveBeenCalled()

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
        }
      }

      spyError.mockRestore()
    })

    it('JSON inválido o respuesta sin texto devuelve error "formato"', async () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const modelo = crearModeloGemini(cfgValida)

      mockGenerateContent.mockResolvedValueOnce({
        text: 'ESTO NO ES UN JSON',
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
        }),
      )

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
})
