'use server'

import { classifyAuthError, requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { leerConfigAyuda } from '@/lib/ayuda/config'
import { crearModeloGemini } from '@/lib/ayuda/gemini'
import { consultarAyuda } from '@/lib/ayuda/consultar'
import { permisosEfectivos } from '@/lib/ayuda/permisos'
import {
  consultarAyudaSchema,
  calificarConsultaAyudaSchema,
} from '@/lib/validation/ayuda'
import {
  registrarConsultaAyuda,
  calificarConsultaAyuda,
} from '@/lib/dal/ayuda'
import type { ResultadoConsulta } from '@/lib/ayuda/tipos'

export type ResultadoAyudaValido = Exclude<ResultadoConsulta, { resultado: 'error' }>

export type ConsultarAyudaActionResult =
  | {
      ok: true
      idConsulta: string | null
      resultado: ResultadoAyudaValido
    }
  | {
      ok: false
      reason: string
    }

export type CalificarConsultaAyudaActionResult =
  | { ok: true }
  | { ok: false; reason: string }

export async function consultarAyudaAction(
  input: unknown,
): Promise<ConsultarAyudaActionResult> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'ayuda', 'consultar')

    const cfg = leerConfigAyuda()
    if (!cfg) {
      return { ok: false, reason: 'ayuda-no-disponible' }
    }

    const parsed = consultarAyudaSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, reason: 'payload-invalido' }
    }

    const permisos = permisosEfectivos(session)
    const modelo = crearModeloGemini(cfg)
    const resConsulta = await consultarAyuda(
      {
        pregunta: parsed.data.pregunta,
        historial: parsed.data.historial,
        focoId: parsed.data.focoId,
        permisos,
      },
      modelo,
    )

    if (resConsulta.resultado === 'error') {
      const reg = await registrarConsultaAyuda({
        idConversacion: parsed.data.idConversacion,
        pregunta: parsed.data.pregunta,
        respuesta: null,
        entradaId: null,
        resultado: 'error',
      })
      if (!reg.ok) {
        console.error('consultarAyudaAction: registrar', reg.reason)
      }
      return { ok: false, reason: 'ayuda-error' }
    }

    let respuesta: string | null = null
    let entradaId: string | null = null

    if (resConsulta.resultado === 'respondida') {
      respuesta = resConsulta.texto
      entradaId = resConsulta.entrada.id
    } else {
      respuesta = null
      entradaId = null
    }

    const reg = await registrarConsultaAyuda({
      idConversacion: parsed.data.idConversacion,
      pregunta: parsed.data.pregunta,
      respuesta,
      entradaId,
      resultado: resConsulta.resultado,
    })

    let idConsulta: string | null = null
    if (reg.ok) {
      idConsulta = reg.id
    } else {
      console.error('consultarAyudaAction: registrar', reg.reason)
      idConsulta = null
    }

    return {
      ok: true,
      idConsulta,
      resultado: resConsulta,
    }
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false, reason: auth.reason }
    throw err
  }
}

export async function calificarConsultaAyudaAction(
  input: unknown,
): Promise<CalificarConsultaAyudaActionResult> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'ayuda', 'consultar')

    const parsed = calificarConsultaAyudaSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, reason: 'payload-invalido' }
    }

    return await calificarConsultaAyuda(parsed.data)
  } catch (err) {
    const auth = classifyAuthError(err)
    if (auth.kind === 'auth') return { ok: false, reason: auth.reason }
    throw err
  }
}
