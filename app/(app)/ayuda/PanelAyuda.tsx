'use client'

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { calificarConsultaAyudaAction } from '@/app/(app)/ayuda/actions'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { IconButton } from '@/components/ui/IconButton'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'
import type { EventoStreamAyuda } from '@/lib/ayuda/tipos'

export type FragmentoMensaje =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'link'; id: string; titulo: string; ruta: string }

export interface EntradaSugerencia {
  id: string
  titulo: string
  ruta?: string
}

export interface MensajeUsuario {
  id: string
  rol: 'usuario'
  texto: string
}

export interface MensajeAsistente {
  id: string
  rol: 'asistente'
  fragmentos: FragmentoMensaje[]
  sugerencias?: EntradaSugerencia[]
  sinCita?: boolean
  error?: string | null
  idConsulta?: string | null
  calificacion?: boolean | null
  enProgreso?: boolean
  esEnlatada?: boolean
}

export type MensajeChat = MensajeUsuario | MensajeAsistente

export function PanelAyuda() {
  const [abierto, setAbierto] = useState(false)
  const [idConversacion, setIdConversacion] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<MensajeChat[]>([])
  const [pregunta, setPregunta] = useState('')
  const [enVuelo, setEnVuelo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cuotaExcedida, setCuotaExcedida] = useState(false)

  const enVueloRef = useRef(false)
  const prevEnVueloRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const botonRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const mensajesEndRef = useRef<HTMLDivElement>(null)

  const toast = useToast()

  const abrirPanel = useCallback(() => {
    if (!idConversacion) {
      setIdConversacion(crypto.randomUUID())
    }
    setAbierto(true)
  }, [idConversacion])

  const cerrarPanel = useCallback(() => {
    abortControllerRef.current?.abort()
    setAbierto(false)
    botonRef.current?.focus()
  }, [])

  const alternarPanel = useCallback(() => {
    if (abierto) {
      cerrarPanel()
    } else {
      abrirPanel()
    }
  }, [abierto, abrirPanel, cerrarPanel])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (abierto) {
      textareaRef.current?.focus()
    }
  }, [abierto])

  useEffect(() => {
    if (prevEnVueloRef.current && !enVuelo && abierto) {
      textareaRef.current?.focus()
    }
    prevEnVueloRef.current = enVuelo
  }, [enVuelo, abierto])

  useEffect(() => {
    if (abierto && typeof mensajesEndRef.current?.scrollIntoView === 'function') {
      mensajesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [mensajes, abierto, enVuelo])

  const reiniciarConversacion = () => {
    abortControllerRef.current?.abort()
    setIdConversacion(crypto.randomUUID())
    setMensajes([])
    if (!cuotaExcedida) {
      setError(null)
    }
    setPregunta('')
    textareaRef.current?.focus()
  }

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cerrarPanel()
    }
  }

  const enviar = async () => {
    if (enVueloRef.current || cuotaExcedida) return
    const textoPregunta = pregunta.trim()
    if (!textoPregunta) return

    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    enVueloRef.current = true
    setEnVuelo(true)
    setError(null)

    const convId = idConversacion || crypto.randomUUID()
    if (!idConversacion) {
      setIdConversacion(convId)
    }

    // Historial con turnos alternados usuario/asistente.
    // Si una respuesta fue excluida (enlatada, sin_cita, sugerencias, error, abortada),
    // se descarta también la pregunta de usuario que la originó.
    const turnosValidos: Array<{ rol: 'usuario' | 'asistente'; texto: string; citasPrevias?: string[] }> = []

    for (let i = 0; i < mensajes.length; i++) {
      const m = mensajes[i]
      if (m.rol === 'usuario') {
        const respuesta = mensajes[i + 1]
        if (
          respuesta &&
          respuesta.rol === 'asistente' &&
          !respuesta.esEnlatada &&
          !respuesta.sinCita &&
          !respuesta.sugerencias &&
          !respuesta.error &&
          !respuesta.enProgreso
        ) {
          const textoAsistente = respuesta.fragmentos
            .map((f) => (f.tipo === 'texto' ? f.texto : f.titulo))
            .join('')
            .slice(0, 500)
          const linkIds = respuesta.fragmentos
            .filter((f): f is { tipo: 'link'; id: string; titulo: string; ruta: string } => f.tipo === 'link')
            .map((f) => f.id)
          const citasPrevias = Array.from(new Set(linkIds))

          turnosValidos.push({
            rol: 'usuario',
            texto: m.texto.slice(0, 500),
          })
          turnosValidos.push({
            rol: 'asistente',
            texto: textoAsistente,
            ...(citasPrevias.length > 0 ? { citasPrevias } : {}),
          })
        }
      }
    }

    const historialValido = turnosValidos.slice(-4)

    const idMensajeUsuario = crypto.randomUUID()
    const idMensajeAsistente = crypto.randomUUID()

    setMensajes((prev) => [
      ...prev,
      {
        id: idMensajeUsuario,
        rol: 'usuario',
        texto: textoPregunta,
      },
    ])
    setPregunta('')

    let recibioFragmentos = false

    try {
      const res = await fetch('/api/ayuda/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idConversacion: convId,
          pregunta: textoPregunta,
          historial: historialValido,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        let reason = 'ayuda-error'
        try {
          const data = await res.json()
          if (data && typeof data.reason === 'string') {
            reason = data.reason
          }
        } catch {
          // Ignorar fallo al parsear JSON
        }

        setMensajes((prev) => prev.filter((m) => m.id !== idMensajeUsuario))
        setPregunta(textoPregunta)
        setError(mensajeDeError(reason))

        if (res.status === 429 || reason === 'cuota-excedida') {
          setCuotaExcedida(true)
        }
        return
      }

      if (!res.body) {
        throw new Error('No body in response')
      }

      const procesarEvento = (evento: EventoStreamAyuda) => {
        setMensajes((prev) => {
          let list = prev
          let idx = list.findIndex((m) => m.id === idMensajeAsistente)
          if (idx === -1) {
            list = [
              ...list,
              {
                id: idMensajeAsistente,
                rol: 'asistente',
                fragmentos: [],
                enProgreso: true,
              },
            ]
            idx = list.length - 1
          }

          const current = list[idx] as MensajeAsistente
          const updated: MensajeAsistente = { ...current }

          if (evento.tipo === 'texto') {
            recibioFragmentos = true
            const frags = [...updated.fragmentos]
            const ultimo = frags[frags.length - 1]
            if (ultimo && ultimo.tipo === 'texto') {
              frags[frags.length - 1] = {
                ...ultimo,
                texto: ultimo.texto + evento.contenido,
              }
            } else {
              frags.push({ tipo: 'texto', texto: evento.contenido })
            }
            updated.fragmentos = frags
          } else if (evento.tipo === 'link') {
            recibioFragmentos = true
            updated.fragmentos = [
              ...updated.fragmentos,
              {
                tipo: 'link',
                id: evento.id,
                titulo: evento.titulo,
                ruta: evento.ruta,
              },
            ]
          } else if (evento.tipo === 'sugerencias') {
            updated.sugerencias = evento.entradas
            updated.esEnlatada = true
          } else if (evento.tipo === 'error') {
            // El error de stream va únicamente dentro del mensaje
            updated.error = mensajeDeError(evento.reason)
            updated.esEnlatada = true
            updated.enProgreso = false
          } else if (evento.tipo === 'fin') {
            const esSinCita = evento.resultado === 'sin_cita'
            const esSinLlm = evento.resultado === 'sin_llm'
            updated.idConsulta = evento.idConsulta
            updated.sinCita = esSinCita
            updated.esEnlatada = esSinCita || esSinLlm || !!updated.sugerencias || !!updated.error
            updated.enProgreso = false
          }

          const next = [...list]
          next[idx] = updated
          return next
        })
      }

      const procesarBloque = (bloque: string) => {
        const lineas = bloque.split('\n')
        for (const linea of lineas) {
          const trimmed = linea.trim()
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim()
            if (!jsonStr) continue
            try {
              const evento = JSON.parse(jsonStr) as EventoStreamAyuda
              procesarEvento(evento)
            } catch {
              // Ignorar JSON corrupto o línea incompleta
            }
          }
        }
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const partes = buffer.split('\n\n')
        buffer = partes.pop() ?? ''
        for (const parte of partes) {
          procesarBloque(parte)
        }
      }

      buffer += decoder.decode()
      if (buffer.trim()) {
        procesarBloque(buffer)
      }

      setMensajes((prev) =>
        prev.map((m) =>
          m.id === idMensajeAsistente && m.rol === 'asistente'
            ? { ...m, enProgreso: false }
            : m,
        ),
      )
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (recibioFragmentos) {
          setMensajes((prev) =>
            prev.map((m) =>
              m.id === idMensajeAsistente && m.rol === 'asistente'
                ? { ...m, enProgreso: false, esEnlatada: true }
                : m,
            ),
          )
        } else {
          setMensajes((prev) => prev.filter((m) => m.id !== idMensajeAsistente))
        }
        return
      }

      if (recibioFragmentos) {
        setMensajes((prev) =>
          prev.map((m) =>
            m.id === idMensajeAsistente && m.rol === 'asistente'
              ? { ...m, enProgreso: false, error: mensajeDeError('ayuda-error'), esEnlatada: true }
              : m,
          ),
        )
      } else {
        setMensajes((prev) => prev.filter((m) => m.id !== idMensajeUsuario && m.id !== idMensajeAsistente))
        setPregunta(textoPregunta)
        setError(mensajeDeError('ayuda-error'))
      }
    } finally {
      enVueloRef.current = false
      setEnVuelo(false)
    }
  }

  const handleTextareaKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      enviar()
    }
  }

  const calificar = async (idConsulta: string, mensajeId: string, util: boolean) => {
    try {
      const res = await calificarConsultaAyudaAction({ idConsulta, util })
      if (res.ok) {
        setMensajes((prev) =>
          prev.map((m) => (m.id === mensajeId ? { ...m, calificacion: util } : m)),
        )
      } else {
        toast.error(mensajeDeError(res.reason))
      }
    } catch {
      toast.error(mensajeDeError('ayuda-error'))
    }
  }

  const ultimoMensaje = mensajes[mensajes.length - 1]
  const esperandoPrimerToken = enVuelo && (!ultimoMensaje || ultimoMensaje.rol === 'usuario')

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={alternarPanel}
        aria-label={abierto ? 'Cerrar panel de ayuda' : 'Ayuda'}
        aria-expanded={abierto}
        className="fixed bottom-4 right-4 z-40 inline-flex h-12 w-12 select-none items-center justify-center rounded-full bg-block text-block-ink shadow-lg transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        {abierto ? (
          <span className="text-xl font-bold leading-none" aria-hidden>
            ×
          </span>
        ) : (
          <span className="text-lg font-bold leading-none" aria-hidden>
            ?
          </span>
        )}
      </button>

      {abierto && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Ayuda"
          aria-modal="false"
          onKeyDown={handlePanelKeyDown}
          className="fixed bottom-20 right-4 z-40 flex h-[520px] max-h-[calc(100vh-6rem)] w-[calc(100vw-2rem)] sm:w-[380px] flex-col rounded-lg border border-line bg-panel shadow-2xl overflow-hidden motion-safe:animate-[fadeUp_0.18s_ease-out]"
        >
          {/* Cabecera */}
          <div className="flex items-center justify-between border-b border-line px-4 py-3 bg-panel">
            <h2 className="text-sm font-semibold text-ink">Ayuda</h2>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reiniciarConversacion}
                className="text-xs text-muted hover:text-ink"
              >
                Nueva conversación
              </Button>
              <IconButton
                size="sm"
                aria-label="Cerrar"
                onClick={cerrarPanel}
              >
                <span aria-hidden className="text-base leading-none">
                  ×
                </span>
              </IconButton>
            </div>
          </div>

          {/* Burbujas */}
          <div
            className="flex-1 overflow-y-auto p-4 space-y-3"
            aria-live="polite"
          >
            {mensajes.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center p-6 text-muted">
                <p className="text-sm">¿En qué te puedo ayudar hoy?</p>
                <p className="mt-1 text-xs text-muted-2">
                  Preguntame sobre pantallas, pasos o funciones del sistema.
                </p>
              </div>
            )}

            {mensajes.map((m) => {
              if (m.rol === 'usuario') {
                return (
                  <div
                    key={m.id}
                    className="ml-auto max-w-[85%] rounded-lg bg-block px-3 py-2 text-sm text-block-ink whitespace-pre-wrap break-words"
                  >
                    {m.texto}
                  </div>
                )
              }

              return (
                <div
                  key={m.id}
                  className="mr-auto max-w-[90%] rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink break-words"
                >
                  {m.fragmentos.length > 0 && (
                    <p className="whitespace-pre-wrap">
                      {m.fragmentos.map((frag, idx) => {
                        if (frag.tipo === 'texto') {
                          return <span key={idx}>{frag.texto}</span>
                        }
                        return (
                          <Link
                            key={idx}
                            href={frag.ruta}
                            className="inline-flex items-center gap-1 font-semibold underline text-ink hover:opacity-80"
                          >
                            {frag.titulo}
                          </Link>
                        )
                      })}
                    </p>
                  )}

                  {m.sugerencias && m.sugerencias.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-xs text-muted">Quizás te sirvan estas opciones:</p>
                      <ul className="space-y-1 list-none p-0 m-0">
                        {m.sugerencias.map((sug) => (
                          <li key={sug.id}>
                            {sug.ruta ? (
                              <Link
                                href={sug.ruta}
                                className="inline-flex items-center gap-1 text-xs font-semibold underline text-ink hover:opacity-80"
                              >
                                {sug.titulo}
                              </Link>
                            ) : (
                              <span className="text-xs text-ink">{sug.titulo}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {m.sinCita && (
                    <Card
                      padding="sm"
                      className="mt-2.5 border-line bg-panel text-sm text-ink"
                    >
                      No tengo esa respuesta. Preguntale al administrador de tu negocio.
                    </Card>
                  )}

                  {m.error && (
                    <div
                      role="alert"
                      className="mt-2 rounded border border-alerta-ink/20 bg-alerta-bg p-2 text-xs text-alerta-ink"
                    >
                      {m.error}
                    </div>
                  )}

                  {m.idConsulta && (
                    <div className="mt-2.5 pt-2 border-t border-line flex items-center gap-2 text-xs text-muted">
                      <span>¿Te sirvió?</span>
                      <Button
                        type="button"
                        size="sm"
                        variant={m.calificacion === true ? 'primary' : 'secondary'}
                        onClick={() => calificar(m.idConsulta!, m.id, true)}
                        className="!text-xs !py-0.5 !px-2"
                      >
                        Sí
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={m.calificacion === false ? 'primary' : 'secondary'}
                        onClick={() => calificar(m.idConsulta!, m.id, false)}
                        className="!text-xs !py-0.5 !px-2"
                      >
                        No
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}

            {esperandoPrimerToken && (
              <div className="mr-auto rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-muted">
                Consultando...
              </div>
            )}

            <div ref={mensajesEndRef} />
          </div>

          {/* Input y pie */}
          <div className="border-t border-line bg-panel p-3">
            {error && (
              <div
                role="alert"
                className="mb-2 rounded-md border border-alerta-ink/20 bg-alerta-bg p-2 text-xs text-alerta-ink"
              >
                {error}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              rows={2}
              maxLength={300}
              value={pregunta}
              disabled={enVuelo || cuotaExcedida}
              placeholder="¿Qué querés hacer?"
              onChange={(e) => setPregunta(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              className="resize-none text-xs"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted">
                No escribas datos de clientes.
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="text-[11px] text-muted-2"
                  aria-label="Caracteres usados"
                >
                  {pregunta.length}/300
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={enVuelo || cuotaExcedida || !pregunta.trim()}
                  onClick={enviar}
                  className="!text-xs !py-1 !px-3"
                >
                  Enviar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
