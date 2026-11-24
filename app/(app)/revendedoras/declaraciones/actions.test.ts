import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as dal from '@/lib/dal/revendedoras'
import * as guard from '@/lib/dal/guard'
import * as sessionModule from '@/lib/dal/session'
import { AuthorizationError } from '@/lib/dal/errors'
import { confirmarDeclaracionAction, rechazarDeclaracionAction } from './actions'

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
  confirmarDeclaracionVenta: vi.fn(),
  rechazarDeclaracionVenta: vi.fn(),
}))

describe('revendedoras declaraciones actions (bandeja local)', () => {
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

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue(mockOperadorSession)
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)
  })

  describe('confirmarDeclaracionAction', () => {
    it('falla con no-permission si una revendedora intenta confirmar (REQ-RV-ACC-42)', async () => {
      vi.mocked(sessionModule.verifySession).mockResolvedValue(mockRevendedoraSession)

      const res = await confirmarDeclaracionAction({
        id_declaracion: '123e4567-e89b-12d3-a456-426614174001',
      })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.confirmarDeclaracionVenta).not.toHaveBeenCalled()
    })

    it('falla con no-permission si el operador no tiene revendedoras/crear', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('no-permission'))

      const res = await confirmarDeclaracionAction({
        id_declaracion: '123e4567-e89b-12d3-a456-426614174001',
      })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.confirmarDeclaracionVenta).not.toHaveBeenCalled()
    })

    it('falla con module-disabled si el módulo revendedoras está apagado', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('module-disabled'))

      const res = await confirmarDeclaracionAction({
        id_declaracion: '123e4567-e89b-12d3-a456-426614174001',
      })

      expect(res).toEqual({ ok: false, reason: 'module-disabled' })
      expect(dal.confirmarDeclaracionVenta).not.toHaveBeenCalled()
    })

    it('falla con payload-invalido si id_declaracion no es uuid', async () => {
      const res = await confirmarDeclaracionAction({ id_declaracion: 'invalido' })
      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(dal.confirmarDeclaracionVenta).not.toHaveBeenCalled()
    })

    it('retorna precio-no-resoluble si el DAL reporta error de precio', async () => {
      vi.mocked(dal.confirmarDeclaracionVenta).mockResolvedValue({
        ok: false,
        reason: 'precio-no-resoluble',
      })

      const res = await confirmarDeclaracionAction({
        id_declaracion: '123e4567-e89b-12d3-a456-426614174001',
      })

      expect(res).toEqual({ ok: false, reason: 'precio-no-resoluble' })
    })

    it('éxito: valida permisos, llama al DAL y retorna id_venta', async () => {
      vi.mocked(dal.confirmarDeclaracionVenta).mockResolvedValue({
        ok: true,
        data: 'vta-uuid-1',
      })

      const res = await confirmarDeclaracionAction({
        id_declaracion: '123e4567-e89b-12d3-a456-426614174001',
      })

      expect(res).toEqual({ ok: true, data: 'vta-uuid-1' })
      expect(guard.requireModuleRole).toHaveBeenCalledWith(mockOperadorSession, 'revendedoras', 'crear')
      expect(dal.confirmarDeclaracionVenta).toHaveBeenCalledWith(mockOperadorSession, {
        id_declaracion: '123e4567-e89b-12d3-a456-426614174001',
      })
    })
  })

  describe('rechazarDeclaracionAction', () => {
    it('falla con no-permission si una revendedora intenta rechazar (REQ-RV-ACC-42)', async () => {
      vi.mocked(sessionModule.verifySession).mockResolvedValue(mockRevendedoraSession)

      const res = await rechazarDeclaracionAction({
        id_declaracion: '123e4567-e89b-12d3-a456-426614174001',
        motivo: 'No se vendió',
      })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.rechazarDeclaracionVenta).not.toHaveBeenCalled()
    })

    it('falla con payload-invalido si el motivo está vacío', async () => {
      const res = await rechazarDeclaracionAction({
        id_declaracion: '123e4567-e89b-12d3-a456-426614174001',
        motivo: '',
      })

      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(dal.rechazarDeclaracionVenta).not.toHaveBeenCalled()
    })

    it('éxito: valida permisos, llama al DAL y retorna ok', async () => {
      vi.mocked(dal.rechazarDeclaracionVenta).mockResolvedValue({ ok: true })

      const res = await rechazarDeclaracionAction({
        id_declaracion: '123e4567-e89b-12d3-a456-426614174001',
        motivo: 'Artículo devuelto al local',
      })

      expect(res).toEqual({ ok: true })
      expect(guard.requireModuleRole).toHaveBeenCalledWith(mockOperadorSession, 'revendedoras', 'crear')
      expect(dal.rechazarDeclaracionVenta).toHaveBeenCalledWith(mockOperadorSession, {
        id_declaracion: '123e4567-e89b-12d3-a456-426614174001',
        motivo: 'Artículo devuelto al local',
      })
    })
  })
})
