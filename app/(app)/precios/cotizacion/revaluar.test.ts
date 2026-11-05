import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revaluarCostosUsdAction } from './actions'
import * as dalCotizacion from '@/lib/dal/precios/cotizacion'
import * as guard from '@/lib/dal/guard'
import * as sessionModule from '@/lib/dal/session'
import * as ipModule from '@/lib/utils/ip'
import { AuthorizationError } from '@/lib/dal/errors'
import { revalidatePath } from 'next/cache'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn(),
}))

vi.mock('@/lib/dal/guard', () => ({
  requireModuleRole: vi.fn(),
}))

vi.mock('@/lib/utils/ip', () => ({
  getClientIp: vi.fn(),
}))

vi.mock('@/lib/dal/precios/cotizacion', () => ({
  spRevaluarCostosUsd: vi.fn(),
  spSetCotizacionManual: vi.fn(),
  spSetModoCotizacion: vi.fn(),
  sincronizarCotizacionBcra: vi.fn(),
}))

describe('revaluarCostosUsdAction (3 compuertas)', () => {
  const fakeSession = {
    tenantId: 'tenant-123',
    user: { id: 'user-456' },
    rol: {
      permisos: {
        precios: ['ver', 'editar'],
      },
    },
  } as unknown as sessionModule.Session

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue(fakeSession)
    vi.mocked(ipModule.getClientIp).mockResolvedValue('127.0.0.1')
  })

  it('rechaza con no-permission si no tiene precios.editar_cotizacion', async () => {
    vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('no-permission'))

    const res = await revaluarCostosUsdAction()

    expect(guard.requireModuleRole).toHaveBeenCalledWith(fakeSession, 'precios', 'editar_cotizacion')
    expect(dalCotizacion.spRevaluarCostosUsd).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'no-permission' })
  })

  it('caso feliz: pasa compuertas, llama a spRevaluarCostosUsd y revalida rutas', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)
    vi.mocked(dalCotizacion.spRevaluarCostosUsd).mockResolvedValueOnce({
      revaluados: 5,
      omitidos_sin_original: 1,
    })

    const res = await revaluarCostosUsdAction()

    expect(guard.requireModuleRole).toHaveBeenCalledWith(fakeSession, 'precios', 'editar_cotizacion')
    expect(dalCotizacion.spRevaluarCostosUsd).toHaveBeenCalledWith({ ip: '127.0.0.1' })
    expect(revalidatePath).toHaveBeenCalledWith('/precios')
    expect(revalidatePath).toHaveBeenCalledWith('/precios/control')
    expect(revalidatePath).toHaveBeenCalledWith('/inventario')
    expect(res).toEqual({
      ok: true,
      data: {
        revaluados: 5,
        omitidos_sin_original: 1,
      },
    })
  })

  it('retorna error del DAL si falla la revaluación (ej: sin-cotizacion-dolar)', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)
    vi.mocked(dalCotizacion.spRevaluarCostosUsd).mockRejectedValueOnce(new Error('sin-cotizacion-dolar'))

    const res = await revaluarCostosUsdAction()

    expect(res).toEqual({ ok: false, reason: 'sin-cotizacion-dolar' })
  })
})
