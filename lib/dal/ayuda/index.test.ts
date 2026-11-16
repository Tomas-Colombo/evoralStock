import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registrarConsultaAyuda,
  calificarConsultaAyuda,
  reservarCuotaAyuda,
  REGLAS_SLUG,
  REGLAS_SLUG_CUOTA,
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

  describe('REGLAS_SLUG_CUOTA', () => {
    it('declara las reglas de cuota', () => {
      expect(REGLAS_SLUG_CUOTA).toEqual([
        { slug: 'no-permission' },
        { slug: 'no-tenant' },
        { slug: 'module-disabled' },
        { slug: 'cuota-excedida' },
      ])
    })
  })

  describe('registrarConsultaAyuda', () => {
    it('traduce entradaId a p_entradas_citadas = [entradaId] y devuelve id en caso de éxito', async () => {
      rpcMock.mockResolvedValueOnce({
        data: '22222222-2222-2222-2222-222222222222',
        error: null,
      })

      const res = await registrarConsultaAyuda(payloadValido)

      expect(rpcMock).toHaveBeenCalledWith('sp_registrar_consulta_ayuda', {
        p_id_conversacion: payloadValido.idConversacion,
        p_pregunta: payloadValido.pregunta,
        p_respuesta: payloadValido.respuesta,
        p_entradas_citadas: ['ventas-nueva'],
        p_resultado: payloadValido.resultado,
        p_tipo_error: null,
        p_latencia_ms: null,
        p_modelo: null,
        p_tokens_input: null,
        p_tokens_output: null,
        p_tokens_cached: null,
        p_tokens_thinking: null,
      })
      expect(res).toEqual({
        ok: true,
        id: '22222222-2222-2222-2222-222222222222',
      })
    })

    it('acepta entradasCitadas directamente y campos de telemetría opcionales', async () => {
      rpcMock.mockResolvedValueOnce({
        data: '33333333-3333-3333-3333-333333333333',
        error: null,
      })

      const payloadV2: RegistrarConsultaAyudaPayload = {
        idConversacion: '11111111-1111-1111-1111-111111111111',
        pregunta: '¿Cómo cobro?',
        respuesta: 'Podés ir a [[ventas-cobro]].',
        entradasCitadas: ['ventas-cobro', 'ventas-nueva'],
        resultado: 'respondida',
        tipoError: null,
        latenciaMs: 1200,
        modelo: 'gemini-2.5-flash',
        tokensInput: 850,
        tokensOutput: 120,
        tokensCached: 500,
        tokensThinking: 0,
      }

      const res = await registrarConsultaAyuda(payloadV2)

      expect(rpcMock).toHaveBeenCalledWith('sp_registrar_consulta_ayuda', {
        p_id_conversacion: payloadV2.idConversacion,
        p_pregunta: payloadV2.pregunta,
        p_respuesta: payloadV2.respuesta,
        p_entradas_citadas: ['ventas-cobro', 'ventas-nueva'],
        p_resultado: payloadV2.resultado,
        p_tipo_error: null,
        p_latencia_ms: 1200,
        p_modelo: 'gemini-2.5-flash',
        p_tokens_input: 850,
        p_tokens_output: 120,
        p_tokens_cached: 500,
        p_tokens_thinking: 0,
      })
      expect(res).toEqual({
        ok: true,
        id: '33333333-3333-3333-3333-333333333333',
      })
    })

    it('manda array vacío cuando entradaId es null y no hay entradasCitadas', async () => {
      rpcMock.mockResolvedValueOnce({
        data: '44444444-4444-4444-4444-444444444444',
        error: null,
      })

      const res = await registrarConsultaAyuda({
        idConversacion: '11111111-1111-1111-1111-111111111111',
        pregunta: 'Pregunta fuera de dominio',
        respuesta: null,
        entradaId: null,
        resultado: 'fuera_de_opciones',
      })

      expect(rpcMock).toHaveBeenCalledWith('sp_registrar_consulta_ayuda', expect.objectContaining({
        p_entradas_citadas: [],
        p_resultado: 'fuera_de_opciones',
      }))
      expect(res).toEqual({
        ok: true,
        id: '44444444-4444-4444-4444-444444444444',
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

  describe('reservarCuotaAyuda', () => {
    it('llama a sp_reservar_cuota_ayuda y devuelve ok: true si no hay error', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: null,
      })

      const res = await reservarCuotaAyuda()
      expect(rpcMock).toHaveBeenCalledWith('sp_reservar_cuota_ayuda')
      expect(res).toEqual({ ok: true })
    })

    it('mapea error cuota-excedida', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: 'P0001', message: 'cuota-excedida' },
      })

      const res = await reservarCuotaAyuda()
      expect(res).toEqual({ ok: false, reason: 'cuota-excedida' })
    })

    it('mapea error no-permission', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: '42501', message: 'no-permission' },
      })

      const res = await reservarCuotaAyuda()
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('mapea error module-disabled', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: 'P0001', message: 'module-disabled' },
      })

      const res = await reservarCuotaAyuda()
      expect(res).toEqual({ ok: false, reason: 'module-disabled' })
    })

    it('mapea error no-tenant', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: '42501', message: 'no-tenant' },
      })

      const res = await reservarCuotaAyuda()
      expect(res).toEqual({ ok: false, reason: 'no-tenant' })
    })

    it('captura excepciones y devuelve ok: false', async () => {
      rpcMock.mockRejectedValueOnce(new Error('fallo de conexion'))

      const res = await reservarCuotaAyuda()
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
