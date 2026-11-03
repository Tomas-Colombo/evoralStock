/**
 * Medición de latencia de modelos de Gemini con @google/genai.
 *
 * Uso:
 *   node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts <modelo1> [modelo2...]
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai'

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) {
  console.error('Falta GEMINI_API_KEY. Corré el script con --env-file=.env.local')
  process.exit(1)
}

const modelos = process.argv.slice(2)
if (modelos.length === 0) {
  console.error(
    'Uso: node --env-file=.env.local --experimental-strip-types scripts/ayuda-latencia.mts <modelo1> [modelo2...]',
  )
  process.exit(1)
}

function extraerError(err: unknown): {
  nombre: string
  status?: number
  esTimeout: boolean
} {
  if (err && typeof err === 'object') {
    const e = err as {
      name?: unknown
      status?: unknown
      code?: unknown
      cause?: unknown
    }
    const nombre = typeof e.name === 'string' ? e.name : 'Error'
    let status: number | undefined =
      typeof e.status === 'number' ? e.status : undefined

    if (status === undefined && e.cause && typeof e.cause === 'object') {
      const c = e.cause as { status?: unknown }
      if (typeof c.status === 'number') {
        status = c.status
      }
    }

    const esTimeout =
      nombre === 'TimeoutError' ||
      nombre === 'AbortError' ||
      nombre === 'RequestTimeoutError' ||
      e.code === 'ETIMEDOUT'

    return { nombre, status, esTimeout }
  }
  return { nombre: 'Error', esTimeout: false }
}

const ai = new GoogleGenAI({ apiKey })

for (const modelo of modelos) {
  const thinkingLevel = modelo.startsWith('gemini-2.5')
    ? ThinkingLevel.LOW
    : ThinkingLevel.MINIMAL
  const duraciones: number[] = []
  let statusTexto = 'ok'
  let fallo = false

  for (let i = 0; i < 3; i++) {
    const inicio = performance.now()
    try {
      await ai.models.generateContent({
        model: modelo,
        contents: 'hola',
        config: {
          thinkingConfig: {
            thinkingLevel,
          },
          httpOptions: {
            timeout: 30_000,
          },
          abortSignal: AbortSignal.timeout(30_000),
        },
      })
      const duracion = Math.round(performance.now() - inicio)
      duraciones.push(duracion)
    } catch (err: unknown) {
      fallo = true
      const { nombre, status, esTimeout } = extraerError(err)
      statusTexto = esTimeout
        ? 'timeout'
        : status !== undefined
          ? `HTTP ${status}`
          : nombre
      break
    }
  }

  if (fallo) {
    console.log(`${modelo} | ${statusTexto} | - | -`)
  } else {
    duraciones.sort((a, b) => a - b)
    const p50 = duraciones[1]
    const max = duraciones[2]
    console.log(`${modelo} | ${statusTexto} | ${p50} ms | ${max} ms`)
  }
}
