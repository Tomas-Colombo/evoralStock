import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ImprimirEtiquetasClient } from './ImprimirEtiquetasClient'
import type { ItemParaEtiqueta } from '@/lib/dal/inventario/item'
import type { EtiquetaConfig, EtiquetaPlantilla } from '@/lib/dal/etiquetas/etiquetas'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/inventario/imprimir-etiquetas',
  useSearchParams: () => new URLSearchParams(),
}))

const mockPlantillaPredeterminada: EtiquetaPlantilla = {
  id_plantilla: 'plan-pred',
  id_tenant: 'tenant-1',
  nombre: 'Predeterminada 50x30',
  ancho_mm: 50,
  alto_mm: 30,
  mostrar_nombre: true,
  mostrar_talle: true,
  mostrar_sku: true,
  mostrar_texto_codigo: false,
  predeterminada: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const mockPlantillaChica: EtiquetaPlantilla = {
  id_plantilla: 'plan-chica',
  id_tenant: 'tenant-1',
  nombre: 'Mini 18x12',
  ancho_mm: 18,
  alto_mm: 12,
  mostrar_nombre: false,
  mostrar_talle: true,
  mostrar_sku: false,
  mostrar_texto_codigo: false,
  predeterminada: false,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const mockConfigHoja2D: EtiquetaConfig = {
  metodo: 'qr',
  impresora_tipo: 'hoja',
  margen_mm: 10,
  separacion_mm: 2,
  columnas: null,
  offset_x_mm: 0,
  offset_y_mm: 0,
}

const mockConfigRollo1D: EtiquetaConfig = {
  metodo: 'code128',
  impresora_tipo: 'rollo',
  margen_mm: 0,
  separacion_mm: 0,
  columnas: null,
  offset_x_mm: 1.5,
  offset_y_mm: -2,
}

const mockItems: ItemParaEtiqueta[] = [
  {
    qr_code: 'abcdef1234567890abcdef12',
    codigo_ean: '2000000000015',
    nombre: 'Campera Denim',
    sku: 'CAM-10',
    talle: 'L',
    descripcion: 'Azul',
  },
  {
    qr_code: 'abcdef1234567890abcdef13',
    codigo_ean: '2000000000022',
    nombre: 'Remera Lisa',
    sku: 'REM-20',
    talle: 'S',
    descripcion: null,
  },
]

describe('ImprimirEtiquetasClient', () => {
  it('renderiza en modo hoja (grilla) con simbología 2D (qr), nombre y talle según plantilla', () => {
    const { container } = render(
      <ImprimirEtiquetasClient
        items={mockItems}
        plantillas={[mockPlantillaPredeterminada]}
        plantillaSeleccionada={mockPlantillaPredeterminada}
        config={mockConfigHoja2D}
        noEncontrados={[]}
        recortadoEn={null}
      />,
    )

    expect(screen.getAllByText(/Predeterminada 50x30/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Campera Denim')).toBeInTheDocument()
    expect(screen.getByText('Remera Lisa')).toBeInTheDocument()
    expect(screen.getByText('L')).toBeInTheDocument()
    expect(screen.getByText('S')).toBeInTheDocument()

    const hoja = container.querySelector('[data-hoja-etiquetas]')
    expect(hoja).toHaveClass('grid')
    expect(hoja).toHaveStyle({
      gap: '2mm',
    })

    const printBtn = screen.getByRole('button', { name: 'Imprimir (2)' })
    expect(printBtn).toBeEnabled()
  })

  it('renderiza en modo rollo con simbología 1D (code128), medida exacta en @page y offsets', () => {
    const { container } = render(
      <ImprimirEtiquetasClient
        items={mockItems}
        plantillas={[mockPlantillaPredeterminada]}
        plantillaSeleccionada={mockPlantillaPredeterminada}
        config={mockConfigRollo1D}
        noEncontrados={[]}
        recortadoEn={null}
      />,
    )

    expect(screen.getByText(/Rollo continuo/)).toBeInTheDocument()
    expect(screen.getByText(/Método: CODE128/)).toBeInTheDocument()

    const hoja = container.querySelector('[data-hoja-etiquetas]')
    expect(hoja).toHaveClass('flex-col')

    const styleEl = container.querySelector('style')
    expect(styleEl?.innerHTML).toContain('size: 50mm 30mm; margin: 0;')
    expect(styleEl?.innerHTML).toContain('left: 1.5mm;')
    expect(styleEl?.innerHTML).toContain('top: -2mm;')
    expect(styleEl?.innerHTML).toContain('break-after: page;')

    expect(screen.getByRole('button', { name: 'Imprimir (2)' })).toBeEnabled()
  })

  it('aviso etiqueta-chica-para-codigo deshabilita el botón Imprimir', () => {
    render(
      <ImprimirEtiquetasClient
        items={mockItems}
        plantillas={[mockPlantillaChica]}
        plantillaSeleccionada={mockPlantillaChica}
        config={{ ...mockConfigHoja2D, metodo: 'ean13' }}
        noEncontrados={[]}
        recortadoEn={null}
      />,
    )

    expect(
      screen.getByText('La medida de la etiqueta es demasiado chica para este código.'),
    ).toBeInTheDocument()

    const printBtn = screen.getByRole('button', { name: 'Imprimir (2)' })
    expect(printBtn).toBeDisabled()
  })

  it('muestra paginación de tandas con links a anterior y siguiente cuando totalTandas > 1', () => {
    render(
      <ImprimirEtiquetasClient
        items={[mockItems[0]]}
        plantillas={[mockPlantillaPredeterminada]}
        plantillaSeleccionada={mockPlantillaPredeterminada}
        config={mockConfigHoja2D}
        noEncontrados={[]}
        recortadoEn={null}
        paginacion={{
          tandaActual: 2,
          totalTandas: 3,
          totalItems: 450,
          anteriorHref: '/inventario/imprimir-etiquetas?ingreso=abc&tanda=1',
          siguienteHref: '/inventario/imprimir-etiquetas?ingreso=abc&tanda=3',
        }}
      />,
    )

    expect(screen.getByText(/Tanda 2 de 3/)).toBeInTheDocument()
    const antLink = screen.getByRole('link', { name: '← Anterior' })
    expect(antLink).toHaveAttribute('href', '/inventario/imprimir-etiquetas?ingreso=abc&tanda=1')
    const sigLink = screen.getByRole('link', { name: 'Siguiente →' })
    expect(sigLink).toHaveAttribute('href', '/inventario/imprimir-etiquetas?ingreso=abc&tanda=3')
  })
})
