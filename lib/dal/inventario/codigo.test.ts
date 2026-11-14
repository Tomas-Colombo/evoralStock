import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItemProductoRow } from '@/lib/types/inventario'
import type { ProductoRowConCategoria } from './producto'

const {
  findItemByQrMock,
  findItemByEanMock,
  findProductoBySkuMock,
  createServerClientMock,
} = vi.hoisted(() => ({
  findItemByQrMock: vi.fn(),
  findItemByEanMock: vi.fn(),
  findProductoBySkuMock: vi.fn(),
  createServerClientMock: vi.fn(),
}))

vi.mock('./item', () => ({
  findItemByQr: findItemByQrMock,
  findItemByEan: findItemByEanMock,
}))

vi.mock('./producto', () => ({
  findProductoBySku: findProductoBySkuMock,
}))

vi.mock('../supabase', () => ({
  createServerClient: createServerClientMock,
}))

const mockItemQr: ItemProductoRow = {
  id_item: 'item-qr-1',
  id_tenant: 't-1',
  id_producto: 'prod-1',
  id_ingreso: null,
  id_ingreso_detalle: null,
  qr_code: 'abcdef1234567890abcdef12',
  codigo_ean: '2000000000015',
  estado_item: 'disponible',
  talle: 'M',
  costo_ingreso: 100,
  tipo_ingreso: 'compra',
  fecha_ingreso: '2026-01-01',
  fecha_venta: null,
  fecha_devolucion: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const mockItemEan: ItemProductoRow = {
  ...mockItemQr,
  id_item: 'item-ean-2',
  qr_code: 'qr-otro-distinto-12345678',
  codigo_ean: '2000000000015',
}

const mockProducto: ProductoRowConCategoria = {
  id_producto: 'prod-1',
  id_tenant: 't-1',
  id_categoria: 'cat-1',
  sku: 'REM-0001',
  nombre: 'Remera Negra',
  descripcion: null,
  stock_minimo: 0,
  activo: true,
  es_nuevo: false,
  precio_venta: 20000,
  id_regla_margen_aplicada: null,
  precio_venta_resuelto_at: null,
  precio_venta_desactualizado: false,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  categoria: { id_categoria: 'cat-1', nombre: 'Remeras', talles: ['S', 'M', 'L'] },
}

describe('resolverCodigo (REQ-ETQ-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findItemByQrMock.mockResolvedValue(null)
    findItemByEanMock.mockResolvedValue(null)
    findProductoBySkuMock.mockResolvedValue(null)
  })

  it('1. Orden: QR exacto tiene prioridad absoluta', async () => {
    findItemByQrMock.mockResolvedValue(mockItemQr)
    findItemByEanMock.mockResolvedValue(mockItemEan)

    const { resolverCodigo } = await import('./codigo')
    const res = await resolverCodigo('abcdef1234567890abcdef12')

    expect(findItemByQrMock).toHaveBeenCalledWith('abcdef1234567890abcdef12')
    expect(findItemByEanMock).not.toHaveBeenCalled()
    expect(findProductoBySkuMock).not.toHaveBeenCalled()
    expect(res).toEqual({ tipo: 'item', item: mockItemQr })
  })

  it('2. Orden: si QR no coincide y es un EAN-13 válido, busca por EAN antes que SKU', async () => {
    // 2000000000015 es un EAN-13 válido (dígito verificador 5)
    findItemByEanMock.mockResolvedValue(mockItemEan)
    findProductoBySkuMock.mockResolvedValue(mockProducto)

    const { resolverCodigo } = await import('./codigo')
    const res = await resolverCodigo('2000000000015')

    expect(findItemByQrMock).toHaveBeenCalledWith('2000000000015')
    expect(findItemByEanMock).toHaveBeenCalledWith('2000000000015')
    expect(findProductoBySkuMock).not.toHaveBeenCalled()
    expect(res).toEqual({ tipo: 'item', item: mockItemEan })
  })

  it('EAN válido sin ítem → sigue a SKU', async () => {
    findProductoBySkuMock.mockResolvedValue(mockProducto)

    const { resolverCodigo } = await import('./codigo')
    const res = await resolverCodigo('2000000000015')

    expect(findItemByQrMock).toHaveBeenCalledWith('2000000000015')
    expect(findItemByEanMock).toHaveBeenCalledWith('2000000000015')
    expect(findProductoBySkuMock).toHaveBeenCalledWith('2000000000015')
    expect(res).toEqual({ tipo: 'producto', producto: mockProducto, talle: null })
  })

  it('3. Orden: si QR y EAN no coinciden, busca por SKU', async () => {
    findProductoBySkuMock.mockResolvedValue(mockProducto)

    const { resolverCodigo } = await import('./codigo')
    const res = await resolverCodigo('REM-0001-M')

    expect(findItemByQrMock).toHaveBeenCalledWith('REM-0001-M')
    expect(findItemByEanMock).not.toHaveBeenCalled()
    expect(findProductoBySkuMock).toHaveBeenCalledWith('REM-0001')
    expect(res).toEqual({ tipo: 'producto', producto: mockProducto, talle: 'M' })
  })

  it('4. N1: 13 dígitos con verificador inválido NO se busca como EAN', async () => {
    // '2000000000010' tiene 13 dígitos pero su dígito verificador real sería 5, no 0.
    const { resolverCodigo } = await import('./codigo')
    const res = await resolverCodigo('2000000000010')

    expect(findItemByQrMock).toHaveBeenCalledWith('2000000000010')
    expect(findItemByEanMock).not.toHaveBeenCalled()
    expect(findProductoBySkuMock).toHaveBeenCalledWith('2000000000010')
    expect(res).toBeNull()
  })

  it('5. Si opts.sku === false no busca SKU pero sí resuelve por EAN válido', async () => {
    findItemByEanMock.mockResolvedValue(mockItemEan)

    const { resolverCodigo } = await import('./codigo')
    const res = await resolverCodigo('2000000000015', { sku: false })

    expect(findItemByEanMock).toHaveBeenCalledWith('2000000000015')
    expect(findProductoBySkuMock).not.toHaveBeenCalled()
    expect(res).toEqual({ tipo: 'item', item: mockItemEan })
  })

  it('6. Si opts.nombre === true busca por nombre si no fue QR, EAN ni SKU', async () => {
    const builder = {
      select: () => builder,
      ilike: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: mockProducto, error: null }),
    }
    createServerClientMock.mockResolvedValue({
      from: () => builder,
    })

    const { resolverCodigo } = await import('./codigo')
    const res = await resolverCodigo('remera', { nombre: true })

    expect(res).toEqual({ tipo: 'producto', producto: mockProducto, talle: null })
  })

  it('7. Texto vacío devuelve null sin consultar', async () => {
    const { resolverCodigo } = await import('./codigo')
    const res = await resolverCodigo('   ')

    expect(res).toBeNull()
    expect(findItemByQrMock).not.toHaveBeenCalled()
  })
})
