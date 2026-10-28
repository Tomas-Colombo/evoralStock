/**
 * Whitelist para el `?from` de los «Volver»: evita open-redirect aceptando
 * sólo rutas internas del app. Estaba copiada en cinco páginas.
 *
 * `/\evil.com` se rechaza igual que `//evil.com`: los navegadores normalizan
 * la barra invertida y lo tratan como una URL de otro host.
 */
export function safeBackHref(from: string | undefined, fallback: string): string {
  if (!from) return fallback
  if (!from.startsWith('/') || from.startsWith('//') || from.startsWith('/\\')) return fallback
  return from
}
