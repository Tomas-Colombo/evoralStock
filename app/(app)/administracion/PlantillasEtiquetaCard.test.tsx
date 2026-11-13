import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlantillasEtiquetaCard } from './PlantillasEtiquetaCard'
import type { EtiquetaConfig, EtiquetaPlantilla } from '@/lib/dal/etiquetas/etiquetas'

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => mockToast,
}))

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

// Mock de CódigoEtiqueta para simplificar render de bwip-js en jsdom
vi.mock('@/components/etiquetas/CodigoEtiqueta', () => ({
  CodigoEtiqueta: ({ simbologia }: { simbologia: string }) => (
    <div data-testid="mock-codigo-etiqueta">{simbologia}</div>
  ),
}))

const mockCrearEtiquetaPlantillaAction = vi.fn()
const mockEditarEtiquetaPlantillaAction = vi.fn()
const mockMarcarEtiquetaPlantillaPredeterminadaAction = vi.fn()
const mockEliminarEtiquetaPlantillaAction = vi.fn()

vi.mock('./actions', () => ({
  crearEtiquetaPlantillaAction: (...args: unknown[]) => mockCrearEtiquetaPlantillaAction(...args),
  editarEtiquetaPlantillaAction: (...args: unknown[]) => mockEditarEtiquetaPlantillaAction(...args),
  marcarEtiquetaPlantillaPredeterminadaAction: (...args: unknown[]) =>
    mockMarcarEtiquetaPlantillaPredeterminadaAction(...args),
  eliminarEtiquetaPlantillaAction: (...args: unknown[]) =>
    mockEliminarEtiquetaPlantillaAction(...args),
}))

const CONFIG_BASE: EtiquetaConfig = {
  metodo: 'qr',
  impresora_tipo: 'hoja',
  margen_mm: 10,
  separacion_mm: 2,
  columnas: null,
  offset_x_mm: 0,
  offset_y_mm: 0,
}

const PLANTILLAS_MOCK: EtiquetaPlantilla[] = [
  {
    id_plantilla: 'plan-pred',
    id_tenant: 'tenant-1',
    nombre: 'Predeterminada 40x30',
    ancho_mm: 40,
    alto_mm: 30,
    mostrar_nombre: true,
    mostrar_talle: true,
    mostrar_sku: false,
    mostrar_texto_codigo: false,
    predeterminada: true,
    created_at: '2026-11-13T10:00:00Z',
    updated_at: '2026-11-13T10:00:00Z',
  },
  {
    id_plantilla: 'plan-sec',
    id_tenant: 'tenant-1',
    nombre: 'Chica 15x10',
    ancho_mm: 15,
    alto_mm: 10,
    mostrar_nombre: false,
    mostrar_talle: false,
    mostrar_sku: false,
    mostrar_texto_codigo: false,
    predeterminada: false,
    created_at: '2026-11-13T10:00:00Z',
    updated_at: '2026-11-13T10:00:00Z',
  },
]

describe('PlantillasEtiquetaCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('respeta permisos en los botones de acción', () => {
    // Sin permisos
    const { rerender } = render(
      <PlantillasEtiquetaCard
        plantillas={PLANTILLAS_MOCK}
        config={CONFIG_BASE}
        canCreate={false}
        canEdit={false}
        canDelete={false}
      />,
    )

    expect(screen.queryByRole('button', { name: /Nueva plantilla/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Predeterminada/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Eliminar/i })).not.toBeInTheDocument()

    // Con permisos completos
    rerender(
      <PlantillasEtiquetaCard
        plantillas={PLANTILLAS_MOCK}
        config={CONFIG_BASE}
        canCreate={true}
        canEdit={true}
        canDelete={true}
      />,
    )

    expect(screen.getByRole('button', { name: /Nueva plantilla/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Editar/i })).toHaveLength(2)
    // Botón "Predeterminada" solo en la secundaria, la predeterminada ya lo es
    expect(screen.getByRole('button', { name: 'Predeterminada' })).toBeInTheDocument()
    // Botón "Eliminar" solo en la secundaria, la predeterminada nunca se elimina
    expect(screen.getByRole('button', { name: /Eliminar/i })).toBeInTheDocument()
  })

  it('muestra aviso de layout si la plantilla es demasiado chica para la simbología', () => {
    // Con método code128 (mínimo 30 mm de ancho) y plantilla chica (15 mm)
    const config1d: EtiquetaConfig = {
      ...CONFIG_BASE,
      metodo: 'code128',
    }

    render(
      <PlantillasEtiquetaCard
        plantillas={PLANTILLAS_MOCK}
        config={config1d}
        canCreate={true}
        canEdit={true}
        canDelete={true}
      />,
    )

    // Seleccionamos la plantilla chica
    const btnVerChica = screen.getAllByRole('button', { name: /Ver/i })[0]
    fireEvent.click(btnVerChica)

    // Debe mostrarse el aviso
    expect(
      screen.getByText('La medida de la etiqueta es demasiado chica para este código.'),
    ).toBeInTheDocument()
  })

  it('maneja error de Action al crear una plantilla duplicada', async () => {
    mockCrearEtiquetaPlantillaAction.mockResolvedValue({
      ok: false,
      reason: 'plantilla-nombre-duplicado',
    })

    render(
      <PlantillasEtiquetaCard
        plantillas={PLANTILLAS_MOCK}
        config={CONFIG_BASE}
        canCreate={true}
        canEdit={true}
        canDelete={true}
      />,
    )

    // Abrir modal
    fireEvent.click(screen.getByRole('button', { name: /Nueva plantilla/i }))

    // Llenar datos
    fireEvent.change(screen.getByLabelText(/Nombre de la plantilla/i), {
      target: { value: 'Predeterminada 40x30' },
    })

    // Guardar
    fireEvent.click(screen.getByRole('button', { name: /Guardar plantilla/i }))

    await waitFor(() => {
      expect(mockCrearEtiquetaPlantillaAction).toHaveBeenCalled()
      expect(mockToast.error).toHaveBeenCalledWith(
        'No se pudo crear la plantilla',
        'Ya existe una plantilla con ese nombre.',
      )
    })
  })

  it('permite eliminar una plantilla secundaria con confirmación', async () => {
    mockEliminarEtiquetaPlantillaAction.mockResolvedValue({ ok: true })

    render(
      <PlantillasEtiquetaCard
        plantillas={PLANTILLAS_MOCK}
        config={CONFIG_BASE}
        canCreate={true}
        canEdit={true}
        canDelete={true}
      />,
    )

    const btnEliminar = screen.getByRole('button', { name: /Eliminar/i })
    fireEvent.click(btnEliminar)

    // Diálogo de confirmación
    expect(screen.getByText(/¿Seguro que querés eliminar la plantilla/i)).toBeInTheDocument()

    const btnConfirmar = screen.getByRole('button', { name: /Sí, eliminar/i })
    fireEvent.click(btnConfirmar)

    await waitFor(() => {
      expect(mockEliminarEtiquetaPlantillaAction).toHaveBeenCalledWith({ id: 'plan-sec' })
      expect(mockToast.success).toHaveBeenCalledWith(
        'Plantilla eliminada',
        expect.stringContaining('Chica 15x10'),
      )
      expect(mockRefresh).toHaveBeenCalled()
    })
  })
})
