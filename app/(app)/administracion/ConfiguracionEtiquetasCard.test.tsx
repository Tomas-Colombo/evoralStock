import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfiguracionEtiquetasCard } from './ConfiguracionEtiquetasCard'
import type { EtiquetaConfig } from '@/lib/dal/etiquetas/etiquetas'

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => mockToast,
}))

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

const mockSetEtiquetaConfigAction = vi.fn()
vi.mock('./actions', () => ({
  setEtiquetaConfigAction: (...args: unknown[]) => mockSetEtiquetaConfigAction(...args),
}))

const CONFIG_INICIAL: EtiquetaConfig = {
  metodo: 'qr',
  impresora_tipo: 'hoja',
  margen_mm: 10,
  separacion_mm: 2,
  columnas: null,
  offset_x_mm: 0,
  offset_y_mm: 0,
}

describe('ConfiguracionEtiquetasCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('respeta canEdit=false deshabilitando controles y ocultando el botón guardar', () => {
    render(<ConfiguracionEtiquetasCard inicial={CONFIG_INICIAL} canEdit={false} />)

    expect(screen.getByLabelText(/Método de identificación/i)).toBeDisabled()
    expect(screen.getByLabelText(/Tipo de impresora/i)).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Guardar configuración/i })).not.toBeInTheDocument()
  })

  it('permite cambiar valores y habilita el botón cuando hay cambios', () => {
    render(<ConfiguracionEtiquetasCard inicial={CONFIG_INICIAL} canEdit={true} />)

    const btn = screen.getByRole('button', { name: /Guardar configuración/i })
    expect(btn).toBeDisabled() // sin cambios al inicio

    const selectMetodo = screen.getByLabelText(/Método de identificación/i)
    fireEvent.change(selectMetodo, { target: { value: 'ean13' } })

    expect(btn).not.toBeDisabled()
  })

  it('guarda exitosamente y notifica con toast', async () => {
    mockSetEtiquetaConfigAction.mockResolvedValue({ ok: true })

    render(<ConfiguracionEtiquetasCard inicial={CONFIG_INICIAL} canEdit={true} />)

    const selectMetodo = screen.getByLabelText(/Método de identificación/i)
    fireEvent.change(selectMetodo, { target: { value: 'datamatrix' } })

    const btn = screen.getByRole('button', { name: /Guardar configuración/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(mockSetEtiquetaConfigAction).toHaveBeenCalledWith(
        expect.objectContaining({
          metodo: 'datamatrix',
          impresora_tipo: 'hoja',
        }),
      )
      expect(mockToast.success).toHaveBeenCalledWith(
        'Configuración guardada',
        expect.stringContaining('actualizados con éxito'),
      )
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('muestra toast de error si la Server Action falla', async () => {
    mockSetEtiquetaConfigAction.mockResolvedValue({
      ok: false,
      reason: 'etiqueta-config-invalida',
    })

    render(<ConfiguracionEtiquetasCard inicial={CONFIG_INICIAL} canEdit={true} />)

    const selectTipo = screen.getByLabelText(/Tipo de impresora/i)
    fireEvent.change(selectTipo, { target: { value: 'rollo' } })

    const btn = screen.getByRole('button', { name: /Guardar configuración/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'No se pudo guardar',
        'La configuración de etiquetas contiene valores fuera de rango.',
      )
    })
  })
})
