import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Etiqueta, type ItemEtiqueta, type PlantillaEtiqueta } from './Etiqueta'

describe('Etiqueta', () => {
  const itemPrueba: ItemEtiqueta = {
    qr_code: '0123456789abcdef01234567',
    codigo_ean: '2000000000008',
    nombre: 'Remera Estampada Algodón',
    talle: 'XL',
    sku: 'REM-EST-01',
  }

  const plantillaBase: PlantillaEtiqueta = {
    ancho_mm: 50,
    alto_mm: 30,
    mostrar_nombre: true,
    mostrar_talle: true,
    mostrar_sku: true,
    mostrar_texto_codigo: true,
  }

  it('aplica las dimensiones en mm según la plantilla', () => {
    const { container } = render(
      <Etiqueta
        plantilla={plantillaBase}
        item={itemPrueba}
        simbologia="qr"
      />,
    )

    const etiqueta = container.querySelector('[data-etiqueta]')
    expect(etiqueta).toBeInTheDocument()
    expect(etiqueta).toHaveStyle({ width: '50mm', height: '30mm' })
  })

  it('renderiza correctamente para cada una de las 4 simbologías', () => {
    for (const simbologia of ['qr', 'datamatrix', 'code128', 'ean13'] as const) {
      const { container } = render(
        <Etiqueta
          plantilla={plantillaBase}
          item={itemPrueba}
          simbologia={simbologia}
        />,
      )

      expect(container.querySelector('svg')).toBeInTheDocument()
    }
  })

  it('muestra y oculta campos según los flags de la plantilla', () => {
    const { rerender } = render(
      <Etiqueta
        plantilla={{
          ...plantillaBase,
          mostrar_nombre: true,
          mostrar_talle: false,
          mostrar_sku: false,
          mostrar_texto_codigo: false,
        }}
        item={itemPrueba}
        simbologia="qr"
      />,
    )

    expect(screen.getByText('Remera Estampada Algodón')).toBeInTheDocument()
    expect(screen.queryByText('XL')).not.toBeInTheDocument()
    expect(screen.queryByText('REM-EST-01')).not.toBeInTheDocument()
    expect(screen.queryByText('0123456789abcdef01234567')).not.toBeInTheDocument()

    // Ahora activamos talle, sku y texto_codigo, y ocultamos nombre
    rerender(
      <Etiqueta
        plantilla={{
          ...plantillaBase,
          mostrar_nombre: false,
          mostrar_talle: true,
          mostrar_sku: true,
          mostrar_texto_codigo: true,
        }}
        item={itemPrueba}
        simbologia="code128"
      />,
    )

    expect(screen.queryByText('Remera Estampada Algodón')).not.toBeInTheDocument()
    expect(screen.getByText('XL')).toBeInTheDocument()
    expect(screen.getByText('REM-EST-01')).toBeInTheDocument()
    // En 1D el texto del código muestra codigo_ean
    expect(screen.getByText('2000000000008')).toBeInTheDocument()
  })

  it('no utiliza colores de la skin/tema y renderiza texto en negro', () => {
    const { container } = render(
      <Etiqueta
        plantilla={plantillaBase}
        item={itemPrueba}
        simbologia="qr"
      />,
    )

    const html = container.innerHTML
    // No debe contener clases de color del tema
    expect(html).not.toContain('text-muted')
    expect(html).not.toContain('text-text')
    expect(html).not.toContain('bg-card')
    // El contenedor y los textos usan text-black / bg-white
    expect(html).toContain('text-black')
    expect(html).toContain('bg-white')
  })
})
