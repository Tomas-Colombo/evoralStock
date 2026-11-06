import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlDePreciosView } from './ControlDePreciosView'
import type { ProductoConPrecioStatus } from '@/lib/types/precios'

const mockRefresh = vi.fn()
const mockSuccess = vi.fn()
const mockError = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: mockSuccess, error: mockError }),
}))

const mockRevaluarCostosUsdAction = vi.fn()

vi.mock('../cotizacion/actions', () => ({
  revaluarCostosUsdAction: (input: unknown) => mockRevaluarCostosUsdAction(input),
}))

vi.mock('../actions', () => ({
  recalcularPrecioAction: vi.fn(),
  recalcularBatchAction: vi.fn(),
}))

describe('ControlDePreciosView — Revaluación USD', () => {
  const rows: ProductoConPrecioStatus[] = [
    {
      id_producto: 'p-1',
      nombre: 'Remera Lisa',
      sku: 'REM-001',
      categoria_nombre: 'Remeras',
      costo_vigente: 15000,
      precio_venta: 25000,
      precio_venta_resuelto_at: null,
      precio_venta_desactualizado: false,
      regla_margen_nombre: 'Margen 50%',
      precio_proyectado: 25000,
      diferencia_pct: 0,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockRevaluarCostosUsdAction.mockResolvedValue({
      ok: true,
      data: { revaluados: 3, sin_cambios: 1, omitidos_sin_original: 2 },
    })
  })

  it('oculta el botón de revaluación si canRevaluar es false', () => {
    render(<ControlDePreciosView initial={rows} canRevaluar={false} cantidadUsd={5} />)
    expect(
      screen.queryByRole('button', { name: /revaluar costos usd/i }),
    ).not.toBeInTheDocument()
  })

  it('muestra el botón si canRevaluar es true y abre el diálogo con la cantidad afectada', async () => {
    render(<ControlDePreciosView initial={rows} canRevaluar={true} cantidadUsd={5} />)

    const btn = screen.getByRole('button', { name: /revaluar costos usd/i })
    expect(btn).toBeInTheDocument()

    fireEvent.click(btn)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/afecta a 5 producto\(s\) con costo en usd/i)).toBeInTheDocument()
  })

  it('muestra las filas omitidas aparte en el diálogo de confirmación cuando existen', async () => {
    render(
      <ControlDePreciosView
        initial={rows}
        canRevaluar={true}
        cantidadUsd={{ revaluables: 5, omitidas: 2 }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /revaluar costos usd/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/afecta a 5 producto\(s\) con costo en usd/i)).toBeInTheDocument()
    expect(
      screen.getByText(/2 omitido\(s\) por no tener costo original en usd registrado/i),
    ).toBeInTheDocument()
  })

  it('ejecuta la revaluación al confirmar y muestra el desglose del resultado con explicación de omitidos', async () => {
    render(<ControlDePreciosView initial={rows} canRevaluar={true} cantidadUsd={5} />)

    fireEvent.click(screen.getByRole('button', { name: /revaluar costos usd/i }))

    const btnConfirmar = screen.getByRole('button', { name: 'Revaluar costos' })
    fireEvent.click(btnConfirmar)

    await waitFor(() => {
      expect(mockRevaluarCostosUsdAction).toHaveBeenCalled()
    })

    // Desglose del resultado
    expect(screen.getByText('Resultado de la revaluación de costos USD')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument() // revaluados
    expect(screen.getByText('1')).toBeInTheDocument() // sin cambios
    expect(screen.getByText('2')).toBeInTheDocument() // omitidos

    // Explicación de los omitidos
    expect(
      screen.getByText(/los productos omitidos corresponden a costos cargados en usd antes de este cambio/i),
    ).toBeInTheDocument()
  })
})
