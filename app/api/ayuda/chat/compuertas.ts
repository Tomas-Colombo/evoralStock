import { NextRequest } from 'next/server'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession, type Session } from '@/lib/dal/session'
import { reservarCuotaAyuda } from '@/lib/dal/ayuda'
import { leerConfigAyuda, type ConfigAyuda } from '@/lib/ayuda/config'
import { permisosEfectivos } from '@/lib/ayuda/permisos'
import { buscarBM25, UMBRAL_MINIMO_BM25, UMBRAL_SUGERENCIAS_BM25 } from '@/lib/ayuda/bm25'
import type { EntradaGuia } from '@/lib/ayuda/tipos'
import type { Permiso } from '@/lib/types/administracion'
import {
  consultarAyudaChatSchema,
  type ConsultarAyudaChatInput,
} from '@/lib/validation/ayuda'

export function validarOrigin(req: Request | NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) {
    return false
  }

  const hostHeader = req.headers.get('x-forwarded-host') || req.headers.get('host')
  if (!hostHeader) {
    return false
  }

  const hostEsperado = hostHeader.split(',')[0].trim().toLowerCase()

  try {
    const parsedOrigin = new URL(origin)
    return parsedOrigin.host.toLowerCase() === hostEsperado
  } catch {
    return false
  }
}

export type ResultadoCompuertas =
  | {
      ok: false
      status: number
      reason: string
    }
  | {
      ok: true
      modo: 'sin_llm'
      idConversacion: string
      pregunta: string
      sugerencias: Array<{ id: string; titulo: string; ruta?: string }>
      permisos: ReadonlySet<Permiso>
    }
  | {
      ok: true
      modo: 'con_llm'
      idConversacion: string
      pregunta: string
      historial: ConsultarAyudaChatInput['historial']
      config: ConfigAyuda
      topEntradas: EntradaGuia[]
      permisos: ReadonlySet<Permiso>
    }

/**
 * REQ-AYUDA-V2-10: Compuertas previas al streaming del chat de ayuda.
 *
 * Orden estricto e innegociable:
 * 1. Validación Origin vs Host / x-forwarded-host (HTTP 403 origin-invalido, sin tocar sesión)
 * 2. verifySession(): rechazo de revendedoras (HTTP 401 no-permission)
 * 3. requireModuleRole(session, 'ayuda', 'consultar'): (HTTP 403 no-permission / module-disabled)
 *    -> Config ausente (leerConfigAyuda null): HTTP 503 ayuda-no-disponible (después de compuerta 3)
 * 4. Parseo Zod strictObject: (HTTP 400 payload-invalido)
 * 5. permisosEfectivos(session): cálculo en memoria
 * 6. Retrieval BM25 local: corte por scoreNormalizado < UMBRAL_MINIMO_BM25 -> sin_llm SIN reservar cuota
 * 7. sp_reservar_cuota_ayuda: (HTTP 429 cuota-excedida)
 */
export async function ejecutarCompuertas(req: NextRequest): Promise<ResultadoCompuertas> {
  // 1. Origin
  if (!validarOrigin(req)) {
    return { ok: false, status: 403, reason: 'origin-invalido' }
  }

  // 2. Sesión
  let session: Session
  try {
    session = await verifySession()
  } catch {
    return { ok: false, status: 401, reason: 'no-permission' }
  }

  if (session.idRevendedora) {
    return { ok: false, status: 401, reason: 'no-permission' }
  }

  // 3. Rol y módulo
  try {
    await requireModuleRole(session, 'ayuda', 'consultar')
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return { ok: false, status: 403, reason: e.reason }
    }
    return { ok: false, status: 403, reason: 'no-permission' }
  }

  // Config ausente después de compuerta 3
  const config = leerConfigAyuda()
  if (!config) {
    return { ok: false, status: 503, reason: 'ayuda-no-disponible' }
  }

  // 4. Validación Zod
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return { ok: false, status: 400, reason: 'payload-invalido' }
  }

  const parsed = consultarAyudaChatSchema.safeParse(body)
  if (!parsed.success) {
    return { ok: false, status: 400, reason: 'payload-invalido' }
  }

  // 5. Permisos efectivos
  const permisos = permisosEfectivos(session)

  // 6. Retrieval BM25 local
  const ultimoAsistente = [...parsed.data.historial].reverse().find((m) => m.rol === 'asistente')
  const citasPrevias = ultimoAsistente?.citasPrevias

  const resultados = buscarBM25(parsed.data.pregunta, permisos, {
    citasPrevias,
    topK: 5,
  })

  if (resultados.length === 0 || resultados[0].scoreNormalizado < UMBRAL_MINIMO_BM25) {
    const sugerencias = resultados
      .filter((r) => r.scoreNormalizado >= UMBRAL_SUGERENCIAS_BM25)
      .slice(0, 3)
      .map((r) => ({
      id: r.entrada.id,
      titulo: r.entrada.titulo,
      ruta: r.entrada.ruta,
    }))

    return {
      ok: true,
      modo: 'sin_llm',
      idConversacion: parsed.data.idConversacion,
      pregunta: parsed.data.pregunta,
      sugerencias,
      permisos,
    }
  }

  // 7. Reserva de cuota
  const reserva = await reservarCuotaAyuda()
  if (!reserva.ok) {
    return { ok: false, status: 429, reason: 'cuota-excedida' }
  }

  return {
    ok: true,
    modo: 'con_llm',
    idConversacion: parsed.data.idConversacion,
    pregunta: parsed.data.pregunta,
    historial: parsed.data.historial,
    config,
    topEntradas: resultados.slice(0, 5).map((r) => r.entrada),
    permisos,
  }
}
