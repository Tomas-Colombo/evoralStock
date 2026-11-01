import { Session } from '../dal/session'
import { hasModuleAccess } from '../dal/guard'
import { capacidades } from '../modulos/capacidades'

export type TipoBloqueFinanzas =
  | 'resultados'
  | 'flujo'
  | 'serie'
  | 'cobrar'
  | 'gastos'
  | 'mercaderia'
  | 'ranking'
  | 'proveedores'
  | 'revendedoras'

/**
 * REQ-APP-04: Mapeo de bloques a módulos y permisos requeridos para verlos
 */
export function bloquesVisibles(session: Session): TipoBloqueFinanzas[] {
  const cap = capacidades(session.modulosHabilitados)
  const visibles: TipoBloqueFinanzas[] = []

  // - resultados/flujo/serie/cobrar → módulo ventas
  if (hasModuleAccess(session, 'ventas', 'ver')) {
    visibles.push('resultados', 'flujo', 'serie', 'cobrar')
  }

  // - gastos → módulo gastos
  if (hasModuleAccess(session, 'gastos', 'ver')) {
    visibles.push('gastos')
  }

  // - mercaderia/ranking → módulo inventario
  if (hasModuleAccess(session, 'inventario', 'ver')) {
    visibles.push('mercaderia', 'ranking')
  }

  // - proveedores → capacidad consignacionProveedor y permiso rendiciones (REQ-MODOP-08)
  if (cap.consignacionProveedor && hasModuleAccess(session, 'rendiciones', 'ver')) {
    visibles.push('proveedores')
  }

  // - revendedoras → módulo revendedoras
  if (hasModuleAccess(session, 'revendedoras', 'ver')) {
    visibles.push('revendedoras')
  }

  return visibles
}
