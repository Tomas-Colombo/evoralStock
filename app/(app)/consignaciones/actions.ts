'use server'

import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import {
  spAgregarItemConsignacion,
  spCancelarItemConsignacion,
  spCerrarConsignacion,
  spConfirmarConsignacion,
  spConfirmarSalidaItem,
  spCrearConsignacionConItems,
  spEditarConsignacion,
  spEliminarConsignacion,
} from '@/lib/dal/consignaciones/consignacion'

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string }
type Guarded =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; error: string }

async function guarded(accion: string): Promise<Guarded> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'consignaciones', accion)
    return { ok: true, tenantId: session.tenantId, userId: session.user.id }
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, error: e.reason }
    throw e
  }
}

/**
 * Alta del lote con sus ítems en una sola transacción. El chequeo de "no
 * vacía" se hace acá Y en el RPC: acá para no gastar un round-trip, en el RPC
 * porque es el único lugar que no se puede saltear.
 */
export async function crearConsignacionAction(input: {
  idProveedor: string
  observaciones?: string | null
  items: string[]
  motivo?: string | null
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('crear')
  if (!g.ok) return { ok: false, reason: g.error }
  if (!input.idProveedor) return { ok: false, reason: 'proveedor-requerido' }
  if (!input.items?.length) return { ok: false, reason: 'consignacion-vacia' }
  try {
    const id = await spCrearConsignacionConItems({
      idProveedor: input.idProveedor,
      observaciones: input.observaciones ?? null,
      items: input.items,
      motivo: input.motivo ?? null,
    })
    revalidatePath('/consignaciones')
    revalidatePath('/inventario/productos')
    return { ok: true, data: { id } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function editarConsignacionAction(input: {
  idConsignacion: string
  observaciones?: string | null
  idProveedor?: string | null
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spEditarConsignacion(input)
    revalidatePath('/consignaciones')
    revalidatePath(`/consignaciones/${input.idConsignacion}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

/** Confirma la salida de todos los pendientes y cierra el lote. */
export async function confirmarConsignacionAction(input: {
  idConsignacion: string
}): Promise<ActionResult<{ confirmados: number }>> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    const confirmados = await spConfirmarConsignacion(input.idConsignacion)
    revalidatePath('/consignaciones')
    revalidatePath(`/consignaciones/${input.idConsignacion}`)
    revalidatePath('/inventario/productos')
    revalidatePath('/inventario')
    return { ok: true, data: { confirmados } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

/**
 * Borrado físico del lote. Los ítems que ya habían salido vuelven al stock,
 * por eso pide permiso `eliminar` y no `editar`: mueve inventario.
 */
export async function eliminarConsignacionAction(input: {
  idConsignacion: string
}): Promise<ActionResult<{ reestockeados: number }>> {
  const g = await guarded('eliminar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    const res = await spEliminarConsignacion(input.idConsignacion)
    revalidatePath('/consignaciones')
    revalidatePath('/inventario/productos')
    revalidatePath('/inventario')
    return { ok: true, data: { reestockeados: res.items_reestockeados } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function agregarItemConsignacionAction(input: {
  idConsignacion: string
  idItem: string
  motivo?: string | null
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('crear')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    const id = await spAgregarItemConsignacion({
      idConsignacion: input.idConsignacion,
      idItem: input.idItem,
      motivo: input.motivo ?? null,
    })
    revalidatePath(`/consignaciones/${input.idConsignacion}`)
    return { ok: true, data: { id } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function cancelarItemConsignacionAction(input: {
  idDetalle: string
  idConsignacion: string
  motivo?: string
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spCancelarItemConsignacion(input.idDetalle, input.motivo)
    revalidatePath(`/consignaciones/${input.idConsignacion}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function confirmarSalidaItemAction(input: {
  idDetalle: string
  idConsignacion: string
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spConfirmarSalidaItem(input.idDetalle)
    revalidatePath(`/consignaciones/${input.idConsignacion}`)
    revalidatePath('/inventario/productos')
    revalidatePath('/inventario')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function cerrarConsignacionAction(input: {
  idConsignacion: string
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spCerrarConsignacion(input.idConsignacion)
    revalidatePath('/consignaciones')
    revalidatePath(`/consignaciones/${input.idConsignacion}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}
