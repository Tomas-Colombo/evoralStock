import { z } from 'zod'

export const reglaIdSchema = z.strictObject({
  idRegla: z.uuid('payload-invalido'),
})

export type ReglaIdInput = z.infer<typeof reglaIdSchema>
