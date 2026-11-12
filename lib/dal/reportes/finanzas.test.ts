import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()

vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: vi.fn(async () => ({
    rpc: mockRpc,
  })),
}))

import {
  getResultados,
  getFlujo,
  getSerieMensual,
  getPosicion,
  getRankingProductos,
} from './finanzas'

describe('finanzas DAL — D-CPC-08 (8.B) null vs 0', () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it('getResultados: con permiso devuelve números; sin ver_costos preserva null y nunca 0', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          mes: '2026-11',
          ventas_brutas: 1000,
          anulaciones: 100,
          ventas_netas: 900,
          costo_mercaderia: 400,
          ganancia_sobre_ventas: 500,
          gastos: 50,
          comision_liquidada: 20,
          comision_pendiente_estimada: 10,
          ganancia_final: 430,
          porcentaje_ganancia: 55.5,
          cantidad_ventas: 3,
          ticket_promedio: 300,
        },
      ],
      error: null,
    })

    const conPermiso = await getResultados('2026-11-01', '2026-11-30')
    expect(conPermiso?.costo_mercaderia).toBe(400)
    expect(conPermiso?.ganancia_sobre_ventas).toBe(500)
    expect(conPermiso?.ganancia_final).toBe(430)

    mockRpc.mockResolvedValueOnce({
      data: [
        {
          mes: '2026-11',
          ventas_brutas: 1000,
          anulaciones: 100,
          ventas_netas: 900,
          costo_mercaderia: null,
          ganancia_sobre_ventas: null,
          gastos: 50,
          comision_liquidada: 20,
          comision_pendiente_estimada: 10,
          ganancia_final: null,
          porcentaje_ganancia: null,
          cantidad_ventas: 3,
          ticket_promedio: 300,
        },
      ],
      error: null,
    })

    const sinPermiso = await getResultados('2026-11-01', '2026-11-30')
    expect(sinPermiso?.ventas_netas).toBe(900)
    expect(sinPermiso?.gastos).toBe(50)
    expect(sinPermiso?.costo_mercaderia).toBeNull()
    expect(sinPermiso?.ganancia_sobre_ventas).toBeNull()
    expect(sinPermiso?.ganancia_final).toBeNull()
    expect(sinPermiso?.porcentaje_ganancia).toBeNull()
  })

  it('getFlujo: sin ver_costos preserva null en compras_mercaderia, pagos_proveedores y flujo_neto', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          mes: '2026-11',
          cobrado: 1200,
          devuelto_clientes: 100,
          costo_cobro: 20,
          neto_cobros: 1080,
          compras_mercaderia: null,
          pagos_proveedores: null,
          gastos: 50,
          flujo_neto: null,
          por_acreditar: {},
        },
      ],
      error: null,
    })

    const res = await getFlujo('2026-11-01', '2026-11-30')
    expect(res?.cobrado).toBe(1200)
    expect(res?.neto_cobros).toBe(1080)
    expect(res?.gastos).toBe(50)
    expect(res?.compras_mercaderia).toBeNull()
    expect(res?.pagos_proveedores).toBeNull()
    expect(res?.flujo_neto).toBeNull()
  })

  it('getSerieMensual: sin ver_costos preserva null en ganancias', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          mes: '2026-11-01',
          ventas_netas: 900,
          ganancia_sobre_ventas: null,
          ganancia_final: null,
          cobrado_neto: 850,
        },
      ],
      error: null,
    })

    const res = await getSerieMensual('2026-11-30', 1)
    expect(res[0].ventas_netas).toBe(900)
    expect(res[0].cobrado_neto).toBe(850)
    expect(res[0].ganancia_sobre_ventas).toBeNull()
    expect(res[0].ganancia_final).toBeNull()
  })

  it('getPosicion: sin ver_costos preserva null en capital_propio, mercaderia_terceros, devueltos_clientes y deuda_proveedores', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          capital_propio: null,
          mercaderia_terceros: null,
          devueltos_clientes: null,
          valor_venta_potencial: 2500,
          productos_sin_precio: 1,
          por_cobrar: null,
          deuda_proveedores: null,
        },
      ],
      error: null,
    })

    const res = await getPosicion()
    expect(res?.valor_venta_potencial).toBe(2500)
    expect(res?.capital_propio).toBeNull()
    expect(res?.mercaderia_terceros).toBeNull()
    expect(res?.devueltos_clientes).toBeNull()
    expect(res?.deuda_proveedores).toBeNull()
  })

  it('getRankingProductos: sin ver_costos preserva null en ganancia', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id_producto: 'p1',
          nombre: 'Remera',
          unidades_vendidas: 4,
          monto_vendido: 800,
          ganancia: null,
          porcentaje_ventas: null,
        },
      ],
      error: null,
    })

    const res = await getRankingProductos('2026-11-01', '2026-11-30', 10, 'monto')
    expect(res[0].monto_vendido).toBe(800)
    expect(res[0].ganancia).toBeNull()
  })
})
