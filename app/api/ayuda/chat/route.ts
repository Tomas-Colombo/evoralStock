import { after, NextResponse, type NextRequest } from 'next/server'
import { ejecutarCompuertas } from './compuertas'
import { armarPromptV2 } from '@/lib/ayuda/prompt'
import { ejecutarGeminiStream, type StreamGeminiResultado } from '@/lib/ayuda/gemini'
import { TransformStreamAyuda } from '@/lib/ayuda/stream'
import { filtrarGuia } from '@/lib/ayuda/filtrar'
import { GUIA } from '@/lib/ayuda/guia'
import { registrarConsultaAyuda } from '@/lib/dal/ayuda'
import type { EventoStreamAyuda } from '@/lib/ayuda/tipos'

export const maxDuration = 30

export function deduplicarEntradasCitadas(ids: readonly string[]): string[] {
  const vistas = new Set<string>()
  const res: string[] = []
  for (const id of ids) {
    if (!vistas.has(id)) {
      vistas.add(id)
      res.push(id)
      if (res.length === 6) {
        break
      }
    }
  }
  return res
}

function programarEnAfter(tarea: () => Promise<void>) {
  try {
    after(tarea)
  } catch {
    void tarea()
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const inicio = Date.now()

  const compuerta = await ejecutarCompuertas(req)
  if (!compuerta.ok) {
    return NextResponse.json(
      { ok: false, reason: compuerta.reason },
      { status: compuerta.status },
    )
  }

  const encoder = new TextEncoder()

  // Flujo sin LLM: sugerencias (top 3) -> registro en DB -> fin
  if (compuerta.modo === 'sin_llm') {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const eventoSugerencias: EventoStreamAyuda = {
          tipo: 'sugerencias',
          entradas: compuerta.sugerencias,
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventoSugerencias)}\n\n`))

        let idConsulta: string | null = null
        try {
          const regRes = await registrarConsultaAyuda({
            idConversacion: compuerta.idConversacion,
            pregunta: compuerta.pregunta,
            respuesta: null,
            entradasCitadas: [],
            resultado: 'sin_llm',
            latenciaMs: Date.now() - inicio,
          })
          if (regRes.ok) {
            idConsulta = regRes.id
          } else {
            console.error('ayuda: error al registrar consulta')
          }
        } catch {
          console.error('ayuda: error al registrar consulta')
        }

        const eventoFin: EventoStreamAyuda = {
          tipo: 'fin',
          idConsulta,
          resultado: 'sin_llm',
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventoFin)}\n\n`))
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  }

  // Flujo con LLM
  const { idConversacion, pregunta, config, topEntradas, historial, permisos } = compuerta

  const prompt = armarPromptV2({
    entradas: topEntradas,
    historial,
    pregunta,
  })

  let geminiRes: StreamGeminiResultado | undefined
  let textoAcumulado = ''
  let completado = false

  function registrarFallo(tipoError: 'cancelado' | 'stream' | 'proveedor') {
    const meta = geminiRes?.getMeta()
    const modelo = meta?.modelo ?? config.modelo
    const tokens = meta?.usage
    const latenciaMs = Date.now() - inicio
    const respuesta = textoAcumulado.length > 0 ? textoAcumulado.slice(0, 5000) : null

    programarEnAfter(async () => {
      try {
        await registrarConsultaAyuda({
          idConversacion,
          pregunta,
          respuesta,
          entradasCitadas: [],
          resultado: 'error',
          tipoError,
          latenciaMs,
          modelo,
          tokensInput: tokens?.tokensInput,
          tokensOutput: tokens?.tokensOutput,
          tokensCached: tokens?.tokensCached,
          tokensThinking: tokens?.tokensThinking,
        })
      } catch {
        console.error('ayuda: error al registrar consulta')
      }
    })
  }

  try {
    geminiRes = await ejecutarGeminiStream({
      apiKey: config.apiKey,
      modelo: config.modelo,
      modeloFallback: config.modeloFallback,
      prompt,
      signal: req.signal,
    })
  } catch {
    registrarFallo('proveedor')
    return NextResponse.json({ ok: false, reason: 'ayuda-error' }, { status: 502 })
  }

  const entradasAutorizadas = filtrarGuia(GUIA, permisos)
  const parser = new TransformStreamAyuda(entradasAutorizadas)
  const parsedStream = geminiRes.stream.pipeThrough(parser)
  const reader = parsedStream.getReader()

  const citasCitadas: string[] = []

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          if (value.tipo === 'texto') {
            textoAcumulado += value.contenido
          } else if (value.tipo === 'link') {
            textoAcumulado += value.titulo
            citasCitadas.push(value.id)
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
        }

        completado = true
        const respuesta = textoAcumulado.slice(0, 5000)
        const entradasCitadas = deduplicarEntradasCitadas(citasCitadas)
        const resultado = entradasCitadas.length > 0 ? 'respondida' : 'sin_cita'
        const meta = geminiRes.getMeta()
        const latenciaMs = Date.now() - inicio

        let idConsulta: string | null = null
        try {
          const regRes = await registrarConsultaAyuda({
            idConversacion,
            pregunta,
            respuesta,
            entradasCitadas,
            resultado,
            latenciaMs,
            modelo: meta.modelo,
            tokensInput: meta.usage.tokensInput,
            tokensOutput: meta.usage.tokensOutput,
            tokensCached: meta.usage.tokensCached,
            tokensThinking: meta.usage.tokensThinking,
          })
          if (regRes.ok) {
            idConsulta = regRes.id
          } else {
            console.error('ayuda: error al registrar consulta')
          }
        } catch {
          console.error('ayuda: error al registrar consulta')
        }

        const eventoFin: EventoStreamAyuda = {
          tipo: 'fin',
          idConsulta,
          resultado,
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventoFin)}\n\n`))
        controller.close()
      } catch {
        if (req.signal.aborted) {
          if (!completado) {
            completado = true
            registrarFallo('cancelado')
          }
          try {
            controller.close()
          } catch {}
          return
        }

        if (!completado) {
          completado = true
          const eventoError: EventoStreamAyuda = {
            tipo: 'error',
            reason: 'ayuda-error',
          }
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventoError)}\n\n`))
            controller.close()
          } catch {}

          registrarFallo('stream')
        }
      }
    },

    cancel() {
      void reader.cancel()
      if (!completado) {
        completado = true
        registrarFallo('cancelado')
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
