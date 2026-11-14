import bwipjs from 'bwip-js/browser'
import {
  obtenerSimbologia,
  resolverValorSimbologia,
  type SimbologiaId,
} from '@/lib/etiquetas/simbologias'

export interface CodigoEtiquetaProps {
  /** Simbología a utilizar ('qr', 'datamatrix', 'code128', 'ean13'). Default: 'qr'. */
  simbologia?: SimbologiaId
  /** Valor explícito a codificar. Si se omite, se usa qrCode (para 2D) o codigoEan (para 1D). */
  valor?: string
  /** Código QR del ítem (24 hex). Se usa para simbologías 2D. */
  qrCode?: string
  /** Código EAN del ítem (13 dígitos). Se usa para simbologías 1D. */
  codigoEan?: string
  /** Ancho en milímetros asignado al código SVG. */
  anchoMm?: number
  /** Alto en milímetros asignado al código SVG. */
  altoMm?: number
  /** Si debe incluir texto legible dentro del código generado. */
  mostrarTexto?: boolean
  className?: string
  alt?: string
}

/**
 * Renderiza el código de barras o bidimensional como SVG puro con `bwip-js`.
 *
 * Funciona offline, en servidor y en cliente, sin llamadas de red ni Canvas (D-ETQ-04).
 * D-ETQ-01: Simbologías 2D codifican `qrCode`; simbologías 1D codifican `codigoEan`.
 */
export function CodigoEtiqueta({
  simbologia = 'qr',
  valor,
  qrCode,
  codigoEan,
  anchoMm,
  altoMm,
  mostrarTexto = false,
  className = '',
  alt,
}: CodigoEtiquetaProps) {
  const sim = obtenerSimbologia(simbologia) ?? obtenerSimbologia('qr')!

  // D-ETQ-01: selección del valor según catálogo de simbología si no se pasó valor explícito
  const textoACodificar =
    valor ?? resolverValorSimbologia(simbologia, { qrCode, codigoEan })

  let svgHtml: string | null = null
  let errorMsg: string | null = null

  if (!textoACodificar) {
    errorMsg = 'Sin código'
  } else {
    try {
      const rawSvg = bwipjs.toSVG({
        bcid: sim.bcid,
        text: textoACodificar,
        includetext: mostrarTexto,
        textxalign: 'center',
      })
      // Aseguramos que el SVG escale al 100% de la caja contenedora en mm
      svgHtml = rawSvg.replace('<svg ', '<svg width="100%" height="100%" ')
    } catch {
      errorMsg = 'Error al generar código'
    }
  }

  const contenedorStyle: React.CSSProperties = {
    width: anchoMm !== undefined ? `${anchoMm}mm` : undefined,
    height: altoMm !== undefined ? `${altoMm}mm` : undefined,
  }

  if (errorMsg || !svgHtml) {
    return (
      <div
        role="alert"
        style={contenedorStyle}
        className={`flex items-center justify-center p-1 text-center font-mono text-[10px] text-muted border border-dashed border-border ${className}`}
        aria-label={alt ?? `Error ${simbologia}`}
      >
        {errorMsg ?? 'Error'}
      </div>
    )
  }

  return (
    <div
      style={contenedorStyle}
      className={`inline-flex items-center justify-center [&>svg]:block [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full ${className}`}
      aria-label={alt ?? `${simbologia} ${textoACodificar}`}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  )
}
