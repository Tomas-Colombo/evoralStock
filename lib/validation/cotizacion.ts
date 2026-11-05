import { z } from 'zod'

export const actualizarCotizacionSchema = z.strictObject({
  valor: z.number().positive().finite().max(10_000_000),
})

export const cambiarModoCotizacionSchema = z.strictObject({
  modo: z.enum(['automatica', 'manual']),
})
