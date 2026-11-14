import { describe, expect, it, vi, beforeEach } from 'vitest'
import { obtenerPanelRevendedoras, quienTieneItem } from './panel'
import * as supabaseModule from '../supabase'
import * as codigoModule from '../inventario/codigo'
import type { ItemProductoRow } from '@/lib/types/inventario'

describe('DAL Panel Revendedoras — Slice 4b', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('con 200 revendedoras realiza UNA SOLA llamada rpc a la base de datos', async () => {
    const mockRows = Array.from({ length: 200 }, (_, i) => ({
      id_revendedora: `rev-${i}`,
      nombre: `Rev${i}`,
      apellido: `Zeta${i}`,
      email: `rev${i}@test.com`,
      telefono: null,
      activo: true,
      items_en_poder: 2,
      monto_en_poder: 10000,
      vendido_periodo: 20000,
      comision_liquidada: 2000,
      comision_estimada: 1000,
      adeudado: 17000,
      fecha_ultima_venta: '2026-10-14T10:00:00Z',
      declaraciones_pendientes: 0,
      estado_cuenta: 'con_saldo' as const,
      total_filas: 200,
      kpi_en_poder: 400,
      kpi_en_local: 50,
      kpi_adeudado_total: 3400000,
      kpi_liquidaciones_pendientes_monto: 500000,
      kpi_liquidaciones_pendientes_cant: 10,
    }))

    const rpcSpy = vi.fn().mockResolvedValue({ data: mockRows, error: null })
    const mockSupabase = {
      rpc: rpcSpy,
    }

    vi.spyOn(supabaseModule, 'createServerClient').mockResolvedValue(
      mockSupabase as unknown as Awaited<ReturnType<typeof supabaseModule.createServerClient>>,
    )

    const res = await obtenerPanelRevendedoras({ limit: 200 })

    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(rpcSpy).toHaveBeenCalledWith('rf_panel_revendedoras', expect.objectContaining({
      p_limit: 200,
    }))

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.revendedoras).toHaveLength(200)
      expect(res.data.total).toBe(200)
      expect(res.data.totales.en_poder).toBe(400)
      expect(res.data.totales.en_local).toBe(50)
      expect(res.data.totales.adeudado_total).toBe(3400000)
      expect(res.data.totales.liquidaciones_pendientes_monto).toBe(500000)
      expect(res.data.totales.liquidaciones_pendientes_cant).toBe(10)
    }
  })

  it('quienTieneItem llama a rf_quien_tiene_item y devuelve la revendedora', async () => {
    const mockQuien = [
      {
        id_revendedora: 'rev-1',
        nombre: 'Valeria',
        apellido: 'Vera',
        telefono: '1234',
        email: 'valeria@test.com',
        id_consignacion: 'consig-1',
        fecha_entrega: '2026-10-01T00:00:00Z',
        estado_detalle: 'en_poder',
      },
    ]

    const rpcSpy = vi.fn().mockResolvedValue({ data: mockQuien, error: null })
    const mockSupabase = { rpc: rpcSpy }
    vi.spyOn(supabaseModule, 'createServerClient').mockResolvedValue(
      mockSupabase as unknown as Awaited<ReturnType<typeof supabaseModule.createServerClient>>,
    )
    vi.spyOn(codigoModule, 'resolverCodigo').mockResolvedValue({
      tipo: 'item',
      item: { qr_code: 'QR-TEST-01' } as unknown as ItemProductoRow,
    })

    const res = await quienTieneItem('QR-TEST-01')
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(rpcSpy).toHaveBeenCalledWith('rf_quien_tiene_item', { p_identificador: 'QR-TEST-01' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data?.nombre).toBe('Valeria')
      expect(res.data?.id_consignacion).toBe('consig-1')
    }
  })

  it('quienTieneItem resuelve EAN con resolverCodigo y pasa el qr_code a rf_quien_tiene_item', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockSupabase = { rpc: rpcSpy }
    vi.spyOn(supabaseModule, 'createServerClient').mockResolvedValue(
      mockSupabase as unknown as Awaited<ReturnType<typeof supabaseModule.createServerClient>>,
    )
    const resolverSpy = vi.spyOn(codigoModule, 'resolverCodigo').mockResolvedValue({
      tipo: 'item',
      item: { qr_code: 'QR-RESOLVED-123' } as unknown as ItemProductoRow,
    })

    await quienTieneItem('2000000000015')
    expect(resolverSpy).toHaveBeenCalledWith('2000000000015', { sku: false })
    expect(rpcSpy).toHaveBeenCalledWith('rf_quien_tiene_item', { p_identificador: 'QR-RESOLVED-123' })
  })

  it('quienTieneItem con UUID no llama a resolverCodigo y lo pasa directo a rf_quien_tiene_item', async () => {
    const uuid = 'a0000000-0000-0000-0000-000000000001'
    const rpcSpy = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockSupabase = { rpc: rpcSpy }
    vi.spyOn(supabaseModule, 'createServerClient').mockResolvedValue(
      mockSupabase as unknown as Awaited<ReturnType<typeof supabaseModule.createServerClient>>,
    )
    const resolverSpy = vi.spyOn(codigoModule, 'resolverCodigo')

    await quienTieneItem(uuid)
    expect(resolverSpy).not.toHaveBeenCalled()
    expect(rpcSpy).toHaveBeenCalledWith('rf_quien_tiene_item', { p_identificador: uuid })
  })
})
