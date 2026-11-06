'use server'

import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { createServerClient } from '@/lib/dal/supabase'
import {
  getRol,
  inviteUsuario,
  spAsignarRol,
  spCreateRol,
  spDeleteRol,
  spSetConfiguracionImpresora,
  spSetConfiguracionQrLadoMm,
  quitarLogoTenant,
  spToggleUsuarioActivo,
  spUpdateRol,
  subirLogoTenant,
} from '@/lib/dal/administracion/administracion'
import {
  compactarPermisos,
  createRolSchema,
  deleteRolSchema,
  primerReason,
  updateConfiguracionImpresoraSchema,
  updateConfiguracionQrSchema,
  updateRolSchema,
  updateTenantLogoSchema,
  cambiarPasswordSchema,
} from '@/lib/validation/administracion'
import type { UsuarioEstado } from '@/lib/types/administracion'
import { Session } from '@/lib/dal/session'
import { capacidades, modulosDePermisoVisibles } from '@/lib/modulos/capacidades'

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string }
type Guarded =
  | { ok: true; session: Session; tenantId: string; userId: string }
  | { ok: false; error: string }

async function guarded(accion: string): Promise<Guarded> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, 'administracion', accion)
    return { ok: true, session, tenantId: session.tenantId, userId: session.user.id }
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, error: e.reason }
    throw e
  }
}

export async function toggleUsuarioEstadoAction(input: {
  idUsuario: string
  estado: UsuarioEstado
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spToggleUsuarioActivo(input.idUsuario, input.estado)
    revalidatePath('/administracion/usuarios')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function invitarUsuarioAction(input: {
  email: string
  nombreCompleto: string
  idRol: string
  password: string
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('crear')
  if (!g.ok) return { ok: false, reason: g.error }

  const email = input.email.trim().toLowerCase()
  if (!email.includes('@') || email.length < 5) return { ok: false, reason: 'email-invalido' }
  if (input.nombreCompleto.trim().length < 2) return { ok: false, reason: 'nombre-corto' }
  if (!input.idRol) return { ok: false, reason: 'rol-requerido' }
  if (input.password.length < 8) return { ok: false, reason: 'password-corto' }

  try {
    const res = await inviteUsuario({
      tenantId: g.tenantId,
      email,
      nombreCompleto: input.nombreCompleto.trim(),
      idRol: input.idRol,
      password: input.password,
    })
    revalidatePath('/administracion/usuarios')
    return { ok: true, data: res }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function asignarRolAction(input: {
  idUsuario: string
  idRol: string
  nombreCompleto?: string
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spAsignarRol(input.idUsuario, input.idRol, input.nombreCompleto)
    revalidatePath('/administracion/usuarios')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function createRolAction(input: {
  nombre: string
  permisos: Record<string, string[]>
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('crear')
  if (!g.ok) return { ok: false, reason: g.error }

  const cap = capacidades(g.session.modulosHabilitados)
  const modulosVisibles = modulosDePermisoVisibles(cap)
  const parsed = createRolSchema(modulosVisibles).safeParse(input)
  if (!parsed.success) return { ok: false, reason: primerReason(parsed.error) }

  try {
    const id = await spCreateRol({
      nombre: parsed.data.nombre,
      permisos: compactarPermisos(parsed.data.permisos),
    })
    revalidatePath('/administracion')
    return { ok: true, data: { id } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function updateRolAction(input: {
  idRol: string
  nombre: string
  permisos: Record<string, string[]>
}): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }

  const cap = capacidades(g.session.modulosHabilitados)
  const modulosVisibles = modulosDePermisoVisibles(cap)
  const parsed = updateRolSchema(modulosVisibles).safeParse(input)
  if (!parsed.success) return { ok: false, reason: primerReason(parsed.error) }

  try {
    // Si el rol ya tenía permisos guardados de módulos hoy apagados (no visibles),
    // los preservamos para no borrarlos al editar el rol. Al reactivar el módulo,
    // el tenant recuperará esos permisos intactos (REQ-MODOP-09).
    const rolActual = await getRol(parsed.data.idRol)
    const permisosPreservados: Record<string, string[]> = {}
    if (rolActual?.permisos) {
      for (const [mod, acc] of Object.entries(rolActual.permisos)) {
        if (!modulosVisibles.includes(mod)) {
          permisosPreservados[mod] = acc
        }
      }
    }

    const permisosFinales = {
      ...permisosPreservados,
      ...parsed.data.permisos,
    }

    await spUpdateRol({
      idRol: parsed.data.idRol,
      nombre: parsed.data.nombre,
      permisos: compactarPermisos(permisosFinales),
    })
    revalidatePath('/administracion')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function deleteRolAction(input: { idRol: string }): Promise<ActionResult> {
  const g = await guarded('eliminar')
  if (!g.ok) return { ok: false, reason: g.error }

  const parsed = deleteRolSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: primerReason(parsed.error) }

  try {
    await spDeleteRol(parsed.data.idRol)
    revalidatePath('/administracion')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function updateConfiguracionQrAction(
  raw: unknown,
): Promise<ActionResult<{ ladoMm: number }>> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }

  const parsed = updateConfiguracionQrSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: primerReason(parsed.error) }

  try {
    const ladoMm = await spSetConfiguracionQrLadoMm(parsed.data.ladoMm)
    revalidatePath('/administracion')
    revalidatePath('/inventario/imprimir-etiquetas')
    return { ok: true, data: { ladoMm } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function updateConfiguracionImpresoraAction(raw: unknown): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }

  const parsed = updateConfiguracionImpresoraSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: primerReason(parsed.error) }

  try {
    await spSetConfiguracionImpresora(parsed.data)
    revalidatePath('/administracion')
    revalidatePath('/inventario/imprimir-etiquetas')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function updateTenantLogoAction(
  raw: unknown,
): Promise<ActionResult<{ logoUrl: string }>> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }

  // El tipo dice FormData, pero el POST lo arma cualquiera: si no lo es, el
  // schema recibe `undefined` y responde `logo-invalido`.
  const logo = raw instanceof FormData ? raw.get('logo') : undefined
  const parsed = updateTenantLogoSchema.safeParse({ logo })
  if (!parsed.success) return { ok: false, reason: primerReason(parsed.error) }

  try {
    const logoUrl = await subirLogoTenant(g.tenantId, parsed.data.logo)
    revalidatePath('/', 'layout')
    return { ok: true, data: { logoUrl } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function quitarTenantLogoAction(): Promise<ActionResult> {
  const g = await guarded('editar')
  if (!g.ok) return { ok: false, reason: g.error }

  try {
    await quitarLogoTenant(g.tenantId)
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function cambiarMiPasswordAction(
  raw: unknown,
): Promise<ActionResult> {
  const g = await guarded('ver')
  if (!g.ok) return { ok: false, reason: g.error }

  const session = await verifySession()

  const parsed = cambiarPasswordSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: primerReason(parsed.error) }

  const supabase = await createServerClient()

  const { error: reverifyError } = await supabase.auth.signInWithPassword({
    email: session.user.email,
    password: parsed.data.passwordActual,
  })

  if (reverifyError) {
    return { ok: false, reason: 'password-actual-incorrecta' }
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: parsed.data.passwordNuevo,
  })

  if (updateError) {
    return { ok: false, reason: 'error-actualizar-password' }
  }

  try {
    await supabase.rpc('sp_change_password_user', { p_id_usuario: session.user.id })
  } catch {
    // Auditoría best-effort
  }

  return { ok: true }
}
