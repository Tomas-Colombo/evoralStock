import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: vi.fn(),
}))

import { proyectarPerfilProveedor, type PerfilProveedorDetalle } from './proveedor'

const BASE_PERFIL: PerfilProveedorDetalle = {
  items_disponibles: 12,
  consignaciones_activas: 2,
  monto_pendiente_rendicion: 1500,
  lineas_pendientes_rendicion: 3,
  monto_rendido_historico: 4200,
  rendiciones_pendientes_pago: 1,
  valor_stock_consignacion: 8000,
  items_en_stock_consignacion: 5,
  items_costo_pendiente_consignacion: 1,
  deuda_total_consignacion: 9500,
}

describe('proyectarPerfilProveedor — segregación de montos y costos', () => {
  it('con inventario.ver_costos y rendiciones.ver conserva todos los números', () => {
    const res = proyectarPerfilProveedor(BASE_PERFIL, {
      puedeVerCostos: true,
      puedeVerRendiciones: true,
    })
    expect(res).toEqual(BASE_PERFIL)
  })

  it('solo con rendiciones.ver (sin ver_costos) oculta valor_stock_consignacion en null y conserva rendiciones', () => {
    const res = proyectarPerfilProveedor(BASE_PERFIL, {
      puedeVerCostos: false,
      puedeVerRendiciones: true,
    })
    expect(res.valor_stock_consignacion).toBeNull()
    expect(res.items_en_stock_consignacion).toBeNull()
    expect(res.items_costo_pendiente_consignacion).toBeNull()
    expect(res.monto_pendiente_rendicion).toBe(1500)
    expect(res.monto_rendido_historico).toBe(4200)
    expect(res.rendiciones_pendientes_pago).toBe(1)
    // Deuda total = pendiente + stock a costo: sin ver_costos no hay total.
    expect(res.deuda_total_consignacion).toBeNull()
  })

  it('sin ver_costos ni rendiciones.ver devuelve null en todos los KPI de monto y nunca 0', () => {
    const res = proyectarPerfilProveedor(BASE_PERFIL, {
      puedeVerCostos: false,
      puedeVerRendiciones: false,
    })
    expect(res.items_disponibles).toBe(12)
    expect(res.consignaciones_activas).toBe(2)
    expect(res.monto_pendiente_rendicion).toBeNull()
    expect(res.lineas_pendientes_rendicion).toBeNull()
    expect(res.monto_rendido_historico).toBeNull()
    expect(res.rendiciones_pendientes_pago).toBeNull()
    expect(res.valor_stock_consignacion).toBeNull()
    expect(res.items_en_stock_consignacion).toBeNull()
    expect(res.items_costo_pendiente_consignacion).toBeNull()
    expect(res.deuda_total_consignacion).toBeNull()
  })
})
