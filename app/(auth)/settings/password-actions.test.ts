import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  verifySessionMock,
  createServerClientMock,
  signInWithPasswordMock,
  updateUserMock,
  rpcMock,
} = vi.hoisted(() => ({
  verifySessionMock: vi.fn(),
  createServerClientMock: vi.fn(),
  signInWithPasswordMock: vi.fn(),
  updateUserMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: verifySessionMock,
  debeCambiarClave: vi.fn().mockResolvedValue(false),
  marcarClaveCambiada: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: createServerClientMock,
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
  verifySessionMock.mockResolvedValue({
    user: { id: 'user-1', email: 'a@b.com' },
    tenantId: 'tenant-1',
  })
  createServerClientMock.mockResolvedValue({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      updateUser: updateUserMock,
    },
    rpc: rpcMock,
  })
  signInWithPasswordMock.mockResolvedValue({ error: null })
  updateUserMock.mockResolvedValue({ error: null })
  rpcMock.mockResolvedValue({ error: null })
})

describe('changePasswordAction (SECURITY-CRITICAL, REQ-AUTH-05/06/07, spec 3.3/3.4)', () => {
  it('succeeds and writes the audit RPC when the current password is correct', async () => {
    const { changePasswordAction } = await import('./password-actions')

    const result = await changePasswordAction(
      { ok: false },
      buildFormData({
        current_password: 'old-password',
        new_password: 'new-password-123',
        confirm_new_password: 'new-password-123',
      }),
    )

    expect(result).toEqual({ ok: true })
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'old-password',
    })
    expect(updateUserMock).toHaveBeenCalledWith({ password: 'new-password-123' })
    expect(rpcMock).toHaveBeenCalledWith('sp_change_password_user', { p_id_usuario: 'user-1' })
  })

  it('rejects BEFORE calling updateUser when the current password is wrong (REQ-AUTH-06)', async () => {
    signInWithPasswordMock.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    })
    const { changePasswordAction } = await import('./password-actions')

    const result = await changePasswordAction(
      { ok: false },
      buildFormData({
        current_password: 'wrong-password',
        new_password: 'new-password-123',
        confirm_new_password: 'new-password-123',
      }),
    )

    expect(result).toEqual({ ok: false, error: 'Current password is incorrect' })
    expect(updateUserMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rejects when new password and confirmation do not match, without calling Supabase', async () => {
    const { changePasswordAction } = await import('./password-actions')

    const result = await changePasswordAction(
      { ok: false },
      buildFormData({
        current_password: 'old-password',
        new_password: 'new-password-123',
        confirm_new_password: 'different-password-123',
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/do not match/i)
    expect(verifySessionMock).not.toHaveBeenCalled()
    expect(signInWithPasswordMock).not.toHaveBeenCalled()
    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('rejects when the new password is below the minimum length (REQ-AUTH-07)', async () => {
    const { changePasswordAction } = await import('./password-actions')

    const result = await changePasswordAction(
      { ok: false },
      buildFormData({
        current_password: 'old-password',
        new_password: 'short',
        confirm_new_password: 'short',
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/at least 8 characters/i)
    expect(signInWithPasswordMock).not.toHaveBeenCalled()
  })

  it('does not call updateUser when the audit RPC throws (audit is best-effort)', async () => {
    rpcMock.mockRejectedValue(new Error('network error'))
    const { changePasswordAction } = await import('./password-actions')

    const result = await changePasswordAction(
      { ok: false },
      buildFormData({
        current_password: 'old-password',
        new_password: 'new-password-123',
        confirm_new_password: 'new-password-123',
      }),
    )

    expect(result).toEqual({ ok: true })
    expect(updateUserMock).toHaveBeenCalledWith({ password: 'new-password-123' })
  })
})
