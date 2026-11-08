'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession, type Session } from '@/lib/dal/session'
import { capacidades, tiposProveedorPermitidos } from '@/lib/modulos/capacidades'
import {
  proveedorPatchSchema,
  extraerReasonZod,
} from '@/lib/validation/inventario'
import { getProveedor, updateProveedor } from '@/lib/dal/inventario/proveedor'
import type { TipoProveedor } from '@/lib/types/inventario'

type ActionResult = { ok: true } | { ok: false; reason: string }

// proveedores no existe como permiso: se autoriza contra inventario (docs/modulos.md).
async function guarded(
  accion: string,
): Promise<{ tenantId: string; userId: string; session: Session } | { error: string }> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'inventario', accion)
    return { tenantId: session.tenantId, userId: session.user.id, session }
  } catch (error) {
    if (error instanceof AuthorizationError) return { error: error.reason }
    throw error
  }
}

/**
 * Alta/baja lógica del proveedor. NO borra: setea `activo=false` para que
 * desaparezca de todos los selectores (ingresos, consignaciones, rendiciones,
 * reglas de precio, alta de producto) — que ya usan `listProveedoresActivos()`.
 * Los movimientos históricos y la deuda pendiente siguen quedando visibles
 * desde el perfil individual.
 */
export async function setProveedorActivoAction(input: {
  id: string
  activo: boolean
}): Promise<ActionResult> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'inventario', 'editar')
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, reason: error.reason }
    throw error
  }
  try {
    await updateProveedor(input.id, { activo: input.activo })
    revalidatePath('/proveedores')
    revalidatePath(`/proveedores/${input.id}`)
    revalidatePath('/inventario')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function updateProveedorAction(
  id: string,
  patch: {
    nombre?: string
    tipo?: TipoProveedor
    telefono?: string | null
    email?: string | null
    cuit?: string | null
    dias_rotacion?: number | null
    notas?: string | null
    activo?: boolean
  },
): Promise<ActionResult> {
  const g = await guarded('editar')
  if ('error' in g) return { ok: false, reason: g.error }

  const idParsed = z.uuid('proveedor-invalido').safeParse(id)
  if (!idParsed.success) {
    return { ok: false, reason: 'proveedor-invalido' }
  }

  const cap = capacidades(g.session.modulosHabilitados)
  const permitidos = tiposProveedorPermitidos(cap)
  let tiposAceptados: [TipoProveedor, ...TipoProveedor[]] = permitidos

  // Si el tipo del patch no está en los permitidos por capacidades,
  // permitimos mantener el tipo actual si el proveedor histórico ya era consignatario (REQ-MODOP-06 N3).
  if (patch && typeof patch === 'object' && 'tipo' in patch && patch.tipo) {
    const patchTipo = patch.tipo as TipoProveedor
    if (!permitidos.includes(patchTipo)) {
      const actual = await getProveedor(id)
      if (actual && actual.tipo === patchTipo) {
        tiposAceptados = [...permitidos, patchTipo] as [TipoProveedor, ...TipoProveedor[]]
      }
    }
  }

  const schema = proveedorPatchSchema(tiposAceptados)
  const parsed = schema.safeParse(patch)
  if (!parsed.success) {
    return { ok: false, reason: extraerReasonZod(parsed.error) }
  }

  try {
    await updateProveedor(id, parsed.data)
    revalidatePath('/proveedores')
    revalidatePath(`/proveedores/${id}`)
    return { ok: true }
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('module-disabled')) return { ok: false, reason: 'module-disabled' }
    return { ok: false, reason: msg }
  }
}
