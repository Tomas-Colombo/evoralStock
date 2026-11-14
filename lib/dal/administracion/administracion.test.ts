import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: createServerClientMock,
  createServiceClient: vi.fn(),
}))

describe('spSetTenantLogo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invoca el RPC sp_set_tenant_logo con p_logo_url y p_ip', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: 'https://example.com/logo.png', error: null })
    createServerClientMock.mockResolvedValue({
      rpc: rpcMock,
    })

    const { spSetTenantLogo } = await import('./administracion')
    const res = await spSetTenantLogo('https://example.com/logo.png')

    expect(rpcMock).toHaveBeenCalledWith('sp_set_tenant_logo', {
      p_logo_url: 'https://example.com/logo.png',
      p_ip: null,
    })
    expect(res).toBe('https://example.com/logo.png')
  })
})
