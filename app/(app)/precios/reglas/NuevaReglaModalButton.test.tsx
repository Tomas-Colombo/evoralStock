import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NuevaReglaModalButton } from './NuevaReglaModalButton'
import * as actions from '@/app/(app)/precios/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: mockRefresh,
    back: vi.fn(),
  }),
}))

const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
}
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => toastMock,
}))

vi.mock('@/app/(app)/precios/actions', () => ({
  createReglaAction: vi.fn(),
  impactoReglaAction: vi.fn(),
  aplicarReglaAction: vi.fn(),
  bajaReglaAction: vi.fn(),
}))

describe('NuevaReglaModalButton — Caso N4', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('N4: cuando falla impactoReglaAction muestra toast de éxito + toast de error tal cual y link a Control de precios', async () => {
    vi.mocked(actions.createReglaAction).mockResolvedValue({
      ok: true,
      data: { id: 'regla-123' },
    })
    vi.mocked(actions.impactoReglaAction).mockResolvedValue({
      ok: false,
      reason: 'regla-not-found',
    })

    render(
      <NuevaReglaModalButton
        categorias={[]}
        proveedores={[]}
        productos={[]}
        puedeVerMargenes={true}
        puedeAplicar={true}
        puedeDeshacer={true}
        puedeVerCostos={true}
      />,
    )

    // Abrir modal
    fireEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))

    // Completar formulario
    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: 'Margen N4' } })
    fireEvent.change(screen.getByLabelText(/tipo de regla/i), { target: { value: 'margen' } })
    fireEvent.change(screen.getByLabelText(/porcentaje/i), { target: { value: '25' } })

    // Enviar
    fireEvent.click(screen.getByRole('button', { name: 'Crear regla' }))

    await waitFor(() => {
      expect(actions.createReglaAction).toHaveBeenCalledTimes(1)
      expect(actions.impactoReglaAction).toHaveBeenCalledWith('regla-123')
    })

    // Toasts
    expect(toastMock.success).toHaveBeenCalledWith('Regla creada')
    expect(toastMock.error).toHaveBeenCalledWith(
      'No se pudo calcular el impacto',
      mensajeDeError('regla-not-found'),
    )

    // Modal muestra el mensaje y el link a Control de precios
    expect(screen.getByText(mensajeDeError('regla-not-found'))).toBeInTheDocument()
    const linkControl = screen.getByRole('link', { name: 'Ver en Control de precios' })
    expect(linkControl).toBeInTheDocument()
    expect(linkControl).toHaveAttribute('href', '/precios/control')

    // Botón cerrar no deja estado colgado
    const btnsCerrar = screen.getAllByRole('button', { name: 'Cerrar' })
    fireEvent.click(btnsCerrar[btnsCerrar.length - 1])
    expect(mockRefresh).toHaveBeenCalled()
  })
})
