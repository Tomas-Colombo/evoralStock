import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  verifySessionMock,
  requireModuleRoleMock,
  resolverCodigoMock,
  contarDisponiblesPorTalleMock,
  listItemsDisponiblesMock,
  getProductoConCategoriaMock,
  calcularSnapshotPrecioMock,
  getReservasActivasDeItemsMock,
} = vi.hoisted(() => ({
  verifySessionMock: vi.fn(),
  requireModuleRoleMock: vi.fn(),
  resolverCodigoMock: vi.fn(),
  contarDisponiblesPorTalleMock: vi.fn(),
  listItemsDisponiblesMock: vi.fn(),
  getProductoConCategoriaMock: vi.fn(),
  calcularSnapshotPrecioMock: vi.fn(),
  getReservasActivasDeItemsMock: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: verifySessionMock,
}))

vi.mock('@/lib/dal/guard', () => ({
  requireModuleRole: requireModuleRoleMock,
}))

vi.mock('@/lib/dal/inventario/codigo', () => ({
  resolverCodigo: resolverCodigoMock,
}))

vi.mock('@/lib/dal/inventario/item', () => ({
  contarDisponiblesPorTalle: contarDisponiblesPorTalleMock,
  listItemsDisponibles: listItemsDisponiblesMock,
}))

vi.mock('@/lib/dal/inventario/producto', () => ({
  getProductoConCategoria: getProductoConCategoriaMock,
}))

vi.mock('@/lib/dal/precios/resolucion', () => ({
  calcularSnapshotPrecio: calcularSnapshotPrecioMock,
}))

vi.mock('@/lib/dal/reservas', () => ({
  getReservasActivasDeItems: getReservasActivasDeItemsMock,
}))

describe('GET /api/ventas/lookup-item con soporte de cantidad', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifySessionMock.mockResolvedValue({ tenantId: 't-1', idRevendedora: null })
    requireModuleRoleMock.mockResolvedValue(undefined)
    getProductoConCategoriaMock.mockResolvedValue({
      id_producto: 'prod-1',
      nombre: 'Remera Lisa',
      sku: 'REM-001',
      categoria: { id_categoria: 'cat-1', nombre: 'Remeras', talles: ['S', 'M', 'L'] },
    })
    calcularSnapshotPrecioMock.mockResolvedValue({
      ok: true,
      precio_lista: 10000,
      precio_final: 10000,
      desactualizado: false,
      desglose: [],
    })
  })

  it('resuelve item físico por código EAN a través de resolverCodigo', async () => {
    resolverCodigoMock.mockResolvedValue({
      tipo: 'item',
      item: { id_item: 'it-ean-1', id_producto: 'prod-1', qr_code: 'QR-EAN-1', talle: 'M', estado_item: 'disponible' },
    })
    getReservasActivasDeItemsMock.mockResolvedValue(new Map())

    const { GET } = await import('./route')
    const req = new NextRequest(
      'http://localhost:3000/api/ventas/lookup-item?code=2000000000015',
    )
    const res = await GET(req)
    const json = await res.json()

    expect(resolverCodigoMock).toHaveBeenCalledWith('2000000000015', { sku: true })
    expect(json.ok).toBe(true)
    expect(json.linea.id_item).toBe('it-ean-1')
  })

  it('devuelve N líneas en un solo pedido calculando el snapshot 1 sola vez', async () => {
    listItemsDisponiblesMock.mockResolvedValue([
      { id_item: 'it-1', id_producto: 'prod-1', qr_code: 'QR-1', talle: 'M' },
      { id_item: 'it-2', id_producto: 'prod-1', qr_code: 'QR-2', talle: 'M' },
      { id_item: 'it-3', id_producto: 'prod-1', qr_code: 'QR-3', talle: 'M' },
    ])
    getReservasActivasDeItemsMock.mockResolvedValue(new Map())

    const { GET } = await import('./route')
    const req = new NextRequest(
      'http://localhost:3000/api/ventas/lookup-item?id_producto=prod-1&talle=M&cantidad=3',
    )
    const res = await GET(req)
    const json = await res.json()

    expect(calcularSnapshotPrecioMock).toHaveBeenCalledTimes(1)
    expect(json.ok).toBe(true)
    expect(json.lineas).toHaveLength(3)
    expect(json.linea.id_item).toBe('it-1')
    expect(json.aviso).toBeUndefined()
  })

  it('entrega las unidades disponibles y emite aviso stock-parcial-disponible si hay menos de las pedidas', async () => {
    listItemsDisponiblesMock.mockResolvedValue([
      { id_item: 'it-1', id_producto: 'prod-1', qr_code: 'QR-1', talle: 'M' },
      { id_item: 'it-2', id_producto: 'prod-1', qr_code: 'QR-2', talle: 'M' },
    ])
    getReservasActivasDeItemsMock.mockResolvedValue(new Map())

    const { GET } = await import('./route')
    const req = new NextRequest(
      'http://localhost:3000/api/ventas/lookup-item?id_producto=prod-1&talle=M&cantidad=5',
    )
    const res = await GET(req)
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.lineas).toHaveLength(2)
    expect(json.aviso).toBe('stock-parcial-disponible')
  })
})
