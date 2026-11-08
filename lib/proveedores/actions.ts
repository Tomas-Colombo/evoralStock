'use server'

import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession, type Session } from '@/lib/dal/session'
import { capacidades, tiposProveedorPermitidos } from '@/lib/modulos/capacidades'
import { proveedorSchema, extraerReasonZod } from '@/lib/validation/inventario'
import { createProveedor } from '@/lib/dal/inventario/proveedor'
import type { TipoProveedor } from '@/lib/types/inventario'

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string }

// proveedores no existe como permiso: el alta se autoriza contra inventario (docs/modulos.md).
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

export async function createProveedorAction(input: {
  nombre: string
  tipo: TipoProveedor
  telefono?: string | null
  email?: string | null
  cuit?: string | null
  dias_rotacion?: number | null
  notas?: string | null
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('crear')
  if ('error' in g) return { ok: false, reason: g.error }

  const cap = capacidades(g.session.modulosHabilitados)
  const tipos = tiposProveedorPermitidos(cap)
  const schema = proveedorSchema(tipos)
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: extraerReasonZod(parsed.error) }
  }

  try {
    const row = await createProveedor({
      id_tenant: g.tenantId,
      nombre: parsed.data.nombre.trim(),
      tipo: parsed.data.tipo,
      telefono: parsed.data.telefono?.trim() || null,
      email: parsed.data.email?.trim() || null,
      cuit: parsed.data.cuit?.trim() || null,
      dias_rotacion: parsed.data.dias_rotacion ?? null,
      notas: parsed.data.notas?.trim() || null,
    })
    revalidatePath('/proveedores')
    return { ok: true, data: { id: row.id_proveedor } }
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('module-disabled')) return { ok: false, reason: 'module-disabled' }
    return { ok: false, reason: msg }
  }
}
