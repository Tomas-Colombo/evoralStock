import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { RESERVED_SUBDOMINIOS } from './lib/tenant/subdominio'

/**
 * proxy.ts (Next.js 16 file convention; replaces the deprecated
 * `middleware.ts`). Two responsibilities run here on every page request:
 *
 *  1. Tenant Resolution — design §6 / spec `tenant-resolution.md`
 *     REQ-TR-01..11. Optimistic, non-authoritative (REQ-TR-03): never
 *     queries the DB, only injects an UNVERIFIED `x-utopia-tenant-subdomain`
 *     hint for the DAL's authoritative `verifyTenantMatch()`.
 *
 *  2. Supabase session refresh — the proxy is a Route-Handler-like context
 *     where writing cookies IS allowed, so this is where the refreshed
 *     session token gets persisted. Server Components can read the session
 *     but cannot write cookies, so without this step the token would be
 *     re-refreshed on every request that hits an expired JWT (and, before
 *     the DAL swallowed it, throw "Cookies can only be modified in a Server
 *     Action or Route Handler").
 *
 * Per the Next.js proxy docs, this file stays self-contained (no shared DAL
 * import): the proxy may be deployed separately from the app runtime. The
 * one exception is `lib/tenant/subdominio` — a dependency-free constants
 * module, deliberately kept that way so the reserved list cannot drift
 * between this file and tenant provisioning (see that file's header).
 */

const RESERVED = new Set<string>(RESERVED_SUBDOMINIOS)
const ROOT_PROD = process.env.UTOPIA_ROOT_DOMAIN ?? 'utopia.app'
const ROOT_DEV = process.env.UTOPIA_ROOT_DOMAIN_DEV ?? 'localhost'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name} — set it in .env.local before starting the app`)
  }
  return value
}

export async function proxy(request: NextRequest) {
  // --- 1. Tenant resolution (REQ-TR-04/09/11) ---
  const host = (request.headers.get('host') ?? '').split(':')[0] // strip port
  const root = host.endsWith(ROOT_DEV) ? ROOT_DEV : ROOT_PROD
  const sub = host.endsWith('.' + root) ? host.slice(0, -(root.length + 1)) : ''

  // Only a valid-looking subdomain gets the UNVERIFIED hint header injected.
  // Bare root / reserved subdomains keep the request untouched (REQ-TR-09/11),
  // exactly as before — the DAL is the authoritative tenant check.
  const isTenant = Boolean(sub) && !RESERVED.has(sub)
  const isTrace = process.env.DAL_TRACE === '1'
  const nextOptions = (isTenant || isTrace)
    ? (() => {
        const requestHeaders = new Headers(request.headers)
        if (isTenant) {
          requestHeaders.set('x-utopia-tenant-subdomain', sub)
        }
        if (isTrace) {
          requestHeaders.set('x-dal-path', request.nextUrl.pathname)
        }
        return { request: { headers: requestHeaders } }
      })()
    : undefined

  // --- 2. Supabase session refresh ---
  // `response` is rebuilt inside setAll so the refreshed Set-Cookie headers
  // ride along with the (tenant) request headers. Do NOT run other logic
  // between createServerClient and getUser().
  let response = NextResponse.next(nextOptions)

  const supabase = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next(nextOptions)
          items.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Verifies the JWT and, when near expiry, refreshes it — emitting the
  // Set-Cookie headers captured above. This is the one place that write is
  // legal, which is what keeps the Server Component render from throwing.
  //
  // `getClaims()` and NOT `getUser()`: this project signs with an asymmetric
  // key (ES256), so verification happens locally via WebCrypto against a
  // cached JWKS instead of a round-trip to the Auth API on EVERY request
  // (~260ms measured here). Same guarantee — full signature verification —
  // and it is what the Supabase Next.js proxy example uses.
  const { data: claimsData } = await supabase.auth.getClaims()

  // Cuenta creada con contraseña temporal: hasta que la persona elija la
  // suya, todo la devuelve a /cambiar-clave (el flag lo pone el alta de
  // usuarios y de revendedoras; lo quita changePasswordAction).
  const claims = claimsData?.claims as { app_metadata?: { debe_cambiar_clave?: boolean } } | undefined
  const appMetadata = claims?.app_metadata
  const path = request.nextUrl.pathname
  if (
    appMetadata?.debe_cambiar_clave === true &&
    path !== '/cambiar-clave' &&
    path !== '/login' &&
    !path.startsWith('/api/')
  ) {
    const redirect = NextResponse.redirect(new URL('/cambiar-clave', request.url))
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
    return redirect
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|api/health|favicon.ico|.*\\..*).*)'],
}
