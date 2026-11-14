import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ImprimirEtiquetasPage from './page'
import * as sessionModule from '@/lib/dal/session'
import * as etiquetasDal from '@/lib/dal/etiquetas/etiquetas'
import * as itemDal from '@/lib/dal/inventario/item'

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn(),
}))

vi.mock('@/lib/dal/etiquetas/etiquetas', () => ({
  getEtiquetaConfig: vi.fn(),
  listEtiquetaPlantillas: vi.fn(),
}))

vi.mock('@/lib/dal/inventario/item', () => ({
  ETIQUETAS_MAX: 200,
  listItemsParaEtiquetas: vi.fn(),
  listItemsParaEtiquetasPorOrigen: vi.fn(),
}))

vi.mock('./ImprimirEtiquetasClient', () => ({
  ImprimirEtiquetasClient: (props: {
    plantillas: { id_plantilla: string; nombre: string }[]
    plantillaSeleccionada: { id_plantilla: string; nombre: string }
    items: unknown[]
  }) => (
    <div
      data-testid="imprimir-client-mock"
      data-plantilla-id={props.plantillaSeleccionada.id_plantilla}
      data-plantilla-nombre={props.plantillaSeleccionada.nombre}
      data-plantillas-ids={props.plantillas.map((p) => p.id_plantilla).join(',')}
      data-items-count={props.items.length}
    />
  ),
}))

const mockPredeterminada: etiquetasDal.EtiquetaPlantilla = {
  id_plantilla: '00000000-0000-0000-0000-000000000001',
  id_tenant: 'tenant-1',
  nombre: 'Predeterminada',
  ancho_mm: 50,
  alto_mm: 30,
  mostrar_nombre: true,
  mostrar_talle: true,
  mostrar_sku: false,
  mostrar_texto_codigo: false,
  predeterminada: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const mockOtraPlantilla: etiquetasDal.EtiquetaPlantilla = {
  id_plantilla: '11111111-1111-1111-1111-111111111111',
  id_tenant: 'tenant-1',
  nombre: 'Bijou 25x15',
  ancho_mm: 25,
  alto_mm: 15,
  mostrar_nombre: false,
  mostrar_talle: true,
  mostrar_sku: true,
  mostrar_texto_codigo: false,
  predeterminada: false,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const mockConfig: etiquetasDal.EtiquetaConfig = {
  metodo: 'qr',
  impresora_tipo: 'hoja',
  margen_mm: 10,
  separacion_mm: 2,
  columnas: null,
  offset_x_mm: 0,
  offset_y_mm: 0,
}

describe('ImprimirEtiquetasPage (REQ-ETQ-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue({
      tenantId: 'tenant-1',
      user: { id: 'user-1' },
      modulosHabilitados: [],
    } as unknown as sessionModule.Session)
    vi.mocked(etiquetasDal.getEtiquetaConfig).mockResolvedValue(mockConfig)
    vi.mocked(etiquetasDal.listEtiquetaPlantillas).mockResolvedValue([
      mockPredeterminada,
      mockOtraPlantilla,
    ])
    vi.mocked(itemDal.listItemsParaEtiquetas).mockResolvedValue([
      {
        qr_code: 'abcdef1234567890abcdef12',
        codigo_ean: '2000000000015',
        talle: 'M',
        nombre: 'Remera Test',
        sku: 'REM-01',
      },
    ])
  })

  it('?plantilla no es UUID válido → usa plantilla predeterminada sin mostrar error', async () => {
    const jsx = await ImprimirEtiquetasPage({
      searchParams: Promise.resolve({
        qrs: 'abcdef1234567890abcdef12',
        plantilla: 'no-es-un-uuid',
      }),
    })

    render(jsx)

    const el = screen.getByTestId('imprimir-client-mock')
    expect(el).toHaveAttribute('data-plantilla-id', mockPredeterminada.id_plantilla)
    expect(el).toHaveAttribute('data-plantilla-nombre', 'Predeterminada')
    expect(screen.queryByText(/Parámetros inválidos/i)).not.toBeInTheDocument()
  })

  it('?plantilla es UUID de otro tenant o inexistente → usa plantilla predeterminada sin mostrar error', async () => {
    const jsx = await ImprimirEtiquetasPage({
      searchParams: Promise.resolve({
        qrs: 'abcdef1234567890abcdef12',
        plantilla: '99999999-9999-9999-9999-999999999999',
      }),
    })

    render(jsx)

    const el = screen.getByTestId('imprimir-client-mock')
    expect(el).toHaveAttribute('data-plantilla-id', mockPredeterminada.id_plantilla)
    expect(el).toHaveAttribute('data-plantilla-nombre', 'Predeterminada')
    expect(screen.queryByText(/Parámetros inválidos/i)).not.toBeInTheDocument()
  })

  it('?plantilla es UUID válido existente → usa la plantilla correspondiente', async () => {
    const jsx = await ImprimirEtiquetasPage({
      searchParams: Promise.resolve({
        qrs: 'abcdef1234567890abcdef12',
        plantilla: mockOtraPlantilla.id_plantilla,
      }),
    })

    render(jsx)

    const el = screen.getByTestId('imprimir-client-mock')
    expect(el).toHaveAttribute('data-plantilla-id', mockOtraPlantilla.id_plantilla)
    expect(el).toHaveAttribute('data-plantilla-nombre', 'Bijou 25x15')
  })

  it('sin parámetros de códigos → muestra aviso "No hay códigos para imprimir"', async () => {
    const jsx = await ImprimirEtiquetasPage({
      searchParams: Promise.resolve({}),
    })

    render(jsx)

    expect(screen.getByText('No hay códigos para imprimir')).toBeInTheDocument()
    expect(screen.queryByTestId('imprimir-client-mock')).not.toBeInTheDocument()
  })

  it('si no hay plantillas en base (defensivo) → usa PLANTILLA_FALLBACK y la incluye en las opciones del selector', async () => {
    vi.mocked(etiquetasDal.listEtiquetaPlantillas).mockResolvedValue([])

    const jsx = await ImprimirEtiquetasPage({
      searchParams: Promise.resolve({
        qrs: 'abcdef1234567890abcdef12',
      }),
    })

    render(jsx)

    const el = screen.getByTestId('imprimir-client-mock')
    expect(el).toHaveAttribute('data-plantilla-id', '00000000-0000-0000-0000-000000000000')
    expect(el).toHaveAttribute('data-plantilla-nombre', 'Predeterminada')
    expect(el).toHaveAttribute('data-plantillas-ids', '00000000-0000-0000-0000-000000000000')
  })
})
