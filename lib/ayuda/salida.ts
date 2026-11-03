import { z } from 'zod'

export interface SalidaModelo {
  respuesta: string
  entradaId: string | null
  necesitaDetalle?: boolean
}

/**
 * Esquema OpenAPI para el modo JSON estructurado de Gemini (responseSchema).
 * Se arma como un objeto plano sin acoplarse al SDK de Gemini.
 */
export function esquemaSalida(ids: readonly string[]): object {
  return {
    type: 'OBJECT',
    properties: {
      respuesta: {
        type: 'STRING',
      },
      entradaId: {
        type: 'STRING',
        format: 'enum',
        enum: [...ids],
        nullable: true,
      },
      necesitaDetalle: {
        type: 'BOOLEAN',
      },
    },
    required: ['respuesta', 'entradaId'],
  }
}

/**
 * Re-valida en el servidor la salida estructurada devuelta por el modelo.
 * Garantiza que entradaId pertenezca al enum permitido de la consulta (o sea null)
 * y que respuesta no supere los 2000 caracteres.
 */
export function salidaSchema(ids: readonly string[]): z.ZodType<SalidaModelo> {
  const idsValidos = new Set(ids)

  return z.object({
    respuesta: z.string().max(2000),
    entradaId: z
      .string()
      .nullable()
      .refine((val) => val === null || idsValidos.has(val), {
        message: 'entradaId fuera del enum permitido',
      }),
    necesitaDetalle: z.boolean().optional(),
  })
}
