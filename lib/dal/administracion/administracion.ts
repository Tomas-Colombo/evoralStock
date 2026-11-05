import 'server-only'
import { randomUUID } from 'node:crypto'
import { createServerClient, createServiceClient } from '@/lib/dal/supabase'
import { detectarFormatoImagen, EXTENSION_LOGO, LOGO_BUCKET } from '@/lib/tenant/logo'
import { QR_LADO_MM_DEFAULT, QR_LADO_MM_MAX, QR_LADO_MM_MIN } from '@/lib/inventario/limites'
import type {
  AuditoriaConActor,
  AuditoriaRow,
  RolRow,
  UsuarioConRol,
  UsuarioEstado,
} from '@/lib/types/administracion'

// ─── Usuarios ────────────────────────────────────────────────────────

export async function listUsuarios(): Promise<UsuarioConRol[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('usuario')
    .select(`
      id_usuario, id_tenant, email, nombre_completo, id_rol, estado_usuario,
      created_at, updated_at,
      rol:rol(id_rol, nombre)
    `)
    .order('email', { ascending: true })
  if (error) throw new Error(`listUsuarios: ${error.message}`)
  return (data ?? []) as unknown as UsuarioConRol[]
}

export async function spToggleUsuarioActivo(
  idUsuario: string,
  estado: UsuarioEstado,
): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_toggle_usuario_activo', {
    p_id_usuario: idUsuario,
    p_estado: estado,
  })
  if (error) throw new Error(`sp_toggle_usuario_activo: ${error.message}`)
}

export async function spAsignarRol(idUsuario: string, idRol: string, nombreCompleto?: string): Promise<void> {
  // Reutiliza sp_update_usuario (00009 — ya existente).
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_update_usuario', {
    p_id_usuario: idUsuario,
    p_nombre_completo: nombreCompleto ?? '',
    p_id_rol: idRol,
  })
  if (error) throw new Error(`sp_update_usuario: ${error.message}`)
}

/**
 * Alta de un usuario (invitation flow). Requires the service_role key —
 * the Auth Admin API (`auth.admin.createUser`) is privileged and MUST NOT
 * run under a user session.
 *
 * Two steps, in order, because `usuario.id_usuario` is a FK to
 * `auth.users(id)` (00006):
 *   1. Create the auth user with a temporary password (email pre-confirmed
 *      so they can sign in immediately).
 *   2. Insert the `usuario` profile row linking that auth id to the tenant
 *      and role.
 *
 * `tenantId` comes from the caller's verified session — NEVER from client
 * input — because the service client bypasses RLS. If step 2 fails we
 * delete the orphaned auth user so the email can be retried.
 */
export async function inviteUsuario(input: {
  tenantId: string
  email: string
  nombreCompleto: string
  idRol: string
  password: string
}): Promise<{ id: string }> {
  const admin = createServiceClient()

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { nombre_completo: input.nombreCompleto },
    // proxy.ts manda a /cambiar-clave hasta que la persona elija la suya.
    app_metadata: { tenant_id: input.tenantId, debe_cambiar_clave: true },
  })
  if (authError || !created.user) {
    throw new Error(`inviteUsuario auth: ${authError?.message ?? 'no user returned'}`)
  }

  const authId = created.user.id

  const { error: rowError } = await admin.from('usuario').insert({
    id_usuario: authId,
    id_tenant: input.tenantId,
    email: input.email,
    nombre_completo: input.nombreCompleto,
    id_rol: input.idRol,
    estado_usuario: 'invitado',
  })
  if (rowError) {
    // Roll back the orphan auth user so a retry can reuse the email.
    await admin.auth.admin.deleteUser(authId)
    throw new Error(`inviteUsuario row: ${rowError.message}`)
  }

  return { id: authId }
}

// ─── Roles ───────────────────────────────────────────────────────────

export async function listRoles(): Promise<RolRow[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('rol').select('*').order('nombre', { ascending: true })
  if (error) throw new Error(`listRoles: ${error.message}`)
  return (data ?? []) as RolRow[]
}

export async function getRol(id: string): Promise<RolRow | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('rol').select('*').eq('id_rol', id).maybeSingle()
  if (error) throw new Error(`getRol: ${error.message}`)
  return (data ?? null) as RolRow | null
}

export async function spCreateRol(input: {
  nombre: string
  permisos: Record<string, string[]>
}): Promise<string> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_create_rol', {
    p_nombre: input.nombre,
    p_permisos: input.permisos,
  })
  if (error) throw new Error(`sp_create_rol: ${error.message}`)
  return data as string
}

export async function spUpdateRol(input: {
  idRol: string
  nombre: string
  permisos: Record<string, string[]>
}): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_update_rol_permisos', {
    p_id_rol: input.idRol,
    p_nombre: input.nombre,
    p_permisos: input.permisos,
  })
  if (error) throw new Error(`sp_update_rol_permisos: ${error.message}`)
}

export async function spDeleteRol(idRol: string): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('sp_delete_rol', { p_id_rol: idRol })
  if (error) throw new Error(`sp_delete_rol: ${error.message}`)
}

// ─── Configuración de etiquetas QR ───────────────────────────────────

/**
 * Medida en milímetros del lado del código QR para las hojas de etiquetas del
 * tenant actual. Si todavía no fue configurada (o el valor guardado quedó
 * fuera de rango), devuelve `QR_LADO_MM_DEFAULT` (35 mm).
 */
export async function getConfiguracionQrLadoMm(): Promise<number> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('configuracion')
    .select('valor')
    .eq('seccion', 'etiquetas')
    .eq('clave', 'qr_lado_mm')
    .maybeSingle()
  if (error || !data) return QR_LADO_MM_DEFAULT
  const n = Number((data as { valor: unknown }).valor)
  if (!Number.isFinite(n) || n < QR_LADO_MM_MIN || n > QR_LADO_MM_MAX) {
    return QR_LADO_MM_DEFAULT
  }
  return Math.round(n)
}

export async function spSetConfiguracionQrLadoMm(
  ladoMm: number,
  ip?: string | null,
): Promise<number> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_set_configuracion_qr_lado_mm', {
    p_lado_mm: ladoMm,
    p_ip: ip ?? null,
  })
  if (error) throw new Error(`sp_set_configuracion_qr_lado_mm: ${error.message}`)
  return Number(data ?? ladoMm)
}

export async function spSetTenantLogo(
  logoUrl: string | null,
  ip?: string | null,
): Promise<string | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('sp_set_tenant_logo', {
    p_logo_url: logoUrl,
    p_ip: ip ?? null,
  })
  if (error) throw new Error(`sp_set_tenant_logo: ${error.message}`)
  return (data as string | null) ?? null
}

/**
 * Sube el logo a `tenant-logos/<tenant>/` y lo deja como logo del tenant.
 *
 * Va con el cliente del usuario, no con service role: las policies de
 * `storage.objects` (00116) atan la carpeta al claim `tenant_id`, así que un
 * `tenantId` equivocado falla en Storage en vez de escribir en otro tenant.
 * El nombre es único por subida para que la URL se pueda cachear para siempre
 * y el navegador nunca muestre el logo viejo.
 */
export async function subirLogoTenant(tenantId: string, file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const formato = detectarFormatoImagen(bytes)
  if (!formato) throw new Error('logo-formato-invalido')

  const supabase = await createServerClient()
  const bucket = supabase.storage.from(LOGO_BUCKET)
  const ruta = `${tenantId}/logo-${randomUUID()}.${EXTENSION_LOGO[formato]}`

  const { error: errSubida } = await bucket.upload(ruta, bytes, {
    contentType: formato,
    cacheControl: '31536000',
    upsert: false,
  })
  if (errSubida) {
    console.error('subirLogoTenant: upload', errSubida.message)
    throw new Error('logo-no-subido')
  }

  const { publicUrl } = bucket.getPublicUrl(ruta).data
  try {
    await spSetTenantLogo(publicUrl)
  } catch (e) {
    // Sin esto el objeto queda huérfano en el bucket: nadie lo referencia.
    await bucket.remove([ruta])
    throw e
  }

  await borrarLogosViejos(bucket, tenantId, ruta)
  return publicUrl
}

/** Deja el tenant sin logo (el shell vuelve al nombre) y vacía su carpeta. */
export async function quitarLogoTenant(tenantId: string): Promise<void> {
  await spSetTenantLogo(null)
  const supabase = await createServerClient()
  await borrarLogosViejos(supabase.storage.from(LOGO_BUCKET), tenantId, null)
}

/**
 * Best-effort: el logo nuevo ya quedó guardado, así que un fallo acá solo deja
 * archivos de más en el bucket. No vale romper la operación del operador por eso.
 */
async function borrarLogosViejos(
  bucket: ReturnType<Awaited<ReturnType<typeof createServerClient>>['storage']['from']>,
  tenantId: string,
  conservar: string | null,
): Promise<void> {
  const { data, error } = await bucket.list(tenantId, { limit: 100 })
  if (error) {
    console.error('borrarLogosViejos: list', error.message)
    return
  }
  const viejos = (data ?? [])
    .map((o) => `${tenantId}/${o.name}`)
    .filter((ruta) => ruta !== conservar)
  if (viejos.length === 0) return
  const { error: errBorrado } = await bucket.remove(viejos)
  if (errBorrado) console.error('borrarLogosViejos: remove', errBorrado.message)
}

// ─── Auditoría ───────────────────────────────────────────────────────

export async function listAuditoria(opts?: {
  entidad?: string
  desde?: string
  hasta?: string
  limit?: number
}): Promise<AuditoriaConActor[]> {
  const supabase = await createServerClient()
  let q = supabase
    .from('auditoria')
    .select(`
      id_auditoria, id_tenant, id_usuario, entidad, entidad_id, accion,
      cambios, ts, ip
    `)
    .order('ts', { ascending: false })
    .limit(opts?.limit ?? 200)
  if (opts?.entidad) q = q.eq('entidad', opts.entidad)
  if (opts?.desde) q = q.gte('ts', opts.desde)
  if (opts?.hasta) q = q.lte('ts', opts.hasta)

  const { data: rawRows, error } = await q
  if (error) throw new Error(`listAuditoria: ${error.message}`)

  const rows = (rawRows ?? []) as AuditoriaRow[]
  if (rows.length === 0) return []

  const userIds = Array.from(
    new Set(rows.map((r) => r.id_usuario).filter((id): id is string => Boolean(id))),
  )

  const userMap = new Map<string, { email: string; nombre_completo: string | null }>()
  if (userIds.length > 0) {
    const { data: users, error: userError } = await supabase
      .from('usuario')
      .select('id_usuario, email, nombre_completo')
      .in('id_usuario', userIds)
    if (userError) throw new Error(`listAuditoria usuario: ${userError.message}`)
    for (const u of users ?? []) {
      userMap.set(u.id_usuario, { email: u.email, nombre_completo: u.nombre_completo })
    }
  }

  return rows.map((r) => {
    const actor = r.id_usuario ? userMap.get(r.id_usuario) : null
    return {
      ...r,
      actor_email: actor?.email ?? null,
      actor_nombre: actor?.nombre_completo ?? null,
    }
  })
}

/** Lista de entidades distintas para el filtro (dinámico). */
export async function listEntidadesAuditoria(): Promise<string[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('auditoria').select('entidad').limit(1000)
  if (error) return []
  const set = new Set<string>()
  for (const r of data ?? []) if (r.entidad) set.add(r.entidad as string)
  return Array.from(set).sort()
}
