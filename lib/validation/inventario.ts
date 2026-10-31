import { z } from 'zod'
import type { TipoIngreso, TipoProveedor } from '@/lib/types/inventario'

const payloadParams = {
  error: (issue: z.core.$ZodRawIssue) =>
    issue.code === 'unrecognized_keys' ? 'campo-desconocido' : 'payload-invalido',
}

/**
 * Esquema de validación para `crearIngresoCompletoAction`.
 * Construido a partir de los tipos de ingreso permitidos por las capacidades
 * del tenant (REQ-MODOP-05).
 */
export function crearIngresoCompletoSchema(tipos: readonly [TipoIngreso, ...TipoIngreso[]]) {
  return z.strictObject(
    {
      idProveedor: z.uuid('proveedor-invalido').nullable().optional(),
      tipoIngreso: z.enum(tipos, 'tipo-ingreso-invalido'),
      numeroRemito: z.string().nullable().optional(),
      observaciones: z.string().nullable().optional(),
      moneda: z.string().optional(),
      lineas: z.array(z.unknown()),
    },
    payloadParams,
  )
}

/**
 * Esquema de validación para alta y edición de proveedores (`createProveedorAction`
 * y `updateProveedorAction`), validando el tipo de proveedor según las capacidades
 * del tenant (REQ-MODOP-06).
 */
export function proveedorSchema(tipos: readonly [TipoProveedor, ...TipoProveedor[]]) {
  return z.strictObject(
    {
      nombre: z.string('nombre-requerido').trim().min(1, 'nombre-requerido'),
      tipo: z.enum(tipos, 'tipo-proveedor-invalido'),
      telefono: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      cuit: z.string().nullable().optional(),
      dias_rotacion: z.number().nullable().optional(),
      notas: z.string().nullable().optional(),
      activo: z.boolean().optional(),
    },
    payloadParams,
  )
}

/**
 * Esquema parcial para edición de proveedor. Mantiene `strictObject` para
 * rechazar campos extraños.
 */
export function proveedorPatchSchema(tipos: readonly [TipoProveedor, ...TipoProveedor[]]) {
  return proveedorSchema(tipos).partial()
}

export function extraerReasonZod(error: z.ZodError): string {
  const issue = error.issues[0]
  return issue ? issue.message : 'payload-invalido'
}
