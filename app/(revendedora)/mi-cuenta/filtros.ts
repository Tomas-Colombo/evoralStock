import { esFechaValida } from '@/lib/fechas'

export const PORTAL_PAGE_SIZE = 50

export function parsearPeriodoPortal(
  desdeRaw?: string,
  hastaRaw?: string,
): { desde?: string; hasta?: string } {
  const desde = esFechaValida(desdeRaw) ? desdeRaw : undefined
  let hasta = esFechaValida(hastaRaw) ? hastaRaw : undefined
  if (desde && hasta && hasta < desde) {
    hasta = desde
  }
  return { desde, hasta }
}

export function parsearEstadoPortal<T extends string>(
  raw: string | undefined,
  permitidos: readonly T[],
): T | undefined {
  if (!raw) return undefined
  return permitidos.includes(raw as T) ? (raw as T) : undefined
}

export function parsearPaginaPortal(raw?: string): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 1 ? Math.floor(n) : 1
}

export function parsearBusquedaPortal(raw?: string): string | undefined {
  const limpio = raw?.trim().slice(0, 100)
  return limpio ? limpio : undefined
}

export function urlPortalConFiltros(
  basePath: string,
  filtros: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filtros)) {
    if (v) params.set(k, v)
  }
  const qs = params.toString()
  return qs ? `${basePath}?${qs}` : basePath
}
