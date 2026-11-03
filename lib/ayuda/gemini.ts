import 'server-only'
import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from '@google/genai'
import type { ErrorModelo, ModeloAyuda } from './tipos'
import { esquemaSalida } from './salida'

/**
 * Determina la configuración de pensamiento para el modelo según el SDK fijado (@google/genai 2.32.0).
 *
 * En @google/genai/dist/genai.d.ts:
 * - Líneas 14032–14035: para Gemini 2.5 sólo se optimiza `thinkingBudget` (0 = no thinking, -1 = dynamic).
 *   A partir de Gemini 3.5, `thinking_budget` ya no se soporta y se debe usar `thinking_level`.
 * - Líneas 16189–16203: `ThinkingConfig` define `thinkingBudget?: number` y `thinkingLevel?: ThinkingLevel`.
 *
 * DR-AYUDA-8:
 * - Gemini 3+: `thinkingLevel: ThinkingLevel.MINIMAL`.
 * - Gemini 2.5: `thinkingBudget: 0` (apaga el pensamiento y reduce latencia).
 */
export function nivelPensamiento(modelo: string): ThinkingConfig {
  if (modelo.startsWith('gemini-2.5')) {
    return { thinkingBudget: 0 }
  }
  return { thinkingLevel: ThinkingLevel.MINIMAL }
}

interface LogFalloParams {
  modelo: string
  status?: number
  nombre?: string
  mensaje?: string
}

function logFallo(tipo: ErrorModelo, params: LogFalloParams): void {
  console.error(`ayuda: ${tipo}`, {
    modelo: params.modelo,
    status: params.status,
    nombre: params.nombre ?? 'Error',
    mensaje: (params.mensaje ?? '').slice(0, 200),
  })
}

function extraerStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null) {
    if (typeof (err as { status?: unknown }).status === 'number') {
      return (err as { status: number }).status
    }
    if (typeof (err as { statusCode?: unknown }).statusCode === 'number') {
      return (err as { statusCode: number }).statusCode
    }
  }
  return undefined
}

function extraerNombre(err: unknown, defaultNombre = 'Error'): string {
  if (typeof err === 'object' && err !== null && typeof (err as { name?: unknown }).name === 'string') {
    return (err as { name: string }).name
  }
  return defaultNombre
}

function extraerMensaje(err: unknown): string {
  if (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  if (typeof err === 'string') {
    return err
  }
  return ''
}

/**
 * Crea el adaptador de Gemini que implementa el puerto ModeloAyuda.
 * REQ-AYUDA-08: clasifica fallos en 'sin-clave' | 'timeout' | 'proveedor' | 'formato'.
 */
export function crearModeloGemini(cfg: { apiKey: string; modelo: string }): ModeloAyuda {
  return async (prompt, idsPermitidos) => {
    if (!cfg.apiKey || cfg.apiKey.trim() === '') {
      logFallo('sin-clave', {
        modelo: cfg.modelo,
        nombre: 'SinClaveError',
        mensaje: 'Falta GEMINI_API_KEY',
      })
      return { ok: false, error: 'sin-clave' }
    }

    const ai = new GoogleGenAI({
      apiKey: cfg.apiKey,
      httpOptions: {
        timeout: 10_000,
        retryOptions: { attempts: 1 },
      },
    })

    const contents = prompt.turnos.map((t) => ({
      role: t.rol === 'usuario' ? 'user' : 'model',
      parts: [{ text: t.texto }],
    }))

    const abortController = new AbortController()
    const timeoutId = setTimeout(() => {
      abortController.abort(new DOMException('Request timeout after 10s', 'AbortError'))
    }, 10_000)

    let response
    try {
      response = await ai.models.generateContent({
        model: cfg.modelo,
        contents,
        config: {
          systemInstruction: prompt.instrucciones,
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: esquemaSalida(idsPermitidos) as unknown,
          thinkingConfig: nivelPensamiento(cfg.modelo),
          abortSignal: abortController.signal,
          httpOptions: {
            timeout: 10_000,
            retryOptions: { attempts: 1 },
          },
        },
      })
    } catch (err: unknown) {
      const isTimeout =
        abortController.signal.aborted ||
        extraerNombre(err) === 'AbortError' ||
        extraerNombre(err) === 'RequestTimeoutError' ||
        extraerNombre(err) === 'TimeoutError'

      if (isTimeout) {
        logFallo('timeout', {
          modelo: cfg.modelo,
          nombre: extraerNombre(err, 'AbortError'),
          mensaje: extraerMensaje(err),
        })
        return { ok: false, error: 'timeout' }
      }

      logFallo('proveedor', {
        modelo: cfg.modelo,
        status: extraerStatus(err),
        nombre: extraerNombre(err, 'ApiError'),
        mensaje: extraerMensaje(err),
      })
      return { ok: false, error: 'proveedor' }
    } finally {
      clearTimeout(timeoutId)
    }

    const rawText = response.text
    if (typeof rawText !== 'string') {
      logFallo('formato', {
        modelo: cfg.modelo,
        nombre: 'FormatoError',
        mensaje: 'La respuesta de Gemini no contiene texto',
      })
      return { ok: false, error: 'formato' }
    }

    try {
      const salida = JSON.parse(rawText) as unknown
      return { ok: true, salida }
    } catch (err: unknown) {
      logFallo('formato', {
        modelo: cfg.modelo,
        nombre: extraerNombre(err, 'SyntaxError'),
        mensaje: extraerMensaje(err),
      })
      return { ok: false, error: 'formato' }
    }
  }
}
