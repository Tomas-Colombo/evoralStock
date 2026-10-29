import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  signInWithPasswordMock,
  signOutMock,
  getClaimsMock,
  createServerClientMock,
  redirectMock,
  esSuperAdminMock,
} = vi.hoisted(() => ({
  signInWithPasswordMock: vi.fn(),
  signOutMock: vi.fn(),
  getClaimsMock: vi.fn(),
  createServerClientMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  esSuperAdminMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}))

vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: createServerClientMock,
}))

vi.mock('@/lib/dal/plataforma/guard', () => ({
  esSuperAdmin: esSuperAdminMock,
}))

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value)
  }
  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
  createServerClientMock.mockResolvedValue({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signOut: signOutMock,
      getClaims: getClaimsMock,
    },
  })
})

describe('loginAction (DR-SA-02, REQ-SA-01)', () => {
  it('falla si email o password están vacíos', async () => {
    const { loginAction } = await import('./actions')

    const res1 = await loginAction({ ok: false }, buildFormData({ email: '', password: '123' }))
    expect(res1).toEqual({
      ok: false,
      error: 'El correo electrónico y la contraseña son obligatorios',
    })

    const res2 = await loginAction({ ok: false }, buildFormData({ email: 'a@b.com', password: '' }))
    expect(res2).toEqual({
      ok: false,
      error: 'El correo electrónico y la contraseña son obligatorios',
    })

    expect(signInWithPasswordMock).not.toHaveBeenCalled()
  })

  it('falla con mensaje genérico si signInWithPassword devuelve error', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid credentials' },
    })

    const { loginAction } = await import('./actions')
    const res = await loginAction(
      { ok: false },
      buildFormData({ email: 'a@b.com', password: 'wrong' }),
    )

    expect(res).toEqual({ ok: false, error: 'Credenciales inválidas' })
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('con claim tenant_id: redirige a /ventas (flujo estándar de tenant)', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: {
        user: { id: 'tenant-user-1' },
        session: { access_token: 'valid-jwt-token' },
      },
      error: null,
    })
    getClaimsMock.mockResolvedValue({
      data: {
        claims: {
          sub: 'tenant-user-1',
          tenant_id: 'tenant-uuid-1',
        },
      },
      error: null,
    })

    const { loginAction } = await import('./actions')
    await expect(
      loginAction({ ok: false }, buildFormData({ email: 'vendedor@tenant.com', password: 'pass' })),
    ).rejects.toThrow('REDIRECT:/ventas')

    expect(redirectMock).toHaveBeenCalledWith('/ventas')
    expect(esSuperAdminMock).not.toHaveBeenCalled()
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('sin claim tenant_id y esSuperAdmin: redirige a /plataforma', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: {
        user: { id: 'super-admin-user-1' },
        session: { access_token: 'valid-sa-token' },
      },
      error: null,
    })
    getClaimsMock.mockResolvedValue({
      data: {
        claims: {
          sub: 'super-admin-user-1',
          // Sin tenant_id
        },
      },
      error: null,
    })
    esSuperAdminMock.mockResolvedValue(true)

    const { loginAction } = await import('./actions')
    await expect(
      loginAction({ ok: false }, buildFormData({ email: 'admin@utopia.app', password: 'pass' })),
    ).rejects.toThrow('REDIRECT:/plataforma')

    expect(esSuperAdminMock).toHaveBeenCalledWith('super-admin-user-1')
    expect(redirectMock).toHaveBeenCalledWith('/plataforma')
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('sin claim tenant_id y no es super admin: cierra sesión (signOut) y devuelve error genérico', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: {
        user: { id: 'orphan-user-1' },
        session: { access_token: 'valid-orphan-token' },
      },
      error: null,
    })
    getClaimsMock.mockResolvedValue({
      data: {
        claims: {
          sub: 'orphan-user-1',
          // Sin tenant_id
        },
      },
      error: null,
    })
    esSuperAdminMock.mockResolvedValue(false)
    signOutMock.mockResolvedValue({ error: null })

    const { loginAction } = await import('./actions')
    const res = await loginAction(
      { ok: false },
      buildFormData({ email: 'desconocido@externo.com', password: 'pass' }),
    )

    expect(esSuperAdminMock).toHaveBeenCalledWith('orphan-user-1')
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(redirectMock).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, error: 'Credenciales inválidas' })
  })
})
