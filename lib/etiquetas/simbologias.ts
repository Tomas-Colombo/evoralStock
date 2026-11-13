/**
 * Catálogo de simbologías de identificación de ítems y etiquetas.
 *
 * Especificación: openspec/changes/etiquetas-configurables/ (REQ-ETQ-01, D-ETQ-01 y §6).
 */

export const SIMBOLOGIA_IDS = ['qr', 'datamatrix', 'code128', 'ean13'] as const
export type SimbologiaId = (typeof SIMBOLOGIA_IDS)[number]

export type DimensionSimbologia = '1d' | '2d'
export type ValorSimbologia = 'qr_code' | 'codigo_ean'

export interface Simbologia {
  id: SimbologiaId
  dimension: DimensionSimbologia
  valor: ValorSimbologia
  bcid: string
  minAnchoMm: number
  minAltoMm: number
}

/**
 * Catálogo autoritativo de simbologías soportadas por el sistema.
 *
 * D-ETQ-01:
 * - 2D (qr, datamatrix) codifican `qr_code` (24 hex).
 * - 1D (code128, ean13) codifican `codigo_ean` (13 dígitos numéricos).
 *
 * Mínimos en mm:
 * - qr: 15×15 mm (piso para lectura confiable con cámara de smartphone).
 * - datamatrix: 10×10 mm (alta densidad 2D, entra en piezas de bijouterie).
 * - code128: 30×10 mm (13 dígitos numéricos en modo C entran en ~30 mm).
 * - ean13: 30×10 mm (magnificación mínima GS1 del 80% ronda ~30 mm de ancho).
 */
export const SIMBOLOGIAS: readonly Simbologia[] = [
  {
    id: 'qr',
    dimension: '2d',
    valor: 'qr_code',
    bcid: 'qrcode',
    minAnchoMm: 15,
    minAltoMm: 15,
  },
  {
    id: 'datamatrix',
    dimension: '2d',
    valor: 'qr_code',
    bcid: 'datamatrix',
    minAnchoMm: 10,
    minAltoMm: 10,
  },
  {
    id: 'code128',
    dimension: '1d',
    valor: 'codigo_ean',
    bcid: 'code128',
    minAnchoMm: 30,
    minAltoMm: 10,
  },
  {
    id: 'ean13',
    dimension: '1d',
    valor: 'codigo_ean',
    bcid: 'ean13',
    minAnchoMm: 30,
    minAltoMm: 10,
  },
] as const

const SIMBOLOGIAS_POR_ID = new Map<SimbologiaId, Simbologia>(
  SIMBOLOGIAS.map((s) => [s.id, s]),
)

/** Verifica si un string corresponde a una simbología válida del catálogo. */
export function esSimbologiaId(valor: unknown): valor is SimbologiaId {
  return typeof valor === 'string' && SIMBOLOGIA_IDS.includes(valor as SimbologiaId)
}

/** Obtiene la definición completa de una simbología por su ID. */
export function obtenerSimbologia(id: SimbologiaId | string): Simbologia | undefined {
  return SIMBOLOGIAS_POR_ID.get(id as SimbologiaId)
}
