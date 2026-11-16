import type { Permiso } from '@/lib/types/administracion'

export interface DetalleGuia {
  tema: string
  texto: string
}

export interface EntradaGuia {
  id: string
  titulo: string
  pasos: readonly string[]
  ruta?: `/${string}`
  permisos: readonly [Permiso, ...Permiso[]]
  detalles?: readonly DetalleGuia[]
  alias?: readonly string[]
}

export interface MensajeHistorial {
  rol: 'usuario' | 'asistente'
  texto: string
  citasPrevias?: readonly string[]
}

export interface TokenLinkAyuda {
  tipo: 'link'
  id: string
  titulo: string
  ruta: string
}

export type EventoStreamAyuda =
  | { tipo: 'texto'; contenido: string }
  | TokenLinkAyuda
  | { tipo: 'sugerencias'; entradas: Array<{ id: string; titulo: string; ruta?: string }> }
  | { tipo: 'error'; reason: string }

export interface PromptAyuda {
  instrucciones: string               // prefijo estable
  turnos: readonly MensajeHistorial[] // historial + turno final etiquetado
}

export type ErrorModelo = 'sin-clave' | 'timeout' | 'proveedor' | 'formato'

/** Puerto: lo implementa lib/ayuda/gemini.ts; los tests usan un fake. */
export type ModeloAyuda = (
  prompt: PromptAyuda,
  idsPermitidos: readonly [string, ...string[]],
) => Promise<{ ok: true; salida: unknown } | { ok: false; error: ErrorModelo }>

export type ResultadoConsulta =
  | { resultado: 'respondida'; texto: string; entrada: { id: string; titulo: string; ruta?: string } }
  | { resultado: 'fuera_de_opciones' }
  | { resultado: 'error'; error: ErrorModelo }
