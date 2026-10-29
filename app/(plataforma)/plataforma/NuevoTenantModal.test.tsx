import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuevoTenantModal } from './NuevoTenantModal'
import { ToastProvider } from '@/components/ui/Toast'

const mockAltaTenantAction = vi.fn()
vi.mock('@/app/(plataforma)/plataforma/actions', () => ({
  altaTenantAction: (...args: unknown[]) => mockAltaTenantAction(...args),
}))

function renderModal(props: {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}) {
  return render(
    <ToastProvider>
      <NuevoTenantModal {...props} />
    </ToastProvider>,
  )
}

describe('NuevoTenantModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza el formulario completo cuando está abierto', () => {
    renderModal({ open: true, onClose: vi.fn() })

    expect(screen.getByText('Nuevo tenant')).toBeInTheDocument()
    expect(screen.getByLabelText(/Nombre comercial/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Subdominio/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Nombre del administrador/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Email del administrador/i)).toBeInTheDocument()
    expect(screen.getByText('Revendedoras')).toBeInTheDocument()
    expect(screen.getByText('Consignación de proveedor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear tenant' })).toBeInTheDocument()
  })

  it('envía los datos del formulario a altaTenantAction y procesa paquetes opcionales', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    const handleSuccess = vi.fn()

    mockAltaTenantAction.mockResolvedValue({
      ok: true,
      data: {
        idTenant: 'tenant-123',
        passwordTemporal: 'ClaveSecreta123!',
      },
    })

    renderModal({ open: true, onClose: handleClose, onSuccess: handleSuccess })

    await user.type(screen.getByLabelText(/Nombre comercial/i), 'Modas Primavera')
    await user.type(screen.getByLabelText(/Subdominio/i), 'primavera')
    await user.type(screen.getByLabelText(/Nombre del administrador/i), 'Laura Gómez')
    await user.type(screen.getByLabelText(/Email del administrador/i), 'laura@primavera.com')

    // Seleccionar paquete Revendedoras
    await user.click(screen.getByLabelText(/Revendedoras/i))

    await user.click(screen.getByRole('button', { name: 'Crear tenant' }))

    await waitFor(() => {
      expect(mockAltaTenantAction).toHaveBeenCalledWith({
        nombre: 'Modas Primavera',
        subdominio: 'primavera',
        nombreAdmin: 'Laura Gómez',
        emailAdmin: 'laura@primavera.com',
        paquetes: ['revendedoras'],
      })
      expect(handleSuccess).toHaveBeenCalled()
    })
  })

  it('D5: la clave temporal aparece UNA vez en el modal de éxito y NO sobrevive al cerrar', async () => {
    const user = userEvent.setup()
    let isOpen = true
    const handleClose = vi.fn(() => {
      isOpen = false
    })

    mockAltaTenantAction.mockResolvedValue({
      ok: true,
      data: {
        idTenant: 'tenant-999',
        passwordTemporal: 'TmpP@ssword2026',
      },
    })

    const { rerender } = renderModal({ open: isOpen, onClose: handleClose })

    await user.type(screen.getByLabelText(/Nombre comercial/i), 'Calzados Sur')
    await user.type(screen.getByLabelText(/Subdominio/i), 'calzados-sur')
    await user.type(screen.getByLabelText(/Nombre del administrador/i), 'Roberto Sur')
    await user.type(screen.getByLabelText(/Email del administrador/i), 'roberto@sur.com')

    await user.click(screen.getByRole('button', { name: 'Crear tenant' }))

    // Verifica que la clave se muestra en pantalla y está el botón de copiar
    await waitFor(() => {
      expect(screen.getByText('Tenant creado con éxito')).toBeInTheDocument()
      expect(screen.getByTestId('password-temporal')).toHaveTextContent('TmpP@ssword2026')
      expect(screen.getByRole('button', { name: 'Copiar contraseña' })).toBeInTheDocument()
    })

    // Copiar contraseña
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    })

    await user.click(screen.getByRole('button', { name: 'Copiar contraseña' }))
    expect(writeTextMock).toHaveBeenCalledWith('TmpP@ssword2026')

    // Cerrar el modal
    await user.click(screen.getByRole('button', { name: 'Entendido, cerrar' }))
    expect(handleClose).toHaveBeenCalled()

    // Al reabrir el modal, la clave temporal NO está en el DOM ni sobrevive en el componente
    rerender(
      <ToastProvider>
        <NuevoTenantModal open={true} onClose={handleClose} />
      </ToastProvider>,
    )

    expect(screen.queryByTestId('password-temporal')).not.toBeInTheDocument()
    expect(screen.queryByText('TmpP@ssword2026')).not.toBeInTheDocument()
    expect(screen.getByText('Nuevo tenant')).toBeInTheDocument()
    expect(screen.getByLabelText(/Nombre comercial/i)).toHaveValue('')
  })
})
