import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CotizacionView } from './CotizacionView'
import type { CotizacionVigente } from '@/lib/dal/precios/cotizacion'

const mockRefresh = vi.fn()
const mockSuccess = vi.fn()
const mockError = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: mockSuccess, error: mockError }),
}))

const mockActualizarCotizacionManualAction = vi.fn()
const mockCambiarModoCotizacionAction = vi.fn()
const mockSincronizarCotizacionBcraAction = vi.fn()

vi.mock('./actions', () => ({
  actualizarCotizacionManualAction: (input: unknown) => mockActualizarCotizacionManualAction(input),
  cambiarModoCotizacionAction: (input: unknown) => mockCambiarModoCotizacionAction(input),
  sincronizarCotizacionBcraAction: (input: unknown) => mockSincronizarCotizacionBcraAction(input),
}))

describe('CotizacionView', () => {
  const cotizacionBcra: CotizacionVigente = {
    modo: 'automatica',
    valor: 1546,
    fecha: '2026-11-04',
    fechaValor: '2026-11-04',
    origen: 'bcra',
    desactualizada: false,
    idCotizacion: 'c-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockActualizarCotizacionManualAction.mockResolvedValue({ ok: true })
    mockCambiarModoCotizacionAction.mockResolvedValue({ ok: true })
    mockSincronizarCotizacionBcraAction.mockResolvedValue({ ok: true })
  })

  it('muestra el cartel explicativo oficial vs billete obligatorio', () => {
    render(<CotizacionView initial={cotizacionBcra} canEdit={true} />)
    expect(
      screen.getByText(/es la cotización oficial del bcra/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/para operar con dólar billete/i)).toBeInTheDocument()
  })

  it('muestra los datos vigentes: tipo de cambio, origen BCRA y fecha valor', () => {
    render(<CotizacionView initial={cotizacionBcra} canEdit={true} />)
    expect(screen.getByText(/\$ 1\.546,00/i)).toBeInTheDocument()
    expect(screen.getByText('Oficial BCRA')).toBeInTheDocument()
    expect(screen.getByText('4/11/2026')).toBeInTheDocument()
    expect(screen.getByText('Al día')).toBeInTheDocument()
  })

  it('muestra banner de advertencia si la cotización figura como desactualizada y permite reintentar', async () => {
    const cotizacionDesactualizada: CotizacionVigente = {
      ...cotizacionBcra,
      desactualizada: true,
    }
    render(<CotizacionView initial={cotizacionDesactualizada} canEdit={true} />)

    expect(screen.getByText('Cotización del BCRA no actualizada')).toBeInTheDocument()
    const botonReintentar = screen.getByRole('button', { name: 'Reintentar' })
    expect(botonReintentar).toBeInTheDocument()

    fireEvent.click(botonReintentar)
    await waitFor(() => {
      expect(mockSincronizarCotizacionBcraAction).toHaveBeenCalled()
    })
  })

  it('permite conmutar a modo manual e ingresar una cotización manual', async () => {
    render(<CotizacionView initial={cotizacionBcra} canEdit={true} />)

    const btnManual = screen.getByRole('button', { name: 'Manual' })
    fireEvent.click(btnManual)

    await waitFor(() => {
      expect(mockCambiarModoCotizacionAction).toHaveBeenCalledWith({ modo: 'manual' })
    })

    // Esperar a que pending vuelva a false
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Manual' })).not.toBeDisabled()
    })

    const input = screen.getByLabelText(/cotización manual del dólar/i)
    fireEvent.change(input, { target: { value: '1650' } })

    const form = input.closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockActualizarCotizacionManualAction).toHaveBeenCalledWith({ valor: 1650 })
    })
  })

  it('oculta los controles de edición cuando canEdit es false', () => {
    render(<CotizacionView initial={cotizacionBcra} canEdit={false} />)

    expect(screen.queryByRole('button', { name: 'Automático (BCRA)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manual' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/cotización manual del dólar/i)).not.toBeInTheDocument()
    expect(
      screen.getByText(/tu rol cuenta con permiso de visualización/i),
    ).toBeInTheDocument()
  })
})
