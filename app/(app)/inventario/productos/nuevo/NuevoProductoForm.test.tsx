import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NuevoProductoForm } from './NuevoProductoForm'
import type { CategoriaRow, ProveedorRow } from '@/lib/types/inventario'

const mockRefresh = vi.fn()
const mockSuccess = vi.fn()
const mockError = vi.fn()
const mockInfo = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: mockSuccess, error: mockError, info: mockInfo }),
}))

const mockCreateProductoAction = vi.fn()

vi.mock('../../actions', () => ({
  createProductoAction: (input: unknown) => mockCreateProductoAction(input),
}))

describe('NuevoProductoForm — Moneda USD y cotización', () => {
  const categorias: CategoriaRow[] = [
    {
      id_categoria: 'cat-1',
      id_tenant: 't-1',
      nombre: 'Remeras',
      descripcion: null,
      talles: ['S', 'M'],
      activa: true,
      created_at: '',
      updated_at: '',
    },
  ]
  const productos: Array<{ nombre: string }> = []
  const proveedores: ProveedorRow[] = []
  const cotizacion = { valor: 1500, fechaValor: '2026-11-04', desactualizada: false }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateProductoAction.mockResolvedValue({
      ok: true,
      data: { id: 'p-1', itemsCreados: 0, cotizacionDesactualizada: false },
    })
  })

  it('muestra hint con la cotización y el estimado en ARS al elegir USD', () => {
    render(
      <NuevoProductoForm
        categorias={categorias}
        productos={productos}
        proveedores={proveedores}
        cotizacion={cotizacion}
        puedeCargarCostos={true}
      />,
    )

    const selectMoneda = screen.getByLabelText(/moneda/i)
    fireEvent.change(selectMoneda, { target: { value: 'USD' } })

    const inputCosto = screen.getByLabelText(/costo inicial/i)
    fireEvent.change(inputCosto, { target: { value: '50' } })

    expect(screen.getByText(/cotización oficial: \$ 1\.500,00/i)).toBeInTheDocument()
    expect(screen.getByText(/estimado: \$ 75\.000,00 ars/i)).toBeInTheDocument()
  })

  it('envía la moneda USD y el costo en USD a createProductoAction', async () => {
    render(
      <NuevoProductoForm
        categorias={categorias}
        productos={productos}
        proveedores={proveedores}
        cotizacion={cotizacion}
        puedeCargarCostos={true}
      />,
    )

    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: 'Remera Verde' } })
    fireEvent.change(screen.getByLabelText(/moneda/i), { target: { value: 'USD' } })
    fireEvent.change(screen.getByLabelText(/costo inicial/i), { target: { value: '30' } })

    const form = screen.getByRole('button', { name: /crear producto/i }).closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockCreateProductoAction).toHaveBeenCalledWith(
        expect.objectContaining({
          nombre: 'Remera Verde',
          moneda: 'USD',
          costoInicial: 30,
        }),
      )
    })
  })

  it('muestra aviso si la respuesta indica cotizacionDesactualizada', async () => {
    mockCreateProductoAction.mockResolvedValue({
      ok: true,
      data: { id: 'p-1', itemsCreados: 0, cotizacionDesactualizada: true },
    })

    render(
      <NuevoProductoForm
        categorias={categorias}
        productos={productos}
        proveedores={proveedores}
        cotizacion={cotizacion}
        puedeCargarCostos={true}
      />,
    )

    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: 'Remera Amarilla' } })
    fireEvent.change(screen.getByLabelText(/moneda/i), { target: { value: 'USD' } })
    fireEvent.change(screen.getByLabelText(/costo inicial/i), { target: { value: '25' } })

    const form = screen.getByRole('button', { name: /crear producto/i }).closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockInfo).toHaveBeenCalledWith(
        'Cotización desactualizada',
        expect.stringContaining('La cotización oficial del BCRA no se encuentra al día'),
      )
    })
  })

  it('sin cargar_costos: no renderiza inputs de costo ni envía costo a la Action', async () => {
    render(
      <NuevoProductoForm
        categorias={categorias}
        productos={productos}
        proveedores={proveedores}
        cotizacion={cotizacion}
        puedeCargarCostos={false}
      />,
    )

    expect(screen.queryByLabelText(/costo inicial/i)).toBeNull()
    expect(screen.queryByLabelText(/moneda/i)).toBeNull()

    fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: 'Remera Sin Costo' } })
    const form = screen.getByRole('button', { name: /crear producto/i }).closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockCreateProductoAction).toHaveBeenCalledWith(
        expect.objectContaining({
          nombre: 'Remera Sin Costo',
          costoInicial: null,
        }),
      )
    })
  })
})
