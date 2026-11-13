/**
 * Límites y constantes para plantillas de etiquetas y configuración de impresora.
 *
 * Especificación: openspec/changes/etiquetas-configurables/ (REQ-ETQ-03 y REQ-ETQ-04).
 */

/** Cantidad máxima de plantillas de etiqueta por tenant. */
export const PLANTILLAS_MAX = 20

/** Longitud mínima y máxima del nombre de una plantilla. */
export const PLANTILLA_NOMBRE_MIN = 1
export const PLANTILLA_NOMBRE_MAX = 40

/** Rango permitido para el ancho de la plantilla en milímetros (15 a 300 mm). */
export const PLANTILLA_ANCHO_MM_MIN = 15
export const PLANTILLA_ANCHO_MM_MAX = 300

/** Rango permitido para el alto de la plantilla en milímetros (10 a 300 mm). */
export const PLANTILLA_ALTO_MM_MIN = 10
export const PLANTILLA_ALTO_MM_MAX = 300

/** Tipos de impresora soportados para etiquetas. */
export const IMPRESORA_TIPOS = ['hoja', 'rollo'] as const
export type ImpresoraTipo = (typeof IMPRESORA_TIPOS)[number]

/** Rango del margen de página en milímetros (0 a 20 mm). */
export const IMPRESORA_MARGEN_MM_MIN = 0
export const IMPRESORA_MARGEN_MM_MAX = 20

/** Rango de la separación entre etiquetas en milímetros (0 a 20 mm). */
export const IMPRESORA_SEPARACION_MM_MIN = 0
export const IMPRESORA_SEPARACION_MM_MAX = 20

/** Rango de columnas configuradas para hoja (1 a 10 columnas, o null para automático). */
export const IMPRESORA_COLUMNAS_MIN = 1
export const IMPRESORA_COLUMNAS_MAX = 10

/** Rango del offset de calibración en milímetros (-10 a 10 mm). */
export const IMPRESORA_OFFSET_MM_MIN = -10
export const IMPRESORA_OFFSET_MM_MAX = 10

/** Medidas estándar de una hoja A4 en milímetros. */
export const A4_ANCHO_MM = 210
export const A4_ALTO_MM = 297

/** Padding interno por defecto alrededor de la etiqueta en milímetros. */
export const PADDING_ETIQUETA_MM = 1

/** Valores por defecto de configuración de etiquetas (sin fila en etiqueta_config). */
export const ETIQUETA_CONFIG_DEFAULTS = {
  metodo: 'qr' as const,
  impresora_tipo: 'hoja' as const,
  margen_mm: 10,
  separacion_mm: 2,
  columnas: null as number | null,
  offset_x_mm: 0,
  offset_y_mm: 0,
} as const
