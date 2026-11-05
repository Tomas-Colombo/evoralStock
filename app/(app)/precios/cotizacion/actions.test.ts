import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actualizarCotizacionManualAction,
  cambiarModoCotizacionAction,
  sincronizarCotizacionBcraAction,
} from './actions'
import * as dalCotizacion from '@/lib/dal/precios/cotizacion'
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

vi.mock('@/lib/dal/precios/cotizacion', () => ({
  spSetCotizacionManual: vi.fn(),
  spSetModoCotizacion: vi.fn(),
  sincronizarCotizacionBcra: vi.fn(),
}))

describe('Server Actions de Cotización USD (3 compuertas)', () => {
  const fakeSession = {
    tenantId: 'tenant-123',
    user: { id: 'user-456' },
    rol: {
      permisos: {
        precios: ['ver', 'editar'], // Sin editar_cotizacion
      },
    },
  } as unknown as sessionModule.Session

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue(fakeSession)
  })

  describe('actualizarCotizacionManualAction', () => {
    it('caso feliz: pasa las 3 compuertas y llama al DAL', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)
      vi.mocked(dalCotizacion.spSetCotizacionManual).mockResolvedValueOnce(undefined)

      const res = await actualizarCotizacionManualAction({ valor: 1540.5 })

      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        fakeSession,
        'precios',
        'editar_cotizacion',
      )
      expect(dalCotizacion.spSetCotizacionManual).toHaveBeenCalledWith({
        valor: 1540.5,
      })
      expect(revalidatePath).toHaveBeenCalledWith('/precios')
      expect(revalidatePath).toHaveBeenCalledWith('/precios/cotizacion')
      expect(res).toEqual({ ok: true })
    })

    it('rechaza con no-permission si el usuario tiene precios.editar pero NO precios.editar_cotizacion', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
        new AuthorizationError('no-permission'),
      )

      const res = await actualizarCotizacionManualAction({ valor: 1500 })

      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        fakeSession,
        'precios',
        'editar_cotizacion',
      )
      expect(dalCotizacion.spSetCotizacionManual).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('rechaza con payload-invalido si el valor es inválido o el payload no cumple Zod', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)

      // Valor <= 0
      const resCero = await actualizarCotizacionManualAction({ valor: 0 })
      expect(resCero).toEqual({ ok: false, reason: 'payload-invalido' })

      // Tipo incorrecto
      const resString = await actualizarCotizacionManualAction({ valor: '1500' })
      expect(resString).toEqual({ ok: false, reason: 'payload-invalido' })

      // Extra fields (strictObject)
      const resExtra = await actualizarCotizacionManualAction({ valor: 1500, desconocido: true })
      expect(resExtra).toEqual({ ok: false, reason: 'payload-invalido' })

      expect(dalCotizacion.spSetCotizacionManual).not.toHaveBeenCalled()
    })
  })

  describe('cambiarModoCotizacionAction', () => {
    it('caso feliz: pasa las 3 compuertas y conmuta el modo en DAL', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)
      vi.mocked(dalCotizacion.spSetModoCotizacion).mockResolvedValueOnce(undefined)

      const res = await cambiarModoCotizacionAction({ modo: 'manual' })

      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        fakeSession,
        'precios',
        'editar_cotizacion',
      )
      expect(dalCotizacion.spSetModoCotizacion).toHaveBeenCalledWith({
        modo: 'manual',
      })
      expect(revalidatePath).toHaveBeenCalledWith('/precios')
      expect(revalidatePath).toHaveBeenCalledWith('/precios/cotizacion')
      expect(res).toEqual({ ok: true })
    })

    it('rechaza con no-permission si no tiene editar_cotizacion', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
        new AuthorizationError('no-permission'),
      )

      const res = await cambiarModoCotizacionAction({ modo: 'automatica' })

      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        fakeSession,
        'precios',
        'editar_cotizacion',
      )
      expect(dalCotizacion.spSetModoCotizacion).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('rechaza con payload-invalido si el modo no es permitido por Zod', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)

      const res = await cambiarModoCotizacionAction({ modo: 'otro-modo' })

      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(dalCotizacion.spSetModoCotizacion).not.toHaveBeenCalled()
    })
  })

  describe('sincronizarCotizacionBcraAction', () => {
    it('caso feliz: sincronización forzada exitosa', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)
      vi.mocked(dalCotizacion.sincronizarCotizacionBcra).mockResolvedValueOnce({
        ok: true,
        data: {
          modo: 'automatica',
          valor: 1546.5,
          fecha: '2026-11-05',
          fechaValor: '2026-11-04',
          origen: 'bcra',
          desactualizada: false,
        },
      })

      const res = await sincronizarCotizacionBcraAction()

      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        fakeSession,
        'precios',
        'editar_cotizacion',
      )
      expect(dalCotizacion.sincronizarCotizacionBcra).toHaveBeenCalledTimes(1)
      expect(revalidatePath).toHaveBeenCalledWith('/precios')
      expect(revalidatePath).toHaveBeenCalledWith('/precios/cotizacion')
      expect(res).toEqual({ ok: true })
    })

    it('rechaza con no-permission si no tiene editar_cotizacion', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
        new AuthorizationError('no-permission'),
      )

      const res = await sincronizarCotizacionBcraAction()

      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        fakeSession,
        'precios',
        'editar_cotizacion',
      )
      expect(dalCotizacion.sincronizarCotizacionBcra).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('rechaza con payload-invalido si se envía un payload con propiedades desconocidas', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)

      const res = await sincronizarCotizacionBcraAction({ campoExtra: 123 })

      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(dalCotizacion.sincronizarCotizacionBcra).not.toHaveBeenCalled()
    })

    it('propaga error del DAL si la sincronización falla', async () => {
      vi.mocked(guard.requireModuleRole).mockResolvedValueOnce(undefined)
      vi.mocked(dalCotizacion.sincronizarCotizacionBcra).mockResolvedValueOnce({
        ok: false,
        reason: 'bcra-no-disponible',
      })

      const res = await sincronizarCotizacionBcraAction()

      expect(res).toEqual({ ok: false, reason: 'bcra-no-disponible' })
    })
  })
})
