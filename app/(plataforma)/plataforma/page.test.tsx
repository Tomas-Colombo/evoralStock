import { describe, expect, it, vi, beforeEach } from 'vitest'
import { listarTenantsPaginado } from '@/lib/dal/plataforma'
import type { TenantPlataformaResumen } from '@/lib/types/plataforma'

vi.mock('@/lib/dal/plataforma', () => ({
  listarTenantsPaginado: vi.fn(),
}))

vi.mock('./TenantsView', () => ({
  TenantsView: (props: { tenants?: unknown[]; page?: number; total?: number }) => (
    <div data-testid="tenants-view" data-props={JSON.stringify(props)}>
      Tenants: {props.tenants?.length}
    </div>
  ),
}))

describe('PlataformaPage (Server Component)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('trae los tenants paginados del DAL y los pasa a TenantsView', async () => {
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
    vi.mocked(listarTenantsPaginado).mockResolvedValueOnce({
      rows: mockList,
      total: 50,
    })

    const { default: PlataformaPage } = await import('./page')
    const element = await PlataformaPage({
      searchParams: Promise.resolve({
        q: 'alpha',
        estado: 'activo',
        deuda: 'con-deuda',
        orden: 'saldo_desc',
        page: '2',
      }),
    })

    expect(listarTenantsPaginado).toHaveBeenCalledWith({
      page: 2,
      pageSize: 25,
      q: 'alpha',
      estado: 'activo',
      deuda: 'con-deuda',
      orden: 'saldo_desc',
    })
    expect(element.props.tenants).toEqual(mockList)
    expect(element.props.total).toBe(50)
    expect(element.props.page).toBe(2)
  })

  it('parseo de params: valores inválidos caen a defaults, tope de 100 caracteres en q, comas/paréntesis rechazadas y page < 1 -> 1', async () => {
    vi.mocked(listarTenantsPaginado).mockResolvedValueOnce({
      rows: [],
      total: 0,
    })

    const { default: PlataformaPage } = await import('./page')

    // 1. Valores fuera de catálogo y page negativa
    await PlataformaPage({
      searchParams: Promise.resolve({
        q: '   tienda válida   ',
        estado: 'invalido',
        deuda: 'moroso',
        orden: 'desconocido',
        page: '-5',
      }),
    })

    expect(listarTenantsPaginado).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      q: 'tienda válida',
      estado: 'todos',
      deuda: 'todos',
      orden: 'nombre_asc',
    })

    // 2. Q con comas o paréntesis -> cae a default ''
    vi.mocked(listarTenantsPaginado).mockResolvedValueOnce({
      rows: [],
      total: 0,
    })
    await PlataformaPage({
      searchParams: Promise.resolve({
        q: 'tienda, maliciosa(1)',
      }),
    })

    expect(listarTenantsPaginado).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      q: '',
      estado: 'todos',
      deuda: 'todos',
      orden: 'nombre_asc',
    })

    // 3. Q con más de 100 caracteres -> recortado a 100
    vi.mocked(listarTenantsPaginado).mockResolvedValueOnce({
      rows: [],
      total: 0,
    })
    const textoLargo = 'a'.repeat(150)
    await PlataformaPage({
      searchParams: Promise.resolve({
        q: textoLargo,
      }),
    })

    expect(listarTenantsPaginado).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      q: 'a'.repeat(100),
      estado: 'todos',
      deuda: 'todos',
      orden: 'nombre_asc',
    })
  })

  it('D6: si page supera el total, muestra y consulta la última página', async () => {
    // Primera consulta con page 5 pero hay solo 30 tenants (2 páginas de 25)
    vi.mocked(listarTenantsPaginado)
      .mockResolvedValueOnce({
        rows: [],
        total: 30,
      })
      .mockResolvedValueOnce({
        rows: [{ idTenant: 't-30' } as unknown as TenantPlataformaResumen],
        total: 30,
      })

    const { default: PlataformaPage } = await import('./page')
    const element = await PlataformaPage({
      searchParams: Promise.resolve({
        page: '5',
      }),
    })

    // Debe haber consultado la página 5, y al detectar que supera totalPages (2), reconsultar la 2
    expect(listarTenantsPaginado).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 5 }))
    expect(listarTenantsPaginado).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }))
    expect(element.props.page).toBe(2)
    expect(element.props.total).toBe(30)
  })
})
