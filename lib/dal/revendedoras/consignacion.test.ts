import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItemProductoRow } from '@/lib/types/inventario'
import type { ProductoRowConCategoria } from '../inventario/producto'

const {
  createServerClientMock,
  resolverCodigoMock,
  listItemsDisponiblesMock,
  getProductoConCategoriaMock,
  calcularSnapshotPrecioMock,
} = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  resolverCodigoMock: vi.fn(),
  listItemsDisponiblesMock: vi.fn(),
  getProductoConCategoriaMock: vi.fn(),
  calcularSnapshotPrecioMock: vi.fn(),
}))

vi.mock('../supabase', () => ({
  createServerClient: createServerClientMock,
}))

vi.mock('../inventario/codigo', () => ({
  resolverCodigo: resolverCodigoMock,
}))

vi.mock('../inventario/item', () => ({
  listItemsDisponibles: listItemsDisponiblesMock,
}))

vi.mock('../inventario/producto', () => ({
  getProductoConCategoria: getProductoConCategoriaMock,
}))

vi.mock('../precios/resolucion', () => ({
  calcularSnapshotPrecio: calcularSnapshotPrecioMock,
}))

const productoConTallesFixture: ProductoRowConCategoria = {
  id_producto: 'prod-1',
  id_tenant: 'tenant-1',
  id_categoria: 'cat-1',
  sku: 'REM-0001',
  nombre: 'Remera Básica',
  descripcion: null,
  stock_minimo: 0,
  activo: true,
  es_nuevo: false,
  precio_venta: 15000,
  id_regla_margen_aplicada: null,
  precio_venta_resuelto_at: null,
  precio_venta_desactualizado: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  categoria: { id_categoria: 'cat-1', nombre: 'Remeras', talles: ['S', 'M', 'L'] },
}

const productoSinTallesFixture: ProductoRowConCategoria = {
  ...productoConTallesFixture,
  categoria: { id_categoria: 'cat-2', nombre: 'Accesorios', talles: [] },
}

function makeItem(id: string, qr: string, talle: string | null = 'M'): ItemProductoRow {
  return {
    id_item: id,
    id_tenant: 'tenant-1',
    id_producto: 'prod-1',
    id_ingreso: null,
    id_ingreso_detalle: null,
    qr_code: qr,
    estado_item: 'disponible',
    talle,
    costo_ingreso: 8000,
    tipo_ingreso: 'compra',
    fecha_ingreso: '2026-10-01T00:00:00Z',
    fecha_venta: null,
    fecha_devolucion: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  }
}

function mockSupabase(opts?: {
  itemsDisponibles?: Array<{ id_item: string; talle: string | null }>
  itemsEnPoder?: Array<{ id_item: string; item: { talle: string | null } }>
  itemCompleto?: Record<string, unknown> | null
}) {
  createServerClientMock.mockResolvedValue({
    from: (table: string) => {
      if (table === 'revendedora') {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: async () => ({ data: { activo: true }, error: null }),
        }
        return b
      }
      if (table === 'item_producto') {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: async () => ({ data: opts?.itemCompleto ?? null, error: null }),
          then: (resolve: (val: unknown) => unknown) =>
            Promise.resolve({ data: opts?.itemsDisponibles ?? [], error: null }).then(resolve),
        }
        return b
      }
      if (table === 'consignacion_revendedora_detalle') {
        const b = {
          select: () => b,
          in: () => b,
          eq: () => b,
          maybeSingle: async () => ({
            data: { id_consignacion_revendedora_detalle: 'det-1' },
            error: null,
          }),
          then: (resolve: (val: unknown) => unknown) =>
            Promise.resolve({ data: opts?.itemsEnPoder ?? [], error: null }).then(resolve),
        }
        return b
      }
      // Tablas de bloqueo (detalle_reserva, consignacion_detalle)
      const b = {
        select: () => b,
        in: () => b,
        eq: () => b,
        then: (resolve: (val: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      }
      return b
    },
  })
}

describe('lookupItemParaConsignacionRevendedora', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase()
  })

  it('saltea las unidades presentes en excluir y devuelve la siguiente unidad FIFO disponible cuando viene SKU con talle', async () => {
    resolverCodigoMock.mockResolvedValue({
      tipo: 'producto',
      producto: productoConTallesFixture,
      talle: 'M',
    })
    listItemsDisponiblesMock.mockResolvedValue([
      makeItem('item-1', 'UTP-001', 'M'),
      makeItem('item-2', 'UTP-002', 'M'),
    ])

    const { lookupItemParaConsignacionRevendedora } = await import('./consignacion')
    const res = await lookupItemParaConsignacionRevendedora('REM-0001-M', 'rev-1', ['item-1'])

    expect(res).toEqual({
      ok: true,
      data: {
        id_item: 'item-2',
        id_producto: 'prod-1',
        nombre_producto: 'Remera Básica',
        codigo_barra: 'UTP-002',
        sku: 'REM-0001',
        talle: 'M',
        precio_actual: 15000,
      },
    })
  })

  it('pide elegir-talle cuando el SKU no tiene talle y la categoría usa talles', async () => {
    mockSupabase({
      itemsDisponibles: [
        { id_item: 'item-1', talle: 'L' },
        { id_item: 'item-2', talle: 'M' },
        { id_item: 'item-3', talle: null },
      ],
    })
    resolverCodigoMock.mockResolvedValue({
      tipo: 'producto',
      producto: productoConTallesFixture,
      talle: null,
    })

    const { lookupItemParaConsignacionRevendedora } = await import('./consignacion')
    const res = await lookupItemParaConsignacionRevendedora('REM-0001', 'rev-1', [])

    expect(res).toEqual({
      ok: false,
      reason: 'elegir-talle',
      id_producto: 'prod-1',
      producto_nombre: 'Remera Básica',
      talles: [
        { talle: 'M', disponibles: 1, reservados: 0 },
        { talle: 'L', disponibles: 1, reservados: 0 },
      ],
      sin_talle: 1,
      sin_talle_reservados: 0,
      id_reserva: null,
    })
  })

  it('devuelve sku-sin-stock-libre cuando todas las unidades disponibles ya están en excluir', async () => {
    resolverCodigoMock.mockResolvedValue({
      tipo: 'producto',
      producto: productoConTallesFixture,
      talle: 'M',
    })
    listItemsDisponiblesMock.mockResolvedValue([makeItem('item-1', 'UTP-001')])

    const { lookupItemParaConsignacionRevendedora } = await import('./consignacion')
    const res = await lookupItemParaConsignacionRevendedora('REM-0001-M', 'rev-1', ['item-1'])

    expect(res).toEqual({
      ok: false,
      reason: 'sku-sin-stock-libre',
    })
  })

  it('devuelve sku-sin-stock cuando el producto sin talles no tiene unidades disponibles', async () => {
    resolverCodigoMock.mockResolvedValue({
      tipo: 'producto',
      producto: productoSinTallesFixture,
      talle: null,
    })
    listItemsDisponiblesMock.mockResolvedValue([])

    const { lookupItemParaConsignacionRevendedora } = await import('./consignacion')
    const res = await lookupItemParaConsignacionRevendedora('REM-0001', 'rev-1', [])

    expect(res).toEqual({
      ok: false,
      reason: 'sku-sin-stock',
    })
  })

  it('con cantidad > 1 devuelve hasta N ítems disponibles no excluidos (pide 3 y hay 3)', async () => {
    resolverCodigoMock.mockResolvedValue(null)
    getProductoConCategoriaMock.mockResolvedValue(productoConTallesFixture)
    listItemsDisponiblesMock.mockResolvedValue([
      makeItem('item-1', 'UTP-001', 'M'),
      makeItem('item-2', 'UTP-002', 'M'),
      makeItem('item-3', 'UTP-003', 'M'),
    ])

    const { lookupItemParaConsignacionRevendedora } = await import('./consignacion')
    const res = await lookupItemParaConsignacionRevendedora(undefined, 'rev-1', [], {
      idProducto: 'prod-1',
      talle: 'M',
      cantidad: 3,
    })

    expect(res).toEqual({
      ok: true,
      data: {
        id_item: 'item-1',
        id_producto: 'prod-1',
        nombre_producto: 'Remera Básica',
        codigo_barra: 'UTP-001',
        sku: 'REM-0001',
        talle: 'M',
        precio_actual: 15000,
      },
      items: [
        {
          id_item: 'item-1',
          id_producto: 'prod-1',
          nombre_producto: 'Remera Básica',
          codigo_barra: 'UTP-001',
          sku: 'REM-0001',
          talle: 'M',
          precio_actual: 15000,
        },
        {
          id_item: 'item-2',
          id_producto: 'prod-1',
          nombre_producto: 'Remera Básica',
          codigo_barra: 'UTP-002',
          sku: 'REM-0001',
          talle: 'M',
          precio_actual: 15000,
        },
        {
          id_item: 'item-3',
          id_producto: 'prod-1',
          nombre_producto: 'Remera Básica',
          codigo_barra: 'UTP-003',
          sku: 'REM-0001',
          talle: 'M',
          precio_actual: 15000,
        },
      ],
    })
  })

  it('con cantidad > 1 emite aviso stock-parcial-disponible si hay menos de las pedidas (pide 3 y hay 1)', async () => {
    resolverCodigoMock.mockResolvedValue(null)
    getProductoConCategoriaMock.mockResolvedValue(productoConTallesFixture)
    listItemsDisponiblesMock.mockResolvedValue([makeItem('item-1', 'UTP-001', 'M')])

    const { lookupItemParaConsignacionRevendedora } = await import('./consignacion')
    const res = await lookupItemParaConsignacionRevendedora(undefined, 'rev-1', [], {
      idProducto: 'prod-1',
      talle: 'M',
      cantidad: 3,
    })

    expect(res).toEqual({
      ok: true,
      data: {
        id_item: 'item-1',
        id_producto: 'prod-1',
        nombre_producto: 'Remera Básica',
        codigo_barra: 'UTP-001',
        sku: 'REM-0001',
        talle: 'M',
        precio_actual: 15000,
      },
      items: [
        {
          id_item: 'item-1',
          id_producto: 'prod-1',
          nombre_producto: 'Remera Básica',
          codigo_barra: 'UTP-001',
          sku: 'REM-0001',
          talle: 'M',
          precio_actual: 15000,
        },
      ],
      aviso: 'stock-parcial-disponible',
    })
  })

  it('con cantidad ausente mantiene respuesta idéntica a hoy', async () => {
    resolverCodigoMock.mockResolvedValue(null)
    getProductoConCategoriaMock.mockResolvedValue(productoConTallesFixture)
    listItemsDisponiblesMock.mockResolvedValue([
      makeItem('item-1', 'UTP-001', 'M'),
      makeItem('item-2', 'UTP-002', 'M'),
    ])

    const { lookupItemParaConsignacionRevendedora } = await import('./consignacion')
    const res = await lookupItemParaConsignacionRevendedora(undefined, 'rev-1', [], {
      idProducto: 'prod-1',
      talle: 'M',
    })

    expect(res).toEqual({
      ok: true,
      data: {
        id_item: 'item-1',
        id_producto: 'prod-1',
        nombre_producto: 'Remera Básica',
        codigo_barra: 'UTP-001',
        sku: 'REM-0001',
        talle: 'M',
        precio_actual: 15000,
      },
    })
    expect((res as { items?: unknown }).items).toBeUndefined()
    expect((res as { aviso?: unknown }).aviso).toBeUndefined()
  })
})

describe('lookupItemParaVentaRevendedora', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pide elegir-talle con los talles en poder de la revendedora cuando el SKU no trae talle', async () => {
    mockSupabase({
      itemsEnPoder: [
        { id_item: 'item-1', item: { talle: 'M' } },
        { id_item: 'item-2', item: { talle: 'S' } },
      ],
    })
    resolverCodigoMock.mockResolvedValue({
      tipo: 'producto',
      producto: productoConTallesFixture,
      talle: null,
    })

    const { lookupItemParaVentaRevendedora } = await import('./consignacion')
    const res = await lookupItemParaVentaRevendedora('REM-0001', 'rev-1')

    expect(res).toEqual({
      ok: false,
      reason: 'elegir-talle',
      id_producto: 'prod-1',
      producto_nombre: 'Remera Básica',
      talles: [
        { talle: 'S', disponibles: 1, reservados: 0 },
        { talle: 'M', disponibles: 1, reservados: 0 },
      ],
      sin_talle: 0,
      sin_talle_reservados: 0,
      id_reserva: null,
    })
  })

  it('filtra directo por el talle del código (REM-0001-M) entre las unidades en poder de la revendedora', async () => {
    mockSupabase({
      itemsEnPoder: [
        { id_item: 'item-s', item: { talle: 'S' } },
        { id_item: 'item-m', item: { talle: 'M' } },
      ],
      itemCompleto: {
        id_item: 'item-m',
        id_producto: 'prod-1',
        qr_code: 'UTP-M1',
        talle: 'M',
        estado_item: 'en_revendedora',
        producto: {
          id_producto: 'prod-1',
          nombre: 'Remera Básica',
          sku: 'REM-0001',
          precio_venta: 15000,
          categoria: { id_categoria: 'cat-1', nombre: 'Remeras' },
        },
      },
    })
    resolverCodigoMock.mockResolvedValue({
      tipo: 'producto',
      producto: productoConTallesFixture,
      talle: 'M',
    })
    calcularSnapshotPrecioMock.mockResolvedValue({
      ok: true,
      precio_lista: 15000,
      precio_final: 15000,
      desactualizado: false,
      desglose: [],
    })

    const { lookupItemParaVentaRevendedora } = await import('./consignacion')
    const res = await lookupItemParaVentaRevendedora('REM-0001-M', 'rev-1')

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.item.id_item).toBe('item-m')
      expect(res.data.item.talle).toBe('M')
    }
  })
})
