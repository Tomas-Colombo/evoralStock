import type { ProductoConPrecioStatus } from '@/lib/types/precios'

export interface PermisosControlDePrecios {
  puedeVerCostos: boolean
  puedeVerMargenes: boolean
}

/**
 * Proyecta las filas del panel de control de precios según permisos de costos y márgenes.
 *
 * Sin inventario.ver_costos:
 *   - costo_vigente es null.
 *
 * Sin precios.ver_margenes:
 *   - regla_margen_nombre es null.
 *   - precio_proyectado es null.
 *   - diferencia_pct es null.
 *
 * Nota: precio_proyectado y diferencia_pct requieren ambos permisos porque derivan de costo * margen.
 */
export function proyectarControlDePrecios(
  rows: ProductoConPrecioStatus[],
  permisos: PermisosControlDePrecios,
): ProductoConPrecioStatus[] {
  const { puedeVerCostos, puedeVerMargenes } = permisos
  return rows.map((r) => ({
    ...r,
    costo_vigente: puedeVerCostos ? r.costo_vigente : null,
    regla_margen_nombre: puedeVerMargenes ? r.regla_margen_nombre : null,
    precio_proyectado: puedeVerCostos && puedeVerMargenes ? r.precio_proyectado : null,
    diferencia_pct: puedeVerCostos && puedeVerMargenes ? r.diferencia_pct : null,
  }))
}
