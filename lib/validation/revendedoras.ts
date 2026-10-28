import { z } from 'zod'

export const revendedoraSchema = z.strictObject({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(100, 'El nombre es muy largo'),
  apellido: z.string().trim().min(1, 'El apellido es obligatorio').max(100, 'El apellido es muy largo'),
  telefono: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().email('El formato del email no es válido').nullable().optional().or(z.literal('')),
  notas: z.string().trim().max(1000).nullable().optional(),
})

export type RevendedoraPayload = z.infer<typeof revendedoraSchema>

const dateRegex = /^\d{4}-\d{2}-\d{2}$/

const optionalDateSchema = z
  .string()
  .trim()
  .regex(dateRegex, 'Formato de fecha inválido (AAAA-MM-DD)')
  .nullable()
  .optional()
  .or(z.literal(''))
  .transform((val) => (val ? val : null))

export const crearConsignacionRevendedoraSchema = z.strictObject({
  id_revendedora: z.string().uuid('id-revendedora-invalido'),
  items: z
    .array(z.string().uuid('id-item-invalido'))
    .min(1, 'items-vacios')
    .max(200, 'demasiados-items')
    .transform((items) => Array.from(new Set(items))),
  periodo_desde: optionalDateSchema,
  periodo_hasta: optionalDateSchema,
  observaciones: z
    .string()
    .trim()
    .max(1000, 'observaciones-largas')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
  motivo: z
    .string()
    .trim()
    .max(500, 'motivo-largo')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
})

export type CrearConsignacionRevendedoraPayload = z.infer<typeof crearConsignacionRevendedoraSchema>

export const editarConsignacionRevendedoraSchema = z.strictObject({
  id_consignacion_revendedora: z.string().uuid('id-consignacion-invalido'),
  periodo_desde: optionalDateSchema,
  periodo_hasta: optionalDateSchema,
  observaciones: z
    .string()
    .trim()
    .max(1000, 'observaciones-largas')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
})

export type EditarConsignacionRevendedoraPayload = z.infer<typeof editarConsignacionRevendedoraSchema>

export const confirmarConsignacionRevendedoraSchema = z.strictObject({
  id_consignacion_revendedora: z.string().uuid('id-consignacion-invalido'),
})

export type ConfirmarConsignacionRevendedoraPayload = z.infer<typeof confirmarConsignacionRevendedoraSchema>

export const registrarDevolucionRevendedoraSchema = z.strictObject({
  id_consignacion_revendedora: z.string().uuid('id-consignacion-invalido'),
  items: z
    .array(z.string().uuid('id-item-invalido'))
    .min(1, 'items-vacios')
    .max(200, 'demasiados-items')
    .transform((items) => Array.from(new Set(items))),
  estado_destino: z.enum(['disponible', 'devuelto', 'baja']),
  motivo: z
    .string()
    .trim()
    .max(500, 'motivo-largo')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
})

export type RegistrarDevolucionRevendedoraPayload = z.infer<typeof registrarDevolucionRevendedoraSchema>

export const devolverItemsRevendedoraSchema = z.strictObject({
  id_revendedora: z.string().uuid('id-revendedora-invalido'),
  items: z
    .array(z.string().uuid('id-item-invalido'))
    .min(1, 'items-vacios')
    .max(200, 'demasiados-items')
    .transform((items) => Array.from(new Set(items))),
  estado_destino: z.enum(['disponible', 'devuelto', 'baja']),
  motivo: z
    .string()
    .trim()
    .max(500, 'motivo-largo')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
})

export type DevolverItemsRevendedoraPayload = z.infer<typeof devolverItemsRevendedoraSchema>

export const cerrarConsignacionRevendedoraSchema = z.strictObject({
  id_consignacion_revendedora: z.string().uuid('id-consignacion-invalido'),
})

export type CerrarConsignacionRevendedoraPayload = z.infer<typeof cerrarConsignacionRevendedoraSchema>

export const eliminarConsignacionRevendedoraSchema = z.strictObject({
  id_consignacion_revendedora: z.string().uuid('id-consignacion-invalido'),
})

export type EliminarConsignacionRevendedoraPayload = z.infer<typeof eliminarConsignacionRevendedoraSchema>

export const previewLiquidacionSchema = z.strictObject({
  id_revendedora: z.string().uuid('id-revendedora-invalido'),
  desde: z.string().trim().regex(dateRegex, 'fecha-desde-invalida'),
  hasta: z.string().trim().regex(dateRegex, 'fecha-hasta-invalida'),
})
export type PreviewLiquidacionPayload = z.infer<typeof previewLiquidacionSchema>

export const generarLiquidacionSchema = z.strictObject({
  id_revendedora: z.string().uuid('id-revendedora-invalido'),
  desde: z.string().trim().regex(dateRegex, 'fecha-desde-invalida'),
  hasta: z.string().trim().regex(dateRegex, 'fecha-hasta-invalida'),
  observaciones: z
    .string()
    .trim()
    .max(1000, 'observaciones-largas')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
})
export type GenerarLiquidacionPayload = z.infer<typeof generarLiquidacionSchema>

export const excluirDetalleLiquidacionSchema = z.strictObject({
  id_detalle: z.string().uuid('id-detalle-invalido'),
  motivo: z
    .string()
    .trim()
    .max(500, 'motivo-largo')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
})
export type ExcluirDetalleLiquidacionPayload = z.infer<typeof excluirDetalleLiquidacionSchema>

export const reincluirDetalleLiquidacionSchema = z.strictObject({
  id_detalle: z.string().uuid('id-detalle-invalido'),
})
export type ReincluirDetalleLiquidacionPayload = z.infer<typeof reincluirDetalleLiquidacionSchema>

export const marcarLiquidacionPagadaSchema = z.strictObject({
  id_liquidacion: z.string().uuid('id-liquidacion-invalido'),
  id_cuenta: z.string().uuid('id-cuenta-invalido'),
  monto: z.number().positive('monto-invalido'),
  metodo: z
    .string()
    .trim()
    .max(50, 'metodo-largo')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
  referencia: z
    .string()
    .trim()
    .max(100, 'referencia-larga')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
  fecha: z
    .string()
    .trim()
    .regex(dateRegex, 'fecha-invalida')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
})
export type MarcarLiquidacionPagadaPayload = z.infer<typeof marcarLiquidacionPagadaSchema>

export const panelRevendedorasQuerySchema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha-invalida').optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha-invalida').optional(),
  estado: z.enum(['todos', 'activa', 'inactiva']).default('todos'),
  cuenta: z.enum(['todos', 'con_saldo', 'atrasada', 'declaraciones_pendientes']).default('todos'),
  q: z.string().max(100).optional(),
  orden: z
    .enum([
      'apellido_asc',
      'apellido_desc',
      'nombre_asc',
      'nombre_desc',
      'adeudado_asc',
      'adeudado_desc',
      'vendido_asc',
      'vendido_desc',
      'items_poder_asc',
      'items_poder_desc',
      'ultima_venta_asc',
      'ultima_venta_desc',
    ])
    .default('apellido_asc'),
  page: z.coerce.number().int().min(1).default(1),
})
export type PanelRevendedorasQuery = z.infer<typeof panelRevendedorasQuerySchema>

export const altaRevendedoraUnificadaSchema = z.strictObject({
  nombre: z.string().trim().min(2, 'nombre-corto').max(60, 'nombre-largo'),
  apellido: z.string().trim().min(2, 'apellido-invalido').max(60, 'apellido-invalido'),
  telefono: z
    .string()
    .trim()
    .max(30, 'telefono-invalido')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
  email: z
    .string()
    .trim()
    .email('email-invalido')
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val ? val : null)),
  notas: z
    .string()
    .trim()
    .max(1000, 'observaciones-largas')
    .nullable()
    .optional()
    .transform((val) => (val ? val : null)),
  crear_acceso: z.boolean().default(false),
  password_acceso: z.string().min(8, 'password-corto').optional(),
  comision_propia: z.coerce.number().min(0, 'porcentaje-invalido').max(100, 'porcentaje-invalido').optional(),
})
export type AltaRevendedoraUnificadaPayload = z.infer<typeof altaRevendedoraUnificadaSchema>

export const declararVentaRevendedoraSchema = z.strictObject({
  id_item: z.string().uuid('id-item-invalido'),
  nota: z
    .string()
    .trim()
    .max(500, 'observaciones-largas')
    .optional()
    .default(''),
})
export type DeclararVentaRevendedoraPayload = z.infer<typeof declararVentaRevendedoraSchema>

export const retirarDeclaracionSchema = z.strictObject({
  id_declaracion: z.string().uuid('id-declaracion-invalido'),
})
export type RetirarDeclaracionPayload = z.infer<typeof retirarDeclaracionSchema>

export const confirmarDeclaracionVentaSchema = z.strictObject({
  id_declaracion: z.string().uuid('id-declaracion-invalido'),
})
export type ConfirmarDeclaracionVentaPayload = z.infer<typeof confirmarDeclaracionVentaSchema>

export const rechazarDeclaracionVentaSchema = z.strictObject({
  id_declaracion: z.string().uuid('id-declaracion-invalido'),
  motivo: z.string().trim().min(1, 'motivo-requerido').max(500, 'motivo-largo'),
})
export type RechazarDeclaracionVentaPayload = z.infer<typeof rechazarDeclaracionVentaSchema>

export const paginacionQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const declaracionesLocalQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  estado: z.enum(['todas', 'pendiente', 'confirmada', 'rechazada', 'retirada']).default('todas'),
  id_revendedora: z.string().uuid().optional(),
})
export type DeclaracionesLocalQuery = z.infer<typeof declaracionesLocalQuerySchema>

