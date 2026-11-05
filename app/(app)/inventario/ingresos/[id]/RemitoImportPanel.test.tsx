import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RemitoImportPanel } from './RemitoImportPanel'
import type { CategoriaRow, ProductoConDetalle } from '@/lib/types/inventario'

const mockSuccess = vi.fn()
const mockError = vi.fn()
const mockInfo = vi.fn()

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: mockSuccess, error: mockError, info: mockInfo }),
}))

const mockImportarRemitoAction = vi.fn()
const mockParseRemitoPdfAction = vi.fn()

vi.mock('../../actions', () => ({
  importarRemitoAction: (input: unknown) => mockImportarRemitoAction(input),
  parseRemitoPdfAction: (input: unknown) => mockParseRemitoPdfAction(input),
}))

describe('RemitoImportPanel — Selector de moneda y cotización USD', () => {
  const productos: ProductoConDetalle[] = []
  const categorias: CategoriaRow[] = [
    {
      id_categoria: 'cat-1',
      id_tenant: 't-1',
      nombre: 'Buzos',
      descripcion: null,
      talles: ['M', 'L'],
      activa: true,
      created_at: '',
      updated_at: '',
    },
  ]
  const cotizacion = { valor: 1500, fechaValor: '2026-11-04', desactualizada: false }
  const mockOnImported = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockParseRemitoPdfAction.mockResolvedValue({
      ok: true,
      data: {
        lineas: [{ nombre: 'Buzo Canguro', cantidad: 10, costoUnitario: 40 }],
        advertencias: [],
      },
    })
    mockImportarRemitoAction.mockResolvedValue({
      ok: true,
      data: {
        creados: 1,
        vinculados: 0,
        detalles: [],
        cotizacionDesactualizada: false,
      },
    })
  })

  async function abrirPanelConPdf() {
    render(
      <RemitoImportPanel
        idIngreso="ing-1"
        productos={productos}
        categorias={categorias}
        cotizacion={cotizacion}
        onImported={mockOnImported}
      />,
    )

    const file = new File(['dummy'], 'remito.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByDisplayValue('Buzo Canguro')).toBeInTheDocument()
    })
  }

  it('permite seleccionar moneda USD y muestra cotización oficial y total estimado en pesos', async () => {
    await abrirPanelConPdf()

    const selectMoneda = screen.getByLabelText(/moneda del remito/i)
    fireEvent.change(selectMoneda, { target: { value: 'USD' } })

    expect(screen.getByText(/cotización oficial: \$ 1\.500,00/i)).toBeInTheDocument()
    // 10 unidades * 40 USD = 400 USD * 1500 = 600.000 ARS
    expect(screen.getAllByText(/600\.000 ars/i).length).toBeGreaterThanOrEqual(1)
  })

  it('envía moneda USD a importarRemitoAction y avisa si cotizacionDesactualizada es true', async () => {
    mockImportarRemitoAction.mockResolvedValue({
      ok: true,
      data: {
        creados: 1,
        vinculados: 0,
        detalles: [],
        cotizacionDesactualizada: true,
      },
    })

    await abrirPanelConPdf()

    const selectMoneda = screen.getByLabelText(/moneda del remito/i)
    fireEvent.change(selectMoneda, { target: { value: 'USD' } })

    const btnImportar = screen.getByRole('button', { name: /importar 1 línea\(s\)/i })
    fireEvent.click(btnImportar)

    await waitFor(() => {
      expect(mockImportarRemitoAction).toHaveBeenCalledWith(
        expect.objectContaining({
          idIngreso: 'ing-1',
          moneda: 'USD',
          lineas: [
            expect.objectContaining({
              nombre: 'Buzo Canguro',
              cantidad: 10,
              costoUnitario: 40,
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
})
