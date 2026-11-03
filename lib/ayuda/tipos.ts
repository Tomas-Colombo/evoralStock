import type { Permiso } from '@/lib/types/administracion'

export interface DetalleGuia {
  tema: string
  texto: string
}

export interface EntradaGuia {
  id: string                          // kebab, único, ≤64
  titulo: string
  pasos: readonly string[]
  ruta?: `/${string}`                 // solo rutas estáticas de app/(app)
  permisos: readonly [Permiso, ...Permiso[]]
  detalles?: readonly DetalleGuia[]
}

export interface MensajeHistorial {
  rol: 'usuario' | 'asistente'
  texto: string
}

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
