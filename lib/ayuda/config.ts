import 'server-only'
import { z } from 'zod'

export interface ConfigAyuda {
  apiKey: string
  modelo: string
}

const DEFAULT_MODELO = 'gemini-3-flash-preview'
const MODELO_REGEX = /^[a-z0-9.-]+$/

const configAyudaSchema = z.object({
  apiKey: z.string().trim().min(1, 'GEMINI_API_KEY no puede estar vacía'),
  modelo: z
    .string()
    .trim()
    .regex(MODELO_REGEX, 'GEMINI_MODEL debe coincidir con ^[a-z0-9.-]+$')
    .default(DEFAULT_MODELO),
})

/**
 * Indica si la funcionalidad de ayuda está disponible en el entorno actual.
 * Devuelve true únicamente si GEMINI_API_KEY está configurada y no vacía.
 */
export function ayudaDisponible(): boolean {
  const key = process.env.GEMINI_API_KEY
  return typeof key === 'string' && key.trim().length > 0
}

/**
 * Lectura perezosa de la configuración de ayuda para Gemini.
 * Si GEMINI_API_KEY no está configurada, devuelve null sin lanzar error.
 * Si está configurada, valida el modelo con zod y devuelve apiKey y modelo.
 */
export function leerConfigAyuda(): ConfigAyuda | null {
  if (!ayudaDisponible()) {
    return null
  }

  const rawKey = process.env.GEMINI_API_KEY
  const rawModel = process.env.GEMINI_MODEL

  const parsed = configAyudaSchema.parse({
    apiKey: rawKey,
    modelo: typeof rawModel === 'string' && rawModel.trim() !== '' ? rawModel.trim() : DEFAULT_MODELO,
  })

  return {
    apiKey: parsed.apiKey,
    modelo: parsed.modelo,
  }
}
