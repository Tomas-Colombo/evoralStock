import { describe, expect, it, vi, beforeEach } from 'vitest'
import { revalidatePath } from 'next/cache'
import * as dal from '@/lib/dal/revendedoras'
import * as guard from '@/lib/dal/guard'
import * as sessionModule from '@/lib/dal/session'
import { AuthorizationError } from '@/lib/dal/errors'
import {
  anularVentaRevendedoraAction,
  registrarVentaRevendedoraAction,
  buscarItemStockRevendedoraAction,
} from './actions'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn(),
}))

vi.mock('@/lib/dal/guard', async (importOriginal) => {
  const actual = await importOriginal<typeof guard>()
  return {
    ...actual,
    requireModuleRole: vi.fn(),
  }
})

vi.mock('@/lib/dal/revendedoras', () => ({
  anularVentaRevendedora: vi.fn(),
  registrarVentaRevendedora: vi.fn(),
  resolverItemStockRevendedora: vi.fn(),
}))

const UUID_1 = '123e4567-e89b-12d3-a456-426614174000'
const UUID_2 = '123e4567-e89b-12d3-a456-426614174001'

function generarUuids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const hex = i.toString(16).padStart(12, '0')
    return `123e4567-e89b-12d3-a456-${hex}`
  })
}

describe('mi-cuenta actions (portal revendedora)', () => {
  const mockRevendedoraSession = {
    user: { id: 'user-rev-1', email: 'revendedora@test.com' },
    tenantId: 'tenant-1',
    rolId: 'rol-revendedora',
    rolNombre: 'Revendedora',
    permisos: { revendedoras: ['ver_propio', 'vender'] },
    modulosHabilitados: ['revendedoras'],
    subdominioOk: true,
    idRevendedora: 'rev-uuid-123',
    marca: { nombre: 'Test', logoUrl: null },
  } as sessionModule.Session

  const mockOperadorSession = {
    user: { id: 'user-op-1', email: 'admin@test.com' },
    tenantId: 'tenant-1',
    rolId: 'rol-admin',
    rolNombre: 'Administrador',
    permisos: { revendedoras: ['ver', 'crear', 'editar'] },
    modulosHabilitados: ['revendedoras'],
    subdominioOk: true,
    idRevendedora: null,
    marca: { nombre: 'Test', logoUrl: null },
  } as sessionModule.Session

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue(mockRevendedoraSession)
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)
  })

  describe('registrarVentaRevendedoraAction', () => {
    it('falla con no-permission si la sesión es de un operador (sin idRevendedora)', async () => {
      vi.mocked(sessionModule.verifySession).mockResolvedValue(mockOperadorSession)

      const res = await registrarVentaRevendedoraAction({ id_items: [UUID_1] })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.registrarVentaRevendedora).not.toHaveBeenCalled()
    })

    it('falla con no-permission si el rol no tiene revendedoras/vender', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('no-permission'))

      const res = await registrarVentaRevendedoraAction({ id_items: [UUID_1] })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.registrarVentaRevendedora).not.toHaveBeenCalled()
    })

    it('falla con module-disabled si el módulo está deshabilitado', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('module-disabled'))

      const res = await registrarVentaRevendedoraAction({ id_items: [UUID_1] })

      expect(res).toEqual({ ok: false, reason: 'module-disabled' })
      expect(dal.registrarVentaRevendedora).not.toHaveBeenCalled()
    })

    it('falla con lineas-vacias si el carrito está vacío', async () => {
      const res = await registrarVentaRevendedoraAction({ id_items: [] })

      expect(res).toEqual({ ok: false, reason: 'lineas-vacias' })
      expect(dal.registrarVentaRevendedora).not.toHaveBeenCalled()
    })

    it('falla con payload-invalido si supera los 50 ítems', async () => {
      const res = await registrarVentaRevendedoraAction({ id_items: generarUuids(51) })

      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(dal.registrarVentaRevendedora).not.toHaveBeenCalled()
    })

    it('falla con payload-invalido si algún id_item no es uuid', async () => {
      const res = await registrarVentaRevendedoraAction({ id_items: ['no-es-uuid'] })

      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(dal.registrarVentaRevendedora).not.toHaveBeenCalled()
    })

    it('falla con payload-invalido si se intenta inyectar campos extras (strictObject)', async () => {
      const res = await registrarVentaRevendedoraAction({
        id_items: [UUID_1],
        id_revendedora: 'rev-otra',
      })

      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(dal.registrarVentaRevendedora).not.toHaveBeenCalled()
    })

    it('deduplica id_items, delega al DAL con parsed.data y revalida las tres rutas', async () => {
      vi.mocked(dal.registrarVentaRevendedora).mockResolvedValue({
        ok: true,
        data: { id_venta: 'venta-uuid-1' },
      })

      const res = await registrarVentaRevendedoraAction({
        id_items: [UUID_1, UUID_2, UUID_1],
      })

      expect(res).toEqual({ ok: true, data: { id_venta: 'venta-uuid-1' } })
      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        mockRevendedoraSession,
        'revendedoras',
        'vender',
      )
      expect(dal.registrarVentaRevendedora).toHaveBeenCalledWith(mockRevendedoraSession, {
        id_items: [UUID_1, UUID_2],
        contacto_nombre: null,
        contacto_telefono: null,
      })
      expect(revalidatePath).toHaveBeenCalledWith('/mi-cuenta')
      expect(revalidatePath).toHaveBeenCalledWith('/mi-cuenta/stock')
      expect(revalidatePath).toHaveBeenCalledWith('/mi-cuenta/ventas')
      expect(revalidatePath).toHaveBeenCalledTimes(3)
    })

    it('retorna error del DAL sin revalidar si falla el RPC', async () => {
      vi.mocked(dal.registrarVentaRevendedora).mockResolvedValue({
        ok: false,
        reason: 'item-no-en-poder',
      })

      const res = await registrarVentaRevendedoraAction({ id_items: [UUID_1] })

      expect(res).toEqual({ ok: false, reason: 'item-no-en-poder' })
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  })

  describe('buscarItemStockRevendedoraAction', () => {
    it('falla con no-permission si la sesión es de operador (sin idRevendedora)', async () => {
      vi.mocked(sessionModule.verifySession).mockResolvedValue(mockOperadorSession)

      const res = await buscarItemStockRevendedoraAction({ codigo: 'REM-0001' })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.resolverItemStockRevendedora).not.toHaveBeenCalled()
    })

    it('falla con no-permission si el rol no tiene revendedoras/vender', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('no-permission'))

      const res = await buscarItemStockRevendedoraAction({ codigo: 'REM-0001' })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.resolverItemStockRevendedora).not.toHaveBeenCalled()
    })

    it('falla con payload-invalido si codigo está vacío o tiene campos extras', async () => {
      const resVacio = await buscarItemStockRevendedoraAction({ codigo: '   ' })
      expect(resVacio).toEqual({ ok: false, reason: 'payload-invalido' })

      const resExtra = await buscarItemStockRevendedoraAction({
        codigo: 'REM-0001',
        extra: true,
      })
      expect(resExtra).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(dal.resolverItemStockRevendedora).not.toHaveBeenCalled()
    })

    it('delega al DAL con parsed.data (excluir por defecto [])', async () => {
      vi.mocked(dal.resolverItemStockRevendedora).mockResolvedValue({
        ok: true,
        data: [
          {
            id_item: UUID_1,
            id_producto: UUID_2,
            descripcion: 'Remera',
            sku: 'REM-0001',
            talle: 'M',
            precio_venta: 15000,
          },
        ],
      })

      const res = await buscarItemStockRevendedoraAction({ codigo: '  REM-0001  ' })

      expect(res).toEqual({
        ok: true,
        data: [
          {
            id_item: UUID_1,
            id_producto: UUID_2,
            descripcion: 'Remera',
            sku: 'REM-0001',
            talle: 'M',
            precio_venta: 15000,
          },
        ],
      })
      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        mockRevendedoraSession,
        'revendedoras',
        'vender',
      )
      expect(dal.resolverItemStockRevendedora).toHaveBeenCalledWith(mockRevendedoraSession, {
        codigo: 'REM-0001',
        excluir: [],
      })
    })
  })

  describe('anularVentaRevendedoraAction', () => {
    it('falla con no-permission si la sesión es de un operador', async () => {
      vi.mocked(sessionModule.verifySession).mockResolvedValue(mockOperadorSession)

      const res = await anularVentaRevendedoraAction({ id_venta: UUID_1 })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.anularVentaRevendedora).not.toHaveBeenCalled()
    })

    it('falla con payload-invalido si id_venta no es uuid', async () => {
      const res = await anularVentaRevendedoraAction({ id_venta: 'invalido' })

      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(dal.anularVentaRevendedora).not.toHaveBeenCalled()
    })

    it('delega al DAL con parsed.data y revalida las tres rutas', async () => {
      vi.mocked(dal.anularVentaRevendedora).mockResolvedValue({ ok: true })

      const res = await anularVentaRevendedoraAction({
        id_venta: UUID_1,
        motivo: '  Error de carga  ',
      })

      expect(res).toEqual({ ok: true })
      expect(guard.requireModuleRole).toHaveBeenCalledWith(
        mockRevendedoraSession,
        'revendedoras',
        'vender',
      )
      expect(dal.anularVentaRevendedora).toHaveBeenCalledWith(mockRevendedoraSession, {
        id_venta: UUID_1,
        motivo: 'Error de carga',
      })
      expect(revalidatePath).toHaveBeenCalledWith('/mi-cuenta')
      expect(revalidatePath).toHaveBeenCalledWith('/mi-cuenta/stock')
      expect(revalidatePath).toHaveBeenCalledWith('/mi-cuenta/ventas')
    })
  })
})
