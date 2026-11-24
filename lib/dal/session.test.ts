import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getClaimsMock, rpcMock, createServerClientMock, createServiceClientMock, headersMock } = vi.hoisted(() => ({
  getClaimsMock: vi.fn(),
  rpcMock: vi.fn(),
  createServerClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  headersMock: vi.fn(),
}))

vi.mock('./supabase', () => ({
  createServerClient: createServerClientMock,
  createServiceClient: createServiceClientMock,
}))

vi.mock('next/headers', () => ({
  headers: headersMock,
}))

/**
 * `getClaims()` returns the claims of an already signature-verified access
 * token (locally, via WebCrypto — the project signs with ES256). Tests only
 * need the claim payload; verification is the SDK's job.
 */
function claimsResult(claims: Record<string, unknown> | null) {
  return { data: claims === null ? null : { claims }, error: null }
}

/** Default `sp_session_context` payload: valid session, no role, no modules. */
function contextPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      ok: true,
      tenant_id: 'tenant-1',
      rol_id: null,
      rol_nombre: null,
      permisos: {},
      subdominio_ok: false,
      modulos_habilitados: [],
      ...overrides,
    },
    error: null,
  }
}

/** Shape every `verifySession()` result carries once the context RPC lands. */
const emptyContext = {
  rolId: null,
  rolNombre: null,
  permisos: {},
  modulosHabilitados: [],
  subdominioOk: false,
  idRevendedora: null,
  marca: { nombre: '', logoUrl: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  // `verifySession` is wrapped in React's `cache()`, which memoizes across
  // calls with no request-scope teardown outside a real render. Reset the
  // module graph per test so each test gets a fresh, unmemoized function.
  vi.resetModules()
  createServerClientMock.mockResolvedValue({
    auth: { getClaims: getClaimsMock },
    rpc: rpcMock,
  })
  rpcMock.mockResolvedValue(contextPayload())
  headersMock.mockResolvedValue({ get: () => null })
})

describe('verifySession (design §5 — tenant_id desde claims verificados)', () => {
  it('returns user + tenantId from the top-level tenant_id claim (Auth Hook path)', async () => {
    getClaimsMock.mockResolvedValue(
      claimsResult({ sub: 'user-1', email: 'a@b.com', tenant_id: 'tenant-1', app_metadata: {} }),
    )

    const { verifySession } = await import('./session')
    await expect(verifySession()).resolves.toEqual({
      user: { id: 'user-1', email: 'a@b.com' },
      tenantId: 'tenant-1',
      ...emptyContext,
    })
  })

  it('falls back to app_metadata.tenant_id when the top-level claim is absent (backward compat)', async () => {
    getClaimsMock.mockResolvedValue(
      claimsResult({
        sub: 'user-1',
        email: 'a@b.com',
        app_metadata: { tenant_id: 'tenant-legacy' },
      }),
    )

    const { verifySession } = await import('./session')
    await expect(verifySession()).resolves.toEqual({
      user: { id: 'user-1', email: 'a@b.com' },
      tenantId: 'tenant-legacy',
      ...emptyContext,
    })
  })

  it('throws AuthorizationError("no-session") when there are no claims (invalid/absent token)', async () => {
    getClaimsMock.mockResolvedValue(claimsResult(null))

    const { verifySession } = await import('./session')
    await expect(verifySession()).rejects.toMatchObject({
      name: 'AuthorizationError',
      reason: 'no-session',
    })
  })

  it('throws AuthorizationError("no-session") when both the JWT claim and app_metadata are missing (fail-closed, REQ-AUTH-10)', async () => {
    getClaimsMock.mockResolvedValue(claimsResult({ sub: 'user-1', email: 'a@b.com', app_metadata: {} }))

    const { verifySession } = await import('./session')
    await expect(verifySession()).rejects.toMatchObject({ reason: 'no-session' })
  })

  it('no pega a la Auth API: solo verifica claims localmente', async () => {
    getClaimsMock.mockResolvedValue(
      claimsResult({ sub: 'user-1', email: 'a@b.com', tenant_id: 'tenant-1' }),
    )

    const { verifySession } = await import('./session')
    await verifySession()

    expect(getClaimsMock).toHaveBeenCalledTimes(1)
  })
})

describe('verifySession — contexto de sesión (sp_session_context, 00041)', () => {
  beforeEach(() => {
    getClaimsMock.mockResolvedValue(
      claimsResult({ sub: 'user-1', email: 'a@b.com', tenant_id: 'tenant-1' }),
    )
  })

  it('carga rol, permisos, módulos habilitados y match de subdominio en un solo round-trip', async () => {
    headersMock.mockResolvedValue({
      get: (key: string) => (key === 'x-utopia-tenant-subdomain' ? 'acme' : null),
    })
    rpcMock.mockResolvedValue(
      contextPayload({
        rol_id: 'rol-1',
        rol_nombre: 'Encargado',
        permisos: { inventario: ['ver', 'crear'], ventas: ['ver'] },
        subdominio_ok: true,
        modulos_habilitados: ['inventario', 'ventas'],
      }),
    )

    const { verifySession } = await import('./session')
    await expect(verifySession()).resolves.toMatchObject({
      rolId: 'rol-1',
      rolNombre: 'Encargado',
      permisos: { inventario: ['ver', 'crear'], ventas: ['ver'] },
      modulosHabilitados: ['inventario', 'ventas'],
      subdominioOk: true,
    })
    expect(rpcMock).toHaveBeenCalledWith('sp_session_context', { p_subdominio: 'acme' })
  })

  it('pasa p_subdominio null cuando el proxy no inyectó el header (dev/localhost)', async () => {
    const { verifySession } = await import('./session')
    await expect(verifySession()).resolves.toMatchObject({ subdominioOk: false })
    expect(rpcMock).toHaveBeenCalledWith('sp_session_context', { p_subdominio: null })
  })

  it('degrada a sesión sin privilegios cuando la RPC devuelve ok:false (fail-closed en el guard)', async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, reason: 'no-session' }, error: null })

    const { verifySession } = await import('./session')
    await expect(verifySession()).resolves.toMatchObject({
      tenantId: 'tenant-1',
      rolId: null,
      permisos: {},
      modulosHabilitados: [],
      subdominioOk: false,
    })
  })
})

describe('verifySession — sesión de revendedora (REQ-RV-ACC-01/03/40)', () => {
  it('resuelve permisos y módulo habilitado cuando el JWT tiene id_revendedora', async () => {
    getClaimsMock.mockResolvedValue(
      claimsResult({
        sub: 'user-rev-1',
        email: 'rev@test.com',
        tenant_id: 'tenant-1',
        id_revendedora: 'rev-uuid-1',
      }),
    )

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'usuario') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id_rol: 'rol-rev-uuid',
                rol: {
                  nombre: 'Revendedora',
                  permisos: { revendedoras: ['ver_propio', 'vender'] },
                },
              },
              error: null,
            }),
          }
        }
        if (table === 'tenant_modulo') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { habilitado: true },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
    })

    const { verifySession } = await import('./session')
    const session = await verifySession()

    expect(session.idRevendedora).toBe('rev-uuid-1')
    expect(session.rolNombre).toBe('Revendedora')
    expect(session.permisos).toEqual({ revendedoras: ['ver_propio', 'vender'] })
    expect(session.modulosHabilitados).toEqual(['revendedoras'])
  })

  it('resuelve modulosHabilitados vacío si el módulo revendedoras está apagado', async () => {
    getClaimsMock.mockResolvedValue(
      claimsResult({
        sub: 'user-rev-1',
        email: 'rev@test.com',
        tenant_id: 'tenant-1',
        id_revendedora: 'rev-uuid-1',
      }),
    )

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'usuario') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id_rol: 'rol-rev-uuid',
                rol: {
                  nombre: 'Revendedora',
                  permisos: { revendedoras: ['ver_propio', 'vender'] },
                },
              },
              error: null,
            }),
          }
        }
        if (table === 'tenant_modulo') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { habilitado: false },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
    })

    const { verifySession } = await import('./session')
    const session = await verifySession()

    expect(session.idRevendedora).toBe('rev-uuid-1')
    expect(session.modulosHabilitados).toEqual([])
  })
})
