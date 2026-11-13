import { z } from 'zod'
import {
  IMPRESORA_COLUMNAS_MAX,
  IMPRESORA_COLUMNAS_MIN,
  IMPRESORA_MARGEN_MM_MAX,
  IMPRESORA_MARGEN_MM_MIN,
  IMPRESORA_OFFSET_MM_MAX,
  IMPRESORA_OFFSET_MM_MIN,
  IMPRESORA_SEPARACION_MM_MAX,
  IMPRESORA_SEPARACION_MM_MIN,
  IMPRESORA_TIPOS,
  PLANTILLA_ALTO_MM_MAX,
  PLANTILLA_ALTO_MM_MIN,
  PLANTILLA_ANCHO_MM_MAX,
  PLANTILLA_ANCHO_MM_MIN,
  PLANTILLA_NOMBRE_MAX,
  PLANTILLA_NOMBRE_MIN,
} from '@/lib/etiquetas/limites'
import { SIMBOLOGIA_IDS } from '@/lib/etiquetas/simbologias'

/**
 * Parámetros comunes de error para `z.strictObject`.
 * Rechaza claves adicionales o payloads que no sean objetos planos.
 */
const payloadParams = {
  error: (issue: z.core.$ZodRawIssue) =>
    issue.code === 'unrecognized_keys' ? 'campo-desconocido' : 'payload-invalido',
}

/**
 * Esquema de validación para `etiqueta_config` (REQ-ETQ-01 y REQ-ETQ-04).
 */
export const etiquetaConfigSchema = z.strictObject(
  {
    metodo: z.enum(SIMBOLOGIA_IDS, {
      error: () => 'etiqueta-config-invalida',
    }),
    impresora_tipo: z.enum(IMPRESORA_TIPOS, {
      error: () => 'etiqueta-config-invalida',
    }),
    margen_mm: z
      .number({ error: () => 'etiqueta-config-invalida' })
      .int('etiqueta-config-invalida')
      .min(IMPRESORA_MARGEN_MM_MIN, 'etiqueta-config-invalida')
      .max(IMPRESORA_MARGEN_MM_MAX, 'etiqueta-config-invalida'),
    separacion_mm: z
      .number({ error: () => 'etiqueta-config-invalida' })
      .int('etiqueta-config-invalida')
      .min(IMPRESORA_SEPARACION_MM_MIN, 'etiqueta-config-invalida')
      .max(IMPRESORA_SEPARACION_MM_MAX, 'etiqueta-config-invalida'),
    columnas: z
      .number({ error: () => 'etiqueta-config-invalida' })
      .int('etiqueta-config-invalida')
      .min(IMPRESORA_COLUMNAS_MIN, 'etiqueta-config-invalida')
      .max(IMPRESORA_COLUMNAS_MAX, 'etiqueta-config-invalida')
      .nullable(),
    offset_x_mm: z
      .number({ error: () => 'etiqueta-config-invalida' })
      .int('etiqueta-config-invalida')
      .min(IMPRESORA_OFFSET_MM_MIN, 'etiqueta-config-invalida')
      .max(IMPRESORA_OFFSET_MM_MAX, 'etiqueta-config-invalida'),
    offset_y_mm: z
      .number({ error: () => 'etiqueta-config-invalida' })
      .int('etiqueta-config-invalida')
      .min(IMPRESORA_OFFSET_MM_MIN, 'etiqueta-config-invalida')
      .max(IMPRESORA_OFFSET_MM_MAX, 'etiqueta-config-invalida'),
  },
  payloadParams,
)

/**
 * Nombre de plantilla: 1 a 40 caracteres, sin espacios al borde (REQ-ETQ-03).
 */
const nombrePlantillaSchema = z
  .string('payload-invalido')
  .min(PLANTILLA_NOMBRE_MIN, 'payload-invalido')
  .max(PLANTILLA_NOMBRE_MAX, 'payload-invalido')
  .refine((s) => s.trim() === s, 'payload-invalido')

const anchoPlantillaSchema = z
  .number('plantilla-medidas-invalidas')
  .min(PLANTILLA_ANCHO_MM_MIN, 'plantilla-medidas-invalidas')
  .max(PLANTILLA_ANCHO_MM_MAX, 'plantilla-medidas-invalidas')

const altoPlantillaSchema = z
  .number('plantilla-medidas-invalidas')
  .min(PLANTILLA_ALTO_MM_MIN, 'plantilla-medidas-invalidas')
  .max(PLANTILLA_ALTO_MM_MAX, 'plantilla-medidas-invalidas')

/**
 * Esquema para crear una plantilla de etiqueta (REQ-ETQ-03).
 */
export const crearEtiquetaPlantillaSchema = z.strictObject(
  {
    nombre: nombrePlantillaSchema,
    ancho_mm: anchoPlantillaSchema,
    alto_mm: altoPlantillaSchema,
    mostrar_nombre: z.boolean('payload-invalido'),
    mostrar_talle: z.boolean('payload-invalido'),
    mostrar_sku: z.boolean('payload-invalido'),
    mostrar_texto_codigo: z.boolean('payload-invalido'),
  },
  payloadParams,
)

/**
 * Esquema para editar una plantilla de etiqueta (REQ-ETQ-03).
 */
export const editarEtiquetaPlantillaSchema = z.strictObject(
  {
    id: z.uuid('plantilla-no-encontrada'),
    nombre: nombrePlantillaSchema,
    ancho_mm: anchoPlantillaSchema,
    alto_mm: altoPlantillaSchema,
    mostrar_nombre: z.boolean('payload-invalido'),
    mostrar_talle: z.boolean('payload-invalido'),
    mostrar_sku: z.boolean('payload-invalido'),
    mostrar_texto_codigo: z.boolean('payload-invalido'),
  },
  payloadParams,
)

/**
 * Esquema para eliminar una plantilla de etiqueta (REQ-ETQ-03).
 */
export const eliminarEtiquetaPlantillaSchema = z.strictObject(
  {
    id: z.uuid('plantilla-no-encontrada'),
  },
  payloadParams,
)

/**
 * Esquema para marcar una plantilla como predeterminada (REQ-ETQ-03).
 */
export const marcarEtiquetaPlantillaPredeterminadaSchema = z.strictObject(
  {
    id: z.uuid('plantilla-no-encontrada'),
  },
  payloadParams,
)
