'use server'

import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import {
  spExcluirDetalleRendicion,
  spGenerarRendicion,
  spMarcarRendicionPagada,
  spReincluirDetalleRendicion,
} from '@/lib/dal/rendiciones/rendicion'

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string }
type Guarded =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; error: string }

async function guarded(accion: string): Promise<Guarded> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'rendiciones', accion)
    return { ok: true, tenantId: session.tenantId, userId: session.user.id }
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, error: e.reason }
    throw e
  }
}

// ─── Rendiciones ─────────────────────────────────────────────────────

export async function excluirDetalleAction(input: {
  idDetalle: string
  motivo?: string | null
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spExcluirDetalleRendicion(input)
    revalidatePath('/rendiciones/nueva')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function reincluirDetalleAction(input: {
  idDetalle: string
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spReincluirDetalleRendicion(input.idDetalle)
    revalidatePath('/rendiciones/nueva')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function generarRendicionAction(input: {
  idProveedor: string
  observaciones?: string | null
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('crear')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    const id = await spGenerarRendicion({
      idProveedor: input.idProveedor,
      observaciones: input.observaciones ?? null,
    })
    revalidatePath('/rendiciones')
    revalidatePath('/rendiciones/nueva')
    return { ok: true, data: { id } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function marcarRendicionPagadaAction(input: {
  idRendicion: string
  fechaPago?: string | null
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spMarcarRendicionPagada({
      idRendicion: input.idRendicion,
      fechaPago: input.fechaPago ?? null,
    })
    revalidatePath('/rendiciones')
    revalidatePath(`/rendiciones/${input.idRendicion}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}
