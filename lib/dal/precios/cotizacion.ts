import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/dal/supabase'
import { fetchCotizacionBcra } from '@/lib/cotizacion/bcra'

export type CotizacionVigente = {
  modo: 'automatica' | 'manual'
  valor: number
  fecha: string | null
  fechaValor: string | null
  origen: 'bcra' | 'manual'
  desactualizada: boolean
  idCotizacion?: string | null
}

export type SincronizacionBcraResult =
  | { ok: true; data: CotizacionVigente }
  | { ok: false; reason: string }

interface SpGetCotizacionRow {
  modo: 'automatica' | 'manual'
  id_cotizacion: string | null
  valor: number | null
  fecha: string | null
  fecha_valor: string | null
  origen: 'bcra' | 'manual' | null
  desactualizada: boolean
}

function extraerSlugRpc(error: { message: string }): string {
  const clean = error.message.replace(/^.*(?:sp_[a-z_]+):\s*/i, '').trim()
  const match = clean.match(/([a-z0-9_-]+)/)
  return match ? match[1] : clean
}

/**
 * Consulta la cotización vigente para el tenant actual.
 * Utilizado por las conversiones monetarias y visualización de cotización.
 * NO exige permiso de edición: es una lectura de sistema/operativa.
 *
 * En modo automático:
 * - Si no está desactualizada y tiene valor de hoy, la retorna directamente.
 * - Si desactualizada=true (aún no se consultó hoy o falló previo), consulta el BCRA.
 * - Si el BCRA responde bien, persiste con desactualizada=false y retorna valor actualizado.
 * - Si el BCRA falla y existe un valor anterior, retorna el anterior con desactualizada=true.
 * - Si no existe ningún valor previo, lanza error 'sin-cotizacion-dolar'.
 */
export async function getCotizacionVigente(
  client?: SupabaseClient,
): Promise<CotizacionVigente> {
  const supabase = client ?? (await createServerClient())
  const { data: raw, error } = await supabase.rpc('sp_get_cotizacion_vigente')
  if (error) throw new Error(extraerSlugRpc(error))

  const vigente = raw as SpGetCotizacionRow

  if (vigente.modo === 'manual') {
    if (vigente.valor === null || vigente.valor <= 0) {
      throw new Error('sin-cotizacion-dolar')
    }
    return {
      modo: 'manual',
      valor: Number(vigente.valor),
      fecha: vigente.fecha,
      fechaValor: vigente.fecha_valor,
      origen: 'manual',
      desactualizada: Boolean(vigente.desactualizada),
      idCotizacion: vigente.id_cotizacion,
    }
  }

  // Modo automático: si ya tenemos la fila de hoy con desactualizada=false
  if (!vigente.desactualizada && vigente.valor !== null && vigente.valor > 0) {
    return {
      modo: 'automatica',
      valor: Number(vigente.valor),
      fecha: vigente.fecha,
      fechaValor: vigente.fecha_valor,
      origen: 'bcra',
      desactualizada: false,
      idCotizacion: vigente.id_cotizacion,
    }
  }

  // Si desactualizada=true, intentamos consultar al BCRA
  const bcraRes = await fetchCotizacionBcra()

  if (bcraRes.ok) {
    const { error: errReg } = await supabase.rpc('sp_registrar_cotizacion_bcra', {
      p_valor: bcraRes.valor,
      p_fecha_valor: bcraRes.fechaValor,
      p_desactualizada: false,
    })
    if (errReg) throw new Error(extraerSlugRpc(errReg))

    const { data: updatedRaw, error: errUpd } = await supabase.rpc('sp_get_cotizacion_vigente')
    if (errUpd) throw new Error(extraerSlugRpc(errUpd))
    const updated = (updatedRaw ?? {}) as Partial<SpGetCotizacionRow>

    return {
      modo: 'automatica',
      valor: Number(updated.valor ?? bcraRes.valor),
      fecha: updated.fecha ?? null,
      fechaValor: updated.fecha_valor ?? bcraRes.fechaValor,
      origen: 'bcra',
      desactualizada: false,
      idCotizacion: updated.id_cotizacion ?? null,
    }
  }

  // Si falla el BCRA pero teníamos un valor anterior
  if (vigente.valor !== null && vigente.valor > 0) {
    return {
      modo: 'automatica',
      valor: Number(vigente.valor),
      fecha: vigente.fecha,
      fechaValor: vigente.fecha_valor,
      origen: 'bcra',
      desactualizada: true,
      idCotizacion: vigente.id_cotizacion,
    }
  }

  throw new Error('sin-cotizacion-dolar')
}

/**
 * Fuerza la sincronización con la API oficial del BCRA.
 * Si la sincronización falla, NO pisa una fila de hoy que ya estaba bien.
 */
export async function sincronizarCotizacionBcra(
  client?: SupabaseClient,
): Promise<SincronizacionBcraResult> {
  const supabase = client ?? (await createServerClient())

  const bcraRes = await fetchCotizacionBcra()
  if (!bcraRes.ok) {
    // Si falla el BCRA, retornamos el error sin pisar ninguna fila existente
    return { ok: false, reason: bcraRes.reason }
  }

  const { error: errReg } = await supabase.rpc('sp_registrar_cotizacion_bcra', {
    p_valor: bcraRes.valor,
    p_fecha_valor: bcraRes.fechaValor,
    p_desactualizada: false,
  })
  if (errReg) throw new Error(extraerSlugRpc(errReg))

  const { data: updatedRaw, error: errUpd } = await supabase.rpc('sp_get_cotizacion_vigente')
  if (errUpd) throw new Error(extraerSlugRpc(errUpd))
  const updated = (updatedRaw ?? {}) as Partial<SpGetCotizacionRow>

  return {
    ok: true,
    data: {
      modo: 'automatica',
      valor: Number(updated.valor ?? bcraRes.valor),
      fecha: updated.fecha ?? null,
      fechaValor: updated.fecha_valor ?? bcraRes.fechaValor,
      origen: 'bcra',
      desactualizada: false,
      idCotizacion: updated.id_cotizacion ?? null,
    },
  }
}

/**
 * Fija la cotización manual y conmuta el tenant a modo manual.
 */
export async function spSetCotizacionManual(
  params: { valor: number; ip?: string | null },
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? (await createServerClient())
  const { error } = await supabase.rpc('sp_set_cotizacion_manual', {
    p_valor: params.valor,
    p_ip: params.ip ?? null,
  })
  if (error) throw new Error(extraerSlugRpc(error))
}

/**
 * Cambia el modo de cotización del tenant ('automatica' | 'manual').
 */
export async function spSetModoCotizacion(
  params: { modo: 'automatica' | 'manual'; ip?: string | null },
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? (await createServerClient())
  const { error } = await supabase.rpc('sp_set_modo_cotizacion', {
    p_modo: params.modo,
    p_ip: params.ip ?? null,
  })
  if (error) throw new Error(extraerSlugRpc(error))
}
