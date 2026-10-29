import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError } from '@/lib/dal/errors'

const {
  getUserMock,
  createServerClientMock,
  createServiceClientMock,
  fromMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  createServerClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: createServerClientMock,
  createServiceClient: createServiceClientMock,
}))

beforeEach(() => {
  vi.clearAllMocks()
  createServerClientMock.mockResolvedValue({
    auth: {
      getUser: getUserMock,
    },
  })
  createServiceClientMock.mockReturnValue({
    from: fromMock,
  })
})

describe('esSuperAdmin (DR-SA-01, REQ-SA-01)', () => {
  it('devuelve true si el idUsuario figura en la tabla superadmin', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id_auth_user: 'admin-uuid-1' },
            error: null,
          }),
        }),
      }),
    })

    const { esSuperAdmin } = await import('./guard')
    const result = await esSuperAdmin('admin-uuid-1')

    expect(result).toBe(true)
    expect(createServiceClientMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith('superadmin')
  })

  it('devuelve false si el idUsuario no existe en la tabla superadmin', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      }),
    })

    const { esSuperAdmin } = await import('./guard')
    const result = await esSuperAdmin('user-uuid-2')

    expect(result).toBe(false)
  })

  it('devuelve false ante idUsuario vacío o inválido sin consultar la base de datos', async () => {
    const { esSuperAdmin } = await import('./guard')
    expect(await esSuperAdmin('')).toBe(false)
    expect(await esSuperAdmin(null as unknown as string)).toBe(false)
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('falla cerrada: devuelve false si la consulta a la base de datos retorna error', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database failure' },
          }),
        }),
      }),
    })

    const { esSuperAdmin } = await import('./guard')
    const result = await esSuperAdmin('admin-uuid-1')

    expect(result).toBe(false)
  })

  it('falla cerrada: devuelve false si ocurre una excepción inesperada', async () => {
    fromMock.mockImplementation(() => {
      throw new Error('Unexpected network disconnection')
    })

    const { esSuperAdmin } = await import('./guard')
    const result = await esSuperAdmin('admin-uuid-1')

    expect(result).toBe(false)
  })
})

describe('requireSuperAdmin (REQ-SA-01 N1–N4)', () => {
  it('Feliz: devuelve { id, email } si el usuario está autenticado y es super admin', async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: { id: 'admin-uuid-1', email: 'admin@utopia.app' },
      },
      error: null,
    })

    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id_auth_user: 'admin-uuid-1' },
            error: null,
          }),
        }),
      }),
    })

    const { requireSuperAdmin } = await import('./guard')
    const identity = await requireSuperAdmin()

    expect(identity).toEqual({
      id: 'admin-uuid-1',
      email: 'admin@utopia.app',
    })
    expect(getUserMock).toHaveBeenCalledTimes(1)
  })

  it('N1: lanza AuthorizationError(\'no-session\') si no hay usuario autenticado o getUser falla', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'Auth session missing' },
    })

    const { requireSuperAdmin } = await import('./guard')
    await expect(requireSuperAdmin()).rejects.toThrow(AuthorizationError)
    await expect(requireSuperAdmin()).rejects.toMatchObject({
      reason: 'no-session',
    })
  })

  it('N2: lanza AuthorizationError(\'no-permission\') para usuario autenticado de tenant (no superadmin)', async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: { id: 'tenant-user-uuid', email: 'vendedor@tenant.com' },
      },
      error: null,
    })

    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      }),
    })

    const { requireSuperAdmin } = await import('./guard')
    await expect(requireSuperAdmin()).rejects.toThrow(AuthorizationError)
    await expect(requireSuperAdmin()).rejects.toMatchObject({
      reason: 'no-permission',
    })
  })

  it('N3: lanza AuthorizationError(\'no-permission\') para usuaria revendedora (no superadmin)', async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: { id: 'revendedora-uuid', email: 'rev@tenant.com' },
      },
      error: null,
    })

    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      }),
    })

    const { requireSuperAdmin } = await import('./guard')
    await expect(requireSuperAdmin()).rejects.toThrow(AuthorizationError)
    await expect(requireSuperAdmin()).rejects.toMatchObject({
      reason: 'no-permission',
    })
  })

  it('N4: lanza AuthorizationError(\'no-permission\') para usuario en Auth pero sin registro en superadmin ni usuario', async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: { id: 'orphan-user-uuid', email: 'huerfano@test.com' },
      },
      error: null,
    })

    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      }),
    })

    const { requireSuperAdmin } = await import('./guard')
    await expect(requireSuperAdmin()).rejects.toThrow(AuthorizationError)
    await expect(requireSuperAdmin()).rejects.toMatchObject({
      reason: 'no-permission',
    })
  })
})
