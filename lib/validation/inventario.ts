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
      lineas: z.array(
        z.object({
          costoUnitario: z.number().nullable().optional(),
        }).passthrough(),
      ),
    },
    payloadParams,
  )
}

export const createProductoSchema = z.object(
  {
    idCategoria: z.string().min(1, 'falta-categoria'),
    nombre: z.string().trim().min(1, 'nombre-requerido'),
    sku: z.string().nullable().optional(),
    stockMinimo: z.number().nonnegative().optional(),
    descripcion: z.string().nullable().optional(),
    costoInicial: z.number().nonnegative('costo-invalido').nullable().optional(),
    moneda: z.string().optional(),
    idProveedor: z.string().nullable().optional(),
    stock: z
      .array(
        z.object({
          talle: z.string().nullable(),
          cantidad: z.number(),
        }),
      )
      .optional(),
  },
)

export const confirmarIngresoSchema = z.object(
  {
    idIngreso: z.string().min(1, 'ingreso-not-found'),
    costo: z.number().nullable().optional(),
  },
)

export const lineaRemitoSchema = z.object(
  {
    esNuevo: z.boolean(),
    idProducto: z.string().nullable(),
    idCategoria: z.string().nullable(),
    nombre: z.string(),
    cantidad: z.number(),
    costoUnitario: z.number().nullable().optional(),
    talles: z
      .array(
        z.object({
          talle: z.string().nullable(),
          cantidad: z.number(),
        }),
      )
      .optional(),
  },
)

export const importarRemitoSchema = z.object(
  {
    idIngreso: z.string().min(1, 'ingreso-not-found'),
    moneda: z.string().optional(),
    lineas: z.array(lineaRemitoSchema),
  },
)

export const completarCostoIngresoSchema = z.strictObject(
  {
    idIngreso: z.string().min(1, 'ingreso-not-found'),
    lineas: z
      .array(
        z.strictObject(
          {
            idDetalle: z.string().min(1, 'detalle-not-found'),
            costoUnitario: z.number().positive('costo-invalido'),
          },
          payloadParams,
        ),
      )
      .min(1, 'sin-lineas'),
  },
  payloadParams,
)

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
