import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImpactoReglaDialog } from './ImpactoReglaDialog'
import * as actions from '@/app/(app)/precios/actions'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
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
  aplicarReglaAction: vi.fn(),
  bajaReglaAction: vi.fn(),
}))

describe('ImpactoReglaDialog', () => {
  const idRegla = '123e4567-e89b-12d3-a456-426614174000'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('N2: impacto con 0 productos muestra aviso y no muestra Aplicar', () => {
    render(
      <ImpactoReglaDialog
        idRegla={idRegla}
        impacto={[]}
        puedeAplicar={true}
        puedeDeshacer={true}
        puedeVerCostos={true}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Esta regla no cambia ningún precio ahora')).toBeInTheDocument()
    expect(
      screen.getByText('Puede estar tapada por otra regla más específica o tener una vigencia futura.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aplicar a/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deshacer regla' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()
  })

  it('N3: sin inventario.ver_costos muestra "pasan a esta regla", aviso y oculta Aplicar', () => {
    const impactoSinCostos = [
      {
        id_categoria: 'c1',
        categoria_nombre: 'Remeras',
        productos: 4,
        cambian: null,
        suben: null,
        bajan: null,
        sin_costo: null,
      },
    ]

    render(
      <ImpactoReglaDialog
        idRegla={idRegla}
        impacto={impactoSinCostos}
        puedeAplicar={true}
        puedeDeshacer={true}
        puedeVerCostos={false}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText(/Remeras.*4 productos pasan a esta regla/)).toBeInTheDocument()
    expect(screen.queryByText(/suben/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aplicar a/i })).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Otra persona con permiso para ver costos puede aplicar los precios desde Control.',
      ),
    ).toBeInTheDocument()
  })

  it('N5: sin_costo > 0 muestra aviso de productos sin costo', () => {
    const impactoConSinCosto = [
      {
        id_categoria: 'c1',
        categoria_nombre: 'Remeras',
        productos: 5,
        cambian: 3,
        suben: 2,
        bajan: 1,
        sin_costo: 2,
      },
    ]

    render(
      <ImpactoReglaDialog
        idRegla={idRegla}
        impacto={impactoConSinCosto}
        puedeAplicar={true}
        puedeDeshacer={false}
        puedeVerCostos={true}
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByText('2 productos no tienen costo y no se van a recalcular.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar a 3 productos' })).toBeInTheDocument()
  })

  it('N6: botones deshabilitados mientras corre una acción y solo llama una vez', async () => {
    const user = userEvent.setup()
    let resolverAplicar!: (val: { ok: true; data: { recalculados: number } }) => void
    const promesa = new Promise<{ ok: true; data: { recalculados: number } }>((res) => {
      resolverAplicar = res
    })
    vi.mocked(actions.aplicarReglaAction).mockReturnValue(
      promesa as unknown as ReturnType<typeof actions.aplicarReglaAction>,
    )

    const onClose = vi.fn()
    const impacto = [
      {
        id_categoria: 'c1',
        categoria_nombre: 'Remeras',
        productos: 3,
        cambian: 3,
        suben: 2,
        bajan: 1,
        sin_costo: 0,
      },
    ]

    render(
      <ImpactoReglaDialog
        idRegla={idRegla}
        impacto={impacto}
        puedeAplicar={true}
        puedeDeshacer={true}
        puedeVerCostos={true}
        onClose={onClose}
      />,
    )

    const btnAplicar = screen.getByRole('button', { name: 'Aplicar a 3 productos' })
    const btnDeshacer = screen.getByRole('button', { name: 'Deshacer regla' })
    const btnCerrar = screen.getByRole('button', { name: 'Cerrar' })
    const btnDetalle = screen.getByRole('button', { name: 'Ver detalle' })

    await user.click(btnAplicar)

    expect(btnAplicar).toBeDisabled()
    expect(btnDeshacer).toBeDisabled()
    expect(btnCerrar).toBeDisabled()
    expect(btnDetalle).toBeDisabled()
    expect(actions.aplicarReglaAction).toHaveBeenCalledTimes(1)

    // Intento de segundo clic mientras corre
    await user.click(btnAplicar)
    expect(actions.aplicarReglaAction).toHaveBeenCalledTimes(1)

    resolverAplicar({ ok: true, data: { recalculados: 5 } })
    await vi.waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith('5 productos recalculados')
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('visibilidad de botones por permiso', () => {
    const impacto = [
      {
        id_categoria: 'c1',
        categoria_nombre: 'Remeras',
        productos: 2,
        cambian: 2,
        suben: 2,
        bajan: 0,
        sin_costo: 0,
      },
    ]

    const { rerender } = render(
      <ImpactoReglaDialog
        idRegla={idRegla}
        impacto={impacto}
        puedeAplicar={false}
        puedeDeshacer={false}
        puedeVerCostos={true}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /Aplicar a/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deshacer regla' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver detalle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()
    expect(
      screen.getByText('La regla queda guardada y los precios sin aplicar.'),
    ).toBeInTheDocument()

    // Con puedeDeshacer
    rerender(
      <ImpactoReglaDialog
        idRegla={idRegla}
        impacto={impacto}
        puedeAplicar={true}
        puedeDeshacer={true}
        puedeVerCostos={true}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Aplicar a 2 productos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deshacer regla' })).toBeInTheDocument()
  })
})
