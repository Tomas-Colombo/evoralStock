import { z } from 'zod'

const payloadParams = {
  error: (issue: z.core.$ZodRawIssue) =>
    issue.code === 'unrecognized_keys' ? 'campo-desconocido' : 'payload-invalido',
}

export const mensajeHistorialSchema = z.strictObject(
  {
    rol: z.enum(['usuario', 'asistente'], 'payload-invalido'),
    texto: z.string('payload-invalido').max(500, 'payload-invalido'),
  },
  payloadParams,
)

export const consultarAyudaSchema = z.strictObject(
  {
    idConversacion: z.uuid('payload-invalido'),
    pregunta: z
      .string('payload-invalido')
      .trim()
      .min(1, 'payload-invalido')
      .max(300, 'payload-invalido'),
    historial: z.array(mensajeHistorialSchema, 'payload-invalido').max(6, 'payload-invalido'),
    focoId: z.string('payload-invalido').max(64, 'payload-invalido').nullable(),
  },
  payloadParams,
)

export type ConsultarAyudaInput = z.infer<typeof consultarAyudaSchema>

export const calificarConsultaAyudaSchema = z.strictObject(
  {
    idConsulta: z.uuid('payload-invalido'),
    util: z.boolean('payload-invalido'),
  },
  payloadParams,
)

export type CalificarConsultaAyudaInput = z.infer<typeof calificarConsultaAyudaSchema>

// ─── Chat v2 ─────────────────────────────────────────────────────────

const KEBAB_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const mensajeHistorialChatSchema = z.strictObject(
  {
    rol: z.enum(['usuario', 'asistente'], 'payload-invalido'),
    texto: z.string('payload-invalido').max(500, 'payload-invalido'),
    citasPrevias: z
      .array(
        z
          .string('payload-invalido')
          .max(64, 'payload-invalido')
          .regex(KEBAB_REGEX, 'payload-invalido'),
        'payload-invalido',
      )
      .max(6, 'payload-invalido')
      .optional(),
  },
  payloadParams,
)

export const consultarAyudaChatSchema = z.strictObject(
  {
    idConversacion: z.uuid('payload-invalido'),
    pregunta: z
      .string('payload-invalido')
      .trim()
      .min(1, 'payload-invalido')
      .max(300, 'payload-invalido'),
    historial: z
      .array(mensajeHistorialChatSchema, 'payload-invalido')
      .max(4, 'payload-invalido'),
  },
  payloadParams,
)

export type ConsultarAyudaChatInput = z.infer<typeof consultarAyudaChatSchema>

