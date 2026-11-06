import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  countProductosCostoUsdVigentes,
  getCotizacionVigente,
  leerCotizacionVigente,
  sincronizarCotizacionBcra,
  spSetCotizacionManual,
  spSetModoCotizacion,
} from './cotizacion'
import * as bcraModule from '@/lib/cotizacion/bcra'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/cotizacion/bcra', () => ({
  fetchCotizacionBcra: vi.fn(),
}))

describe('lib/dal/precios/cotizacion — Servicio de cotización vigente y sincronización', () => {
  let mockSupabase: {
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase = {
      rpc: vi.fn(),
    }
  })

  describe('getCotizacionVigente', () => {
    it('en modo manual devuelve la cotización manual y no consulta BCRA', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          modo: 'manual',
          id_cotizacion: 'cotiz-123',
          valor: 1650.0,
          fecha: '2026-11-05',
          fecha_valor: '2026-11-05',
          origen: 'manual',
          desactualizada: false,
        },
        error: null,
      })

      const res = await getCotizacionVigente(mockSupabase as unknown as SupabaseClient)

      expect(res).toEqual({
        modo: 'manual',
        valor: 1650.0,
        fecha: '2026-11-05',
        fechaValor: '2026-11-05',
        origen: 'manual',
        desactualizada: false,
        idCotizacion: 'cotiz-123',
      })
      expect(bcraModule.fetchCotizacionBcra).not.toHaveBeenCalled()
    })

    it('en modo manual si no hay cotización previa lanza sin-cotizacion-dolar', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          modo: 'manual',
          id_cotizacion: null,
          valor: null,
          fecha: null,
          fecha_valor: null,
          origen: null,
          desactualizada: true,
        },
        error: null,
      })

      await expect(
        getCotizacionVigente(mockSupabase as unknown as SupabaseClient),
      ).rejects.toThrow('sin-cotizacion-dolar')
    })

    it('en modo automático si la fila de hoy ya está registrada y no desactualizada, no consulta BCRA', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          modo: 'automatica',
          id_cotizacion: 'cotiz-auto-1',
          valor: 1546.5,
          fecha: '2026-11-05',
          fecha_valor: '2026-11-04',
          origen: 'bcra',
          desactualizada: false,
        },
        error: null,
      })

      const res = await getCotizacionVigente(mockSupabase as unknown as SupabaseClient)

      expect(res).toEqual({
        modo: 'automatica',
        valor: 1546.5,
        fecha: '2026-11-05',
        fechaValor: '2026-11-04',
        origen: 'bcra',
        desactualizada: false,
        idCotizacion: 'cotiz-auto-1',
      })
      expect(bcraModule.fetchCotizacionBcra).not.toHaveBeenCalled()
    })

    it('en modo automático si desactualizada=true consulta BCRA y si responde bien registra con desactualizada=false', async () => {
      // 1. Primer sp_get_cotizacion_vigente retorna desactualizada=true
      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          modo: 'automatica',
          id_cotizacion: 'cotiz-old',
          valor: 1500.0,
          fecha: '2026-11-04',
          fecha_valor: '2026-11-03',
          origen: 'bcra',
          desactualizada: true,
        },
        error: null,
      })

      // 2. BCRA responde con éxito
      vi.mocked(bcraModule.fetchCotizacionBcra).mockResolvedValueOnce({
        ok: true,
        valor: 1546.5,
        fechaValor: '2026-11-04',
      })

      // 3. sp_registrar_cotizacion_bcra exitoso
      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: null,
      })

      // 4. Segundo sp_get_cotizacion_vigente devuelve la nueva fila actualizada
      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          modo: 'automatica',
          id_cotizacion: 'cotiz-new',
          valor: 1546.5,
          fecha: '2026-11-05',
          fecha_valor: '2026-11-04',
          origen: 'bcra',
          desactualizada: false,
        },
        error: null,
      })

      const res = await getCotizacionVigente(mockSupabase as unknown as SupabaseClient)

      expect(bcraModule.fetchCotizacionBcra).toHaveBeenCalledTimes(1)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('sp_registrar_cotizacion_bcra', {
        p_valor: 1546.5,
        p_fecha_valor: '2026-11-04',
        p_desactualizada: false,
      })
      expect(res).toEqual({
        modo: 'automatica',
        valor: 1546.5,
        fecha: '2026-11-05',
        fechaValor: '2026-11-04',
        origen: 'bcra',
        desactualizada: false,
        idCotizacion: 'cotiz-new',
      })
    })

    it('en modo automático si BCRA falla y hay valor anterior, lo devuelve marcado como desactualizado', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          modo: 'automatica',
          id_cotizacion: 'cotiz-ayer',
          valor: 1500.0,
          fecha: '2026-11-04',
          fecha_valor: '2026-11-03',
          origen: 'bcra',
          desactualizada: true,
        },
        error: null,
      })

      vi.mocked(bcraModule.fetchCotizacionBcra).mockResolvedValueOnce({
        ok: false,
        reason: 'bcra-no-disponible',
      })

      const res = await getCotizacionVigente(mockSupabase as unknown as SupabaseClient)

      expect(bcraModule.fetchCotizacionBcra).toHaveBeenCalledTimes(1)
      // NO llama a registrar cotización
      expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
        'sp_registrar_cotizacion_bcra',
        expect.anything(),
      )
      expect(res).toEqual({
        modo: 'automatica',
        valor: 1500.0,
        fecha: '2026-11-04',
        fechaValor: '2026-11-03',
        origen: 'bcra',
        desactualizada: true,
        idCotizacion: 'cotiz-ayer',
      })
    })

    it('en modo automático si BCRA falla y no hay ningún valor previo, lanza sin-cotizacion-dolar', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          modo: 'automatica',
          id_cotizacion: null,
          valor: null,
          fecha: null,
          fecha_valor: null,
          origen: null,
          desactualizada: true,
        },
        error: null,
      })

      vi.mocked(bcraModule.fetchCotizacionBcra).mockResolvedValueOnce({
        ok: false,
        reason: 'bcra-no-disponible',
      })

      await expect(
        getCotizacionVigente(mockSupabase as unknown as SupabaseClient),
      ).rejects.toThrow('sin-cotizacion-dolar')
    })
  })

  describe('sincronizarCotizacionBcra', () => {
    it('sincronización forzada exitosa actualiza en DB con desactualizada=false', async () => {
      vi.mocked(bcraModule.fetchCotizacionBcra).mockResolvedValueOnce({
        ok: true,
        valor: 1550.0,
        fechaValor: '2026-11-05',
      })

      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null })
      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          modo: 'automatica',
          id_cotizacion: 'new',
          valor: 1550.0,
          fecha: '2026-11-05',
          fecha_valor: '2026-11-05',
          origen: 'bcra',
          desactualizada: false,
        },
        error: null,
      })

      const res = await sincronizarCotizacionBcra(mockSupabase as unknown as SupabaseClient)

      expect(res).toEqual({
        ok: true,
        data: {
          modo: 'automatica',
          valor: 1550.0,
          fecha: '2026-11-05',
          fechaValor: '2026-11-05',
          origen: 'bcra',
          desactualizada: false,
          idCotizacion: 'new',
        },
      })
    })

    it('sincronización forzada que FALLA no pisa una fila de hoy que ya estaba bien', async () => {
      // El fetch al BCRA falla
      vi.mocked(bcraModule.fetchCotizacionBcra).mockResolvedValueOnce({
        ok: false,
        reason: 'bcra-no-disponible',
      })

      const res = await sincronizarCotizacionBcra(mockSupabase as unknown as SupabaseClient)

      expect(res).toEqual({
        ok: false,
        reason: 'bcra-no-disponible',
      })
      // VERIFICACIÓN CLAVE: NUNCA llama a sp_registrar_cotizacion_bcra para pisar la fila
      expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
        'sp_registrar_cotizacion_bcra',
        expect.anything(),
      )
    })
  })

  describe('spSetCotizacionManual y spSetModoCotizacion', () => {
    it('spSetCotizacionManual invoca RPC correspondiente', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null })

      await spSetCotizacionManual(
        { valor: 1620, ip: '192.168.1.1' },
        mockSupabase as unknown as SupabaseClient,
      )

      expect(mockSupabase.rpc).toHaveBeenCalledWith('sp_set_cotizacion_manual', {
        p_valor: 1620,
        p_ip: '192.168.1.1',
      })
    })

    it('spSetModoCotizacion invoca RPC correspondiente', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null })

      await spSetModoCotizacion(
        { modo: 'manual', ip: null },
        mockSupabase as unknown as SupabaseClient,
      )

      expect(mockSupabase.rpc).toHaveBeenCalledWith('sp_set_modo_cotizacion', {
        p_modo: 'manual',
        p_ip: null,
      })
    })
  })

  describe('leerCotizacionVigente (lectura pura)', () => {
    it('llama únicamente a sp_get_cotizacion_vigente y NUNCA a fetchCotizacionBcra', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          modo: 'automatica',
          id_cotizacion: 'cotiz-1',
          valor: 1520.5,
          fecha: '2026-11-05',
          fecha_valor: '2026-11-04',
          origen: 'bcra',
          desactualizada: true,
        },
        error: null,
      })

      const res = await leerCotizacionVigente(mockSupabase as unknown as SupabaseClient)

      expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('sp_get_cotizacion_vigente')
      expect(bcraModule.fetchCotizacionBcra).not.toHaveBeenCalled()
      expect(res).toEqual({
        modo: 'automatica',
        valor: 1520.5,
        fecha: '2026-11-05',
        fechaValor: '2026-11-04',
        origen: 'bcra',
        desactualizada: true,
        idCotizacion: 'cotiz-1',
      })
    })

    it('retorna null sin lanzar error si no existe cotización o el valor es nulo/cero', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({
        data: {
          modo: 'automatica',
          id_cotizacion: null,
          valor: null,
          fecha: null,
          fecha_valor: null,
          origen: null,
          desactualizada: true,
        },
        error: null,
      })

      const res = await leerCotizacionVigente(mockSupabase as unknown as SupabaseClient)

      expect(res).toBeNull()
      expect(bcraModule.fetchCotizacionBcra).not.toHaveBeenCalled()
    })
  })

  describe('countProductosCostoUsdVigentes', () => {
    it('cuenta por separado las filas revaluables y las omitidas', async () => {
      const mockQueryBuilderRev = {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockResolvedValue({ count: 8, error: null }),
      }
      const mockQueryBuilderOmit = {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockImplementation((col: string) => {
          if (col === 'costo_original_usd') {
            return Promise.resolve({ count: 3, error: null })
          }
          return mockQueryBuilderOmit
        }),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
      }

      let callCount = 0
      const mockClient = {
        from: vi.fn().mockImplementation(() => {
          callCount++
          return callCount === 1 ? mockQueryBuilderRev : mockQueryBuilderOmit
        }),
      }

      const res = await countProductosCostoUsdVigentes(mockClient as unknown as SupabaseClient)

      expect(res).toEqual({
        revaluables: 8,
        omitidas: 3,
      })
    })
  })
})
