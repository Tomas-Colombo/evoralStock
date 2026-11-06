import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { createAnonTestClient, createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { CATALOGO_PERMISOS } from '@/lib/types/administracion'

/**
 * True only when all three `_TEST` Supabase env vars are present. Every
 * `tests/db/*` suite gates its `describe` block on this so the suite still
 * imports and type-checks cleanly (and shows as a passing "skip") on a
 * checkout with no local Supabase stack running.
 */
export const hasTestDb =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL_TEST) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY_TEST) &&
  // `createAnonTestClient` needs this third one. Omitting it here made the
  // gate report "test DB available" and then let the suites fail deep inside
  // a fixture instead of skipping cleanly.
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST)

/**
 * Generates a unique, collision-safe fixture slug prefixed `test_<uuid>_`
 * (design §12 test-project safety note), so repeated runs never collide on
 * unique columns like `tenant.subdominio`.
 *
 * @example withScopedTenant('acme') // => 'test_3f9c2e40-...-acme'
 */
export function withScopedTenant(prefix: string): string {
  return `test_${randomUUID()}_${prefix}`
}

/**
 * Turns a PostgREST result into the row, or throws an error that says WHAT
 * went wrong.
 *
 * Fixtures used to destructure only `data` and throw `fixture insert failed:
 * tenant is null`, which hides the actual constraint, permission or
 * validation error behind a message that is the same for every cause. Every
 * minute spent guessing at one of those is a minute the error message should
 * have saved.
 */
export function unwrapFixture<T>(what: string, res: PostgrestSingleResponse<T>): T {
  // Typed with the library's own `PostgrestSingleResponse<T>` rather than a
  // hand-written `{ data: T | null; error: ... | null }`. That shape matches
  // BOTH arms of PostgREST's discriminated union, so TypeScript resolved `T`
  // against the failure arm (`data: null`) and every call site came back as
  // `never`. Using the real type means `T` is inferred from the success arm,
  // which is the row.
  if (res.error) {
    const code = res.error.code ? ` [${res.error.code}]` : ''
    const details = res.error.details ? ` — ${res.error.details}` : ''
    throw new Error(`fixture ${what} failed${code}: ${res.error.message}${details}`)
  }
  if (res.data === null || res.data === undefined) {
    throw new Error(`fixture ${what} returned no row (no error reported)`)
  }
  return res.data
}

export interface TenantFixture {
  serviceRole: ReturnType<typeof createServiceRoleTestClient>
  tenantId: string
  rolId: string
  userId: string
  email: string
  password: string
}

/**
 * Creates a complete, isolated tenant: `tenant` + `rol` + a real Supabase Auth
 * user + the matching `usuario` row.
 *
 * The `usuario` row is what makes this more than a convenience. The Auth Hook
 * (`custom_access_token_hook`, migration 00008) reads `usuario.id_tenant` to
 * stamp the `tenant_id` claim, so a fixture that skips it produces a session
 * with NO claim — and every RLS policy then silently matches zero rows, which
 * reads exactly like "isolation works" while proving nothing.
 */
// Permisos completos del catálogo (menos ver_propio/declarar de revendedoras) para que RLS restrictivas por permiso no bloqueen al admin del fixture (igual que provision-tenant).
const PERMISOS_ADMIN_FIXTURE: Record<string, string[]> = Object.fromEntries(
  Object.entries(CATALOGO_PERMISOS).map(([modulo, acciones]) => [
    modulo,
    modulo === 'revendedoras'
      ? acciones.filter((a) => a !== 'ver_propio' && a !== 'declarar')
      : [...acciones],
  ]),
)

export async function createTenantWithUser(prefix: string): Promise<TenantFixture> {
  const serviceRole = createServiceRoleTestClient()

  const tenant = unwrapFixture(
    'tenant insert',
    await serviceRole
      .from('tenant')
      .insert({ nombre_comercial: `Fixture ${prefix}`, subdominio: withScopedTenant(prefix) })
      .select('id_tenant')
      .single(),
  )

  const rol = unwrapFixture(
    'rol insert',
    await serviceRole
      .from('rol')
      .insert({ id_tenant: tenant.id_tenant, nombre: 'Administrador', permisos: PERMISOS_ADMIN_FIXTURE })
      .select('id_rol')
      .single(),
  )

  const email = `${withScopedTenant(prefix)}@example.com`
  const password = 'Fixture-Password-1!'

  const { data: authUser, error: authError } = await serviceRole.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authError) throw new Error(`fixture auth user creation failed: ${authError.message}`)
  if (!authUser?.user) throw new Error('fixture auth user creation returned no user')

  unwrapFixture(
    'usuario insert',
    await serviceRole
      .from('usuario')
      .insert({
        id_usuario: authUser.user.id,
        id_tenant: tenant.id_tenant,
        email,
        nombre_completo: `Fixture User ${prefix}`,
        id_rol: rol.id_rol,
      })
      .select('id_usuario')
      .single(),
  )

  return {
    serviceRole,
    tenantId: tenant.id_tenant as string,
    rolId: rol.id_rol as string,
    userId: authUser.user.id,
    email,
    password,
  }
}

/**
 * Signs the fixture user in for real and returns an anon-key client carrying
 * the resulting access token.
 *
 * Deliberately a real `signInWithPassword` rather than a hand-made token: the
 * point of these suites is to exercise the `authenticated` role WITH the
 * claim the Auth Hook actually issues. A hand-rolled JWT would test our own
 * idea of the token, not GoTrue's.
 */
export async function signInAs(fixture: { email: string; password: string }) {
  // Signs in through an ANON client, the way the app does. Using the
  // service_role client for this would work, but it muddles which key is
  // being exercised — and that confusion is what hid the session-leak bug.
  const { data, error } = await createAnonTestClient().auth.signInWithPassword({
    email: fixture.email,
    password: fixture.password,
  })
  if (error) throw new Error(`fixture sign-in failed: ${error.message}`)

  const token = data?.session?.access_token
  if (!token) throw new Error('fixture sign-in returned no access token')

  return createAnonTestClient(token)
}

/**
 * Returns an anon-key client with NO session — the `anon` role, pre-login.
 * Useful for asserting that a table is unreachable before authentication.
 */
export function anonClient() {
  return createAnonTestClient()
}

/**
 * A real Auth user with NO `usuario` row, and therefore no tenant.
 *
 * This is the Auth Hook's other branch: with no `usuario` row to read,
 * `custom_access_token_hook` strips `tenant_id` from the claims rather than
 * emitting an empty one (migration 00008). The resulting session is genuinely
 * authenticated yet belongs to no tenant, which is the only honest way to test
 * that a tenant-scoped policy returns nothing — as opposed to a malformed
 * token, which fails at the gateway and never reaches a policy at all.
 */
export async function createUserWithoutTenant(prefix: string) {
  const serviceRole = createServiceRoleTestClient()
  const email = `${withScopedTenant(prefix)}@example.com`
  const password = 'Fixture-Password-1!'

  const { data, error } = await serviceRole.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`fixture tenantless user creation failed: ${error.message}`)
  if (!data?.user) throw new Error('fixture tenantless user creation returned no user')

  return { serviceRole, email, password, userId: data.user.id }
}

/**
 * No-op. Fixtures are scoped with `withScopedTenant` (a fresh UUID per row),
 * and CI rebuilds the database from migrations for every run, so there is
 * nothing to reset between suites. Kept because suites reference it.
 */
export async function resetTestData(): Promise<void> {
  // Intentionally empty — see the doc comment above.
}

/**
 * Ejecuta una consulta SQL sincrónica vía psql con variables de entorno o valores por defecto del stack local.
 */
export function runPsql(query: string): string {
  const host = process.env.SUPABASE_DB_HOST || '127.0.0.1'
  const port = process.env.SUPABASE_DB_PORT || '54322'
  const user = process.env.SUPABASE_DB_USER || 'postgres'
  const db = process.env.SUPABASE_DB_NAME || 'postgres'
  const password = process.env.PGPASSWORD || 'postgres'
  return execSync(`psql -h ${host} -p ${port} -U ${user} -d ${db} -tA -c "${query.replace(/"/g, '\\"')}"`, {
    env: { ...process.env, PGPASSWORD: password },
  }).toString().trim()
}

