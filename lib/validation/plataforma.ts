import { z } from 'zod'
import {
  MEDIOS_PAGO_TENANT,
  CLAVES_PAQUETES_OPCIONALES,
  TIPOS_MOVIMIENTO_TENANT,
} from '@/lib/types/plataforma'

const payloadParams = {
  error: (issue: z.core.$ZodRawIssue) =>
    issue.code === 'unrecognized_keys' ? 'campo-desconocido' : 'payload-invalido',
}

/**
 * Validador de monto positivo con hasta 2 decimales.
 */
const montoPositivoSchema = z
  .number('monto-invalido')
  .positive('monto-invalido')
  .refine(
    (val) => {
      if (!Number.isFinite(val)) return false
      const parts = val.toString().split('.')
      return parts.length === 1 || parts[1].length <= 2
    },
    'monto-invalido',
  )

/**
 * Validador y transformador de período contable:
 * Entrada 'YYYY-MM' (control <input type="month">)
 * Salida 'YYYY-MM-01' (primer día del mes para PostgreSQL).
 */
const periodoMonthSchema = z
  .string('periodo-invalido')
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'periodo-invalido')
  .transform((val) => `${val}-01`)

/**
 * Formato de fecha estándar 'YYYY-MM-DD'.
 * La regla de no futura la impone el stored procedure en base de datos.
 */
const fechaDiaSchema = z
  .string('fecha-invalida')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha-invalida')

/**
 * Concepto recortado no vacío.
 */
const conceptoSchema = z
  .string('concepto-invalido')
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, 'concepto-invalido')

/**
 * Nota opcional con recorte de espacios.
 */
const notaOpcionalSchema = z
  .string()
  .transform((s) => s.trim())
  .optional()
  .nullable()

/**
 * Schema estricto para registro de cargo a tenant (REQ-SA-04).
 */
export const registrarCargoSchema = z.strictObject(
  {
    idTenant: z.uuid('tenant-inexistente'),
    periodo: periodoMonthSchema,
    monto: montoPositivoSchema,
    concepto: conceptoSchema,
  },
  payloadParams,
)

export type RegistrarCargoInput = z.infer<typeof registrarCargoSchema>

/**
 * Schema estricto para registro de pago de tenant (REQ-SA-05).
 */
export const registrarPagoSchema = z.strictObject(
  {
    idTenant: z.uuid('tenant-inexistente'),
    fecha: fechaDiaSchema,
    monto: montoPositivoSchema,
    medio: z.enum(MEDIOS_PAGO_TENANT, 'medio-pago-invalido'),
    nota: notaOpcionalSchema,
  },
  payloadParams,
)

export type RegistrarPagoInput = z.infer<typeof registrarPagoSchema>

/**
 * Schema estricto para anulación de movimiento de cuenta corriente (REQ-SA-06).
 */
export const anularMovimientoSchema = z.strictObject(
  {
    tipo: z.enum(TIPOS_MOVIMIENTO_TENANT, 'tipo-movimiento-invalido'),
    idMovimiento: z.uuid('movimiento-inexistente'),
  },
  payloadParams,
)

export type AnularMovimientoInput = z.infer<typeof anularMovimientoSchema>

/**
 * Schema estricto para alternar módulos de un paquete opcional (REQ-SA-03).
 */
export const togglePaqueteSchema = z.strictObject(
  {
    idTenant: z.uuid('tenant-inexistente'),
    paquete: z.enum(CLAVES_PAQUETES_OPCIONALES, 'paquete-invalido'),
    habilitado: z.boolean({
      error: 'payload-invalido',
    }),
  },
  payloadParams,
)

export type TogglePaqueteInput = z.infer<typeof togglePaqueteSchema>

/**
 * Extrae el slug de error del primer issue de Zod.
 */
export function extraerReasonZod(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'payload-invalido'
  return issue.message || 'payload-invalido'
}
