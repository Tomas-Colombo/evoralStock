import type { Session } from '@/lib/dal/session'
import { hasPermission } from '@/lib/dal/guard'

export interface PermisosNuevaRevendedora {
  canGrantAccess: boolean
  canEditComision: boolean
}

/**
 * Centraliza las banderas de permisos requeridas para las secciones opcionales
 * del alta de revendedora (acceso al sistema y comisión particular).
 * Se extrae a un helper de servidor para no duplicar la regla de negocio
 * entre la página `/revendedoras/nuevo` y el modal de `/revendedoras`.
 */
export function getPermisosNuevaRevendedora(session: Session): PermisosNuevaRevendedora {
  return {
    canGrantAccess:
      hasPermission(session, 'administracion', 'crear') &&
      hasPermission(session, 'revendedoras', 'editar'),
    canEditComision: hasPermission(session, 'revendedoras', 'editar'),
  }
}
