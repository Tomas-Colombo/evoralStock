'use client'

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  consultarAyudaAction,
  calificarConsultaAyudaAction,
} from '@/app/(app)/ayuda/actions'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { IconButton } from '@/components/ui/IconButton'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'

interface MensajeUsuario {
  id: string
  rol: 'usuario'
  texto: string
}

interface MensajeRespondida {
  id: string
  rol: 'asistente'
  tipo: 'respondida'
  texto: string
  entrada: {
    id: string
    titulo: string
    ruta?: string
  }
  idConsulta: string | null
  calificacion: boolean | null
}

interface MensajeFueraDeOpciones {
  id: string
  rol: 'asistente'
  tipo: 'fuera_de_opciones'
}

type MensajeChat = MensajeUsuario | MensajeRespondida | MensajeFueraDeOpciones

export function PanelAyuda() {
  const [abierto, setAbierto] = useState(false)
  const [idConversacion, setIdConversacion] = useState<string | null>(null)
  const [focoId, setFocoId] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<MensajeChat[]>([])
  const [pregunta, setPregunta] = useState('')
  const [enVuelo, setEnVuelo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enVueloRef = useRef(false)
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
    if (abierto) {
      textareaRef.current?.focus()
    }
  }, [abierto])

  useEffect(() => {
    if (abierto && typeof mensajesEndRef.current?.scrollIntoView === 'function') {
      mensajesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [mensajes, abierto, enVuelo])

  const reiniciarConversacion = () => {
    setIdConversacion(crypto.randomUUID())
    setMensajes([])
    setFocoId(null)
    setError(null)
    setPregunta('')
    textareaRef.current?.focus()
  }

  // Escape cierra SOLO el panel: onKeyDown en el contenedor del panel, nunca un listener en document o window (REQ-AYUDA-12 N3)
  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cerrarPanel()
    }
  }

  const enviar = async () => {
    if (enVueloRef.current) return
    const textoPregunta = pregunta.trim()
    if (!textoPregunta) return

    enVueloRef.current = true
    setEnVuelo(true)
    setError(null)

    const convId = idConversacion || crypto.randomUUID()
    if (!idConversacion) {
      setIdConversacion(convId)
    }

    const historialParaEnviar = mensajes
      .map((m) => {
        if (m.rol === 'usuario') {
          return { rol: 'usuario' as const, texto: m.texto.slice(0, 500) }
        }
        if (m.tipo === 'respondida') {
          return { rol: 'asistente' as const, texto: m.texto.slice(0, 500) }
        }
        return {
          rol: 'asistente' as const,
          texto: 'No tengo esa respuesta. Preguntale al administrador de tu negocio.'.slice(0, 500),
        }
      })
      .slice(-6)

    const idMensajeUsuario = crypto.randomUUID()
    setMensajes((prev) => [
      ...prev,
      {
        id: idMensajeUsuario,
        rol: 'usuario',
        texto: textoPregunta,
      },
    ])
    setPregunta('')

    try {
      const res = await consultarAyudaAction({
        idConversacion: convId,
        pregunta: textoPregunta,
        historial: historialParaEnviar,
        focoId,
      })

      if (!res.ok) {
        setMensajes((prev) => prev.filter((m) => m.id !== idMensajeUsuario))
        setPregunta(textoPregunta)
        setError(mensajeDeError(res.reason))
        return
      }

      const { resultado, idConsulta } = res
      setError(null)
      if (resultado.resultado === 'respondida') {
        setFocoId(resultado.entrada.id)
        setMensajes((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            rol: 'asistente',
            tipo: 'respondida',
            texto: resultado.texto,
            entrada: resultado.entrada,
            idConsulta,
            calificacion: null,
          },
        ])
      } else if (resultado.resultado === 'fuera_de_opciones') {
        setMensajes((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            rol: 'asistente',
            tipo: 'fuera_de_opciones',
          },
        ])
      }
    } catch {
      setMensajes((prev) => prev.filter((m) => m.id !== idMensajeUsuario))
      setPregunta(textoPregunta)
      setError(mensajeDeError('ayuda-error'))
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

              if (m.tipo === 'fuera_de_opciones') {
                return (
                  <Card
                    key={m.id}
                    padding="sm"
                    className="mr-auto max-w-[90%] border-line bg-panel-2 text-sm text-ink"
                  >
                    No tengo esa respuesta. Preguntale al administrador de tu negocio.
                  </Card>
                )
              }

              return (
                <div
                  key={m.id}
                  className="mr-auto max-w-[90%] rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink break-words"
                >
                  <p className="whitespace-pre-wrap">{m.texto}</p>
                  {m.entrada.ruta && (
                    <div className="mt-2">
                      <Link
                        href={m.entrada.ruta}
                        className="inline-flex items-center gap-1 text-xs font-semibold underline text-ink hover:opacity-80"
                      >
                        Ir a {m.entrada.titulo}
                      </Link>
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

            {enVuelo && (
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
              disabled={enVuelo}
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
                  disabled={enVuelo || !pregunta.trim()}
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
