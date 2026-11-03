import type { Permiso } from '@/lib/types/administracion'
import { accionesDelModulo } from '@/lib/types/administracion'

// Es estructural porque lib/ayuda no puede importar lib/dal (REQ-AYUDA-09)
export interface SessionPermisosInput {
  rolId: string | null
  permisos: Record<string, readonly string[] | string[]>
  modulosHabilitados: readonly string[] | string[]
}

/**
 * Devuelve el conjunto de permisos efectivos de la sesión.
 * Solo incluye acciones válidas de módulos habilitados en el tenant para un rol asignado.
 */
export function permisosEfectivos(
  s: SessionPermisosInput,
): ReadonlySet<Permiso> {
  if (!s.rolId) {
    return new Set<Permiso>()
  }

  const resultado = new Set<Permiso>()
  const habilitados = new Set(s.modulosHabilitados)

  for (const [modulo, acciones] of Object.entries(s.permisos)) {
    if (!habilitados.has(modulo)) {
      continue
    }

    const accionesValidas = accionesDelModulo(modulo)
    if (!accionesValidas) {
      continue
    }

    const catalogoSet = new Set<string>(accionesValidas)
    for (const accion of acciones) {
      if (catalogoSet.has(accion)) {
        resultado.add(`${modulo}.${accion}` as Permiso)
      }
    }
  }

  return resultado
}
