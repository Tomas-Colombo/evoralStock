import {
  MODULOS_NUCLEO,
  PAQUETES_OPCIONALES,
  type PaqueteOpcional,
} from './catalogo'
import {
  TIPOS_INGRESO,
  TIPOS_PROVEEDOR,
  type TipoIngreso,
  type TipoProveedor,
} from '@/lib/types/inventario'

export type Capacidades = Record<PaqueteOpcional, boolean>

/**
 * Traduce los códigos de módulos habilitados de un tenant a sus capacidades funcionales.
 * Un paquete está activo únicamente si están TODOS sus códigos de PAQUETES_OPCIONALES.
 * Lógica pura sin imports de servidor (REQ-MODOP-04).
 */
export function capacidades(modulosHabilitados: readonly string[]): Capacidades {
  const set = new Set(modulosHabilitados)
  const result = {} as Capacidades
  for (const [paquete, codigos] of Object.entries(PAQUETES_OPCIONALES)) {
    result[paquete as PaqueteOpcional] = (codigos as readonly string[]).every((c) => set.has(c))
  }
  return result
}

/**
 * Tipos de ingreso de mercadería permitidos según las capacidades del tenant.
 * Derivado de TIPOS_INGRESO: 'consignacion' solo se ofrece si cap.consignacionProveedor.
 */
export function tiposIngresoPermitidos(cap: Capacidades): [TipoIngreso, ...TipoIngreso[]] {
  const permitidos = TIPOS_INGRESO.filter(
    (t) => t !== 'consignacion' || cap.consignacionProveedor,
  )
  return permitidos as [TipoIngreso, ...TipoIngreso[]]
}

/**
 * Tipos de proveedor permitidos según las capacidades del tenant.
 * Derivado de TIPOS_PROVEEDOR: 'consignatario' solo se ofrece si cap.consignacionProveedor.
 */
export function tiposProveedorPermitidos(cap: Capacidades): [TipoProveedor, ...TipoProveedor[]] {
  const permitidos = TIPOS_PROVEEDOR.filter(
    (t) => t !== 'consignatario' || cap.consignacionProveedor,
  )
  return permitidos as [TipoProveedor, ...TipoProveedor[]]
}

/**
 * Códigos de módulos visibles en el editor de permisos:
 * módulos del núcleo + códigos de los paquetes opcionales activos.
 */
export function modulosDePermisoVisibles(cap: Capacidades): string[] {
  const modulos: string[] = [...MODULOS_NUCLEO]
  for (const [paquete, codigos] of Object.entries(PAQUETES_OPCIONALES)) {
    if (cap[paquete as PaqueteOpcional]) {
      modulos.push(...codigos)
    }
  }
  return modulos
}
