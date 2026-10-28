import { LOGO_ALTO_MAX, LOGO_ANCHO_MAX } from '@/lib/tenant/logo'

/**
 * Reescala el logo en el navegador a la caja que usa el rail y lo exporta como
 * WebP (o PNG si el navegador no codifica WebP). Antes se mandaba el archivo
 * original como base64 y una foto de 2 MB superaba el límite de 1 MB de las
 * Server Actions. Un SVG también pasa por acá: se rasteriza, porque el bucket
 * no lo acepta.
 *
 * Tira slugs de `mensajes.ts` para que la tarjeta los muestre tal cual.
 */
export async function achicarLogo(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    try {
      await img.decode()
    } catch {
      throw new Error('logo-formato-invalido')
    }

    // Un SVG sin width/height puede decodificar con tamaño natural 0.
    const anchoOriginal = img.naturalWidth || LOGO_ANCHO_MAX
    const altoOriginal = img.naturalHeight || LOGO_ALTO_MAX
    const escala = Math.min(1, LOGO_ANCHO_MAX / anchoOriginal, LOGO_ALTO_MAX / altoOriginal)

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(anchoOriginal * escala))
    canvas.height = Math.max(1, Math.round(altoOriginal * escala))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('logo-invalido')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    // Safari viejo ignora 'image/webp' y devuelve PNG: se mira el tipo real.
    const webp = await exportar(canvas, 'image/webp', 0.9)
    if (webp?.type === 'image/webp') return webp
    const png = await exportar(canvas, 'image/png')
    if (!png) throw new Error('logo-invalido')
    return png
  } finally {
    URL.revokeObjectURL(url)
  }
}

function exportar(canvas: HTMLCanvasElement, tipo: string, calidad?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, calidad))
}
