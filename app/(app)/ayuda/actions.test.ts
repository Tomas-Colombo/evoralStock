import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError } from '@/lib/dal/errors'
import type { Session } from '@/lib/dal/session'
import type { ResultadoConsulta } from '@/lib/ayuda/tipos'

const {
  verifySessionMock,
  requireModuleRoleMock,
  leerConfigAyudaMock,
  crearModeloGeminiMock,
  consultarAyudaMock,
  permisosEfectivosMock,
  registrarConsultaAyudaMock,
  calificarConsultaAyudaMock,
} = vi.hoisted(() => ({
  verifySessionMock: vi.fn(),
  requireModuleRoleMock: vi.fn(),
  leerConfigAyudaMock: vi.fn(),
  crearModeloGeminiMock: vi.fn(),
  consultarAyudaMock: vi.fn(),
  permisosEfectivosMock: vi.fn(),
  registrarConsultaAyudaMock: vi.fn(),
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

vi.mock('@/lib/ayuda/config', () => ({
  leerConfigAyuda: leerConfigAyudaMock,
}))

vi.mock('@/lib/ayuda/gemini', () => ({
  crearModeloGemini: crearModeloGeminiMock,
}))

vi.mock('@/lib/ayuda/consultar', () => ({
  consultarAyuda: consultarAyudaMock,
}))

vi.mock('@/lib/ayuda/permisos', () => ({
  permisosEfectivos: permisosEfectivosMock,
}))

vi.mock('@/lib/dal/ayuda', () => ({
  registrarConsultaAyuda: registrarConsultaAyudaMock,
  calificarConsultaAyuda: calificarConsultaAyudaMock,
}))

import {
  consultarAyudaAction,
  calificarConsultaAyudaAction,
} from './actions'

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

const VALID_UUID_CONV = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const VALID_UUID_CONSULTA = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

const inputConsultaValido = {
  idConversacion: VALID_UUID_CONV,
  pregunta: '¿Cómo crear una venta?',
  historial: [
    { rol: 'usuario' as const, texto: 'Hola' },
    { rol: 'asistente' as const, texto: 'Hola, ¿en qué te puedo ayudar?' },
  ],
  focoId: 'ventas-nueva',
}

const inputCalificarValido = {
  idConsulta: VALID_UUID_CONSULTA,
  util: true,
}

describe('ayuda actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifySessionMock.mockResolvedValue(sessionFixture)
    requireModuleRoleMock.mockResolvedValue(undefined)
    leerConfigAyudaMock.mockReturnValue({ apiKey: 'test-key', modelo: 'gemini-3-flash-preview' })
    permisosEfectivosMock.mockReturnValue(new Set(['ayuda.consultar']))
    crearModeloGeminiMock.mockReturnValue(vi.fn())
    registrarConsultaAyudaMock.mockResolvedValue({ ok: true, id: 'reg-uuid-123' })
    calificarConsultaAyudaMock.mockResolvedValue({ ok: true })
  })

  describe('consultarAyudaAction', () => {
    it('Matriz §2: sin permiso → no-permission; no llama al modelo ni al DAL', async () => {
      requireModuleRoleMock.mockRejectedValueOnce(new AuthorizationError('no-permission'))

      const res = await consultarAyudaAction(inputConsultaValido)

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(consultarAyudaMock).not.toHaveBeenCalled()
      expect(registrarConsultaAyudaMock).not.toHaveBeenCalled()
    })

    it('Matriz §2: módulo apagado → module-disabled; no llama al modelo ni al DAL', async () => {
      requireModuleRoleMock.mockRejectedValueOnce(new AuthorizationError('module-disabled'))

      const res = await consultarAyudaAction(inputConsultaValido)

      expect(res).toEqual({ ok: false, reason: 'module-disabled' })
      expect(consultarAyudaMock).not.toHaveBeenCalled()
      expect(registrarConsultaAyudaMock).not.toHaveBeenCalled()
    })

    it('Sin config → ayuda-no-disponible, sin modelo y sin registro', async () => {
      leerConfigAyudaMock.mockReturnValueOnce(null)

      const res = await consultarAyudaAction(inputConsultaValido)

      expect(res).toEqual({ ok: false, reason: 'ayuda-no-disponible' })
      expect(crearModeloGeminiMock).not.toHaveBeenCalled()
      expect(consultarAyudaMock).not.toHaveBeenCalled()
      expect(registrarConsultaAyudaMock).not.toHaveBeenCalled()
    })

    it('Payload inválido → payload-invalido, sin modelo', async () => {
      const inputInvalido = {
        ...inputConsultaValido,
        pregunta: '', // min 1 requerido
      }

      const res = await consultarAyudaAction(inputInvalido)

      expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
      expect(consultarAyudaMock).not.toHaveBeenCalled()
      expect(registrarConsultaAyudaMock).not.toHaveBeenCalled()
    })

    it('REQ-AYUDA-10 Feliz: turno respondido registra respuesta=texto, entrada_id=id y devuelve idConsulta', async () => {
      const mockResultado: ResultadoConsulta = {
        resultado: 'respondida',
        texto: 'Para crear una venta andá a Ventas.',
        entrada: { id: 'ventas-nueva', titulo: 'Nueva venta', ruta: '/ventas/nueva' },
      }
      consultarAyudaMock.mockResolvedValueOnce(mockResultado)

      const res = await consultarAyudaAction(inputConsultaValido)

      expect(registrarConsultaAyudaMock).toHaveBeenCalledWith({
        idConversacion: inputConsultaValido.idConversacion,
        pregunta: inputConsultaValido.pregunta,
        respuesta: 'Para crear una venta andá a Ventas.',
        entradaId: 'ventas-nueva',
        resultado: 'respondida',
      })
      expect(res).toEqual({
        ok: true,
        idConsulta: 'reg-uuid-123',
        resultado: mockResultado,
      })
    })

    it('REQ-AYUDA-10: turno fuera de opciones registra respuesta=null, entrada_id=null', async () => {
      const mockResultado: ResultadoConsulta = {
        resultado: 'fuera_de_opciones',
      }
      consultarAyudaMock.mockResolvedValueOnce(mockResultado)

      const res = await consultarAyudaAction(inputConsultaValido)

      expect(registrarConsultaAyudaMock).toHaveBeenCalledWith({
        idConversacion: inputConsultaValido.idConversacion,
        pregunta: inputConsultaValido.pregunta,
        respuesta: null,
        entradaId: null,
        resultado: 'fuera_de_opciones',
      })
      expect(res).toEqual({
        ok: true,
        idConsulta: 'reg-uuid-123',
        resultado: mockResultado,
      })
    })

    it('REQ-AYUDA-10 N1: turno con error registra resultado=error, respuesta=null y devuelve ayuda-error', async () => {
      const mockResultado: ResultadoConsulta = {
        resultado: 'error',
        error: 'timeout',
      }
      consultarAyudaMock.mockResolvedValueOnce(mockResultado)

      const res = await consultarAyudaAction(inputConsultaValido)

      expect(registrarConsultaAyudaMock).toHaveBeenCalledWith({
        idConversacion: inputConsultaValido.idConversacion,
        pregunta: inputConsultaValido.pregunta,
        respuesta: null,
        entradaId: null,
        resultado: 'error',
      })
      expect(res).toEqual({ ok: false, reason: 'ayuda-error' })
    })

    it('REQ-AYUDA-10: registro fallido loguea console.error y la respuesta llega igual con idConsulta null', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockResultado: ResultadoConsulta = {
        resultado: 'respondida',
        texto: 'Respuesta generada',
        entrada: { id: 'ventas-nueva', titulo: 'Nueva venta' },
      }
      consultarAyudaMock.mockResolvedValueOnce(mockResultado)
      registrarConsultaAyudaMock.mockResolvedValueOnce({
        ok: false,
        reason: 'error-desconocido',
      })

      const res = await consultarAyudaAction(inputConsultaValido)

      expect(consoleErrorSpy).toHaveBeenCalledWith('consultarAyudaAction: registrar', 'error-desconocido')
      expect(res).toEqual({
        ok: true,
        idConsulta: null,
        resultado: mockResultado,
      })
      consoleErrorSpy.mockRestore()
    })

    it('Orden spec §6: el modelo se llama antes que registrarConsultaAyuda', async () => {
      const ordenLlamadas: string[] = []

      consultarAyudaMock.mockImplementationOnce(async () => {
        ordenLlamadas.push('consultarAyuda')
        return {
          resultado: 'respondida',
          texto: 'Respuesta',
          entrada: { id: 'ventas-nueva', titulo: 'Nueva venta' },
        }
      })

      registrarConsultaAyudaMock.mockImplementationOnce(async () => {
        ordenLlamadas.push('registrarConsultaAyuda')
        return { ok: true, id: 'id-1' }
      })

      await consultarAyudaAction(inputConsultaValido)

      expect(ordenLlamadas).toEqual(['consultarAyuda', 'registrarConsultaAyuda'])
    })
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
