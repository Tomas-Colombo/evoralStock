import 'server-only'
import { GoogleGenAI, ThinkingLevel, type Schema, type ThinkingConfig } from '@google/genai'
import type { ErrorModelo, ModeloAyuda, PromptAyuda } from './tipos'
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
  apiKey?: string
  status?: number
  nombre?: string
  mensaje?: string
}

function logFallo(tipo: ErrorModelo, params: LogFalloParams): void {
  let mensaje = params.mensaje ?? ''
  if (params.apiKey && params.apiKey.trim().length > 0) {
    mensaje = mensaje.replaceAll(params.apiKey, '[REDACTED]')
  }

  console.error(`ayuda: ${tipo}`, {
    modelo: params.modelo,
    status: params.status,
    nombre: params.nombre ?? 'Error',
    mensaje: mensaje.slice(0, 200),
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
        apiKey: cfg.apiKey,
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
          responseSchema: esquemaSalida(idsPermitidos) as Schema,
          thinkingConfig: nivelPensamiento(cfg.modelo),
          abortSignal: abortController.signal,
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
          apiKey: cfg.apiKey,
          nombre: extraerNombre(err, 'AbortError'),
          mensaje: extraerMensaje(err),
        })
        return { ok: false, error: 'timeout' }
      }

      logFallo('proveedor', {
        modelo: cfg.modelo,
        apiKey: cfg.apiKey,
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
        apiKey: cfg.apiKey,
        nombre: 'FormatoError',
        mensaje: 'La respuesta de Gemini no contiene texto',
      })
      return { ok: false, error: 'formato' }
    }

    try {
      const salida = JSON.parse(rawText) as unknown
      return { ok: true, salida }
    } catch {
      logFallo('formato', {
        modelo: cfg.modelo,
        apiKey: cfg.apiKey,
        nombre: 'SyntaxError',
        mensaje: 'JSON inválido',
      })
      return { ok: false, error: 'formato' }
    }
  }
}

export interface TelemetriaUsoGemini {
  tokensInput?: number
  tokensOutput?: number
  tokensCached?: number
  tokensThinking?: number
}

export interface MetaStreamGemini {
  modelo: string
  usage: TelemetriaUsoGemini
}

export interface StreamGeminiResultado {
  stream: ReadableStream<string>
  getMeta: () => MetaStreamGemini
}

export interface EjecutarGeminiStreamParams {
  apiKey: string
  modelo: string
  modeloFallback?: string
  prompt: PromptAyuda
  signal?: AbortSignal
  backoffMs?: number
}

export class ErrorGeminiStream extends Error {
  readonly status?: number

  constructor(nombre: string, status?: number) {
    super(status !== undefined ? `${nombre} (${status})` : nombre)
    this.name = nombre
    this.status = status
  }
}

function esError429o5xx(err: unknown): boolean {
  const status = extraerStatus(err)
  if (status !== undefined) {
    return status === 429 || (status >= 500 && status < 600)
  }
  const nombre = extraerNombre(err)
  const mensaje = extraerMensaje(err)
  if (
    nombre.includes('429') ||
    nombre.includes('503') ||
    nombre.includes('500') ||
    nombre.includes('502') ||
    nombre.includes('504')
  ) {
    return true
  }
  if (
    mensaje.includes('429') ||
    mensaje.includes('503') ||
    mensaje.includes('500') ||
    mensaje.includes('502') ||
    mensaje.includes('504') ||
    mensaje.includes('Too Many Requests') ||
    mensaje.includes('Service Unavailable')
  ) {
    return true
  }
  return false
}

function sanitizarError(err: unknown, modelo: string): ErrorGeminiStream {
  const status = extraerStatus(err)
  const nombre = extraerNombre(err, 'GeminiStreamError')

  console.error('ayuda: error de stream gemini', {
    modelo,
    status,
    nombre,
  })

  return new ErrorGeminiStream(nombre, status)
}

interface UsoMetadataMinimo {
  promptTokenCount?: number
  candidatesTokenCount?: number
  cachedContentTokenCount?: number
  thoughtsTokenCount?: number
}

interface ChunkStreamGemini {
  text?: string
  usageMetadata?: UsoMetadataMinimo
}

/**
 * REQ-AYUDA-V2-07: Ejecuta la llamada en streaming a Gemini con generateContentStream.
 * - Thinking mínimo según el modelo vía nivelPensamiento.
 * - AbortSignal propagado directamente al SDK.
 * - maxOutputTokens: 1000 (coherente con el CHECK de respuesta <= 5000 chars de la DB).
 * - Ante 429/5xx ANTES del primer chunk: 1 reintento con backoff y luego fallback a GEMINI_MODEL_FALLBACK.
 * - DESPUÉS del primer chunk: sin reintentos ni fallback, el error se propaga al consumidor del stream.
 * - Al finalizar, expone métricas de tokens (input, output, cached, thinking) y el modelo que respondió.
 * - Errores sanitizados conteniendo únicamente status y nombre (sin API keys ni prompts).
 */
export async function ejecutarGeminiStream(
  params: EjecutarGeminiStreamParams,
): Promise<StreamGeminiResultado> {
  if (!params.apiKey || params.apiKey.trim() === '') {
    console.error('ayuda: error de stream gemini', {
      modelo: params.modelo,
      nombre: 'SinClaveError',
    })
    throw new ErrorGeminiStream('SinClaveError')
  }

  const ai = new GoogleGenAI({
    apiKey: params.apiKey,
    httpOptions: {
      timeout: 10_000,
      retryOptions: { attempts: 1 },
    },
  })

  const contents = params.prompt.turnos.map((t) => ({
    role: t.rol === 'usuario' ? 'user' : 'model',
    parts: [{ text: t.texto }],
  }))

  async function abrirStream(modeloActual: string) {
    return await ai.models.generateContentStream({
      model: modeloActual,
      contents,
      config: {
        systemInstruction: params.prompt.instrucciones,
        temperature: 0.2,
        maxOutputTokens: 1000,
        thinkingConfig: nivelPensamiento(modeloActual),
        abortSignal: params.signal,
      },
    })
  }

  async function conectar(modeloActual: string) {
    const stream = await abrirStream(modeloActual)
    const iterador = stream[Symbol.asyncIterator]()
    const primerItem = await iterador.next()
    return { iterador, primerItem }
  }

  let conexion: {
    iterador: AsyncIterator<ChunkStreamGemini>
    primerItem: IteratorResult<ChunkStreamGemini, void>
  }
  let modeloEfectivo = params.modelo

  // Manejo de conexión y obtención del primer chunk con reintento y fallback
  try {
    conexion = await conectar(params.modelo)
  } catch (errInicial) {
    if (!esError429o5xx(errInicial)) {
      throw sanitizarError(errInicial, params.modelo)
    }

    // 1 reintento con backoff antes del primer chunk
    const delayMs = params.backoffMs ?? 500
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    try {
      conexion = await conectar(params.modelo)
    } catch (errReintento) {
      if (
        !esError429o5xx(errReintento) ||
        !params.modeloFallback ||
        params.modeloFallback === params.modelo
      ) {
        throw sanitizarError(errReintento, params.modelo)
      }

      // Fallback a GEMINI_MODEL_FALLBACK si reintento falló con 429/5xx
      try {
        conexion = await conectar(params.modeloFallback)
        modeloEfectivo = params.modeloFallback
      } catch (errFallback) {
        throw sanitizarError(errFallback, params.modeloFallback)
      }
    }
  }

  const usage: TelemetriaUsoGemini = {
    tokensInput: undefined,
    tokensOutput: undefined,
    tokensCached: undefined,
    tokensThinking: undefined,
  }

  function actualizarUsage(meta?: UsoMetadataMinimo) {
    if (!meta) return
    if (typeof meta.promptTokenCount === 'number') {
      usage.tokensInput = meta.promptTokenCount
    }
    if (typeof meta.candidatesTokenCount === 'number') {
      usage.tokensOutput = meta.candidatesTokenCount
    }
    if (typeof meta.cachedContentTokenCount === 'number') {
      usage.tokensCached = meta.cachedContentTokenCount
    }
    if (typeof meta.thoughtsTokenCount === 'number') {
      usage.tokensThinking = meta.thoughtsTokenCount
    }
  }

  if (conexion.primerItem.value?.usageMetadata) {
    actualizarUsage(conexion.primerItem.value.usageMetadata)
  }

  let cancelado = false

  const stream = new ReadableStream<string>({
    start(controller) {
      if (!conexion.primerItem.done) {
        const texto = conexion.primerItem.value?.text
        if (typeof texto === 'string' && texto.length > 0) {
          controller.enqueue(texto)
        }
      } else {
        controller.close()
      }
    },

    async pull(controller) {
      if (cancelado) {
        controller.close()
        return
      }

      if (params.signal?.aborted) {
        controller.error(
          sanitizarError(params.signal.reason ?? new Error('Aborted'), modeloEfectivo),
        )
        return
      }

      try {
        const siguiente = await conexion.iterador.next()
        if (siguiente.done) {
          controller.close()
          return
        }

        if (siguiente.value?.usageMetadata) {
          actualizarUsage(siguiente.value.usageMetadata)
        }

        const texto = siguiente.value?.text
        if (typeof texto === 'string' && texto.length > 0) {
          controller.enqueue(texto)
        }
      } catch (err) {
        // Error DESPUÉS del primer chunk: no se reintenta ni conmuta; sale directo al consumidor
        controller.error(sanitizarError(err, modeloEfectivo))
      }
    },

    cancel() {
      cancelado = true
    },
  })

  return {
    stream,
    getMeta: () => ({
      modelo: modeloEfectivo,
      usage: { ...usage },
    }),
  }
}

export const crearStreamGemini = ejecutarGeminiStream

