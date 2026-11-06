import { z } from 'zod'
import { IMPRESORA_MM_MAX, IMPRESORA_MM_MIN, QR_LADO_MM_MAX, QR_LADO_MM_MIN } from '@/lib/inventario/limites'
import { CATALOGO_PERMISOS } from '@/lib/types/administracion'
import { LOGO_MAX_BYTES, LOGO_MIME } from '@/lib/tenant/logo'

/**
 * Validación de runtime para los payloads de roles. Los Server Actions son un
 * endpoint POST público (ver `node_modules/next/dist/docs/01-app/02-guides/
 * server-actions.md` §Security): el tipo TS de `input` desaparece al compilar,
 * así que sin esto cualquiera que pueda mandar el POST escribe el JSON que
 * quiera en `rol.permisos`. RLS no ayuda acá — el escritor ES del tenant, lo
 * que está mal es la FORMA del dato.
 *
 * El esquema se arma desde `CATALOGO_PERMISOS`, que ya es la matriz
 * autoritativa que usa el editor de permisos. Así no hay dos listas que se
 * puedan desincronizar: agregar un módulo o una acción al catálogo lo habilita
 * en la validación automáticamente.
 *
 * Todos los mensajes son slugs kebab estables, no la prosa en inglés de zod:
 * viajan al cliente como `reason` igual que `rol-en-uso` o `nombre-corto`, y
 * `RolesModal` los traduce para el toast.
 */

/**
 * Un objeto estricto con una clave opcional por módulo. `strictObject` rechaza
 * claves que no estén en el catálogo, y cada valor sólo admite las acciones
 * declaradas para ESE módulo — por eso no sirve un `record` con un único
 * esquema de valor: `ventas` no tiene `eliminar`.
 *
 * `__proto__` es la excepción: zod no lo reporta como clave desconocida, pero
 * sí lo descarta de la salida (verificado contra zod 4.4.3), así que nunca
 * llega al SP ni contamina ningún prototipo. Lo cubre un test.
 *
 * Un rol sin permisos (`{}`) es válido: se crea el rol y se le dan después.
 */
export function createPermisosSchema(modulosVisibles: readonly string[]) {
  const permitidos = Object.entries(CATALOGO_PERMISOS).filter(([modulo]) =>
    modulosVisibles.includes(modulo),
  )

  const permisosShape = Object.fromEntries(
    permitidos.map(([modulo, acciones]) => [
      modulo,
      z
        .array(z.enum(acciones, 'accion-invalida'), 'permisos-no-array')
        // Duplicados no rompen nada al leer, pero el JSON se guarda tal cual
        // viene y queda sucio para siempre. Se rechazan en la puerta.
        .refine((as) => new Set(as).size === as.length, 'acciones-duplicadas')
        .optional(),
    ]),
  )

  return z.strictObject(permisosShape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys' ? 'modulo-desconocido' : 'permisos-no-objeto',
  })
}

/**
 * `trim` va como `transform` explícito y los largos como `refine` posteriores:
 * así el orden de evaluación es visible y el mínimo se mide sobre el nombre ya
 * recortado (`"  a  "` es un nombre de un caracter, no de cinco).
 */
const nombreRolSchema = z
  .string('nombre-invalido')
  .transform((s) => s.trim())
  .refine((s) => s.length >= 2, 'nombre-corto')
  .refine((s) => s.length <= 60, 'nombre-largo')

const payloadParams = {
  error: (issue: z.core.$ZodRawIssue) =>
    issue.code === 'unrecognized_keys' ? 'campo-desconocido' : 'payload-invalido',
}

export function createRolSchema(modulosVisibles: readonly string[]) {
  return z.strictObject(
    { nombre: nombreRolSchema, permisos: createPermisosSchema(modulosVisibles) },
    payloadParams,
  )
}

export function updateRolSchema(modulosVisibles: readonly string[]) {
  return z.strictObject(
    { idRol: z.uuid('id-rol-invalido'), nombre: nombreRolSchema, permisos: createPermisosSchema(modulosVisibles) },
    payloadParams,
  )
}

export const deleteRolSchema = z.strictObject(
  { idRol: z.uuid('id-rol-invalido') },
  payloadParams,
)

export const updateConfiguracionQrSchema = z.strictObject(
  {
    ladoMm: z
      .number('qr-lado-mm-invalido')
      .int('qr-lado-mm-invalido')
      .min(QR_LADO_MM_MIN, 'qr-lado-mm-invalido')
      .max(QR_LADO_MM_MAX, 'qr-lado-mm-invalido'),
  },
  payloadParams,
)

const medidaImpresoraSchema = z
  .number('impresora-medida-invalida')
  .int('impresora-medida-invalida')
  .min(IMPRESORA_MM_MIN, 'impresora-medida-invalida')
  .max(IMPRESORA_MM_MAX, 'impresora-medida-invalida')
  .nullable()

export const updateConfiguracionImpresoraSchema = z.strictObject(
  { anchoMm: medidaImpresoraSchema, altoMm: medidaImpresoraSchema },
  payloadParams,
)

/**
 * El logo llega como archivo en `FormData`, no como data URL: el base64 de
 * una imagen de 2 MB superaba el límite de 1 MB de Server Actions. El navegador
 * ya lo achica (ConfiguracionLogoCard); esto es el tope real, porque el archivo
 * lo arma quien hace el POST. El `type` también se puede falsear: el DAL
 * vuelve a mirar los magic bytes antes de subirlo.
 */
export const updateTenantLogoSchema = z.strictObject(
  {
    logo: z
      .file('logo-invalido')
      .min(1, 'logo-invalido')
      .max(LOGO_MAX_BYTES, 'logo-muy-grande')
      .mime([...LOGO_MIME], 'logo-formato-invalido'),
  },
  payloadParams,
)

export const cambiarPasswordSchema = z
  .strictObject(
    {
      passwordActual: z.string().min(1, 'password-actual-requerida'),
      passwordNuevo: z.string().min(8, 'password-corto'),
      passwordConfirmacion: z.string().min(8, 'password-corto'),
    },
    payloadParams,
  )
  .refine((data) => data.passwordNuevo === data.passwordConfirmacion, {
    message: 'passwords-no-coinciden',
    path: ['passwordConfirmacion'],
  })

/**
 * Aplana el `ZodError` a un `reason` corto y estable, en el mismo formato
 * kebab que ya devuelven los demás actions. Incluye la ruta del campo para que
 * el toast diga algo útil cuando el error viene de un permiso anidado.
 */
export function primerReason(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'payload-invalido'
  const ruta = issue.path.join('.')
  return ruta ? `${issue.message} (${ruta})` : issue.message
}

/** Permisos ya validados: sin claves desconocidas y sin acciones inventadas. */
export type PermisosValidados = z.infer<ReturnType<typeof createPermisosSchema>>

/**
 * Las claves ausentes salen del parse como `undefined`. Si eso viajara al SP,
 * `JSON.stringify` las escribe como `null` dentro del `jsonb` y el editor de
 * permisos recibiría `null` donde espera un array. Se descartan acá.
 */
export function compactarPermisos(permisos: PermisosValidados): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(permisos).filter((e): e is [string, string[]] => e[1] !== undefined),
  )
}
