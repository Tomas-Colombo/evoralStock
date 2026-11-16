import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError } from '@/lib/dal/errors'
import type { Session } from '@/lib/dal/session'

const {
  verifySessionMock,
  requireModuleRoleMock,
  calificarConsultaAyudaMock,
} = vi.hoisted(() => ({
  verifySessionMock: vi.fn(),
  requireModuleRoleMock: vi.fn(),
  calificarConsultaAyudaMock: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: verifySessionMock,
}))

vi.mock('@/lib/dal/guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dal/guard')>()
  return {
    ...actual,
    requireModuleRole: requireModuleRoleMock,
  }
})

vi.mock('@/lib/dal/ayuda', () => ({
  calificarConsultaAyuda: calificarConsultaAyudaMock,
}))

import { calificarConsultaAyudaAction } from './actions'

const sessionFixture: Session = {
  user: { id: 'user-1', email: 'admin@negocio.com' },
  tenantId: 'tenant-1',
  rolId: 'rol-1',
  rolNombre: 'Administrador',
  permisos: { ayuda: ['consultar'] },
  modulosHabilitados: ['ayuda'],
  subdominioOk: true,
  idRevendedora: null,
  marca: { nombre: 'Negocio', logoUrl: null },
}

const VALID_UUID_CONSULTA = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

const inputCalificarValido = {
  idConsulta: VALID_UUID_CONSULTA,
  util: true,
}

describe('ayuda actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifySessionMock.mockResolvedValue(sessionFixture)
    requireModuleRoleMock.mockResolvedValue(undefined)
    calificarConsultaAyudaMock.mockResolvedValue({ ok: true })
  })

  describe('calificarConsultaAyudaAction', () => {
    it('REQ-AYUDA-11 Feliz: guarda ayuda.consultar → calificarConsultaAyudaSchema → DAL ok', async () => {
      const res = await calificarConsultaAyudaAction(inputCalificarValido)

      expect(requireModuleRoleMock).toHaveBeenCalledWith(sessionFixture, 'ayuda', 'consultar')
      expect(calificarConsultaAyudaMock).toHaveBeenCalledWith(inputCalificarValido)
      expect(res).toEqual({ ok: true })
    })

    it('REQ-AYUDA-11 N1: consulta-no-encontrada desde el DAL se devuelve tal cual', async () => {
      calificarConsultaAyudaMock.mockResolvedValueOnce({
        ok: false,
        reason: 'consulta-no-encontrada',
      })

      const res = await calificarConsultaAyudaAction(inputCalificarValido)

      expect(res).toEqual({ ok: false, reason: 'consulta-no-encontrada' })
    })

    it('Matriz §2: sin permiso → no-permission sin llamar al DAL', async () => {
      requireModuleRoleMock.mockRejectedValueOnce(new AuthorizationError('no-permission'))

      const res = await calificarConsultaAyudaAction(inputCalificarValido)

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(calificarConsultaAyudaMock).not.toHaveBeenCalled()
    })

    it('Matriz §2: módulo apagado → module-disabled sin llamar al DAL', async () => {
      requireModuleRoleMock.mockRejectedValueOnce(new AuthorizationError('module-disabled'))

      const res = await calificarConsultaAyudaAction(inputCalificarValido)

      expect(res).toEqual({ ok: false, reason: 'module-disabled' })
      expect(calificarConsultaAyudaMock).not.toHaveBeenCalled()
    })

    it('Payload inválido → payload-invalido sin llamar al DAL', async () => {
      const res = await calificarConsultaAyudaAction({ idConsulta: 'no-un-uuid', util: true })

      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(calificarConsultaAyudaMock).not.toHaveBeenCalled()
    })
  })
})
