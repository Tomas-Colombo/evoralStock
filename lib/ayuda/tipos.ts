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
  // Último evento de un stream completo. idConsulta viaja acá porque la UI lo
  // necesita para calificar y la fila recién existe al terminar (DR-AYUDA-V2-7);
  // es null si el registro falló (fail-open).
  | { tipo: 'fin'; idConsulta: string | null; resultado: 'respondida' | 'sin_cita' | 'sin_llm' }

export interface PromptAyuda {
  instrucciones: string               // prefijo estable
  turnos: readonly MensajeHistorial[] // historial + turno final etiquetado
}
