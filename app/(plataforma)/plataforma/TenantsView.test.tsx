import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TenantsView } from './TenantsView'
import { ToastProvider } from '@/components/ui/Toast'
import type { TenantPlataformaResumen } from '@/lib/types/plataforma'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

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

function renderView(tenants: TenantPlataformaResumen[]) {
  return render(
    <ToastProvider>
      <TenantsView tenants={tenants} />
    </ToastProvider>,
  )
}

describe('TenantsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza el estado vacío cuando no hay comercios registrados', () => {
    renderView([])

    expect(screen.getByText('Sin comercios todavía')).toBeInTheDocument()
    expect(
      screen.getByText('No hay comercios registrados en la plataforma.'),
    ).toBeInTheDocument()
  })

  it('renderiza la lista de comercios con estados de saldo (deuda, al día, a favor) y badges de estado', () => {
    renderView(MOCK_TENANTS)

    // Nombres y subdominios
    expect(screen.getByText('Tienda Alpha')).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('Boutique Beta')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getByText('Modas Gamma')).toBeInTheDocument()
    expect(screen.getByText('gamma')).toBeInTheDocument()

    // Badges de estado (activo y suspendido)
    const badgesActivo = screen.getAllByText('Activo')
    expect(badgesActivo.length).toBe(2)
    expect(screen.getByText('Suspendido')).toBeInTheDocument()

    // Paquetes
    expect(screen.getByText('Revendedoras')).toBeInTheDocument()
    expect(screen.getByText('Consignación de proveedor')).toBeInTheDocument()

    // Saldo > 0: deuda
    expect(screen.getByText(/\(deuda\)/)).toBeInTheDocument()

    // Saldo === 0: Al día
    expect(screen.getByText('Al día')).toBeInTheDocument()

    // Saldo < 0: a favor
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

  it('filtra por nombre comercial y por subdominio desde el FilterBar', async () => {
    const user = userEvent.setup()
    renderView(MOCK_TENANTS)

    const inputBusqueda = screen.getByPlaceholderText('Buscar por nombre o subdominio')
    expect(inputBusqueda).toBeInTheDocument()

    // Buscar por nombre
    await user.type(inputBusqueda, 'Alpha')
    expect(screen.getByText('Tienda Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Boutique Beta')).not.toBeInTheDocument()
    expect(screen.queryByText('Modas Gamma')).not.toBeInTheDocument()

    // Limpiar y buscar por subdominio
    await user.clear(inputBusqueda)
    await user.type(inputBusqueda, 'gamma')
    expect(screen.queryByText('Tienda Alpha')).not.toBeInTheDocument()
    expect(screen.getByText('Modas Gamma')).toBeInTheDocument()

    // Búsqueda sin coincidencias
    await user.clear(inputBusqueda)
    await user.type(inputBusqueda, 'noexiste')
    expect(
      screen.getByText(/No se encontraron comercios que coincidan/),
    ).toBeInTheDocument()
  })
})
