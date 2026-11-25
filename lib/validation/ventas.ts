import { z } from 'zod'

const medioPagoSchema = z.enum(['efectivo', 'transferencia', 'tarjeta_debito', 'tarjeta_credito'])

/**
 * Validación de runtime del motivo de anulación. El `maxLength` del textarea
 * es una comodidad de la UI, no un límite: el Server Action es un POST que
 * cualquiera puede mandar a mano (ver `lib/validation/administracion` para el
 * razonamiento completo), y `venta.motivo_anulacion` es `text` sin tope, así
 * que sin esto entra un motivo de cualquier tamaño.
 *
 * Mismo formato de `reason` kebab que el resto de los actions.
 */
export const anularVentaSchema = z.strictObject(
  {
    idVenta: z.uuid('id-venta-invalido'),
    motivo: z
      .string('motivo-invalido')
      .max(300, 'motivo-largo')
      .optional()
      // Un motivo en blanco es lo mismo que no haber puesto motivo: se
      // normaliza a `undefined` para que el SP lo guarde como NULL.
      .transform((m) => {
        const t = m?.trim()
        return t ? t : undefined
      }),
  },
  {
    error: (issue: z.core.$ZodRawIssue) =>
      issue.code === 'unrecognized_keys' ? 'campo-desconocido' : 'payload-invalido',
  },
)

export const devolverItemVentaSchema = z.strictObject(
  {
    idDetalleVenta: z.uuid('id-detalle-invalido'),
    idVenta: z.uuid('id-venta-invalido'),
    motivo: z
      .string('motivo-invalido')
      .max(300, 'motivo-largo')
      .optional()
      .transform((m) => {
        const t = m?.trim()
        return t ? t : undefined
      }),
    idCuentaReintegro: z.string().uuid('cuenta-invalida').optional().nullable()
      .transform((id) => id || undefined),
    medioReintegro: medioPagoSchema.optional().nullable()
      .transform((m) => m || undefined)
  },
  {
    error: (issue: z.core.$ZodRawIssue) =>
      issue.code === 'unrecognized_keys' ? 'campo-desconocido' : 'payload-invalido',
  },
)

const lineaInputSchema = z.strictObject({
  id_item: z.string().uuid('item-invalido'),
  descuentos: z.array(z.string().uuid('descuento-invalido')).optional(),
})

const pagoInputSchema = z.strictObject({
  medio: medioPagoSchema,
  id_cuenta_destino: z.string().uuid('cuenta-invalida'),
  monto: z.number().positive('monto-invalido'),
  cuotas: z.number().int().positive().nullable().optional(),
  monto_recibido: z.number().nullable().optional(),
  referencia: z.string().max(200).nullable().optional(),
})

const financiacionInputSchema = z.strictObject({
  cuotas: z.number().int().min(1).max(24),
  primer_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'vencimiento-invalido'),
})

const financiadorInputSchema = z.strictObject({
  id_cuenta_destino: z.string().uuid().nullable().optional(),
  medio: medioPagoSchema.nullable().optional(),
  propia: z.boolean().optional(),
})

export const registrarVentaSchema = z.strictObject(
  {
    lineas: z.array(lineaInputSchema).min(1, 'lineas-vacias'),
    formaPago: z.string().min(1, 'forma-pago-invalida'),
    idCliente: z.string().uuid('cliente-invalido').nullable().optional(),
    idReserva: z.string().uuid('reserva-invalida').nullable().optional(),
    observaciones: z.string().max(1000, 'observaciones-largas').nullable().optional(),
    pagos: z.array(pagoInputSchema).optional(),
    financiacion: financiacionInputSchema.nullable().optional(),
    financiador: financiadorInputSchema.nullable().optional(),
  },
  {
    error: (issue: z.core.$ZodRawIssue) =>
      issue.code === 'unrecognized_keys' ? 'campo-desconocido' : 'payload-invalido',
  },
)

export const cambiarItemVentaSchema = z.strictObject(
  {
    idDetalleOriginal: z.uuid('id-detalle-invalido'),
    idItemEntregado: z.uuid('item-invalido'),
    idVenta: z.uuid('id-venta-invalido'),
    canal: z.enum(['local', 'revendedora'], {
      error: () => 'canal-invalido',
    }).optional().default('local'),
    idRevendedora: z.uuid('revendedora-invalida').nullable().optional(),
    motivo: z
      .string('motivo-invalido')
      .max(300, 'motivo-largo')
      .optional()
      .transform((m) => {
        const t = m?.trim()
        return t ? t : undefined
      }),
    medioCobro: medioPagoSchema.optional().nullable()
      .transform((m) => m || undefined),
    idCuentaDestino: z.uuid('cuenta-invalida').optional().nullable()
      .transform((id) => id || undefined),
  },
  {
    error: (issue: z.core.$ZodRawIssue) =>
      issue.code === 'unrecognized_keys' ? 'campo-desconocido' : 'payload-invalido',
  },
)

