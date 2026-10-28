import { z } from 'zod'

export const restablecerClaveSchema = z.strictObject({
  idUsuario: z.string().uuid('payload-invalido'),
  password: z.string().min(8, 'password-corto').max(72, 'payload-invalido'),
})

export type RestablecerClavePayload = z.infer<typeof restablecerClaveSchema>
