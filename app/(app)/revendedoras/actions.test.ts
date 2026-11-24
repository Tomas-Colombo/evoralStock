import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as dal from '@/lib/dal/revendedoras'
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

vi.mock('@/lib/dal/guard', async (importOriginal) => {
  const actual = await importOriginal<typeof guard>()
  return {
    ...actual,
    requireModuleRole: vi.fn(),
  }
})

vi.mock('@/lib/dal/revendedoras', () => ({
  crearRevendedora: vi.fn(),
  editarRevendedora: vi.fn(),
  bajaRevendedora: vi.fn(),
  inviteRevendedora: vi.fn(),
  guardarComisionPropia: vi.fn(),
}))

import {
  crearRevendedoraAction,
  crearRevendedoraUnificadaAction,
  editarRevendedoraAction,
  bajaRevendedoraAction,
} from './actions'

describe('revendedoras actions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue({} as unknown as sessionModule.Session)
  })

  describe('crearRevendedoraUnificadaAction', () => {
    it('falla con no-permission si el usuario no tiene permiso revendedoras/crear', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('no-permission'))

      const res = await crearRevendedoraUnificadaAction({
        nombre: 'Lucia',
        apellido: 'Vera',
      })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.crearRevendedora).not.toHaveBeenCalled()
    })

    it('falla con module-disabled si el módulo revendedoras está apagado', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('module-disabled'))

      const res = await crearRevendedoraUnificadaAction({
        nombre: 'Lucia',
        apellido: 'Vera',
      })

      expect(res).toEqual({ ok: false, reason: 'module-disabled' })
      expect(dal.crearRevendedora).not.toHaveBeenCalled()
    })

    it('falla con no-permission si quiere crear acceso y no tiene administracion/crear', async () => {
      vi.mocked(guard.requireModuleRole).mockImplementation(async (_session, modulo, accion) => {
        if (modulo === 'administracion' && accion === 'crear') {
          throw new AuthorizationError('no-permission')
        }
      })

      const res = await crearRevendedoraUnificadaAction({
        nombre: 'Lucia',
        apellido: 'Vera',
        email: 'lucia@test.com',
        crear_acceso: true,
        password_acceso: 'Password123!',
      })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.crearRevendedora).not.toHaveBeenCalled()
    })

    it('alta simple: exige revendedoras/crear y crea la revendedora', async () => {
      vi.mocked(dal.crearRevendedora).mockResolvedValue({ ok: true, data: 'rev-uuid-1' })

      const res = await crearRevendedoraUnificadaAction({
        nombre: 'Lucia',
        apellido: 'Vera',
        email: 'lucia@test.com',
      })

      expect(guard.requireModuleRole).toHaveBeenCalledWith(expect.anything(), 'revendedoras', 'crear')
      expect(dal.crearRevendedora).toHaveBeenCalledWith({
        nombre: 'Lucia',
        apellido: 'Vera',
        email: 'lucia@test.com',
      })
      expect(res).toEqual({ ok: true, data: 'rev-uuid-1' })
      expect(revalidatePath).toHaveBeenCalledWith('/revendedoras')
    })

    it('alta con acceso: exige administracion/crear y revendedoras/editar, e invoca inviteRevendedora', async () => {
      vi.mocked(dal.crearRevendedora).mockResolvedValue({ ok: true, data: 'rev-uuid-2' })
      vi.mocked(dal.inviteRevendedora).mockResolvedValue({ ok: true, data: { id: 'user-uuid-2' } })

      const res = await crearRevendedoraUnificadaAction({
        nombre: 'Lucia',
        apellido: 'Vera',
        email: 'lucia@test.com',
        crear_acceso: true,
        password_acceso: 'Password123!',
      })

      expect(guard.requireModuleRole).toHaveBeenCalledWith(expect.anything(), 'revendedoras', 'crear')
      expect(guard.requireModuleRole).toHaveBeenCalledWith(expect.anything(), 'administracion', 'crear')
      expect(guard.requireModuleRole).toHaveBeenCalledWith(expect.anything(), 'revendedoras', 'editar')
      expect(dal.inviteRevendedora).toHaveBeenCalledWith(expect.anything(), {
        idRevendedora: 'rev-uuid-2',
        email: 'lucia@test.com',
        nombreCompleto: 'Lucia Vera',
        password: 'Password123!',
      })
      expect(res).toEqual({ ok: true, data: 'rev-uuid-2' })
    })

    it('alta con comision propia: exige revendedoras/editar y guarda comision', async () => {
      vi.mocked(dal.crearRevendedora).mockResolvedValue({ ok: true, data: 'rev-uuid-3' })
      vi.mocked(dal.guardarComisionPropia).mockResolvedValue({ ok: true, id_regla: 'regla-uuid-1' })

      const res = await crearRevendedoraUnificadaAction({
        nombre: 'Lucia',
        apellido: 'Vera',
        email: 'lucia@test.com',
        comision_propia: 15,
      })

      expect(guard.requireModuleRole).toHaveBeenCalledWith(expect.anything(), 'revendedoras', 'crear')
      expect(guard.requireModuleRole).toHaveBeenCalledWith(expect.anything(), 'revendedoras', 'editar')
      expect(dal.guardarComisionPropia).toHaveBeenCalledWith(
        expect.objectContaining({
          id_revendedora: 'rev-uuid-3',
          porcentajeFijo: 15,
        }),
      )
      expect(res).toEqual({ ok: true, data: 'rev-uuid-3' })
    })
  })

  describe('crearRevendedoraAction', () => {
    it('falla con no-permission si el usuario no tiene revendedoras/crear', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('no-permission'))

      const res = await crearRevendedoraAction({ nombre: 'A', apellido: 'B' })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.crearRevendedora).not.toHaveBeenCalled()
    })

    it('falla con module-disabled si el módulo revendedoras está apagado', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('module-disabled'))

      const res = await crearRevendedoraAction({ nombre: 'A', apellido: 'B' })

      expect(res).toEqual({ ok: false, reason: 'module-disabled' })
      expect(dal.crearRevendedora).not.toHaveBeenCalled()
    })

    it('pasa por las 3 puertas: requireModuleRole -> safeParse -> DAL', async () => {
      vi.mocked(dal.crearRevendedora).mockResolvedValue({ ok: true, data: 'uuid-1' })
      
      const payload = { nombre: 'A', apellido: 'B' }
      const res = await crearRevendedoraAction(payload)
      
      expect(guard.requireModuleRole).toHaveBeenCalledWith(expect.anything(), 'revendedoras', 'crear')
      expect(dal.crearRevendedora).toHaveBeenCalledWith(payload)
      expect(res.ok).toBe(true)
      expect(revalidatePath).toHaveBeenCalledWith('/revendedoras')
    })

    it('falla con payload-invalido si Zod rechaza', async () => {
      const payload = { nombre: 123 }
      const res = await crearRevendedoraAction(payload)
      
      expect(guard.requireModuleRole).toHaveBeenCalled()
      expect(dal.crearRevendedora).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
    })
  })

  describe('editarRevendedoraAction', () => {
    it('falla con no-permission si el usuario no tiene revendedoras/editar', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('no-permission'))

      const id = '123e4567-e89b-12d3-a456-426614174000'
      const res = await editarRevendedoraAction(id, { nombre: 'A', apellido: 'B' })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.editarRevendedora).not.toHaveBeenCalled()
    })

    it('falla con module-disabled si el módulo está apagado', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('module-disabled'))

      const id = '123e4567-e89b-12d3-a456-426614174000'
      const res = await editarRevendedoraAction(id, { nombre: 'A', apellido: 'B' })

      expect(res).toEqual({ ok: false, reason: 'module-disabled' })
      expect(dal.editarRevendedora).not.toHaveBeenCalled()
    })

    it('pasa por las 3 puertas', async () => {
      vi.mocked(dal.editarRevendedora).mockResolvedValue({ ok: true })
      
      const id = '123e4567-e89b-12d3-a456-426614174000'
      const payload = { nombre: 'A', apellido: 'B' }
      const res = await editarRevendedoraAction(id, payload)
      
      expect(guard.requireModuleRole).toHaveBeenCalledWith(expect.anything(), 'revendedoras', 'editar')
      expect(dal.editarRevendedora).toHaveBeenCalledWith(id, payload)
      expect(res.ok).toBe(true)
      expect(revalidatePath).toHaveBeenCalledWith('/revendedoras')
      expect(revalidatePath).toHaveBeenCalledWith(`/revendedoras/${id}`)
    })

    it('falla si el id no es UUID', async () => {
      const res = await editarRevendedoraAction('no-uuid', { nombre: 'A', apellido: 'B' })
      expect(dal.editarRevendedora).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
    })
  })

  describe('bajaRevendedoraAction', () => {
    it('falla con no-permission si el usuario no tiene revendedoras/eliminar', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('no-permission'))

      const id = '123e4567-e89b-12d3-a456-426614174000'
      const res = await bajaRevendedoraAction(id)

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(dal.bajaRevendedora).not.toHaveBeenCalled()
    })

    it('falla con module-disabled si el módulo está apagado', async () => {
      vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(new AuthorizationError('module-disabled'))

      const id = '123e4567-e89b-12d3-a456-426614174000'
      const res = await bajaRevendedoraAction(id)

      expect(res).toEqual({ ok: false, reason: 'module-disabled' })
      expect(dal.bajaRevendedora).not.toHaveBeenCalled()
    })

    it('pasa por las 3 puertas', async () => {
      vi.mocked(dal.bajaRevendedora).mockResolvedValue({ ok: true })
      
      const id = '123e4567-e89b-12d3-a456-426614174000'
      const res = await bajaRevendedoraAction(id)
      
      expect(guard.requireModuleRole).toHaveBeenCalledWith(expect.anything(), 'revendedoras', 'eliminar')
      expect(dal.bajaRevendedora).toHaveBeenCalledWith(id)
      expect(res.ok).toBe(true)
    })

    it('falla si el id no es UUID', async () => {
      const res = await bajaRevendedoraAction('no-uuid')
      expect(dal.bajaRevendedora).not.toHaveBeenCalled()
      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
    })
  })

  describe('REQ-RV-ACC-42: rechazo de sesión de revendedora en acciones administrativas', () => {
    const revendedoraSession = {
      user: { id: 'user-rev-1', email: 'rev@test.com' },
      tenantId: 'tenant-1',
      rolId: 'rol-rev',
      rolNombre: 'Revendedora',
      permisos: { revendedoras: ['ver_propio', 'vender'] },
      modulosHabilitados: ['revendedoras'],
      subdominioOk: true,
      idRevendedora: 'rev-uuid-1',
      marca: { nombre: 'Test', logoUrl: null },
    } as sessionModule.Session

    beforeEach(() => {
      vi.mocked(sessionModule.verifySession).mockResolvedValue(revendedoraSession)
      vi.mocked(guard.requireModuleRole).mockRejectedValue(new AuthorizationError('no-permission'))
    })

    it('crearRevendedoraUnificadaAction rechaza sesión de revendedora', async () => {
      const res = await crearRevendedoraUnificadaAction({ nombre: 'X', apellido: 'Y' })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('crearRevendedoraAction rechaza sesión de revendedora', async () => {
      const res = await crearRevendedoraAction({ nombre: 'X', apellido: 'Y' })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('editarRevendedoraAction rechaza sesión de revendedora', async () => {
      const res = await editarRevendedoraAction('123e4567-e89b-12d3-a456-426614174000', {
        nombre: 'X',
        apellido: 'Y',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('bajaRevendedoraAction rechaza sesión de revendedora', async () => {
      const res = await bajaRevendedoraAction('123e4567-e89b-12d3-a456-426614174000')
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })
  })
})
