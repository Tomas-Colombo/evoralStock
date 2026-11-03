import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registrarConsultaAyuda,
  calificarConsultaAyuda,
  REGLAS_SLUG,
  type RegistrarConsultaAyudaPayload,
} from './index'

const rpcMock = vi.fn()

vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: vi.fn(async () => ({
    rpc: rpcMock,
  })),
}))

const payloadValido: RegistrarConsultaAyudaPayload = {
  idConversacion: '11111111-1111-1111-1111-111111111111',
  pregunta: '¿Cómo crear una venta?',
  respuesta: 'Tenés que ir a Ventas > Nueva venta.',
  entradaId: 'ventas-nueva',
  resultado: 'respondida',
}

describe('lib/dal/ayuda', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('REGLAS_SLUG', () => {
    it('declara las reglas solo por texto para no-tenant, module-disabled y consulta-no-encontrada', () => {
      expect(REGLAS_SLUG).toEqual([
        { slug: 'no-tenant' },
        { slug: 'module-disabled' },
        { slug: 'consulta-no-encontrada' },
      ])
    })

    it('no mapea errores 42501 genéricos (RLS) a no-tenant', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: '42501', message: 'new row violates row-level security policy' },
      })

      const res = await registrarConsultaAyuda(payloadValido)
      expect(res.ok).toBe(false)
      expect((res as { reason: string }).reason).not.toBe('no-tenant')
    })

    it('no mapea errores P0001 con otro mensaje a module-disabled', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: 'P0001', message: 'otra-cosa' },
      })

      const res = await registrarConsultaAyuda(payloadValido)
      expect(res.ok).toBe(false)
      expect((res as { reason: string }).reason).not.toBe('module-disabled')
    })
  })

  describe('registrarConsultaAyuda', () => {
    it('llama a sp_registrar_consulta_ayuda y devuelve id en caso de éxito', async () => {
      rpcMock.mockResolvedValueOnce({
        data: '22222222-2222-2222-2222-222222222222',
        error: null,
      })

      const res = await registrarConsultaAyuda(payloadValido)

      expect(rpcMock).toHaveBeenCalledWith('sp_registrar_consulta_ayuda', {
        p_id_conversacion: payloadValido.idConversacion,
        p_pregunta: payloadValido.pregunta,
        p_respuesta: payloadValido.respuesta,
        p_entrada_id: payloadValido.entradaId,
        p_resultado: payloadValido.resultado,
      })
      expect(res).toEqual({
        ok: true,
        id: '22222222-2222-2222-2222-222222222222',
      })
    })

    it('devuelve ok: false con error-desconocido si data es null o string vacío', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: null,
      })
      const resNull = await registrarConsultaAyuda(payloadValido)
      expect(resNull).toEqual({ ok: false, reason: 'error-desconocido' })

      rpcMock.mockResolvedValueOnce({
        data: '   ',
        error: null,
      })
      const resVacio = await registrarConsultaAyuda(payloadValido)
      expect(resVacio).toEqual({ ok: false, reason: 'error-desconocido' })
    })

    it('mapea error no-tenant', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: '42501', message: 'no-tenant' },
      })

      const res = await registrarConsultaAyuda(payloadValido)
      expect(res).toEqual({ ok: false, reason: 'no-tenant' })
    })

    it('mapea error module-disabled', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: 'P0001', message: 'module-disabled' },
      })

      const res = await registrarConsultaAyuda(payloadValido)
      expect(res).toEqual({ ok: false, reason: 'module-disabled' })
    })

    it('mapea errores inesperados a error-desconocido', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: '99999', message: 'falla imprevista' },
      })

      const res = await registrarConsultaAyuda(payloadValido)
      expect(res).toEqual({ ok: false, reason: 'error-desconocido' })
    })

    it('captura excepciones y las mapea sin lanzar', async () => {
      rpcMock.mockRejectedValueOnce(new Error('error de red'))

      const res = await registrarConsultaAyuda(payloadValido)
      expect(res.ok).toBe(false)
      expect(typeof (res as { reason: string }).reason).toBe('string')
    })
  })

  describe('calificarConsultaAyuda', () => {
    it('llama a sp_calificar_consulta_ayuda y devuelve ok: true', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: null,
      })

      const res = await calificarConsultaAyuda({
        idConsulta: '33333333-3333-3333-3333-333333333333',
        util: true,
      })

      expect(rpcMock).toHaveBeenCalledWith('sp_calificar_consulta_ayuda', {
        p_id: '33333333-3333-3333-3333-333333333333',
        p_util: true,
      })
      expect(res).toEqual({ ok: true })
    })

    it('mapea error consulta-no-encontrada', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: '42704', message: 'consulta-no-encontrada' },
      })

      const res = await calificarConsultaAyuda({
        idConsulta: '33333333-3333-3333-3333-333333333333',
        util: false,
      })

      expect(res).toEqual({ ok: false, reason: 'consulta-no-encontrada' })
    })

    it('mapea error no-tenant', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: '42501', message: 'no-tenant' },
      })

      const res = await calificarConsultaAyuda({
        idConsulta: '33333333-3333-3333-3333-333333333333',
        util: true,
      })

      expect(res).toEqual({ ok: false, reason: 'no-tenant' })
    })

    it('mapea error module-disabled', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: 'P0001', message: 'module-disabled' },
      })

      const res = await calificarConsultaAyuda({
        idConsulta: '33333333-3333-3333-3333-333333333333',
        util: true,
      })

      expect(res).toEqual({ ok: false, reason: 'module-disabled' })
    })
  })
})
