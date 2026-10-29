import { describe, expect, it, vi, beforeEach } from 'vitest'
import { notFound } from 'next/navigation'
import { obtenerTenantDetalle } from '@/lib/dal/plataforma'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/lib/dal/plataforma', () => ({
  obtenerTenantDetalle: vi.fn(),
}))

vi.mock('./TenantDetalleView', () => ({
  TenantDetalleView: ({ detalle }: { detalle: { tenant: { nombreComercial: string } } }) => (
    <div data-testid="tenant-detalle">{detalle.tenant.nombreComercial}</div>
  ),
}))

describe('TenantDetallePage (Server Component)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('si el id no es un UUID válido -> llama a notFound()', async () => {
    const { default: TenantDetallePage } = await import('./page')

    await expect(
      TenantDetallePage({
        params: Promise.resolve({ id: 'no-es-un-uuid' }),
      }),
    ).rejects.toThrow('NOT_FOUND')

    expect(notFound).toHaveBeenCalled()
  })

  it('si el tenant no existe en la base de datos (tenant-inexistente) -> llama a notFound()', async () => {
    vi.mocked(obtenerTenantDetalle).mockRejectedValueOnce(new Error('tenant-inexistente'))
    const { default: TenantDetallePage } = await import('./page')

    await expect(
      TenantDetallePage({
        params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
      }),
    ).rejects.toThrow('NOT_FOUND')

    expect(notFound).toHaveBeenCalled()
  })

  it('si ocurre un error de base de datos o genérico -> se propaga sin atrapar con notFound()', async () => {
    vi.mocked(obtenerTenantDetalle).mockRejectedValueOnce(new Error('connection-refused-db-down'))
    const { default: TenantDetallePage } = await import('./page')

    await expect(
      TenantDetallePage({
        params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
      }),
    ).rejects.toThrow('connection-refused-db-down')

    expect(notFound).not.toHaveBeenCalled()
  })

  it('si el tenant existe -> renderiza la vista de detalle con sus datos', async () => {
    const mockDetalle = {
      tenant: {
        idTenant: '11111111-1111-4111-8111-111111111111',
        nombreComercial: 'Tienda Alpha',
        subdominio: 'alpha',
        logoUrl: null,
        colorPrimario: null,
        estadoTenant: 'activo',
        createdAt: '2026-01-01',
      },
      paquetes: { revendedoras: true, consignacionProveedor: false },
      saldo: 0,
      totalCargos: 0,
      totalPagos: 0,
      historial: [],
      totalHistorial: 0,
      hpage: 1,
      hpageSize: 25,
    }
    vi.mocked(obtenerTenantDetalle).mockResolvedValueOnce(mockDetalle)

    const { default: TenantDetallePage } = await import('./page')
    const element = await TenantDetallePage({
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    })

    expect(element.props.detalle).toEqual(mockDetalle)
  })
  it('D5: pasa hpage parseado con fallback seguro a obtenerTenantDetalle', async () => {
    const mockDetalle = {
      tenant: {
        idTenant: '11111111-1111-4111-8111-111111111111',
        nombreComercial: 'Tienda Alpha',
        subdominio: 'alpha',
        logoUrl: null,
        colorPrimario: null,
        estadoTenant: 'activo',
        createdAt: '2026-01-01',
      },
      paquetes: { revendedoras: true, consignacionProveedor: false },
      saldo: 0,
      totalCargos: 0,
      totalPagos: 0,
      historial: [],
      totalHistorial: 0,
      hpage: 3,
      hpageSize: 25,
    }
    vi.mocked(obtenerTenantDetalle).mockResolvedValueOnce(mockDetalle)

    const { default: TenantDetallePage } = await import('./page')
    await TenantDetallePage({
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
      searchParams: Promise.resolve({ hpage: '3' }),
    })

    expect(obtenerTenantDetalle).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', { hpage: 3 })
  })
})
