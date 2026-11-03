import 'server-only'

import { createServerClient } from '@/lib/dal/supabase'
import { extractErrorSlug, type ReglaSlug } from '@/lib/dal/revendedoras/slug-error'

export const REGLAS_SLUG: readonly ReglaSlug[] = [
  { slug: 'no-tenant', codigo: '42501', contiene: ['no-tenant'] },
  { slug: 'module-disabled', codigo: 'P0001', contiene: ['module-disabled'] },
  { slug: 'consulta-no-encontrada', codigo: '42704', contiene: ['consulta-no-encontrada'] },
]

export interface RegistrarConsultaAyudaPayload {
  idConversacion: string
  pregunta: string
  respuesta: string | null
  entradaId: string | null
  resultado: 'respondida' | 'fuera_de_opciones' | 'error'
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
    const { data, error } = await supabase.rpc('sp_registrar_consulta_ayuda', {
      p_id_conversacion: payload.idConversacion,
      p_pregunta: payload.pregunta,
      p_respuesta: payload.respuesta,
      p_entrada_id: payload.entradaId,
      p_resultado: payload.resultado,
    })

    if (error) {
      return { ok: false, reason: extractErrorSlug(error, REGLAS_SLUG) }
    }

    return { ok: true, id: String(data) }
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
