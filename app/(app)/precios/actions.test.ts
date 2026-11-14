import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aplicarReglaAction, impactoReglaAction } from './actions'
import * as dalRegla from '@/lib/dal/precios/regla'
import * as guard from '@/lib/dal/guard'
import * as sessionModule from '@/lib/dal/session'
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

vi.mock('@/lib/dal/precios/regla', () => ({
  spCreateReglaPrecio: vi.fn(),
  spBajaReglaPrecio: vi.fn(),
  spExtenderVigenciaRegla: vi.fn(),
  spImpactoReglaMargen: vi.fn(),
  spAplicarReglaMargen: vi.fn(),
}))

describe('Server Actions de Reglas de Margen (impacto y aplicar)', () => {
  const validUuid = '123e4567-e89b-12d3-a456-426614174000'
  const fakeSession = {
    tenantId: 'tenant-123',
    user: { id: 'user-456' },
  } as unknown as sessionModule.Session

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue(fakeSession)
  })

  describe('impactoReglaAction', () => {
    it('gate 1: rechaza si no tiene permiso precios.ver_margenes', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
        new AuthorizationError('no-permission'),
      )

      const res = await impactoReglaAction({ idRegla: validUuid })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dalRegla.spImpactoReglaMargen).not.toHaveBeenCalled()
    })

    it('gate 2: rechaza con payload-invalido si idRegla no es uuid o tiene campos extra', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)

      const resInvalido = await impactoReglaAction({ idRegla: 'no-es-uuid' })
      expect(resInvalido).toEqual({ ok: false, reason: 'payload-invalido' })

      const resExtra = await impactoReglaAction({ idRegla: validUuid, extra: 123 })
      expect(resExtra).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(dalRegla.spImpactoReglaMargen).not.toHaveBeenCalled()
    })

    it('gate 3: caso feliz llama al DAL y retorna impacto', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)
      const mockImpacto = [
        {
          id_categoria: 'cat-1',
          categoria_nombre: 'Remeras',
          productos: 5,
          cambian: 4,
          suben: 3,
          bajan: 1,
          sin_costo: 1,
        },
      ]
      vi.mocked(dalRegla.spImpactoReglaMargen).mockResolvedValueOnce(mockImpacto)

      const res = await impactoReglaAction({ idRegla: validUuid })
      expect(guard.requireModuleRole).toHaveBeenCalledWith(fakeSession, 'precios', 'ver_margenes')
      expect(dalRegla.spImpactoReglaMargen).toHaveBeenCalledWith(validUuid)
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.data?.impacto).toEqual(mockImpacto)
        expect((res as unknown as Record<string, unknown>).impacto).toBeUndefined()
      }
    })

    it('gate 3: mapea errores del DAL a slug', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)
      vi.mocked(dalRegla.spImpactoReglaMargen).mockRejectedValueOnce(
        new Error('sp_impacto_regla_margen: regla-not-found'),
      )

      const res = await impactoReglaAction({ idRegla: validUuid })
      expect(res).toEqual({ ok: false, reason: 'regla-not-found' })
    })
  })

  describe('aplicarReglaAction', () => {
    it('gate 1: exige precios.editar + inventario.ver_costos + precios.ver_margenes', async () => {
      // 1. Falla editar
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
        new AuthorizationError('no-permission'),
      )
      const res1 = await aplicarReglaAction({ idRegla: validUuid })
      expect(res1).toEqual({ ok: false, reason: 'no-permission' })
      expect(guard.requireModuleRole).toHaveBeenCalledWith(fakeSession, 'precios', 'editar')

      // 2. Pasa editar pero falla ver_costos en inventario
      vi.clearAllMocks()
      vi.mocked(sessionModule.verifySession).mockResolvedValue(fakeSession)
      vi.mocked(guard.requireModuleRole)
        .mockResolvedValueOnce(undefined) // precios.editar ok
        .mockRejectedValueOnce(new AuthorizationError('no-permission')) // inventario.ver_costos falla
      const res2 = await aplicarReglaAction({ idRegla: validUuid })
      expect(res2).toEqual({ ok: false, reason: 'no-permission' })
      expect(guard.requireModuleRole).toHaveBeenNthCalledWith(1, fakeSession, 'precios', 'editar')
      expect(guard.requireModuleRole).toHaveBeenNthCalledWith(
        2,
        fakeSession,
        'inventario',
        'ver_costos',
      )

      // 3. Pasa editar y ver_costos pero falla ver_margenes
      vi.clearAllMocks()
      vi.mocked(sessionModule.verifySession).mockResolvedValue(fakeSession)
      vi.mocked(guard.requireModuleRole)
        .mockResolvedValueOnce(undefined) // precios.editar ok
        .mockResolvedValueOnce(undefined) // inventario.ver_costos ok
        .mockRejectedValueOnce(new AuthorizationError('no-permission')) // precios.ver_margenes falla
      const res3 = await aplicarReglaAction({ idRegla: validUuid })
      expect(res3).toEqual({ ok: false, reason: 'no-permission' })
      expect(guard.requireModuleRole).toHaveBeenNthCalledWith(3, fakeSession, 'precios', 'ver_margenes')
    })

    it('gate 2: rechaza con payload-invalido si el input no es válido', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)

      const res = await aplicarReglaAction('no-es-uuid')
      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(dalRegla.spAplicarReglaMargen).not.toHaveBeenCalled()
    })

    it('gate 3: caso feliz aplica regla, revalida rutas y devuelve cantidad recalculada', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)
      vi.mocked(dalRegla.spAplicarReglaMargen).mockResolvedValueOnce(12)

      const res = await aplicarReglaAction({ idRegla: validUuid })
      expect(dalRegla.spAplicarReglaMargen).toHaveBeenCalledWith(validUuid)
      expect(revalidatePath).toHaveBeenCalledWith('/precios')
      expect(revalidatePath).toHaveBeenCalledWith('/precios/reglas')
      expect(revalidatePath).toHaveBeenCalledWith('/precios/control')
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.data?.recalculados).toBe(12)
        expect((res as unknown as Record<string, unknown>).recalculados).toBeUndefined()
      }
    })

    it('gate 3: mapea error de DAL a slug', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)
      vi.mocked(dalRegla.spAplicarReglaMargen).mockRejectedValueOnce(
        new Error('sp_aplicar_regla_margen: regla-no-es-margen'),
      )

      const res = await aplicarReglaAction({ idRegla: validUuid })
      expect(res).toEqual({ ok: false, reason: 'regla-no-es-margen' })
    })
  })
})
