/**
 * Tipos TS de administración (Etapa 9). Contra tablas ya existentes
 * (rol, usuario, modulo, tenant_modulo, auditoria) + 00029.
 */

export type UsuarioEstado = 'activo' | 'inactivo' | 'invitado'

export const USUARIO_ESTADO_LABEL: Record<UsuarioEstado, string> = {
  activo: 'Activo',
  inactivo: 'Inactivo',
  invitado: 'Invitado',
}

export interface RolRow {
  id_rol: string
  id_tenant: string
  nombre: string
  permisos: Record<string, string[]>
  created_at: string
  updated_at: string
}

export interface UsuarioRow {
  id_usuario: string
  id_tenant: string
  email: string
  nombre_completo: string | null
  id_rol: string | null
  estado_usuario: UsuarioEstado
  created_at: string
  updated_at: string
}

export interface UsuarioConRol extends UsuarioRow {
  rol: { id_rol: string; nombre: string } | null
}

export interface AuditoriaRow {
  id_auditoria: string
  id_tenant: string
  id_usuario: string | null
  entidad: string
  entidad_id: string | null
  accion: string
  cambios: Record<string, unknown>
  ts: string
  ip: string | null
}

export interface AuditoriaConActor extends AuditoriaRow {
  actor_email: string | null
  actor_nombre: string | null
}

/**
 * Catálogo de acciones por módulo. Se usa para el editor de permisos:
 * el operador ticka las acciones que el rol puede hacer en cada módulo.
 * Las claves deben coincidir con `moduloCodigo` del seed y los valores
 * con lo que cada guard/action valida.
 */
const _CATALOGO = {
  inventario: ['ver', 'crear', 'editar', 'eliminar'],
  precios: ['ver', 'crear', 'editar', 'eliminar', 'editar_cotizacion'],
  // `eliminar` = marcar una cuota como incobrable. Faltaba desde el primer
  // commit: la action lo exigía y ningún rol podía tenerlo, ni el admin.
  ventas: ['ver', 'crear', 'editar', 'eliminar'],
  consignaciones: ['ver', 'crear', 'editar', 'eliminar'],
  rendiciones: ['ver', 'crear', 'editar'],
  gastos: ['ver', 'crear', 'editar'],
  reportes: ['ver'],
  administracion: ['ver', 'crear', 'editar', 'eliminar'],
  revendedoras: ['ver', 'crear', 'editar', 'eliminar', 'liquidar', 'ver_propio', 'declarar'],
  ayuda: ['consultar'],
} as const satisfies Record<string, readonly string[]>

export const CATALOGO_PERMISOS: typeof _CATALOGO & Record<string, readonly string[]> = _CATALOGO

export type ModuloPermiso = keyof typeof _CATALOGO

export type Permiso = {
  [M in ModuloPermiso]: `${M}.${(typeof _CATALOGO)[M][number]}`
}[ModuloPermiso]

/**
 * Helper tipado para consumidores que indexan con string (ej. scripts o e2e).
 */
export function accionesDelModulo(modulo: string): readonly string[] | undefined {
  if (Object.hasOwn(CATALOGO_PERMISOS, modulo)) {
    return CATALOGO_PERMISOS[modulo as ModuloPermiso]
  }
  return undefined
}

export const MODULO_NOMBRE: Record<string, string> = {
  inventario: 'Inventario',
  precios: 'Precios',
  ventas: 'Ventas',
  consignaciones: 'Consignaciones',
  rendiciones: 'Rendiciones',
  gastos: 'Gastos',
  reportes: 'Reportes',
  administracion: 'Administración',
  revendedoras: 'Revendedoras',
  ayuda: 'Ayuda',
}
