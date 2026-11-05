import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getClientIp } from './ip'
import * as nextHeaders from 'next/headers'

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

describe('getClientIp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extrae la primera IP de x-forwarded-for', async () => {
    vi.mocked(nextHeaders.headers).mockResolvedValue({
      get: (name: string) => {
        if (name === 'x-forwarded-for') return '203.0.113.195, 70.41.3.18, 150.172.238.178'
        return null
      },
    } as unknown as Awaited<ReturnType<typeof nextHeaders.headers>>)

    const ip = await getClientIp()
    expect(ip).toBe('203.0.113.195')
  })

  it('extrae x-real-ip si x-forwarded-for no está presente', async () => {
    vi.mocked(nextHeaders.headers).mockResolvedValue({
      get: (name: string) => {
        if (name === 'x-real-ip') return '198.51.100.1'
        return null
      },
    } as unknown as Awaited<ReturnType<typeof nextHeaders.headers>>)

    const ip = await getClientIp()
    expect(ip).toBe('198.51.100.1')
  })

  it('devuelve null si no hay encabezados de IP', async () => {
    vi.mocked(nextHeaders.headers).mockResolvedValue({
      get: () => null,
    } as unknown as Awaited<ReturnType<typeof nextHeaders.headers>>)

    const ip = await getClientIp()
    expect(ip).toBeNull()
  })

  it('devuelve null si headers() arroja error', async () => {
    vi.mocked(nextHeaders.headers).mockRejectedValue(new Error('Outside request context'))

    const ip = await getClientIp()
    expect(ip).toBeNull()
  })
})
