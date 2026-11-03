import 'server-only'
import { z } from 'zod'

export interface ConfigAyuda {
  apiKey: string
  modelo: string
}

const DEFAULT_MODELO = 'gemini-3-flash-preview'
const MODELO_REGEX = /^[a-z0-9.-]+$/

const configAyudaSchema = z.object({
  apiKey: z.string().trim().min(1),
  modelo: z.string().trim().regex(MODELO_REGEX),
})

/**
 * Lectura perezosa de la configuración de ayuda para Gemini.
 * Si GEMINI_API_KEY no está configurada o vacía, devuelve null sin loguear.
 * Si GEMINI_MODEL es inválido, devuelve null y loguea un mensaje fijo sin valores.
 */
export function leerConfigAyuda(): ConfigAyuda | null {
  const rawKey = process.env.GEMINI_API_KEY
  if (!rawKey || rawKey.trim() === '') {
    return null
  }

  const rawModel = process.env.GEMINI_MODEL
  const modeloCandidato = typeof rawModel === 'string' && rawModel.trim() !== '' ? rawModel.trim() : DEFAULT_MODELO

  const parsed = configAyudaSchema.safeParse({
    apiKey: rawKey,
    modelo: modeloCandidato,
  })

  if (!parsed.success) {
    console.error('ayuda: configuración inválida')
    return null
  }

  return {
    apiKey: parsed.data.apiKey,
    modelo: parsed.data.modelo,
  }
}

/**
 * Indica si la funcionalidad de ayuda está disponible en el entorno actual.
 * Alineado exactamente con leerConfigAyuda() para que layout y actions nunca discrepen.
 */
export function ayudaDisponible(): boolean {
  return leerConfigAyuda() !== null
}
