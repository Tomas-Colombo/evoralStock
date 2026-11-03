import fs from 'node:fs'
import path from 'node:path'
import {
  ADMIN,
  PASSWORD_USER,
  SEED_FILE,
  TENANT_NOMBRE,
  TENANT_SUBDOMAIN,
  VENDEDOR,
  type E2EUser,
} from '../config/env'
import { serviceRoleClient, unwrap } from './supabase'
import { accionesDelModulo } from '../../lib/types/administracion'

/**
 * Provisioning of the throwaway tenant every spec runs inside.
 *
 * This mirrors `scripts/provision-tenant.mts` (the real onboarding path) plus
 * the minimum reference data an operator would load on day one: categories,
 * a supplier, a cash account, an expense category, a margin rule and an
 * instalment plan. Anything a spec *asserts on* is created through the UI —
 * this only builds the world those flows need to exist in.
 *
 * The tenant is dropped and rebuilt on every run. A shared, mutated tenant
 * makes failures depend on run order; a fresh one makes every spec start from
 * a state that is written down in this file.
 */

const ACCIONES = ['ver', 'crear', 'editar', 'eliminar'] as const

/** Full access, used by the admin actor. */
const PERMISOS_ADMIN: Record<string, string[]> = {}

/** Deliberately narrow — drives the authorization specs. */
const PERMISOS_VENDEDOR: Record<string, string[]> = { ventas: ['ver', 'crear'] }

export interface SeedData {
  tenantId: string
  subdominio: string
  rolAdminId: string
  rolVendedorId: string
  /** Category WITHOUT sizes — products in it skip the size picker. */
  categoriaSimple: { id: string; nombre: string }
  /** Category WITH sizes — exercises the size-aware paths. */
  categoriaConTalles: { id: string; nombre: string; talles: string[] }
  proveedorMayorista: { id: string; nombre: string }
  proveedorConsignatario: { id: string; nombre: string }
  cuentaCaja: { id: string; nombre: string }
  categoriaGasto: { id: string; nombre: string }
  reglaMargen: { id: string; nombre: string }
}

export function readSeed(): SeedData {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(
      `Missing ${SEED_FILE}. Run the Playwright "setup" project first ` +
        '(it runs automatically as a dependency of the chromium project).',
    )
  }
  return JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) as SeedData
}

/**
 * Turns a module on or off for the e2e tenant. Which modules a customer has is
 * the operator's call (service-role), not something the tenant admin can do
 * from the app, so specs flip it here the same way.
 */
export async function setModuloHabilitado(
  tenantId: string,
  codigo: string,
  habilitado: boolean,
): Promise<void> {
  const db = serviceRoleClient()
  const { id_modulo } = unwrap(
    await db.from('modulo').select('id_modulo').eq('codigo', codigo).single<{ id_modulo: string }>(),
    `modulo ${codigo}`,
  )
  const { error } = await db
    .from('tenant_modulo')
    .update({ habilitado })
    .eq('id_tenant', tenantId)
    .eq('id_modulo', id_modulo)
  if (error) throw new Error(`tenant_modulo ${codigo}: ${error.message}`)
}

function writeSeed(seed: SeedData): void {
  fs.mkdirSync(path.dirname(SEED_FILE), { recursive: true })
  fs.writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2))
}

/**
 * Removes the previous run's tenant. `tenant` cascades to rol,
 * tenant_modulo, usuario and every business table, but auth users live
 * outside that graph, so they go first and explicitly — exactly like the
 * rollback path in `scripts/provision-tenant.mts`.
 */
async function dropExistingTenant(): Promise<void> {
  const db = serviceRoleClient()

  const { data: tenant } = await db
    .from('tenant')
    .select('id_tenant')
    .eq('subdominio', TENANT_SUBDOMAIN)
    .maybeSingle<{ id_tenant: string }>()

  if (tenant) {
    const { data: usuarios } = await db
      .from('usuario')
      .select('id_usuario')
      .eq('id_tenant', tenant.id_tenant)

    for (const u of (usuarios ?? []) as Array<{ id_usuario: string }>) {
      await db.auth.admin.deleteUser(u.id_usuario).catch(() => {})
    }

    const { error } = await db.from('tenant').delete().eq('id_tenant', tenant.id_tenant)
    if (error) throw new Error(`drop tenant: ${error.message}`)
  }

  // Safety net: an auth user can survive a half-failed previous run without a
  // `usuario` row pointing at it, and `createUser` would then fail on the
  // unique email.
  await deleteAuthUsersByEmail([ADMIN.email, VENDEDOR.email, PASSWORD_USER.email])
}

async function deleteAuthUsersByEmail(emails: string[]): Promise<void> {
  const db = serviceRoleClient()
  const wanted = new Set(emails.map((e) => e.toLowerCase()))

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    const users = data?.users ?? []
    for (const user of users) {
      if (user.email && wanted.has(user.email.toLowerCase())) {
        await db.auth.admin.deleteUser(user.id).catch(() => {})
      }
    }
    if (users.length < 200) break
  }
}

async function crearUsuario(
  user: E2EUser,
  tenantId: string,
  rolId: string,
): Promise<void> {
  const db = serviceRoleClient()

  const { data, error } = await db.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { nombre_completo: user.nombre },
    // The Auth Hook (migration 00008) reads `tenant_id` from `public.usuario`;
    // app_metadata is the documented compatibility fallback.
    app_metadata: { tenant_id: tenantId },
  })
  if (error || !data.user) {
    throw new Error(`createUser(${user.email}): ${error?.message ?? 'no user returned'}`)
  }

  const { error: perfilError } = await db.from('usuario').insert({
    id_usuario: data.user.id,
    id_tenant: tenantId,
    email: user.email,
    nombre_completo: user.nombre,
    id_rol: rolId,
    estado_usuario: 'activo',
  })
  if (perfilError) throw new Error(`usuario(${user.email}): ${perfilError.message}`)
}

export async function provisionTenant(): Promise<SeedData> {
  const db = serviceRoleClient()

  await dropExistingTenant()

  const { data: modulos, error: modulosError } = await db
    .from('modulo')
    .select('id_modulo, codigo')
  if (modulosError) throw new Error(`modulo: ${modulosError.message}`)
  const catalogo = (modulos ?? []) as Array<{ id_modulo: string; codigo: string }>
  if (catalogo.length === 0) {
    throw new Error('The `modulo` catalog is empty — apply supabase/seed.sql first.')
  }
  for (const m of catalogo) {
    const permitidas = accionesDelModulo(m.codigo) ?? [...ACCIONES]
    PERMISOS_ADMIN[m.codigo] =
      m.codigo === 'revendedoras'
        ? permitidas.filter((a) => a !== 'ver_propio' && a !== 'declarar')
        : [...permitidas]
  }

  const tenant = unwrap(
    await db
      .from('tenant')
      .insert({ nombre_comercial: TENANT_NOMBRE, subdominio: TENANT_SUBDOMAIN })
      .select('id_tenant')
      .single(),
    'tenant',
  ) as { id_tenant: string }
  const tenantId = tenant.id_tenant

  const roles = unwrap(
    await db
      .from('rol')
      .insert([
        { id_tenant: tenantId, nombre: 'Administrador', permisos: PERMISOS_ADMIN },
        { id_tenant: tenantId, nombre: 'Vendedor', permisos: PERMISOS_VENDEDOR },
      ])
      .select('id_rol, nombre'),
    'rol',
  ) as Array<{ id_rol: string; nombre: string }>

  const rolAdminId = roles.find((r) => r.nombre === 'Administrador')!.id_rol
  const rolVendedorId = roles.find((r) => r.nombre === 'Vendedor')!.id_rol

  const { error: tmError } = await db.from('tenant_modulo').insert(
    catalogo.map((m) => ({ id_tenant: tenantId, id_modulo: m.id_modulo, habilitado: true })),
  )
  if (tmError) throw new Error(`tenant_modulo: ${tmError.message}`)

  const { error: cfgError } = await db
    .from('configuracion')
    .insert({ id_tenant: tenantId, seccion: 'perfil', clave: 'theme', valor: 'light', tipo: 'string' })
  if (cfgError) throw new Error(`configuracion: ${cfgError.message}`)

  await crearUsuario(ADMIN, tenantId, rolAdminId)
  await crearUsuario(VENDEDOR, tenantId, rolVendedorId)
  await crearUsuario(PASSWORD_USER, tenantId, rolVendedorId)

  // ─── Reference data ────────────────────────────────────────────────

  const categorias = unwrap(
    await db
      .from('categoria')
      .insert([
        {
          id_tenant: tenantId,
          nombre: 'Accesorios E2E',
          descripcion: 'Categoría sin talles usada por los flujos base',
          talles: [],
        },
        {
          id_tenant: tenantId,
          nombre: 'Remeras E2E',
          descripcion: 'Categoría con talles',
          talles: ['S', 'M', 'L'],
        },
      ])
      .select('id_categoria, nombre, talles'),
    'categoria',
  ) as Array<{ id_categoria: string; nombre: string; talles: string[] }>

  const categoriaSimple = categorias.find((c) => c.nombre === 'Accesorios E2E')!
  const categoriaConTalles = categorias.find((c) => c.nombre === 'Remeras E2E')!

  const proveedores = unwrap(
    await db
      .from('proveedor')
      .insert([
        {
          id_tenant: tenantId,
          nombre: 'Mayorista E2E',
          tipo: 'mayorista',
          dias_rotacion: 30,
          activo: true,
        },
        {
          id_tenant: tenantId,
          nombre: 'Consignatario E2E',
          tipo: 'consignatario',
          dias_rotacion: 45,
          activo: true,
        },
      ])
      .select('id_proveedor, nombre'),
    'proveedor',
  ) as Array<{ id_proveedor: string; nombre: string }>

  const cuenta = unwrap(
    await db
      .from('cuenta_destino')
      .insert({
        id_tenant: tenantId,
        nombre: 'Caja E2E',
        tipo: 'efectivo',
        activo: true,
        es_predeterminada: true,
      })
      .select('id_cuenta_destino, nombre')
      .single(),
    'cuenta_destino',
  ) as { id_cuenta_destino: string; nombre: string }

  const categoriaGasto = unwrap(
    await db
      .from('categoria_gasto')
      .insert({
        id_tenant: tenantId,
        nombre: 'Servicios E2E',
        descripcion: 'Categoría de gasto base',
        presupuesto_mensual: 100000,
        activa: true,
      })
      .select('id_categoria_gasto, nombre')
      .single(),
    'categoria_gasto',
  ) as { id_categoria_gasto: string; nombre: string }

  // Without a margin rule every product resolves to `sin-precio-lista` and no
  // sale can be completed. 60% matches the dev tenant's own rule.
  const regla = unwrap(
    await db
      .from('regla_precio')
      .insert({
        id_tenant: tenantId,
        nombre: 'Margen base E2E',
        tipo_regla: 'margen',
        tipo_valor: 'porcentaje',
        valor: 0.6,
        alcance: 'global',
        prioridad: 0,
      })
      .select('id_regla, nombre')
      .single(),
    'regla_precio',
  ) as { id_regla: string; nombre: string }

  const { error: planError } = await db
    .from('plan_cuotas')
    .insert({ id_tenant: tenantId, cuotas: 3, activo: true })
  if (planError) throw new Error(`plan_cuotas: ${planError.message}`)

  const seed: SeedData = {
    tenantId,
    subdominio: TENANT_SUBDOMAIN,
    rolAdminId,
    rolVendedorId,
    categoriaSimple: { id: categoriaSimple.id_categoria, nombre: categoriaSimple.nombre },
    categoriaConTalles: {
      id: categoriaConTalles.id_categoria,
      nombre: categoriaConTalles.nombre,
      talles: categoriaConTalles.talles,
    },
    proveedorMayorista: (() => {
      const p = proveedores.find((x) => x.nombre === 'Mayorista E2E')!
      return { id: p.id_proveedor, nombre: p.nombre }
    })(),
    proveedorConsignatario: (() => {
      const p = proveedores.find((x) => x.nombre === 'Consignatario E2E')!
      return { id: p.id_proveedor, nombre: p.nombre }
    })(),
    cuentaCaja: { id: cuenta.id_cuenta_destino, nombre: cuenta.nombre },
    categoriaGasto: { id: categoriaGasto.id_categoria_gasto, nombre: categoriaGasto.nombre },
    reglaMargen: { id: regla.id_regla, nombre: regla.nombre },
  }

  writeSeed(seed)
  return seed
}
