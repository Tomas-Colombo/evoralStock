import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServerClientMock, getReservasActivasDeItemsMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  getReservasActivasDeItemsMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: createServerClientMock,
}))
vi.mock('@/lib/dal/reservas/reserva', () => ({
  getReservasActivasDeItems: getReservasActivasDeItemsMock,
}))

describe('findItemByEan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('consulta item_producto con columnas explicitas y eq codigo_ean', async () => {
    let selectedCols = ''
    let eqCol = ''
    let eqVal = ''

    const builder = {
      select: (cols: string) => {
        selectedCols = cols
        return builder
      },
      eq: (col: string, val: string) => {
        eqCol = col
        eqVal = val
        return builder
      },
      maybeSingle: async () => ({
        data: {
          id_item: 'it-1',
          id_tenant: 'ten-1',
          id_producto: 'p-1',
          id_ingreso: null,
          id_ingreso_detalle: null,
          qr_code: 'QR123',
          codigo_ean: '2000000000015',
          estado_item: 'disponible',
          talle: 'M',
          tipo_ingreso: 'compra',
          fecha_ingreso: '2026-01-01',
          fecha_venta: null,
          fecha_devolucion: null,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
          item_costo: [{ costo_ingreso: 500 }],
        },
        error: null,
      }),
    }

    createServerClientMock.mockResolvedValue({
      from: () => builder,
    })

    const { findItemByEan } = await import('./item')
    const res = await findItemByEan('2000000000015')

    expect(selectedCols).toContain('codigo_ean')
    expect(selectedCols).toContain('qr_code')
    expect(eqCol).toBe('codigo_ean')
    expect(eqVal).toBe('2000000000015')
    expect(res).toEqual({
      id_item: 'it-1',
      id_tenant: 'ten-1',
      id_producto: 'p-1',
      id_ingreso: null,
      id_ingreso_detalle: null,
      qr_code: 'QR123',
      codigo_ean: '2000000000015',
      estado_item: 'disponible',
      talle: 'M',
      tipo_ingreso: 'compra',
      fecha_ingreso: '2026-01-01',
      fecha_venta: null,
      fecha_devolucion: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      costo_ingreso: 500,
    })
  })
})

describe('listItemsParaEtiquetas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selecciona codigo_ean y descripcion, filtra solo estados imprimibles y devuelve las etiquetas en el orden pedido', async () => {
    let selectedCols = ''
    const inCalls: Array<{ col: string; values: unknown[] }> = []

    const builder = {
      select: (cols: string) => {
        selectedCols = cols
        return builder
      },
      in: (col: string, values: unknown[]) => {
        inCalls.push({ col, values })
        return builder
      },
      then: (resolve: (val: unknown) => unknown) =>
        Promise.resolve({
          data: [
            {
              qr_code: 'QR-002',
              codigo_ean: '2000000000022',
              talle: 'M',
              producto: { nombre: 'Remera Básica', sku: 'REM-01', descripcion: 'Color negro, cuello redondo' },
            },
            {
              qr_code: 'QR-001',
              codigo_ean: '2000000000015',
              talle: null,
              producto: { nombre: 'Gorra Lisa', sku: null, descripcion: null },
            },
          ],
          error: null,
        }).then(resolve),
    }

    createServerClientMock.mockResolvedValue({
      from: () => builder,
    })

    const { listItemsParaEtiquetas } = await import('./item')
    const res = await listItemsParaEtiquetas(['QR-001', 'QR-002'])

    expect(selectedCols).toContain('codigo_ean')
    expect(selectedCols).toContain('descripcion')
    expect(inCalls).toEqual([
      { col: 'qr_code', values: ['QR-001', 'QR-002'] },
      { col: 'estado_item', values: ['disponible', 'reservado'] },
    ])
    expect(res).toEqual([
      {
        qr_code: 'QR-001',
        codigo_ean: '2000000000015',
        talle: null,
        nombre: 'Gorra Lisa',
        sku: null,
        descripcion: null,
      },
      {
        qr_code: 'QR-002',
        codigo_ean: '2000000000022',
        talle: 'M',
        nombre: 'Remera Básica',
        sku: 'REM-01',
        descripcion: 'Color negro, cuello redondo',
      },
    ])
  })
})

describe('listQrsByIngreso', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('consulta los qr_code vigentes (disponible o reservado) del ingreso en una sola query ordenada por creación', async () => {
    const eqCalls: Array<{ col: string; val: unknown }> = []
    const inCalls: Array<{ col: string; values: unknown[] }> = []
    const orderCalls: Array<{ col: string; opts: unknown }> = []

    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        eqCalls.push({ col, val })
        return builder
      },
      in: (col: string, values: unknown[]) => {
        inCalls.push({ col, values })
        return builder
      },
      order: (col: string, opts: unknown) => {
        orderCalls.push({ col, opts })
        return builder
      },
      then: (resolve: (val: unknown) => unknown) =>
        Promise.resolve({
          data: [{ qr_code: 'UTP-001' }, { qr_code: 'UTP-002' }],
          error: null,
        }).then(resolve),
    }

    createServerClientMock.mockResolvedValue({
      from: () => builder,
    })

    const { listQrsByIngreso } = await import('./item')
    const qrs = await listQrsByIngreso('ing-123')

    expect(eqCalls).toEqual([{ col: 'id_ingreso', val: 'ing-123' }])
    expect(inCalls).toEqual([{ col: 'estado_item', values: ['disponible', 'reservado'] }])
    expect(orderCalls).toEqual([
      { col: 'created_at', opts: { ascending: true } },
      { col: 'id_item', opts: { ascending: true } },
    ])
    expect(qrs).toEqual(['UTP-001', 'UTP-002'])
  })
})

describe('listItemsParaEtiquetasPorOrigen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('consulta origen producto con paginación determinista, codigo_ean y filtro de talle', async () => {
    let selectedCols = ''
    const eqCalls: Array<{ col: string; val: unknown }> = []
    const inCalls: Array<{ col: string; values: unknown[] }> = []
    let rangeArgs: [number, number] | null = null

    const builder = {
      select: (cols: string) => {
        selectedCols = cols
        return builder
      },
      eq: (col: string, val: unknown) => {
        eqCalls.push({ col, val })
        return builder
      },
      in: (col: string, values: unknown[]) => {
        inCalls.push({ col, values })
        return builder
      },
      order: () => builder,
      range: (desde: number, hasta: number) => {
        rangeArgs = [desde, hasta]
        return builder
      },
      then: (resolve: (val: unknown) => unknown) =>
        Promise.resolve({
          data: [
            {
              qr_code: 'UTP-PR-1',
              codigo_ean: '2000000000039',
              talle: 'L',
              producto: { nombre: 'Buzo Friza', sku: 'BUZ-1', descripcion: 'Negro' },
            },
          ],
          count: 250,
          error: null,
        }).then(resolve),
    }

    createServerClientMock.mockResolvedValue({
      from: () => builder,
    })

    const { listItemsParaEtiquetasPorOrigen } = await import('./item')
    const res = await listItemsParaEtiquetasPorOrigen({
      tipo: 'producto',
      idProducto: 'prod-456',
      talle: 'L',
      incluirReservados: false,
      tanda: 2,
    })

    expect(selectedCols).toContain('codigo_ean')
    expect(eqCalls).toEqual([
      { col: 'id_producto', val: 'prod-456' },
      { col: 'talle', val: 'L' },
    ])
    expect(inCalls).toEqual([{ col: 'estado_item', values: ['disponible'] }])
    expect(rangeArgs).toEqual([200, 399])
    expect(res.total).toBe(250)
    expect(res.items).toHaveLength(1)
    expect(res.items[0].qr_code).toBe('UTP-PR-1')
    expect(res.items[0].codigo_ean).toBe('2000000000039')
  })
})

describe('contarDisponiblesMultiplesProductos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('devuelve array vacio si la lista de ids está vacia sin consultar al server', async () => {
    const { contarDisponiblesMultiplesProductos } = await import('./item')
    const res = await contarDisponiblesMultiplesProductos([])
    expect(res).toEqual([])
    expect(createServerClientMock).not.toHaveBeenCalled()
  })

  it('cuenta cada producto con sp_stock_por_talle en paralelo y conserva el contexto de reserva', async () => {
    const rpc = vi.fn(async (_fn: string, args: { p_id_producto: string }) => ({
      data:
        args.p_id_producto === 'p-1'
          ? { porTalle: [{ talle: 'M', disponibles: 1 }, { talle: 'L', disponibles: 1 }] }
          : { porTalle: [{ talle: null, disponibles: 2 }] },
      error: null,
    }))
    createServerClientMock.mockResolvedValue({ rpc })

    const { contarDisponiblesMultiplesProductos } = await import('./item')
    const res = await contarDisponiblesMultiplesProductos(['p-1', 'p-2'], {
      idReservaCtx: 'res-ctx',
    })

    // El conteo lo hace la base: nada de traer unidades sueltas (max_rows las cortaba).
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith('sp_stock_por_talle', {
      p_id_producto: 'p-1',
      p_id_reserva_ctx: 'res-ctx',
      p_excluir: [],
    })
    expect(res).toEqual([
      { id_producto: 'p-1', talle: 'M', disponibles: 1 },
      { id_producto: 'p-1', talle: 'L', disponibles: 1 },
      { id_producto: 'p-2', talle: null, disponibles: 2 },
    ])
  })
})
