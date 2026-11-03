import type { EntradaGuia } from './tipos'
import type { Permiso } from '@/lib/types/administracion'

/**
 * Filtra las entradas de la guía de forma fail-closed: solo devuelve aquellas
 * cuyos permisos requeridos están TODOS contenidos en el conjunto de permisos provisto.
 * Mantiene el orden original de la guía.
 */
export function filtrarGuia(
  guia: readonly EntradaGuia[],
  permisos: ReadonlySet<Permiso>,
): EntradaGuia[] {
  if (!permisos || permisos.size === 0) {
    return []
  }

  return guia.filter((entrada) => {
    if (!entrada.permisos || entrada.permisos.length === 0) {
      return false
    }

    return entrada.permisos.every((permiso) => permisos.has(permiso))
  })
}
