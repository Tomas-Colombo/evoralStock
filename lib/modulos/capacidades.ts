import {
  MODULOS_NUCLEO,
  PAQUETES_OPCIONALES,
  type PaqueteOpcional,
} from './catalogo'
import type { TipoIngreso, TipoProveedor } from '@/lib/types/inventario'

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
 * Sin consignacionProveedor, solo se permite 'compra'.
 */
export function tiposIngresoPermitidos(cap: Capacidades): [TipoIngreso, ...TipoIngreso[]] {
  return cap.consignacionProveedor
    ? ['compra', 'consignacion']
    : ['compra']
}

/**
 * Tipos de proveedor permitidos según las capacidades del tenant.
 * Sin consignacionProveedor, solo 'mayorista' y 'particular'.
 */
export function tiposProveedorPermitidos(cap: Capacidades): [TipoProveedor, ...TipoProveedor[]] {
  return cap.consignacionProveedor
    ? ['mayorista', 'particular', 'consignatario']
    : ['mayorista', 'particular']
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
