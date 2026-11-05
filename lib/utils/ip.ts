import { headers } from 'next/headers'

/**
 * Obtiene la dirección IP del cliente a partir de los encabezados HTTP de la request.
 * Soporta proxies inversos mediante `x-forwarded-for` y `x-real-ip`.
 * Falla de forma segura retornando null si no se puede acceder a los headers.
 */
export async function getClientIp(): Promise<string | null> {
  try {
    const h = await headers()
    const forwarded = h.get('x-forwarded-for')
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim()
      if (first) return first
    }
    const realIp = h.get('x-real-ip')?.trim()
    return realIp || null
  } catch {
    return null
  }
}
