/**
 * Tenant provisioning — platform operator tool, run from a trusted machine.
 *
 * This is DELIBERATELY not a page in the app. Provisioning creates tenants
 * and writes with the service role, which bypasses RLS entirely: a web
 * surface for it would be the one door in the system that, if forced,
 * exposes every customer at once. Alta happens a few times a month, by one
 * person, on a laptop — the cost of a UI is not worth that blast radius.
 *
 * Do not confuse this with `inviteUsuario` (lib/dal/administracion). That
 * one adds a TEAMMATE to an existing tenant and is correctly exposed in the
 * app. This one onboards a new CUSTOMER company.
 *
 * Usage:
 *   npm run provision-tenant -- \
 *     --nombre "Boutique Alfa" \
 *     --subdominio boutique-alfa \
 *     --email dueño@boutiquealfa.com \
 *     --admin "Ana Álvarez" \
 *     [--password <temporal>] \
 *     [--modulos ventas,inventario] \
 *     [--dry-run]
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { parseArgs } from 'node:util'
import { randomInt } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  SUBDOMINIO_REASON_LABEL,
  validarSubdominio,
} from '../lib/tenant/subdominio.ts'
import { CATALOGO_PERMISOS } from '../lib/types/administracion.ts'

/** Every action the permission model recognizes (`rol.permisos`, REQ-AG-02). */
const ACCIONES = ['ver', 'crear', 'editar', 'eliminar'] as const

/** Temp password charset, minus characters that are ambiguous when read aloud. */
const PASSWORD_CHARS =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

function generarPassword(len = 16): string {
  let out = ''
  for (let i = 0; i < len; i++) out += PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]
  return out
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    fatal(`Falta ${name}. Corré el script con --env-file=.env.local`)
  }
  return value
}

function fatal(message: string): never {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

interface Opciones {
  nombre: string
  subdominio: string
  email: string
  admin: string
  password: string
  modulos: string[] | null
  dryRun: boolean
}

function parseOpciones(): Opciones {
  const { values } = parseArgs({
    options: {
      nombre: { type: 'string' },
      subdominio: { type: 'string' },
      email: { type: 'string' },
      admin: { type: 'string' },
      password: { type: 'string' },
      modulos: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })

  const faltantes = (['nombre', 'subdominio', 'email', 'admin'] as const).filter(
    (k) => !values[k]?.trim(),
  )
  if (faltantes.length > 0) {
    fatal(
      `Faltan argumentos obligatorios: ${faltantes.map((f) => `--${f}`).join(', ')}\n` +
        '  Ver el encabezado de scripts/provision-tenant.mts para un ejemplo completo.',
    )
  }

  const subdominio = values.subdominio!.trim()
  const check = validarSubdominio(subdominio)
  if (!check.ok) fatal(`Subdominio "${subdominio}": ${SUBDOMINIO_REASON_LABEL[check.reason]}`)

  const email = values.email!.trim().toLowerCase()
  if (!email.includes('@') || email.length < 5) fatal(`Email inválido: "${email}"`)

  const password = values.password?.trim() || generarPassword()
  if (password.length < 8) fatal('La contraseña temporal debe tener al menos 8 caracteres')

  return {
    nombre: values.nombre!.trim(),
    subdominio,
    email,
    admin: values.admin!.trim(),
    password,
    modulos:
      values.modulos
        ?.split(',')
        .map((m) => m.trim())
        .filter(Boolean) ?? null,
    dryRun: values['dry-run'] ?? false,
  }
}

const MODULOS_NUCLEO = [
  'administracion',
  'inventario',
  'ventas',
  'precios',
  'gastos',
  'reportes',
] as const

const MODULOS_OPCIONALES = ['revendedoras', 'consignaciones', 'rendiciones'] as const

/**
 * Resolves which modules the new tenant gets. The core modules are ALWAYS
 * included. `--modulos` accepts only optional modules (`revendedoras`,
 * `consignaciones`, `rendiciones`) and enforces that the consignment pair
 * (`consignaciones` + `rendiciones`) is configured together.
 *
 * If `codigos` is `null` (not specified), all modules in the catalog are
 * provisioned.
 */
async function resolverModulos(
  db: SupabaseClient,
  codigos: string[] | null,
): Promise<Array<{ id_modulo: string; codigo: string }>> {
  const { data, error } = await db.from('modulo').select('id_modulo, codigo')
  if (error) throw new Error(`No se pudo leer el catálogo de módulos: ${error.message}`)

  const catalogo = (data ?? []) as Array<{ id_modulo: string; codigo: string }>
  if (catalogo.length === 0) {
    throw new Error('El catálogo `modulo` está vacío — aplicá supabase/seed.sql primero')
  }
  if (!codigos) return catalogo

  const porCodigo = new Map(catalogo.map((m) => [m.codigo, m]))

  const enNucleo = codigos.filter((c) => (MODULOS_NUCLEO as readonly string[]).includes(c))
  if (enNucleo.length > 0) {
    throw new Error(
      `Los módulos del núcleo se incluyen siempre y no deben pasarse en --modulos: ${enNucleo.join(', ')}`,
    )
  }

  const desconocidos = codigos.filter(
    (c) => !(MODULOS_OPCIONALES as readonly string[]).includes(c),
  )
  if (desconocidos.length > 0) {
    throw new Error(
      `Módulos inexistentes u obligatorios: ${desconocidos.join(', ')}. ` +
        `Opcionales disponibles: ${MODULOS_OPCIONALES.join(', ')}`,
    )
  }

  const tieneCons = codigos.includes('consignaciones')
  const tieneRend = codigos.includes('rendiciones')
  if (tieneCons !== tieneRend) {
    throw new Error(
      'El paquete de consignación exige habilitar tanto "consignaciones" como "rendiciones".',
    )
  }

  const codigosFinales = Array.from(new Set([...MODULOS_NUCLEO, ...codigos]))
  return codigosFinales.map((c) => porCodigo.get(c)!)
}

async function provision(opts: Opciones): Promise<void> {
  const db = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  // Pre-flight. Not a substitute for the unique constraint on
  // `tenant.subdominio` (a race would still hit it), just a clearer error
  // than a raw Postgres violation for the common case.
  const { data: existente } = await db
    .from('tenant')
    .select('id_tenant')
    .eq('subdominio', opts.subdominio)
    .maybeSingle()
  if (existente) fatal(`Ya existe un tenant con el subdominio "${opts.subdominio}"`)

  const modulos = await resolverModulos(db, opts.modulos)

  if (opts.dryRun) {
    console.log('\n— dry run, no se escribió nada —')
    console.log(`  Tenant     ${opts.nombre} (${opts.subdominio})`)
    console.log(`  Admin      ${opts.admin} <${opts.email}>`)
    console.log(`  Módulos    ${modulos.map((m) => m.codigo).join(', ')}`)
    console.log(`  URL        https://${opts.subdominio}.${process.env.UTOPIA_ROOT_DOMAIN ?? 'utopia.app'}\n`)
    return
  }

  // Order is forced by the schema: `usuario.id_rol` is NOT NULL and
  // `usuario.id_usuario` is a FK to `auth.users(id)` (00006), so the auth
  // user and the rol both have to exist before the profile row.
  //
  // The profile row is also what makes the tenant usable at all: the Auth
  // Hook (00008) reads `tenant_id` from `public.usuario`, NOT from
  // app_metadata. Without that row the JWT carries no tenant claim and
  // every RLS policy matches zero rows.
  let tenantId: string | null = null
  let authUserId: string | null = null

  try {
    const { data: tenant, error: tenantError } = await db
      .from('tenant')
      .insert({ nombre_comercial: opts.nombre, subdominio: opts.subdominio })
      .select('id_tenant')
      .single()
    if (tenantError) throw new Error(`tenant: ${tenantError.message}`)
    tenantId = tenant.id_tenant as string

    const { data: rol, error: rolError } = await db
      .from('rol')
      .insert({
        id_tenant: tenantId,
        nombre: 'Administrador',
        permisos: Object.fromEntries(
          modulos.map((m) => {
            const permitidas = CATALOGO_PERMISOS[m.codigo] ?? [...ACCIONES]
            return [
              m.codigo,
              m.codigo === 'revendedoras'
                ? permitidas.filter((a) => a !== 'ver_propio' && a !== 'declarar')
                : permitidas,
            ]
          }),
        ),
      })
      .select('id_rol')
      .single()
    if (rolError) throw new Error(`rol: ${rolError.message}`)
    const rolId = rol.id_rol as string

    const { error: modError } = await db.from('tenant_modulo').insert(
      modulos.map((m) => ({ id_tenant: tenantId, id_modulo: m.id_modulo, habilitado: true })),
    )
    if (modError) throw new Error(`tenant_modulo: ${modError.message}`)

    const { data: created, error: authError } = await db.auth.admin.createUser({
      email: opts.email,
      password: opts.password,
      email_confirm: true,
      user_metadata: { nombre_completo: opts.admin },
      app_metadata: { tenant_id: tenantId },
    })
    if (authError || !created.user) {
      throw new Error(`auth: ${authError?.message ?? 'no user returned'}`)
    }
    authUserId = created.user.id

    const { error: usuarioError } = await db.from('usuario').insert({
      id_usuario: authUserId,
      id_tenant: tenantId,
      email: opts.email,
      nombre_completo: opts.admin,
      id_rol: rolId,
      estado_usuario: 'invitado',
    })
    if (usuarioError) throw new Error(`usuario: ${usuarioError.message}`)
  } catch (error) {
    // Roll back in reverse. A half-provisioned tenant is worse than none:
    // it holds the subdomain hostage and, without an admin user, nobody can
    // ever log in to fix it. Deleting the tenant cascades to rol,
    // tenant_modulo and usuario (all FK `on delete cascade`); the auth user
    // lives outside that graph and has to go first and explicitly.
    if (authUserId) await db.auth.admin.deleteUser(authUserId).catch(() => {})
    if (tenantId) await db.from('tenant').delete().eq('id_tenant', tenantId)
    throw error
  }

  const root = process.env.UTOPIA_ROOT_DOMAIN ?? 'utopia.app'
  console.log(`\n✓ Tenant "${opts.nombre}" creado\n`)
  console.log(`  URL                  https://${opts.subdominio}.${root}`)
  console.log(`  Admin                ${opts.email}`)
  console.log(`  Contraseña temporal  ${opts.password}`)
  console.log(`  Módulos              ${modulos.map((m) => m.codigo).join(', ')}\n`)
  console.log('  Compartí la contraseña por un canal seguro. Desde adentro, el')
  console.log('  admin invita a su equipo en Administración → Usuarios.\n')
}

provision(parseOpciones()).catch((error: unknown) => {
  fatal(`No se pudo crear el tenant: ${(error as Error).message}`)
})
