import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  crearEtiquetaPlantillaAction,
  editarEtiquetaPlantillaAction,
  eliminarEtiquetaPlantillaAction,
  marcarEtiquetaPlantillaPredeterminadaAction,
  setEtiquetaConfigAction,
} from './actions'
import * as etiquetasDal from '@/lib/dal/etiquetas/etiquetas'
import * as guard from '@/lib/dal/guard'
import * as sessionModule from '@/lib/dal/session'
import { AuthorizationError } from '@/lib/dal/errors'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn(),
}))

vi.mock('@/lib/dal/guard', () => ({
  requireModuleRole: vi.fn(),
}))

vi.mock('@/lib/dal/etiquetas/etiquetas', () => ({
  spSetEtiquetaConfig: vi.fn(),
  spCrearEtiquetaPlantilla: vi.fn(),
  spEditarEtiquetaPlantilla: vi.fn(),
  spMarcarEtiquetaPlantillaPredeterminada: vi.fn(),
  spEliminarEtiquetaPlantilla: vi.fn(),
}))

const UUID_PLANTILLA = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('Actions de etiquetas en administracion/actions.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue({
      tenantId: 'tenant-123',
      user: { id: 'user-456' },
      modulosHabilitados: [],
    } as unknown as sessionModule.Session)
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)
  })

  describe('setEtiquetaConfigAction', () => {
    const validConfig = {
      metodo: 'qr' as const,
      impresora_tipo: 'hoja' as const,
      margen_mm: 10,
      separacion_mm: 2,
      columnas: null,
      offset_x_mm: 0,
      offset_y_mm: 0,
    }

    it('sin permiso: devuelve no-permission y no llama al DAL', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
        new AuthorizationError('no-permission'),
      )

      const res = await setEtiquetaConfigAction(validConfig)

      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        expect.anything(),
        'administracion',
        'editar',
      )
      expect(etiquetasDal.spSetEtiquetaConfig).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('payload inválido: devuelve slug del schema y no llama al DAL', async () => {
      const res = await setEtiquetaConfigAction({
        ...validConfig,
        metodo: 'invalido',
      })

      expect(etiquetasDal.spSetEtiquetaConfig).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'etiqueta-config-invalida' })
    })

    it('payload con claves extra: devuelve campo-desconocido y no llama al DAL', async () => {
      const res = await setEtiquetaConfigAction({
        ...validConfig,
        clave_extra: 123,
      })

      expect(etiquetasDal.spSetEtiquetaConfig).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'campo-desconocido' })
    })

    it('ok: llama al DAL con parsed.data', async () => {
      vi.mocked(etiquetasDal.spSetEtiquetaConfig).mockResolvedValueOnce(undefined)

      const res = await setEtiquetaConfigAction(validConfig)

      expect(etiquetasDal.spSetEtiquetaConfig).toHaveBeenCalledWith(validConfig)
      expect(res).toEqual({ ok: true })
    })
  })

  describe('crearEtiquetaPlantillaAction', () => {
    const validPlantilla = {
      nombre: 'Remeras 40x30',
      ancho_mm: 40,
      alto_mm: 30,
      mostrar_nombre: true,
      mostrar_talle: true,
      mostrar_sku: false,
      mostrar_texto_codigo: false,
    }

    it('sin permiso: devuelve no-permission y no llama al DAL', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
        new AuthorizationError('no-permission'),
      )

      const res = await crearEtiquetaPlantillaAction(validPlantilla)

      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        expect.anything(),
        'administracion',
        'crear',
      )
      expect(etiquetasDal.spCrearEtiquetaPlantilla).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('payload inválido: devuelve slug del schema y no llama al DAL', async () => {
      const res = await crearEtiquetaPlantillaAction({
        ...validPlantilla,
        nombre: '',
      })

      expect(etiquetasDal.spCrearEtiquetaPlantilla).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'plantilla-nombre-invalido' })
    })

    it('payload con claves extra: devuelve campo-desconocido y no llama al DAL', async () => {
      const res = await crearEtiquetaPlantillaAction({
        ...validPlantilla,
        extra: 'bad',
      })

      expect(etiquetasDal.spCrearEtiquetaPlantilla).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'campo-desconocido' })
    })

    it('ok: llama al DAL con parsed.data', async () => {
      vi.mocked(etiquetasDal.spCrearEtiquetaPlantilla).mockResolvedValueOnce(UUID_PLANTILLA)

      const res = await crearEtiquetaPlantillaAction(validPlantilla)

      expect(etiquetasDal.spCrearEtiquetaPlantilla).toHaveBeenCalledWith(validPlantilla)
      expect(res).toEqual({ ok: true, data: { id: UUID_PLANTILLA } })
    })
  })

  describe('editarEtiquetaPlantillaAction', () => {
    const validPlantilla = {
      id: UUID_PLANTILLA,
      nombre: 'Remeras 40x30 Editada',
      ancho_mm: 45,
      alto_mm: 35,
      mostrar_nombre: true,
      mostrar_talle: false,
      mostrar_sku: true,
      mostrar_texto_codigo: true,
    }

    it('sin permiso: devuelve no-permission y no llama al DAL', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
        new AuthorizationError('no-permission'),
      )

      const res = await editarEtiquetaPlantillaAction(validPlantilla)

      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        expect.anything(),
        'administracion',
        'editar',
      )
      expect(etiquetasDal.spEditarEtiquetaPlantilla).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('payload inválido: devuelve slug del schema y no llama al DAL', async () => {
      const res = await editarEtiquetaPlantillaAction({
        ...validPlantilla,
        id: 'no-es-uuid',
      })

      expect(etiquetasDal.spEditarEtiquetaPlantilla).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'plantilla-no-encontrada' })
    })

    it('payload con claves extra: devuelve campo-desconocido y no llama al DAL', async () => {
      const res = await editarEtiquetaPlantillaAction({
        ...validPlantilla,
        otra_prop: 1,
      })

      expect(etiquetasDal.spEditarEtiquetaPlantilla).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'campo-desconocido' })
    })

    it('ok: llama al DAL con parsed.data', async () => {
      vi.mocked(etiquetasDal.spEditarEtiquetaPlantilla).mockResolvedValueOnce(undefined)

      const res = await editarEtiquetaPlantillaAction(validPlantilla)

      expect(etiquetasDal.spEditarEtiquetaPlantilla).toHaveBeenCalledWith(validPlantilla)
      expect(res).toEqual({ ok: true })
    })
  })

  describe('marcarEtiquetaPlantillaPredeterminadaAction', () => {
    const validPayload = { id: UUID_PLANTILLA }

    it('sin permiso: devuelve no-permission y no llama al DAL', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
        new AuthorizationError('no-permission'),
      )

      const res = await marcarEtiquetaPlantillaPredeterminadaAction(validPayload)

      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        expect.anything(),
        'administracion',
        'editar',
      )
      expect(etiquetasDal.spMarcarEtiquetaPlantillaPredeterminada).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('payload inválido: devuelve slug del schema y no llama al DAL', async () => {
      const res = await marcarEtiquetaPlantillaPredeterminadaAction({ id: 'invalido' })

      expect(etiquetasDal.spMarcarEtiquetaPlantillaPredeterminada).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'plantilla-no-encontrada' })
    })

    it('payload con claves extra: devuelve campo-desconocido y no llama al DAL', async () => {
      const res = await marcarEtiquetaPlantillaPredeterminadaAction({
        id: UUID_PLANTILLA,
        extra: 'bad',
      })

      expect(etiquetasDal.spMarcarEtiquetaPlantillaPredeterminada).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'campo-desconocido' })
    })

    it('ok: llama al DAL con parsed.data', async () => {
      vi.mocked(etiquetasDal.spMarcarEtiquetaPlantillaPredeterminada).mockResolvedValueOnce(undefined)

      const res = await marcarEtiquetaPlantillaPredeterminadaAction(validPayload)

      expect(etiquetasDal.spMarcarEtiquetaPlantillaPredeterminada).toHaveBeenCalledWith(UUID_PLANTILLA)
      expect(res).toEqual({ ok: true })
    })
  })

  describe('eliminarEtiquetaPlantillaAction', () => {
    const validPayload = { id: UUID_PLANTILLA }

    it('sin permiso: devuelve no-permission y no llama al DAL', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
        new AuthorizationError('no-permission'),
      )

      const res = await eliminarEtiquetaPlantillaAction(validPayload)

      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        expect.anything(),
        'administracion',
        'eliminar',
      )
      expect(etiquetasDal.spEliminarEtiquetaPlantilla).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('payload inválido: devuelve slug del schema y no llama al DAL', async () => {
      const res = await eliminarEtiquetaPlantillaAction({ id: 'invalido' })

      expect(etiquetasDal.spEliminarEtiquetaPlantilla).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'plantilla-no-encontrada' })
    })

    it('payload con claves extra: devuelve campo-desconocido y no llama al DAL', async () => {
      const res = await eliminarEtiquetaPlantillaAction({
        id: UUID_PLANTILLA,
        extra: 'bad',
      })

      expect(etiquetasDal.spEliminarEtiquetaPlantilla).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'campo-desconocido' })
    })

    it('ok: llama al DAL con parsed.data', async () => {
      vi.mocked(etiquetasDal.spEliminarEtiquetaPlantilla).mockResolvedValueOnce(undefined)

      const res = await eliminarEtiquetaPlantillaAction(validPayload)

      expect(etiquetasDal.spEliminarEtiquetaPlantilla).toHaveBeenCalledWith(UUID_PLANTILLA)
      expect(res).toEqual({ ok: true })
    })
  })
})
