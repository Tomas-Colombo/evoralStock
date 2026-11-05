import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ImprimirEtiquetasClient } from './ImprimirEtiquetasClient'

vi.mock('@/components/inventario/QrDisplay', () => ({
  generarQrDataUrl: vi.fn(async (qr: string) => `data:image/png;base64,${qr}`),
}))

describe('ImprimirEtiquetasClient', () => {
  it('muestra la descripción debajo del nombre cuando el producto la tiene, la omite si está vacía y aplica el tamaño en mm', async () => {
    render(
      <ImprimirEtiquetasClient
        items={[
          {
            qr_code: 'UTP-100',
            nombre: 'Campera Denim',
            sku: 'CAM-10',
            talle: 'L',
            descripcion: '  Azul lavado con botones bronce  ',
          },
          {
            qr_code: 'UTP-101',
            nombre: 'Remera Lisa',
            sku: 'REM-20',
            talle: 'S',
            descripcion: '   ',
          },
        ]}
        noEncontrados={[]}
        recortadoEn={null}
        ladoMm={45}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Campera Denim')).toBeInTheDocument()
    })

    expect(screen.getByText('Azul lavado con botones bronce')).toBeInTheDocument()
    expect(screen.getByText('Remera Lisa')).toBeInTheDocument()
    expect(screen.getByText('Tamaño QR: 45 × 45 mm')).toBeInTheDocument()

    expect(
      screen.getByText(
        'Pegá cada etiqueta en un artículo del mismo producto y variante; no importa en cuál.',
      ),
    ).toBeInTheDocument()

    const img = screen.getByAltText('QR UTP-100')
    expect(img).toHaveStyle({ width: '45mm', height: '45mm' })
    expect(screen.getByRole('button', { name: 'Imprimir (2)' })).toBeEnabled()
  })

  it('muestra la paginación de tandas con links a anterior y siguiente cuando totalTandas > 1', async () => {
    render(
      <ImprimirEtiquetasClient
        items={[
          {
            qr_code: 'UTP-200',
            nombre: 'Remera Lisa',
            sku: 'REM-20',
            talle: 'M',
            descripcion: null,
          },
        ]}
        noEncontrados={[]}
        recortadoEn={null}
        ladoMm={35}
        paginacion={{
          tandaActual: 2,
          totalTandas: 3,
          totalItems: 450,
          anteriorHref: '/inventario/imprimir-etiquetas?ingreso=abc&tanda=1',
          siguienteHref: '/inventario/imprimir-etiquetas?ingreso=abc&tanda=3',
        }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/Tanda 2 de 3/)).toBeInTheDocument()
    })

    const antLink = screen.getByRole('link', { name: '← Anterior' })
    expect(antLink).toHaveAttribute('href', '/inventario/imprimir-etiquetas?ingreso=abc&tanda=1')

    const sigLink = screen.getByRole('link', { name: 'Siguiente →' })
    expect(sigLink).toHaveAttribute('href', '/inventario/imprimir-etiquetas?ingreso=abc&tanda=3')
  })
})
