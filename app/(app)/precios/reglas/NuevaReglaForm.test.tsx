import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NuevaReglaForm } from './NuevaReglaForm'
import * as actions from '@/app/(app)/precios/actions'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@/app/(app)/precios/actions', () => ({
  createReglaAction: vi.fn(),
}))

describe('NuevaReglaForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mientras onSuccess está pendiente, el botón sigue deshabilitado y un segundo clic no vuelve a llamar a la action', async () => {
    vi.mocked(actions.createReglaAction).mockResolvedValue({
      ok: true,
      data: { id: 'regla-margen-1' },
    })

    let resolverOnSuccess!: () => void
    const onSuccessPromise = new Promise<void>((resolve) => {
      resolverOnSuccess = resolve
    })
    const onSuccessMock = vi.fn().mockReturnValue(onSuccessPromise)

    render(
      <NuevaReglaForm
        categorias={[]}
        proveedores={[]}
        productos={[]}
        puedeVerMargenes={true}
        onSuccess={onSuccessMock}
      />,
    )

    // Completar nombre
    const inputNombre = screen.getByLabelText(/nombre/i)
    fireEvent.change(inputNombre, { target: { value: 'Margen General' } })

    // Seleccionar tipo de regla margen
    const selectTipo = screen.getByLabelText(/tipo de regla/i)
    fireEvent.change(selectTipo, { target: { value: 'margen' } })

    // Completar valor porcentaje (ej. 30%)
    const inputValor = screen.getByLabelText(/porcentaje/i)
    fireEvent.change(inputValor, { target: { value: '30' } })

    const btnCrear = screen.getByRole('button', { name: 'Crear regla' })
    expect(btnCrear).not.toBeDisabled()

    // Primer clic
    fireEvent.click(btnCrear)

    // La acción de crear se llamó
    expect(actions.createReglaAction).toHaveBeenCalledTimes(1)

    // Mientras onSuccess sigue pendiente, el botón debe estar deshabilitado
    expect(btnCrear).toBeDisabled()

    // Segundo clic mientras está pendiente
    fireEvent.click(btnCrear)
    expect(actions.createReglaAction).toHaveBeenCalledTimes(1)

    // Se resuelve onSuccess
    resolverOnSuccess()
  })
})
