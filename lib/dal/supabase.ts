import {
  createBrowserClient as createSupabaseBrowserClient,
  createServerClient as createSupabaseServerClient,
} from '@supabase/ssr'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'

interface RequestTraceContext {
  id: string
  seq: number
  path?: string
  action: boolean
}

const getRequestTrace = cache((): RequestTraceContext => ({
  id: crypto.randomUUID(),
  seq: 0,
  path: undefined,
  action: false,
}))

let scriptSeq = 0

async function getSafeHeaders() {
  if (typeof headers !== 'function') return null
  try {
    return await headers()
  } catch {
    return null
  }
}

function parseTargetAndKind(urlStr: string): {
  kind: 'rest' | 'rpc' | 'auth' | 'storage'
  target: string
} {
  try {
    const parsed = new URL(urlStr, 'http://localhost')
    const pathname = parsed.pathname
    if (pathname.includes('/rest/v1/rpc/')) {
      const sp = pathname.split('/rest/v1/rpc/')[1]?.split('/')[0] || pathname
      return { kind: 'rpc', target: sp }
    }
    if (pathname.includes('/rest/v1/')) {
      const table = pathname.split('/rest/v1/')[1]?.split('/')[0] || pathname
      return { kind: 'rest', target: table }
    }
    if (pathname.includes('/auth/v1/')) {
      const endpoint = pathname.split('/auth/v1/')[1] || ''
      const firstSegment = endpoint.split('/').filter(Boolean)[0] || pathname
      return { kind: 'auth', target: firstSegment }
    }
    if (pathname.includes('/storage/v1/')) {
      const endpoint = pathname.split('/storage/v1/')[1] || ''
      const firstSegment = endpoint.split('/').filter(Boolean)[0] || pathname
      return { kind: 'storage', target: firstSegment }
    }
    return { kind: 'rest', target: pathname }
  } catch {
    return { kind: 'rest', target: 'unknown' }
  }
}

function createTracedFetch(client: 'server' | 'service'): typeof fetch {
  return async function tracedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const headerStore = await getSafeHeaders()

    let req: string
    let seq: number
    let path: string | null = null
    let action = false

    if (headerStore) {
      const trace = getRequestTrace()
      if (trace.path === undefined) {
        const dalPath = headerStore.get('x-dal-path')
        if (dalPath) trace.path = dalPath
        if (headerStore.has('next-action')) trace.action = true
      }
      trace.seq += 1
      req = trace.id
      seq = trace.seq
      path = trace.path ?? null
      action = trace.action
    } else {
      scriptSeq += 1
      req = 'sin-request'
      seq = scriptSeq
      path = null
      action = false
    }

    let urlStr: string
    let method = init?.method ?? 'GET'
    if (typeof input === 'string') {
      urlStr = input
    } else if (input instanceof URL) {
      urlStr = input.toString()
    } else if (input instanceof Request) {
      urlStr = input.url
      if (!init?.method) {
        method = input.method
      }
    } else {
      urlStr = String(input)
    }
    method = method.toUpperCase()

    const { kind, target } = parseTargetAndKind(urlStr)

    const start = performance.now()
    let status = 0
    try {
      const response = await fetch(input, init)
      status = response.status
      return response
    } finally {
      const ms = Math.round(performance.now() - start)
      const payload = {
        req,
        seq,
        path,
        action,
        client,
        kind,
        target,
        method,
        status,
        ms,
      }
      console.log(`[dal-trace] ${JSON.stringify(payload)}`)
    }
  }
}

/**
 * Env vars are read LAZILY inside each factory (never at module import
 * time) so tests can set `process.env` per-case and so a missing var only
 * breaks the specific client that needs it, not every import of this file.
 */
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name} — set it in .env.local before creating a Supabase client`)
  }
  return value
}

function getSupabaseUrl(): string {
  return requireEnv('NEXT_PUBLIC_SUPABASE_URL')
}

function getAnonKey(): string {
  return requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

function getServiceRoleKey(): string {
  return requireEnv('SUPABASE_SERVICE_ROLE_KEY')
}

/**
 * Server Components / Server Actions / Route Handlers client (design §5).
 * Cookie-aware so `supabase.auth.getUser()` re-validates the session JWT.
 */
export async function createServerClient() {
  const cookieStore = await cookies()
  let globalOptions: { fetch: typeof fetch } | undefined

  if (process.env.DAL_TRACE === '1') {
    const trace = getRequestTrace()
    const headerStore = await getSafeHeaders()
    if (headerStore) {
      const dalPath = headerStore.get('x-dal-path')
      if (dalPath) {
        trace.path = dalPath
      }
      if (headerStore.has('next-action')) {
        trace.action = true
      }
    }
    globalOptions = { fetch: createTracedFetch('server') }
  }

  return createSupabaseServerClient(getSupabaseUrl(), getAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // `setAll` was called from a Server Component, where cookies are
          // read-only. Safe to ignore: session refresh is handled by proxy.ts
          // / Server Actions, which CAN write cookies.
        }
      },
    },
    ...(globalOptions ? { global: globalOptions } : {}),
  })
}

/** Browser/Client Component client — anon key only, never the service role. */
export function createBrowserClient() {
  return createSupabaseBrowserClient(getSupabaseUrl(), getAnonKey())
}

/**
 * Service-role client — server only. Threat matrix (design §15): never
 * import this from a `'use client'` module; the service role key bypasses
 * RLS entirely.
 */
export function createServiceClient() {
  const globalOptions =
    process.env.DAL_TRACE === '1'
      ? { fetch: createTracedFetch('service') }
      : undefined

  return createSupabaseServerClient(getSupabaseUrl(), getServiceRoleKey(), {
    cookies: {
      getAll: () => [],
      setAll: () => {},
    },
    ...(globalOptions ? { global: globalOptions } : {}),
  })
}
