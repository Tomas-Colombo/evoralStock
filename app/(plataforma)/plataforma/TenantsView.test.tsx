import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TenantsView } from './TenantsView'
import { ToastProvider } from '@/components/ui/Toast'
import type { TenantPlataformaResumen } from '@/lib/types/plataforma'
import type { FiltrosTenantsParsed } from '@/lib/validation/plataforma'

const mockPush = vi.fn()
const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}))

const DEFAULT_FILTROS: FiltrosTenantsParsed = {
  q: '',
  estado: 'todos',
  deuda: 'todos',
  orden: 'nombre_asc',
  page: 1,
}

const MOCK_TENANTS: TenantPlataformaResumen[] = [
  {
    idTenant: '11111111-1111-4111-8111-111111111111',
    nombreComercial: 'Tienda Alpha',
    subdominio: 'alpha',
    estadoTenant: 'activo',
    createdAt: '2026-01-01T00:00:00Z',
    paquetesHabilitados: ['revendedoras'],
    saldo: 25000,
    totalCargos: 50000,
    totalPagos: 25000,
  },
  {
    idTenant: '22222222-2222-4222-8222-222222222222',
    nombreComercial: 'Boutique Beta',
    subdominio: 'beta',
    estadoTenant: 'activo',
    createdAt: '2026-01-02T00:00:00Z',
    paquetesHabilitados: [],
    saldo: 0,
    totalCargos: 10000,
    totalPagos: 10000,
  },
  {
    idTenant: '33333333-3333-4333-8333-333333333333',
    nombreComercial: 'Modas Gamma',
    subdominio: 'gamma',
    estadoTenant: 'suspendido',
    createdAt: '2026-01-03T00:00:00Z',
    paquetesHabilitados: ['consignacionProveedor'],
    saldo: -5000,
    totalCargos: 5000,
    totalPagos: 10000,
  },
]

function renderView(
  tenants: TenantPlataformaResumen[],
  total: number = tenants.length,
  page: number = 1,
  pageSize: number = 25,
  filtros: FiltrosTenantsParsed = DEFAULT_FILTROS,
) {
  return render(
    <ToastProvider>
      <TenantsView
        tenants={tenants}
        total={total}
        page={page}
        pageSize={pageSize}
        filtros={filtros}
      />
    </ToastProvider>,
  )
}

describe('TenantsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza el estado vacío cuando no hay comercios registrados en toda la plataforma', () => {
    renderView([], 0, 1, 25, DEFAULT_FILTROS)

    expect(screen.getByText('Sin comercios todavía')).toBeInTheDocument()
    expect(
      screen.getByText('No hay comercios registrados en la plataforma.'),
    ).toBeInTheDocument()
  })

  it('D6: estado vacío con copy distinto para sin resultados para estos filtros', () => {
    renderView([], 0, 1, 25, {
      ...DEFAULT_FILTROS,
      q: 'busqueda-sin-exito',
    })

    expect(screen.queryByText('Sin comercios todavía')).not.toBeInTheDocument()
    expect(
      screen.getByText('No se encontraron comercios para los filtros aplicados.'),
    ).toBeInTheDocument()
  })

  it('renderiza la lista de comercios con estados de saldo (deuda, al día, a favor) y badges de estado', () => {
    renderView(MOCK_TENANTS)

    expect(screen.getByText('Tienda Alpha')).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('Boutique Beta')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getByText('Modas Gamma')).toBeInTheDocument()
    expect(screen.getByText('gamma')).toBeInTheDocument()

    // 2 badges en las filas de la tabla + 1 en la opción del select
    const badgesActivo = screen.getAllByText('Activo')
    expect(badgesActivo.length).toBe(3)
    expect(screen.getAllByText('Suspendido').length).toBe(2)

    expect(screen.getByText('Revendedoras')).toBeInTheDocument()
    expect(screen.getByText('Consignación de proveedor')).toBeInTheDocument()

    expect(screen.getByText(/\(deuda\)/)).toBeInTheDocument()
    expect(screen.getAllByText('Al día').length).toBe(2)
    expect(screen.getByText(/a favor/)).toBeInTheDocument()
  })

  it('permite abrir el modal de Nuevo tenant desde el botón superior', async () => {
    const user = userEvent.setup()
    renderView(MOCK_TENANTS)

    const btnNuevo = screen.getByRole('button', { name: 'Nuevo tenant' })
    expect(btnNuevo).toBeInTheDocument()

    await user.click(btnNuevo)
    expect(screen.getByText('Crear tenant')).toBeInTheDocument()
  })

  it('D6: cambiar un filtro resetea page a 1', async () => {
    const user = userEvent.setup()
    // Vista en página 3
    renderView(MOCK_TENANTS, 100, 3, 25, {
      ...DEFAULT_FILTROS,
      page: 3,
    })

    // 1. Cambiar select de estado a suspendido
    const selectEstado = screen.getByLabelText('Filtrar por estado')
    await user.selectOptions(selectEstado, 'suspendido')

    expect(mockPush).toHaveBeenCalledWith('/plataforma?estado=suspendido')

    // 2. Cambiar select de deuda a con-deuda (mantiene estado=suspendido y resetea page)
    mockPush.mockClear()
    const selectDeuda = screen.getByLabelText('Filtrar por deuda')
    await user.selectOptions(selectDeuda, 'con-deuda')

    expect(mockPush).toHaveBeenCalledWith('/plataforma?estado=suspendido&deuda=con-deuda')

    // 3. Cambiar select de orden
    mockPush.mockClear()
    const selectOrden = screen.getByLabelText('Ordenar comercios')
    await user.selectOptions(selectOrden, 'saldo_desc')

    expect(mockPush).toHaveBeenCalledWith(
      '/plataforma?estado=suspendido&deuda=con-deuda&orden=saldo_desc',
    )

    // 4. Filtrar por texto
    mockPush.mockClear()
    const inputBusqueda = screen.getByPlaceholderText('Buscá por comercio o subdominio')
    await user.type(inputBusqueda, 'Modas')
    const btnFiltrar = screen.getByRole('button', { name: 'Filtrar' })
    await user.click(btnFiltrar)

    expect(mockPush).toHaveBeenCalledWith(
      '/plataforma?q=Modas&estado=suspendido&deuda=con-deuda&orden=saldo_desc',
    )
  })

  it('Pagination aparece solo con más de 25 comercios en total', () => {
    // Caso 1: total = 25 -> sin paginador
    const { unmount } = renderView(MOCK_TENANTS, 25, 1, 25)
    expect(screen.queryByLabelText('Paginación')).not.toBeInTheDocument()
    unmount()

    // Caso 2: total = 26 -> aparece paginador
    renderView(MOCK_TENANTS, 26, 1, 25)
    expect(screen.getByLabelText('Paginación')).toBeInTheDocument()
    expect(screen.getByText(/Mostrando/)).toBeInTheDocument()
    expect(screen.getByText('26')).toBeInTheDocument()
  })
})
