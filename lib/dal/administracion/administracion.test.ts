import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QR_LADO_MM_DEFAULT } from '@/lib/inventario/limites'

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: createServerClientMock,
  createServiceClient: vi.fn(),
}))

describe('getConfiguracionQrLadoMm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('devuelve el valor redondeado cuando está en rango [15, 100]', async () => {
    const eqCalls: Array<{ col: string; val: unknown }> = []
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        eqCalls.push({ col, val })
        return builder
      },
      maybeSingle: async () => ({ data: { valor: 48 }, error: null }),
    }

    createServerClientMock.mockResolvedValue({
      from: () => builder,
    })

    const { getConfiguracionQrLadoMm } = await import('./administracion')
    const res = await getConfiguracionQrLadoMm()

    expect(eqCalls).toEqual([
      { col: 'seccion', val: 'etiquetas' },
      { col: 'clave', val: 'qr_lado_mm' },
    ])
    expect(res).toBe(48)
  })

  it('devuelve QR_LADO_MM_DEFAULT cuando no existe fila o el valor está fuera de rango', async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: { valor: 5 }, error: null }),
    }

    createServerClientMock.mockResolvedValue({
      from: () => builder,
    })

    const { getConfiguracionQrLadoMm } = await import('./administracion')
    expect(await getConfiguracionQrLadoMm()).toBe(QR_LADO_MM_DEFAULT)
  })
})

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
