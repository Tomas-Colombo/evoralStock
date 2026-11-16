import 'server-only'

import { createServerClient } from '@/lib/dal/supabase'
import { extractErrorSlug, type ReglaSlug } from '@/lib/dal/revendedoras/slug-error'

export { reservarCuotaAyuda, REGLAS_SLUG_CUOTA } from './cuota'

export const REGLAS_SLUG: readonly ReglaSlug[] = [
  { slug: 'no-tenant' },
  { slug: 'module-disabled' },
  { slug: 'consulta-no-encontrada' },
]

export type ResultadoConsultaAyuda =
  | 'respondida'
  | 'sin_cita'
  | 'sin_llm'
  | 'fuera_de_opciones'
  | 'error'

export interface RegistrarConsultaAyudaPayload {
  idConversacion: string
  pregunta: string
  respuesta: string | null
  entradasCitadas?: readonly string[] | string[] | null
  resultado: ResultadoConsultaAyuda
  tipoError?: string | null
  latenciaMs?: number | null
  modelo?: string | null
  tokensInput?: number | null
  tokensOutput?: number | null
  tokensCached?: number | null
  tokensThinking?: number | null
}

export interface CalificarConsultaAyudaPayload {
  idConsulta: string
  util: boolean
}

export async function registrarConsultaAyuda(
  payload: RegistrarConsultaAyudaPayload,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    const supabase = await createServerClient()
    const entradasCitadas =
      payload.entradasCitadas !== undefined && payload.entradasCitadas !== null
        ? Array.from(payload.entradasCitadas)
        : []

    const { data, error } = await supabase.rpc('sp_registrar_consulta_ayuda', {
      p_id_conversacion: payload.idConversacion,
      p_pregunta: payload.pregunta,
      p_respuesta: payload.respuesta,
      p_entradas_citadas: entradasCitadas,
      p_resultado: payload.resultado,
      p_tipo_error: payload.tipoError ?? null,
      p_latencia_ms: payload.latenciaMs ?? null,
      p_modelo: payload.modelo ?? null,
      p_tokens_input: payload.tokensInput ?? null,
      p_tokens_output: payload.tokensOutput ?? null,
      p_tokens_cached: payload.tokensCached ?? null,
      p_tokens_thinking: payload.tokensThinking ?? null,
    })

    if (error) {
      return { ok: false, reason: extractErrorSlug(error, REGLAS_SLUG) }
    }

    if (typeof data !== 'string' || data.trim() === '') {
      return { ok: false, reason: 'error-desconocido' }
    }

    return { ok: true, id: data }
  } catch (err) {
    return { ok: false, reason: extractErrorSlug(err, REGLAS_SLUG) }
  }
}

export async function calificarConsultaAyuda(
  payload: CalificarConsultaAyudaPayload,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const supabase = await createServerClient()
    const { error } = await supabase.rpc('sp_calificar_consulta_ayuda', {
      p_id: payload.idConsulta,
      p_util: payload.util,
    })

    if (error) {
      return { ok: false, reason: extractErrorSlug(error, REGLAS_SLUG) }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, reason: extractErrorSlug(err, REGLAS_SLUG) }
  }
}
