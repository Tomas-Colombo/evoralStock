'use server'

import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { createCliente } from '@/lib/dal/clientes/cliente'

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string }
type Guarded =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; error: string }

// clientes y cuotas no existen como permiso: se autorizan contra ventas (docs/modulos.md).
async function guardedVentas(accion: string): Promise<Guarded> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'ventas', accion)
    return { ok: true, tenantId: session.tenantId, userId: session.user.id }
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, error: e.reason }
    throw e
  }
}

/**
 * Alta de cliente. `apellido` es OBLIGATORIO desde 00058: la cartera se ordena
 * y se busca por ahí, y un cliente sin apellido es uno que no se va a poder
 * encontrar cuando deba plata.
 *
 * La columna sigue siendo NULLABLE en la DB a propósito: los clientes
 * anteriores a 00058 tienen su nombre completo en `nombre` y no se los puede
 * inventar. La obligatoriedad rige para las altas nuevas, acá y en el form.
 */
export async function crearClienteAction(input: {
  nombre: string
  apellido: string
  telefono?: string | null
  email?: string | null
  notas?: string | null
}): Promise<ActionResult<{ id: string }>> {
  const g = await guardedVentas('crear')
  if (!g.ok) return { ok: false, reason: g.error }
  if (input.nombre.trim().length < 2) return { ok: false, reason: 'nombre-invalido' }
  if (input.apellido.trim().length < 2) return { ok: false, reason: 'apellido-invalido' }
  try {
    const row = await createCliente({
      id_tenant: g.tenantId,
      nombre: input.nombre.trim(),
      apellido: input.apellido.trim(),
      telefono: input.telefono?.trim() || null,
      email: input.email?.trim() || null,
      notas: input.notas?.trim() || null,
    })
    revalidatePath('/clientes')
    return { ok: true, data: { id: row.id_cliente } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}
