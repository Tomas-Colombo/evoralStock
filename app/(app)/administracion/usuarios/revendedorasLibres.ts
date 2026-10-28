import { listarRevendedoras } from '@/lib/dal/revendedoras'
import type { Session } from '@/lib/dal/session'

export interface RevendedoraLibre {
  id_revendedora: string
  nombre: string
  apellido: string
  telefono: string | null
}

/**
 * Carga las revendedoras activas que aún no tienen un usuario enlazado.
 * Solo consulta la DAL si el tenant tiene el módulo 'revendedoras' habilitado;
 * de lo contrario devuelve un arreglo vacío para evitar comprobaciones de
 * permisos y consultas innecesarias.
 *
 * Devuelve sólo lo que usa el formulario: el resultado viaja serializado al
 * cliente (ahora también en el listado de usuarios), y la fila completa
 * llevaba datos de la revendedora que la pantalla no necesita.
 */
export async function getRevendedorasLibres(session: Session): Promise<RevendedoraLibre[]> {
  if (!session.modulosHabilitados.includes('revendedoras')) {
    return []
  }
  const allRevs = await listarRevendedoras(session)
  return allRevs
    .filter((r) => r.activo && !r.id_usuario)
    .map(({ id_revendedora, nombre, apellido, telefono }) => ({
      id_revendedora,
      nombre,
      apellido,
      telefono,
    }))
}
