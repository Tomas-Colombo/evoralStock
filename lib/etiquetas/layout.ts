/**
 * Cálculo puro de layout para hojas A4 y rollos de etiquetas.
 *
 * Especificación: openspec/changes/etiquetas-configurables/ (REQ-ETQ-04 y REQ-ETQ-05).
 */

import {
  A4_ALTO_MM,
  A4_ANCHO_MM,
  ETIQUETA_CONFIG_DEFAULTS,
  PADDING_ETIQUETA_MM,
  type ImpresoraTipo,
} from './limites'
import {
  obtenerSimbologia,
  type Simbologia,
  type SimbologiaId,
} from './simbologias'

export interface PlantillaLayout {
  ancho_mm: number
  alto_mm: number
  mostrar_nombre?: boolean
  mostrar_talle?: boolean
  mostrar_sku?: boolean
  mostrar_texto_codigo?: boolean
}

export interface ConfigImpresoraLayout {
  impresora_tipo?: ImpresoraTipo
  margen_mm?: number
  separacion_mm?: number
  columnas?: number | null
  offset_x_mm?: number
  offset_y_mm?: number
}

export type AvisoLayout = 'etiqueta-chica-para-codigo' | 'etiqueta-no-entra-en-hoja'

export interface TamanoCodigo {
  anchoMm: number
  altoMm: number
}

export interface LayoutResultado {
  impresoraTipo: ImpresoraTipo
  columnas: number
  anchoEtiquetaMm: number
  altoEtiquetaMm: number
  anchoPaginaMm: number
  altoPaginaMm: number
  reglaPage: string
  tamanoCodigo: TamanoCodigo
  avisos: AvisoLayout[]
  puedeImprimir: boolean
  offsets: {
    xMm: number
    yMm: number
  }
}

export interface CalcularLayoutOpciones {
  plantilla: PlantillaLayout
  config?: ConfigImpresoraLayout | null
  simbologia?: SimbologiaId | Simbologia
}

/**
 * Calcula el layout de impresión para una plantilla de etiquetas dada la configuración
 * del tenant y la simbología activa.
 */
export function calcularLayout({
  plantilla,
  config,
  simbologia = 'qr',
}: CalcularLayoutOpciones): LayoutResultado {
  const sim = typeof simbologia === 'string' ? obtenerSimbologia(simbologia) : simbologia
  const simActiva: Simbologia = sim ?? (obtenerSimbologia('qr') as Simbologia)

  const impresoraTipo: ImpresoraTipo =
    config?.impresora_tipo ?? ETIQUETA_CONFIG_DEFAULTS.impresora_tipo
  const margenMm = config?.margen_mm ?? ETIQUETA_CONFIG_DEFAULTS.margen_mm
  const separacionMm = config?.separacion_mm ?? ETIQUETA_CONFIG_DEFAULTS.separacion_mm
  const columnasConfig = config?.columnas !== undefined ? config.columnas : ETIQUETA_CONFIG_DEFAULTS.columnas
  const offsetX_mm = config?.offset_x_mm ?? ETIQUETA_CONFIG_DEFAULTS.offset_x_mm
  const offsetY_mm = config?.offset_y_mm ?? ETIQUETA_CONFIG_DEFAULTS.offset_y_mm

  const anchoEtiquetaMm = plantilla.ancho_mm
  const altoEtiquetaMm = plantilla.alto_mm

  // Reserva de espacio vertical para campos de texto según plantilla
  let altoTextoMm = 0
  if (plantilla.mostrar_nombre) altoTextoMm += 4
  if (plantilla.mostrar_talle) altoTextoMm += 3
  if (plantilla.mostrar_sku) altoTextoMm += 3
  if (plantilla.mostrar_texto_codigo) altoTextoMm += 3

  const anchoDisponible = Math.max(0, anchoEtiquetaMm - 2 * PADDING_ETIQUETA_MM)
  const altoDisponible = Math.max(0, altoEtiquetaMm - 2 * PADDING_ETIQUETA_MM - altoTextoMm)

  // Cálculo del tamaño del código según dimensión (2D es cuadrado; 1D es rectangular)
  let tamanoCodigo: TamanoCodigo
  if (simActiva.dimension === '2d') {
    const ladoMm = Math.max(0, Math.min(anchoDisponible, altoDisponible))
    tamanoCodigo = { anchoMm: ladoMm, altoMm: ladoMm }
  } else {
    const anchoCodigoMm = anchoDisponible
    const altoCodigoMm = Math.max(0, Math.min(altoDisponible, 25))
    tamanoCodigo = { anchoMm: anchoCodigoMm, altoMm: altoCodigoMm }
  }

  const avisos: AvisoLayout[] = []

  // Aviso: etiqueta chica para el código solicitado
  if (
    anchoEtiquetaMm < simActiva.minAnchoMm ||
    altoEtiquetaMm < simActiva.minAltoMm ||
    tamanoCodigo.anchoMm < simActiva.minAnchoMm ||
    tamanoCodigo.altoMm < simActiva.minAltoMm
  ) {
    avisos.push('etiqueta-chica-para-codigo')
  }

  let anchoPaginaMm: number
  let altoPaginaMm: number
  let columnas: number
  let reglaPage: string

  if (impresoraTipo === 'rollo') {
    anchoPaginaMm = anchoEtiquetaMm
    altoPaginaMm = altoEtiquetaMm
    columnas = 1
    reglaPage = `size: ${anchoPaginaMm}mm ${altoPaginaMm}mm; margin: 0;`
  } else {
    // Impresora tipo hoja (A4)
    anchoPaginaMm = A4_ANCHO_MM
    altoPaginaMm = A4_ALTO_MM
    const anchoUtilMm = anchoPaginaMm - 2 * margenMm
    const altoUtilMm = altoPaginaMm - 2 * margenMm

    if (altoEtiquetaMm > altoUtilMm || anchoEtiquetaMm > anchoUtilMm) {
      if (!avisos.includes('etiqueta-no-entra-en-hoja')) {
        avisos.push('etiqueta-no-entra-en-hoja')
      }
    }

    if (columnasConfig !== null && columnasConfig !== undefined) {
      // Columnas forzadas por configuración
      columnas = Math.max(1, columnasConfig)
      const anchoRequerido = columnas * anchoEtiquetaMm + (columnas - 1) * separacionMm
      if (anchoRequerido > anchoUtilMm) {
        if (!avisos.includes('etiqueta-no-entra-en-hoja')) {
          avisos.push('etiqueta-no-entra-en-hoja')
        }
      }
    } else {
      // Cálculo automático de columnas según ancho útil
      const maxCols = Math.floor((anchoUtilMm + separacionMm) / (anchoEtiquetaMm + separacionMm))
      columnas = Math.max(1, maxCols)
      if (maxCols < 1) {
        if (!avisos.includes('etiqueta-no-entra-en-hoja')) {
          avisos.push('etiqueta-no-entra-en-hoja')
        }
      }
    }

    reglaPage = `size: ${anchoPaginaMm}mm ${altoPaginaMm}mm; margin: ${margenMm}mm;`
  }

  const puedeImprimir = avisos.length === 0

  return {
    impresoraTipo,
    columnas,
    anchoEtiquetaMm,
    altoEtiquetaMm,
    anchoPaginaMm,
    altoPaginaMm,
    reglaPage,
    tamanoCodigo,
    avisos,
    puedeImprimir,
    offsets: {
      xMm: offsetX_mm,
      yMm: offsetY_mm,
    },
  }
}
