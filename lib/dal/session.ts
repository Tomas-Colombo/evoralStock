import { cache } from 'react'
import { headers } from 'next/headers'
import { AuthorizationError } from './errors'
import { createServerClient, createServiceClient } from './supabase'

/**
 * Shape of `rol.permisos` (JSONB in DB):
 *   { [moduloCodigo: string]: string[] }
 * e.g. { inventario: ['ver', 'crear'], ventas: ['ver'] }.
 * `undefined` means the role row was not loaded yet (fail-closed callers
 * MUST treat it as "no permissions").
 */
export type RolePermissions = Record<string, string[]>

export interface Session {
  user: { id: string; email: string }
  tenantId: string
  /** `rol.id_rol` for the authenticated user; null if the user has no role assigned yet. */
  rolId: string | null
  /** `rol.nombre` for display purposes; null when `rolId` is null. */
  rolNombre: string | null
  /** `rol.permisos` JSONB, normalized to an object. Empty object if role has none. */
  permisos: RolePermissions
  /**
   * Códigos de módulo habilitados para el tenant (`tenant_modulo.habilitado`).
   * Se cargan junto con la sesión para que `requireModuleRole` resuelva en
   * memoria en vez de pagar un round-trip por módulo.
   */
  modulosHabilitados: string[]
  /**
   * `true` si el subdominio que inyectó el proxy pertenece al tenant de esta
   * sesión. `false` cuando no hay header (dev/localhost, Server Action fuera
   * del matcher) o cuando el subdominio resuelve a OTRO tenant.
   * `verifyTenantMatch` es quien decide qué hacer con esto.
   */
  subdominioOk: boolean
  /** `id_revendedora` del usuario si es una revendedora (puesto por el Auth Hook) */
  idRevendedora: string | null
  /** Marca del tenant para el shell. `logoUrl` null → se muestra el nombre. */
  marca: { nombre: string; logoUrl: string | null }
}

/** Claims que nos interesan del access token verificado. */
interface VerifiedClaims {
  sub?: string
  email?: string
  /** Puesto por el Auth Hook (`00008_auth_hook_tenant_id.sql`) como claim top-level. */
  tenant_id?: string
  id_revendedora?: string
  app_metadata?: { tenant_id?: string; debe_cambiar_clave?: boolean }
}

/**
 * La cuenta se creó con una contraseña temporal que escribió un
 * administrador y la persona todavía no eligió la suya. `proxy.ts` lee el
 * mismo claim para no dejarla salir de /cambiar-clave.
 */
export const debeCambiarClave = cache(async (): Promise<boolean> => {
  const supabase = await createServerClient()
  const { data } = await supabase.auth.getClaims()
  const claims = (data?.claims ?? null) as VerifiedClaims | null
  return claims?.app_metadata?.debe_cambiar_clave === true
})

/**
 * Quita la marca de contraseña temporal. `app_metadata` solo lo escribe el
 * service role; después hay que refrescar la sesión para que el JWT nuevo
 * llegue sin la marca.
 */
export async function marcarClaveCambiada(idUsuario: string): Promise<boolean> {
  const admin = createServiceClient()
  const { error } = await admin.auth.admin.updateUserById(idUsuario, {
    app_metadata: { debe_cambiar_clave: null },
  })
  return !error
}

/**
 * Design §5. El Auth Hook (`00008_auth_hook_tenant_id.sql`) pone `tenant_id`
 * como CLAIM top-level del JWT; `app_metadata.tenant_id` queda como fallback
 * de compatibilidad (sesiones viejas emitidas antes de ese hook). Si faltan
 * las dos, falla cerrado con `AuthorizationError('no-session')` (REQ-AUTH-10).
 *
 * Usa `getClaims()` y NO `getUser()`. El proyecto firma con clave asimétrica
 * (ES256 — ver `/auth/v1/.well-known/jwks.json`), así que `getClaims()`
 * verifica la firma LOCALMENTE con WebCrypto contra un JWKS cacheado: cero
 * round-trips, verificación criptográfica completa. `getUser()` pegaba a la
 * Auth API en cada request (~260ms medidos). La doc de Supabase es explícita:
 * "Prefer this method over getUser which always sends a request to the Auth
 * server for each JWT" — `getUser` queda para cuando hace falta el registro
 * de usuario fresco del servidor, no para proteger páginas.
 *
 * Esto además ENDURECE lo que había: antes se leía `tenant_id` decodificando
 * el JWT en base64 sin verificar firma. Ahora los claims vienen de un token
 * verificado.
 *
 * Wrapped in React's `cache()` so multiple Server Components/Actions in the
 * same request render pass share one verified session.
 */
export const verifySession = cache(async (): Promise<Session> => {
  const supabase = await createServerClient()
  const { data: claimsData } = await supabase.auth.getClaims()

  const claims = (claimsData?.claims ?? null) as VerifiedClaims | null
  if (!claims?.sub) {
    throw new AuthorizationError('no-session')
  }

  const tenantId = claims.tenant_id ?? claims.app_metadata?.tenant_id
  if (!tenantId) {
    throw new AuthorizationError('no-session')
  }

  // Rol + permisos + módulos habilitados + verificación de subdominio, TODO
  // en un round-trip (`sp_session_context`, 00041). Antes eran tres queries
  // secuenciales repartidos entre este archivo, `tenant.ts` y `guard.ts`;
  // los layouts anidados que los disparaban no los podían paralelizar.
  //
  // Si la fila de `usuario` no existe o no tiene rol, NO fallamos acá — la
  // sesión es válida, solo que sin privilegios. El guard falla cerrado
  // después, cuando se intenta una acción protegida.
  const subdominio = (await headers()).get('x-utopia-tenant-subdomain')

  const { data } = await supabase.rpc('sp_session_context', {
    p_subdominio: subdominio,
  })
  const ctx = (data ?? null) as SessionContextRpc | null

  if (claims.id_revendedora) {
    // Para revendedoras, la RLS restrictiva (00078) deniega SELECT directo a usuario, rol y tenant_modulo
    // para prevenir fuga de datos hacia PostgREST.
    // Usamos el cliente administrativo para resolver su rol/permisos (invariante REQ-RV-ACC-03)
    // y el estado del módulo revendedoras para el tenant.
    const admin = createServiceClient()
    const [{ data: userRow }, { data: modRow }, { data: tenantRow }] = await Promise.all([
      admin
        .from('usuario')
        .select('id_rol, rol:id_rol(nombre, permisos)')
        .eq('id_usuario', claims.sub)
        .maybeSingle(),
      admin
        .from('tenant_modulo')
        .select('habilitado, modulo!inner(codigo)')
        .eq('id_tenant', tenantId)
        .eq('modulo.codigo', 'revendedoras')
        .maybeSingle(),
      subdominio
        ? admin
            .from('tenant')
            .select('id_tenant')
            .eq('id_tenant', tenantId)
            .eq('subdominio', subdominio)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    const rolObj = userRow?.rol as { nombre?: string; permisos?: RolePermissions } | null
    const rolNombre = rolObj?.nombre ?? 'Revendedora'
    const permisos = rolObj?.permisos ?? { revendedoras: ['ver_propio', 'declarar'] }
    const moduloHabilitado = Boolean(modRow?.habilitado)
    const subdominioOk = subdominio ? Boolean(tenantRow) : false

    return {
      user: { id: claims.sub, email: claims.email ?? '' },
      tenantId,
      rolId: userRow?.id_rol ?? 'revendedora-role-id',
      rolNombre,
      permisos,
      modulosHabilitados: moduloHabilitado ? ['revendedoras'] : [],
      subdominioOk,
      idRevendedora: claims.id_revendedora,
      marca: marcaDe(ctx),
    }
  }

  return {
    user: { id: claims.sub, email: claims.email ?? '' },
    tenantId,
    rolId: ctx?.ok ? ctx.rol_id : null,
    rolNombre: ctx?.ok ? ctx.rol_nombre : null,
    permisos: ctx?.ok ? ctx.permisos ?? {} : {},
    modulosHabilitados: ctx?.ok ? ctx.modulos_habilitados ?? [] : [],
    subdominioOk: ctx?.ok ? ctx.subdominio_ok : false,
    idRevendedora: null,
    marca: marcaDe(ctx),
  }
})

/** Payload de `sp_session_context` (00041). */
type SessionContextRpc =
  | {
      ok: true
      tenant_id: string
      rol_id: string | null
      rol_nombre: string | null
      permisos: RolePermissions | null
      subdominio_ok: boolean
      modulos_habilitados: string[] | null
      marca?: { nombre: string; logo_url: string | null } | null
    }
  | { ok: false; reason: 'no-session' }

function marcaDe(ctx: SessionContextRpc | null): Session['marca'] {
  const m = ctx?.ok ? ctx.marca : null
  return { nombre: m?.nombre ?? '', logoUrl: m?.logo_url ?? null }
}
