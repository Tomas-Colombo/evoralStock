/**
 * Topes y formato del logo del tenant, compartidos por la tarjeta de
 * administración (que achica la imagen en el navegador) y la Server Action
 * (que vuelve a chequear, porque el archivo lo arma el navegador).
 *
 * Vive sin `'use client'` ni `'server-only'` porque lo usan los dos lados.
 */

/**
 * Tope del archivo que llega a la action. Muy por debajo del `bodySizeLimit`
 * de 1 MB de Server Actions: con el logo mandado como base64 de hasta 2 MB el
 * request moría en el framework antes de llegar a la action. Es el mismo tope
 * que tiene el bucket `tenant-logos` (00116).
 */
export const LOGO_MAX_BYTES = 512 * 1024

/** Formatos que acepta el bucket. Sin SVG: servido desde Storage ejecuta script. */
export const LOGO_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const
export type LogoMime = (typeof LOGO_MIME)[number]

/**
 * Caja a la que se reescala el logo. El rail lo muestra a 56 px de alto como
 * máximo; con 200 px queda nítido en pantallas de alta densidad.
 */
export const LOGO_ANCHO_MAX = 512
export const LOGO_ALTO_MAX = 200

/** Bucket público de Storage (00109) y carpeta por tenant (00116). */
export const LOGO_BUCKET = 'tenant-logos'

export const EXTENSION_LOGO: Record<LogoMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * Formato real de la imagen según sus primeros bytes, o `null` si no es ninguno
 * de los aceptados. El `type` del `File` lo declara el navegador y se puede
 * falsear; los magic bytes son lo que Storage termina sirviendo.
 */
export function detectarFormatoImagen(bytes: Uint8Array): LogoMime | null {
  const empieza = (firma: number[], desde = 0) =>
    bytes.length >= desde + firma.length && firma.every((b, i) => bytes[desde + i] === b)

  if (empieza([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (empieza([0xff, 0xd8, 0xff])) return 'image/jpeg'
  // RIFF....WEBP: los cuatro bytes del medio son el tamaño del contenedor.
  if (empieza([0x52, 0x49, 0x46, 0x46]) && empieza([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  return null
}
