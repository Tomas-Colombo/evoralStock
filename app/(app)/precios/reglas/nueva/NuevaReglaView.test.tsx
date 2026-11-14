import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NuevaReglaView } from './NuevaReglaView'
import * as actions from '@/app/(app)/precios/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
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

describe('NuevaReglaView — Caso N4', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('N4: cuando falla impactoReglaAction muestra toast de éxito + toast de error tal cual y link a Control de precios', async () => {
    vi.mocked(actions.createReglaAction).mockResolvedValue({
      ok: true,
      data: { id: 'regla-view-123' },
    })
    vi.mocked(actions.impactoReglaAction).mockResolvedValue({
      ok: false,
      reason: 'regla-not-found',
    })

    render(
      <NuevaReglaView
        categorias={[]}
        proveedores={[]}
        productos={[]}
        puedeVerMargenes={true}
        puedeAplicar={true}
        puedeDeshacer={true}
        puedeVerCostos={true}
      />,
    )

    // Completar formulario en la vista
    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: 'Margen View N4' } })
    fireEvent.change(screen.getByLabelText(/tipo de regla/i), { target: { value: 'margen' } })
    fireEvent.change(screen.getByLabelText(/porcentaje/i), { target: { value: '25' } })

    // Enviar
    fireEvent.click(screen.getByRole('button', { name: 'Crear regla' }))

    await waitFor(() => {
      expect(actions.createReglaAction).toHaveBeenCalledTimes(1)
      expect(actions.impactoReglaAction).toHaveBeenCalledWith('regla-view-123')
    })

    // Toasts
    expect(toastMock.success).toHaveBeenCalledWith('Regla creada')
    expect(toastMock.error).toHaveBeenCalledWith(
      'No se pudo calcular el impacto',
      mensajeDeError('regla-not-found'),
    )

    // Vista muestra el mensaje y el link a Control de precios
    expect(screen.getByText(mensajeDeError('regla-not-found'))).toBeInTheDocument()
    const linkControl = screen.getByRole('link', { name: 'Ver en Control de precios' })
    expect(linkControl).toBeInTheDocument()
    expect(linkControl).toHaveAttribute('href', '/precios/control')

    // Botón volver a reglas no deja estado colgado
    const btnVolver = screen.getByRole('button', { name: 'Volver a reglas' })
    fireEvent.click(btnVolver)
    expect(mockPush).toHaveBeenCalledWith('/precios/reglas')
  })
})
