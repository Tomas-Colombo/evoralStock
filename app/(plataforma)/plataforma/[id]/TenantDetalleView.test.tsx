import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TenantDetalleView } from './TenantDetalleView'
import { ToastProvider } from '@/components/ui/Toast'
import type { TenantPlataformaDetalle } from '@/lib/types/plataforma'

const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

const mockTogglePaquete = vi.fn()
const mockRegistrarCargo = vi.fn()
const mockRegistrarPago = vi.fn()
const mockAnularMovimiento = vi.fn()

vi.mock('@/app/(plataforma)/plataforma/actions', () => ({
  togglePaqueteTenantAction: (...args: unknown[]) => mockTogglePaquete(...args),
  registrarCargoTenantAction: (...args: unknown[]) => mockRegistrarCargo(...args),
  registrarPagoTenantAction: (...args: unknown[]) => mockRegistrarPago(...args),
  anularMovimientoTenantAction: (...args: unknown[]) => mockAnularMovimiento(...args),
}))

const MOCK_DETALLE: TenantPlataformaDetalle = {
  tenant: {
    idTenant: '11111111-1111-4111-8111-111111111111',
    nombreComercial: 'Tienda Alpha',
    subdominio: 'alpha',
    logoUrl: null,
    colorPrimario: null,
    estadoTenant: 'activo',
    createdAt: '2026-01-01T00:00:00Z',
  },
  paquetes: {
    revendedoras: true,
    consignacionProveedor: false,
  },
  saldo: 15000,
  totalCargos: 40000,
  totalPagos: 25000,
  historial: [
    {
      id: 'c1111111-1111-4111-8111-111111111111',
      tipo: 'cargo',
      fechaImputacion: '2026-10-01',
      monto: 20000,
      detalle: 'Abono Octubre',
      concepto: 'Abono Octubre',
      createdAt: '2026-10-01T10:00:00Z',
      anulado: false,
    },
    {
      id: 'p1111111-1111-4111-8111-111111111111',
      tipo: 'pago',
      fechaImputacion: '2026-10-05',
      monto: 25000,
      detalle: 'Pago transferencia',
      medio: 'transferencia',
      nota: 'Comprobante #1234',
      createdAt: '2026-10-05T12:00:00Z',
      anulado: false,
    },
    {
      id: 'c2222222-2222-4222-8222-222222222222',
      tipo: 'cargo',
      fechaImputacion: '2026-09-01',
      monto: 20000,
      detalle: 'Cargo erróneo',
      concepto: 'Cargo erróneo',
      createdAt: '2026-09-01T10:00:00Z',
      anulado: true,
      anuladoAt: '2026-09-02T10:00:00Z',
      anuladoPor: 'superadmin-uuid',
    },
  ],
}

function renderView(detalle = MOCK_DETALLE) {
  return render(
    <ToastProvider>
      <TenantDetalleView detalle={detalle} />
    </ToastProvider>,
  )
}

describe('TenantDetalleView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTogglePaquete.mockResolvedValue({ ok: true })
    mockRegistrarCargo.mockResolvedValue({ ok: true, data: { id: 'new-id' } })
    mockRegistrarPago.mockResolvedValue({ ok: true, data: { id: 'new-id' } })
    mockAnularMovimiento.mockResolvedValue({ ok: true })
  })

  it('renderiza la cabecera, KPIs y estado de cuenta corriente', () => {
    renderView()

    expect(screen.getByText('Tienda Alpha')).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()

    // KPIs
    expect(screen.getByText('Saldo de cuenta corriente')).toBeInTheDocument()
    expect(screen.getByText('Deuda pendiente de cobro')).toBeInTheDocument()
    expect(screen.getByText('Total cargos acumulados')).toBeInTheDocument()
    expect(screen.getByText('Total pagos recibidos')).toBeInTheDocument()
  })

  it('renderiza paquetes opcionales con estados encendido y apagado', () => {
    renderView()

    const checkRevendedoras = screen.getByLabelText(/Revendedoras/i) as HTMLInputElement
    const checkConsignacion = screen.getByLabelText(/Consignación de proveedor/i) as HTMLInputElement

    expect(checkRevendedoras.checked).toBe(true)
    expect(checkConsignacion.checked).toBe(false)
  })

  it('activar un paquete apagado envía togglePaqueteTenantAction con habilitado: true', async () => {
    const user = userEvent.setup()
    renderView()

    const checkConsignacion = screen.getByLabelText(/Consignación de proveedor/i)
    await user.click(checkConsignacion)

    expect(mockTogglePaquete).toHaveBeenCalledWith({
      idTenant: MOCK_DETALLE.tenant.idTenant,
      paquete: 'consignacionProveedor',
      habilitado: true,
    })
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('apagar un paquete encendido pide ConfirmDialog y envía habilitado: false al confirmar', async () => {
    const user = userEvent.setup()
    renderView()

    const checkRevendedoras = screen.getByLabelText(/Revendedoras/i)
    await user.click(checkRevendedoras)

    // Se debe abrir el diálogo de confirmación
    expect(screen.getByText('¿Desactivar paquete Revendedoras?')).toBeInTheDocument()
    expect(mockTogglePaquete).not.toHaveBeenCalled()

    // Confirmar en el diálogo
    const btnDesactivar = screen.getByRole('button', { name: 'Desactivar' })
    await user.click(btnDesactivar)

    expect(mockTogglePaquete).toHaveBeenCalledWith({
      idTenant: MOCK_DETALLE.tenant.idTenant,
      paquete: 'revendedoras',
      habilitado: false,
    })
  })

  it('muestra mensajeDeError en toast si togglePaquete falla (ej. modulo-con-estado-vivo)', async () => {
    const user = userEvent.setup()
    mockTogglePaquete.mockResolvedValueOnce({
      ok: false,
      reason: 'modulo-con-estado-vivo',
    })
    renderView()

    const checkRevendedoras = screen.getByLabelText(/Revendedoras/i)
    await user.click(checkRevendedoras)

    const btnDesactivar = screen.getByRole('button', { name: 'Desactivar' })
    await user.click(btnDesactivar)

    await waitFor(() => {
      expect(
        screen.getByText(/No podés deshabilitar este módulo porque tiene operaciones o mercadería pendientes/i),
      ).toBeInTheDocument()
    })
  })

  it('permite registrar un nuevo cargo desde el modal', async () => {
    const user = userEvent.setup()
    renderView()

    // Abrir modal de cargo
    await user.click(screen.getByRole('button', { name: 'Nuevo cargo' }))
    expect(screen.getByText('Registrar nuevo cargo')).toBeInTheDocument()

    // Completar formulario
    const inputMonto = screen.getByLabelText(/Monto/i)
    const inputConcepto = screen.getByLabelText(/Concepto/i)

    await user.type(inputMonto, '12500')
    await user.type(inputConcepto, 'Abono Plan Anual')

    // Enviar formulario (dentro del modal hay un botón Registrar cargo)
    const btnSubmit = screen.getAllByRole('button', { name: 'Registrar cargo' })[0]
    await user.click(btnSubmit)

    await waitFor(() => {
      expect(mockRegistrarCargo).toHaveBeenCalledWith({
        idTenant: MOCK_DETALLE.tenant.idTenant,
        periodo: expect.stringMatching(/^\d{4}-\d{2}$/),
        monto: 12500,
        concepto: 'Abono Plan Anual',
      })
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('permite registrar un nuevo pago desde el modal', async () => {
    const user = userEvent.setup()
    renderView()

    // Abrir modal de pago
    await user.click(screen.getByRole('button', { name: 'Nuevo pago' }))
    expect(screen.getByText('Registrar nuevo pago')).toBeInTheDocument()

    // Completar formulario
    const inputMonto = screen.getByLabelText(/Monto/i)
    const selectMedio = screen.getByLabelText(/Medio de pago/i)
    const inputNota = screen.getByLabelText(/Nota u observación/i)

    await user.type(inputMonto, '20000')
    await user.selectOptions(selectMedio, 'mercadopago')
    await user.type(inputNota, 'Operación MP #55512')

    // Enviar formulario
    const btnSubmit = screen.getAllByRole('button', { name: 'Registrar pago' })[0]
    await user.click(btnSubmit)

    await waitFor(() => {
      expect(mockRegistrarPago).toHaveBeenCalledWith({
        idTenant: MOCK_DETALLE.tenant.idTenant,
        fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        monto: 20000,
        medio: 'mercadopago',
        nota: 'Operación MP #55512',
      })
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('renderiza la tabla de historial con filas vigentes y anuladas', () => {
    renderView()

    // Filas vigentes
    expect(screen.getByText('Abono Octubre')).toBeInTheDocument()
    expect(screen.getByText('Comprobante #1234')).toBeInTheDocument()

    // Fila anulada tiene badge Anulado y texto tachado
    expect(screen.getByText('Cargo erróneo')).toBeInTheDocument()
    expect(screen.getByText('Anulado')).toBeInTheDocument()
  })

  it('anular un movimiento pide ConfirmDialog y ejecuta la Server Action correspondiente', async () => {
    const user = userEvent.setup()
    renderView()

    // Hay dos movimientos vigentes, por lo que hay dos botones "Anular"
    const btnsAnular = screen.getAllByRole('button', { name: 'Anular' })
    expect(btnsAnular.length).toBe(2)

    // Clic en el primer botón "Anular" (corresponde al cargo de 20.000)
    await user.click(btnsAnular[0])

    expect(screen.getByText('¿Anular este cargo?')).toBeInTheDocument()

    // Confirmar en el modal
    const btnConfirmar = screen.getByRole('button', { name: 'Anular movimiento' })
    await user.click(btnConfirmar)

    await waitFor(() => {
      expect(mockAnularMovimiento).toHaveBeenCalledWith({
        tipo: 'cargo',
        idMovimiento: 'c1111111-1111-4111-8111-111111111111',
      })
      expect(mockRefresh).toHaveBeenCalled()
    })
  })
})
