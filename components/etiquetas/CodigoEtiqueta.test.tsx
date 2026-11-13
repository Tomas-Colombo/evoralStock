import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CodigoEtiqueta } from './CodigoEtiqueta'

describe('CodigoEtiqueta', () => {
  const QR_24_HEX = '0123456789abcdef01234567'
  const EAN_13_VALIDO = '2000000000008'

  it('renderiza QR (2D) codificando qr_code por defecto', () => {
    const { container } = render(
      <CodigoEtiqueta
        simbologia="qr"
        qrCode={QR_24_HEX}
        codigoEan={EAN_13_VALIDO}
        anchoMm={35}
        altoMm={35}
      />,
    )

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('width', '100%')
    expect(svg).toHaveAttribute('height', '100%')
    expect(svg?.querySelector('path')).toBeInTheDocument()
  })

  it('renderiza DataMatrix (2D) codificando qr_code', () => {
    const { container } = render(
      <CodigoEtiqueta
        simbologia="datamatrix"
        qrCode={QR_24_HEX}
        codigoEan={EAN_13_VALIDO}
        anchoMm={15}
        altoMm={15}
      />,
    )

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg?.querySelector('path')).toBeInTheDocument()
  })

  it('renderiza Code128 (1D) codificando codigo_ean (D-ETQ-01)', () => {
    const { container } = render(
      <CodigoEtiqueta
        simbologia="code128"
        qrCode={QR_24_HEX}
        codigoEan={EAN_13_VALIDO}
        anchoMm={40}
        altoMm={15}
      />,
    )

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg?.querySelector('path')).toBeInTheDocument()
  })

  it('renderiza EAN-13 (1D) codificando codigo_ean (D-ETQ-01)', () => {
    const { container } = render(
      <CodigoEtiqueta
        simbologia="ean13"
        qrCode={QR_24_HEX}
        codigoEan={EAN_13_VALIDO}
        anchoMm={40}
        altoMm={20}
      />,
    )

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg?.querySelector('path')).toBeInTheDocument()
  })

  it('permite pasar un valor explícito que prevalece sobre qrCode / codigoEan', () => {
    const { container } = render(
      <CodigoEtiqueta
        simbologia="code128"
        valor="EXPLICITO-123"
        qrCode={QR_24_HEX}
        codigoEan={EAN_13_VALIDO}
      />,
    )

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('muestra aviso role="alert" cuando falta el código o es vacío', () => {
    render(<CodigoEtiqueta simbologia="qr" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Sin código')
  })

  it('muestra aviso role="alert" cuando la generación de bwip-js falla por datos inválidos', () => {
    // EAN-13 requiere 12 o 13 dígitos numéricos
    render(
      <CodigoEtiqueta
        simbologia="ean13"
        valor="texto-no-numerico"
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Error al generar código')
  })
})
