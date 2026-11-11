import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NuevoIngresoView } from './NuevoIngresoView'
import type { CategoriaRow, ProductoConDetalle, ProveedorRow } from '@/lib/types/inventario'

const mockRefresh = vi.fn()
const mockPush = vi.fn()
const mockSuccess = vi.fn()
const mockError = vi.fn()
const mockInfo = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush, back: vi.fn() }),
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: mockSuccess, error: mockError, info: mockInfo }),
}))

const mockCrearIngresoCompletoAction = vi.fn()

vi.mock('../../actions', () => ({
  crearIngresoCompletoAction: (input: unknown) => mockCrearIngresoCompletoAction(input),
  parseRemitoPdfAction: vi.fn(),
}))

describe('NuevoIngresoView — Selector de moneda y cotización USD', () => {
  const proveedores: ProveedorRow[] = [
    {
      id_proveedor: 'prov-1',
      id_tenant: 't-1',
      nombre: 'Proveedor Central',
      tipo: 'mayorista',
      dias_rotacion: null,
      telefono: null,
      email: null,
      cuit: null,
      notas: null,
      activo: true,
      created_at: '',
      updated_at: '',
    },
  ]
  const categorias: CategoriaRow[] = [
    {
      id_categoria: 'cat-1',
      id_tenant: 't-1',
      nombre: 'Pantalones',
      descripcion: null,
      talles: ['38', '40'],
      activa: true,
      created_at: '',
      updated_at: '',
    },
  ]
  const productos: ProductoConDetalle[] = []
  const cotizacion = { valor: 1550, fechaValor: '2026-11-04', desactualizada: false }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCrearIngresoCompletoAction.mockResolvedValue({
      ok: true,
      data: { id: 'ing-1', itemsGenerados: 2, cotizacionDesactualizada: false },
    })
  })

  it('muestra el selector de moneda y el hint con la cotización oficial al seleccionar USD', () => {
    render(
      <NuevoIngresoView
        proveedores={proveedores}
        productos={productos}
        categorias={categorias}
        tiposIngreso={['compra']}
        tiposProveedor={['mayorista']}
        cotizacion={cotizacion}
        puedeCargarCostos={true}
      />,
    )

    const selectMoneda = screen.getByLabelText(/moneda del comprobante/i)
    expect(selectMoneda).toBeInTheDocument()

    fireEvent.change(selectMoneda, { target: { value: 'USD' } })
    expect(screen.getByText(/cotización oficial: \$ 1\.550,00/i)).toBeInTheDocument()
  })

  it('calcula y muestra el estimado en pesos y el total en USD + ARS', () => {
    render(
      <NuevoIngresoView
        proveedores={proveedores}
        productos={productos}
        categorias={categorias}
        tiposIngreso={['compra']}
        tiposProveedor={['mayorista']}
        cotizacion={cotizacion}
        puedeCargarCostos={true}
      />,
    )

    fireEvent.change(screen.getByLabelText(/moneda del comprobante/i), { target: { value: 'USD' } })

    const btnAgregar = screen.getByRole('button', { name: /\+ agregar producto/i })
    fireEvent.click(btnAgregar)

    const inputNombre = screen.getByPlaceholderText('Producto')
    fireEvent.change(inputNombre, { target: { value: 'Pantalón Cargo' } })

    const inputPrecio = screen.getByLabelText(/precio unitario/i)
    fireEvent.change(inputPrecio, { target: { value: '20' } })

    // Estimado por línea (20 * 1550 = 31000)
    expect(screen.getByText(/≈ \$31\.000 ars/i)).toBeInTheDocument()

    // Total en el pie de página
    expect(screen.getByText(/usd 20/i)).toBeInTheDocument()
    expect(screen.getAllByText(/31\.000 ars/i).length).toBeGreaterThanOrEqual(1)
  })

  it('envía moneda USD a crearIngresoCompletoAction y avisa si cotizacionDesactualizada es true', async () => {
    mockCrearIngresoCompletoAction.mockResolvedValue({
      ok: true,
      data: { id: 'ing-1', itemsGenerados: 1, cotizacionDesactualizada: true },
    })

    render(
      <NuevoIngresoView
        proveedores={proveedores}
        productos={productos}
        categorias={categorias}
        tiposIngreso={['compra']}
        tiposProveedor={['mayorista']}
        cotizacion={cotizacion}
        puedeCargarCostos={true}
      />,
    )

    fireEvent.change(screen.getByLabelText(/moneda del comprobante/i), { target: { value: 'USD' } })

    const btnAgregar = screen.getByRole('button', { name: /\+ agregar producto/i })
    fireEvent.click(btnAgregar)

    fireEvent.change(screen.getByPlaceholderText('Producto'), {
      target: { value: 'Pantalón Jean' },
    })
    fireEvent.change(screen.getByLabelText(/precio unitario/i), { target: { value: '15' } })

    // Abrir modal de confirmación y confirmar
    const btnGuardar = screen.getByRole('button', { name: 'Guardar' })
    fireEvent.click(btnGuardar)

    const btnConfirmar = screen.getByRole('button', { name: 'Confirmar' })
    fireEvent.click(btnConfirmar)

    await waitFor(() => {
      expect(mockCrearIngresoCompletoAction).toHaveBeenCalledWith(
        expect.objectContaining({
          moneda: 'USD',
          lineas: [
            expect.objectContaining({
              nombre: 'Pantalón Jean',
              costoUnitario: 15,
            }),
          ],
        }),
      )
    })

    await waitFor(() => {
      expect(mockInfo).toHaveBeenCalledWith(
        'Cotización desactualizada',
        expect.stringContaining('La cotización oficial del BCRA no se encuentra al día'),
      )
    })
  })

  it('sin cargar_costos: no muestra moneda ni input de precio, y envía costoUnitario null', async () => {
    render(
      <NuevoIngresoView
        proveedores={proveedores}
        productos={productos}
        categorias={categorias}
        tiposIngreso={['compra']}
        tiposProveedor={['mayorista']}
        cotizacion={cotizacion}
        puedeCargarCostos={false}
      />,
    )

    expect(screen.queryByLabelText(/moneda del comprobante/i)).toBeNull()

    const btnAgregar = screen.getByRole('button', { name: /\+ agregar producto/i })
    fireEvent.click(btnAgregar)

    expect(screen.queryByLabelText(/precio unitario/i)).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('Producto'), {
      target: { value: 'Pantalón Cargo' },
    })

    const btnGuardar = screen.getByRole('button', { name: 'Guardar' })
    fireEvent.click(btnGuardar)

    const btnConfirmar = screen.getByRole('button', { name: 'Confirmar' })
    fireEvent.click(btnConfirmar)

    await waitFor(() => {
      expect(mockCrearIngresoCompletoAction).toHaveBeenCalledWith(
        expect.objectContaining({
          moneda: undefined,
          lineas: [
            expect.objectContaining({
              nombre: 'Pantalón Cargo',
              costoUnitario: null,
            }),
          ],
        }),
      )
    })
  })
})
