import { beforeEach, describe, expect, it, vi } from 'vitest'
import InventarioHome from './page'
import NuevoProductoPage from './productos/nuevo/page'
import NuevoIngresoPage from './ingresos/nuevo/page'
import IngresoDetallePage from './ingresos/[id]/page'
import PreciosCotizacionPage from '@/app/(app)/precios/cotizacion/page'

const mockFetchCotizacionBcra = vi.fn()

vi.mock('@/lib/cotizacion/bcra', () => ({
  fetchCotizacionBcra: () => mockFetchCotizacionBcra(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn().mockResolvedValue({
    tenantId: 't-1',
    user: { id: 'u-1', email: 'test@utopia.ar' },
    modulosHabilitados: ['inventario', 'precios'],
  }),
}))

vi.mock('@/lib/dal/guard', () => ({
  hasModuleAccess: vi.fn().mockReturnValue(false),
  hasPermission: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    rpc: vi.fn().mockImplementation((name: string) => {
      if (name === 'sp_get_cotizacion_vigente') {
        return Promise.resolve({
          data: {
            modo: 'automatica',
            id_cotizacion: 'cotiz-1',
            valor: 1500,
            fecha: '2026-11-04',
            fecha_valor: '2026-11-04',
            origen: 'bcra',
            desactualizada: true,
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }),
  }),
}))

vi.mock('@/lib/dal/inventario/categoria', () => ({
  listCategoriasActivas: vi.fn().mockResolvedValue([
    {
      id_categoria: 'cat-1',
      id_tenant: 't-1',
      nombre: 'Remeras',
      descripcion: null,
      activa: true,
      talles: ['S', 'M'],
      created_at: '',
      updated_at: '',
    },
  ]),
}))

vi.mock('@/lib/dal/inventario/producto', () => ({
  listProductosConDetallePaginado: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  listProductosParaBuscador: vi.fn().mockResolvedValue([]),
  getInventarioResumen: vi.fn().mockResolvedValue({
    productosActivos: 10,
    stockDisponibleTotal: 100,
    productosBajoMinimo: 0,
  }),
  listProductosConDetalle: vi.fn().mockResolvedValue([]),
  PRODUCTOS_PAGE_SIZE: 50,
}))

vi.mock('@/lib/dal/inventario/proveedor', () => ({
  countProveedoresActivos: vi.fn().mockResolvedValue(2),
  listProveedoresActivos: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/dal/reportes/reportes', () => ({
  listAlertaReposicion: vi.fn().mockResolvedValue([]),
  listAlertaRotacionVencida: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/dal/revendedoras', () => ({
  obtenerStockPorTenencia: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/dal/inventario/ingreso', () => ({
  getIngreso: vi.fn().mockResolvedValue({
    id_ingreso: 'ing-123',
    id_tenant: 't-1',
    fecha: '2026-11-05',
    confirmado: false,
    tipo: 'compra',
    numero_comprobante: null,
    proveedor: null,
    detalles: [],
  }),
}))

vi.mock('@/lib/dal/inventario/item', () => ({
  listQrsByIngreso: vi.fn().mockResolvedValue([]),
  getUltimoContextoIngresoProducto: vi.fn().mockResolvedValue(null),
}))

describe('Renderizado de pantallas de inventario — Sin llamadas a la API del BCRA', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderizar /inventario no llama a fetchCotizacionBcra', async () => {
    await InventarioHome({ searchParams: Promise.resolve({}) })
    expect(mockFetchCotizacionBcra).not.toHaveBeenCalled()
  })

  it('renderizar /inventario/productos/nuevo no llama a fetchCotizacionBcra', async () => {
    await NuevoProductoPage()
    expect(mockFetchCotizacionBcra).not.toHaveBeenCalled()
  })

  it('renderizar /inventario/ingresos/nuevo no llama a fetchCotizacionBcra', async () => {
    await NuevoIngresoPage({ searchParams: Promise.resolve({}) })
    expect(mockFetchCotizacionBcra).not.toHaveBeenCalled()
  })

  it('renderizar /inventario/ingresos/[id] no llama a fetchCotizacionBcra', async () => {
    await IngresoDetallePage({
      params: Promise.resolve({ id: 'ing-123' }),
      searchParams: Promise.resolve({}),
    })
    expect(mockFetchCotizacionBcra).not.toHaveBeenCalled()
  })

  it('renderizar /precios/cotizacion no llama a fetchCotizacionBcra', async () => {
    await PreciosCotizacionPage()
    expect(mockFetchCotizacionBcra).not.toHaveBeenCalled()
  })
})
