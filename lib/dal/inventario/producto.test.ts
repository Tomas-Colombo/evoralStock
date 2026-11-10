import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  omitirCostoProducto,
  listProductosSinCosto,
  listProductosSinCostoPaginado,
} from './producto'
import type { ProductoConDetalle } from '@/lib/types/inventario'

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: createServerClientMock,
}))

function fixtureProducto(override?: Partial<ProductoConDetalle>): ProductoConDetalle {
  return {
    id_producto: 'prod-123',
    id_tenant: 'tenant-1',
    id_categoria: 'cat-1',
    sku: 'REM-001',
    nombre: 'Remera Lisa',
    descripcion: 'Algodón peinado',
    stock_minimo: 5,
    activo: true,
    es_nuevo: false,
    precio_venta: 12000,
    id_regla_margen_aplicada: 'regla-abc',
    precio_venta_resuelto_at: '2026-11-10T12:00:00Z',
    precio_venta_desactualizado: false,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-10T12:00:00Z',
    categoria: { id_categoria: 'cat-1', nombre: 'Remeras' },
    costo_vigente: 5000,
    moneda_vigente: 'ARS',
    stock_disponible: 10,
    stock_total: 12,
    ...override,
  }
}

describe('omitirCostoProducto', () => {
  it('elimina las claves sensibles de costo y margen del objeto', () => {
    const original = fixtureProducto()
    const sanitizado = omitirCostoProducto(original)

    expect('costo_vigente' in sanitizado).toBe(false)
    expect('moneda_vigente' in sanitizado).toBe(false)
    expect('id_regla_margen_aplicada' in sanitizado).toBe(false)

    expect(sanitizado).toEqual({
      id_producto: 'prod-123',
      id_tenant: 'tenant-1',
      id_categoria: 'cat-1',
      sku: 'REM-001',
      nombre: 'Remera Lisa',
      descripcion: 'Algodón peinado',
      stock_minimo: 5,
      activo: true,
      es_nuevo: false,
      precio_venta: 12000,
      precio_venta_resuelto_at: '2026-11-10T12:00:00Z',
      precio_venta_desactualizado: false,
      created_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-10T12:00:00Z',
      categoria: { id_categoria: 'cat-1', nombre: 'Remeras' },
      stock_disponible: 10,
      stock_total: 12,
    })
  })
})

describe('listProductosSinCosto y listProductosSinCostoPaginado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listProductosSinCosto devuelve la lista con las claves de costo purgadas', async () => {
    createServerClientMock.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: {
          total: 1,
          rows: [fixtureProducto({ id_producto: 'prod-1', nombre: 'P1', costo_vigente: 3500 })],
        },
        error: null,
      }),
    })

    const rows = await listProductosSinCosto({ soloActivos: true })
    expect(rows).toHaveLength(1)
    expect(rows[0].id_producto).toBe('prod-1')
    expect('costo_vigente' in rows[0]).toBe(false)
    expect('moneda_vigente' in rows[0]).toBe(false)
    expect('id_regla_margen_aplicada' in rows[0]).toBe(false)
  })

  it('listProductosSinCostoPaginado pagina correctamente y omite las claves de costo', async () => {
    createServerClientMock.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: {
          total: 50,
          rows: [fixtureProducto({ id_producto: 'prod-2', costo_vigente: 4200 })],
        },
        error: null,
      }),
    })

    const res = await listProductosSinCostoPaginado({ page: 2, pageSize: 10 })
    expect(res.total).toBe(50)
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].id_producto).toBe('prod-2')
    expect('costo_vigente' in res.rows[0]).toBe(false)
    expect('moneda_vigente' in res.rows[0]).toBe(false)
    expect('id_regla_margen_aplicada' in res.rows[0]).toBe(false)
  })
})
