import { describe, expect, it, vi, beforeEach } from 'vitest'
import { listarTenants } from '@/lib/dal/plataforma'

vi.mock('@/lib/dal/plataforma', () => ({
  listarTenants: vi.fn(),
}))

vi.mock('./TenantsView', () => ({
  TenantsView: ({ tenants }: { tenants: unknown[] }) => (
    <div data-testid="tenants-view">Tenants: {tenants.length}</div>
  ),
}))

describe('PlataformaPage (Server Component)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('trae los tenants del DAL y los pasa a TenantsView', async () => {
    const mockList = [
      {
        idTenant: '11111111-1111-4111-8111-111111111111',
        nombreComercial: 'Tienda Alpha',
        subdominio: 'alpha',
        estadoTenant: 'activo',
        createdAt: '2026-01-01',
        paquetesHabilitados: [],
        saldo: 0,
        totalCargos: 0,
        totalPagos: 0,
      },
    ]
    vi.mocked(listarTenants).mockResolvedValueOnce(mockList)

    const { default: PlataformaPage } = await import('./page')
    const element = await PlataformaPage()

    expect(listarTenants).toHaveBeenCalled()
    expect(element.props.tenants).toEqual(mockList)
  })
})
