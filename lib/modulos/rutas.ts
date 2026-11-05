import type { Session } from '@/lib/dal/session'
import { hasModuleAccess } from '@/lib/dal/guard'

export interface SidebarNavItem {
  href: string
  label: string
  icon: string
}

export type NavGroup = 'OPERACIONES' | 'FINANZAS' | 'SISTEMA'

export interface NavItem extends SidebarNavItem {
  moduloCodigo: string
  /** Section heading this item sits under in the rail (design system v2). */
  group: NavGroup
}

// Heading order in the rail. Groups whose items are all access-filtered
// away are dropped entirely — a lone heading with nothing under it is noise.
export const GROUP_ORDER: readonly NavGroup[] = ['OPERACIONES', 'FINANZAS', 'SISTEMA'] as const

// Módulo codes MUST match seed.sql `modulo.codigo` values verbatim.
// See supabase/seed.sql — catalog is: inventario, ventas, precios,
// consignaciones, rendiciones, gastos, reportes, administracion.
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/ventas', label: 'Ventas', icon: 'ventas', moduloCodigo: 'ventas', group: 'OPERACIONES' },
  { href: '/inventario', label: 'Inventario', icon: 'inventario', moduloCodigo: 'inventario', group: 'OPERACIONES' },
  // Ingresos vive bajo el módulo 'inventario' (mismo permiso) — es sub-módulo
  // funcional: historial de ingresos + alta de un ingreso nuevo.
  { href: '/inventario/ingresos', label: 'Ingresos', icon: 'ingresos', moduloCodigo: 'inventario', group: 'OPERACIONES' },
  { href: '/precios', label: 'Precios y Cuentas', icon: 'precios', moduloCodigo: 'precios', group: 'OPERACIONES' },
  // Clientes vive bajo el módulo 'ventas' (mismo permiso) — es sub-módulo funcional.
  { href: '/clientes', label: 'Clientes', icon: 'clientes', moduloCodigo: 'ventas', group: 'OPERACIONES' },
  // Cuotas va pegado a Clientes a propósito: la deuda se mira por cliente, y
  // el salto entre las dos pantallas es constante. Mismo permiso que ventas.
  { href: '/cuotas', label: 'Cuotas', icon: 'cuotas', moduloCodigo: 'ventas', group: 'OPERACIONES' },
  // Proveedores vive bajo el módulo 'inventario' (mismo permiso) — es sub-módulo funcional.
  { href: '/proveedores', label: 'Proveedores', icon: 'proveedores', moduloCodigo: 'inventario', group: 'OPERACIONES' },
  { href: '/revendedoras', label: 'Revendedoras', icon: 'revendedoras', moduloCodigo: 'revendedoras', group: 'OPERACIONES' },
  // Módulo `consignaciones` en DB, pero UI-visible como "Devoluciones a
  // proveedor" — es lo que la sección hace (lote de devolución). Label
  // abreviado para que entre en el rail sin truncar.
  { href: '/consignaciones', label: 'Devoluciones prov.', icon: 'consignaciones', moduloCodigo: 'consignaciones', group: 'OPERACIONES' },
  { href: '/gastos', label: 'Gastos', icon: 'gastos', moduloCodigo: 'gastos', group: 'FINANZAS' },
  { href: '/rendiciones', label: 'Rendiciones', icon: 'rendiciones', moduloCodigo: 'rendiciones', group: 'FINANZAS' },
  { href: '/reportes', label: 'Reportes', icon: 'reportes', moduloCodigo: 'reportes', group: 'FINANZAS' },
  { href: '/administracion', label: 'Administración', icon: 'administracion', moduloCodigo: 'administracion', group: 'SISTEMA' },
] as const

/**
 * Retorna todos los ítems de navegación a los que la sesión tiene acceso de lectura ('ver').
 * Si la sesión no tiene rol asignado (`session.rolId` nulo), retorna un array vacío.
 */
export function itemsPermitidos(session: Session): NavItem[] {
  if (!session.rolId) return []
  return NAV_ITEMS.filter((item) => hasModuleAccess(session, item.moduloCodigo, 'ver'))
}

/**
 * Determina la primera ruta permitida para la sesión según el orden
 * de navegación del Sidebar. Retorna el href correspondiente o null
 * si el usuario no tiene acceso a ningún módulo.
 */
export function primeraRutaPermitida(session: Session): string | null {
  return itemsPermitidos(session)[0]?.href ?? null
}
