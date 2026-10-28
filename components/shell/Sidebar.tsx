import type { Session } from '@/lib/dal/session'
import { hasModuleAccess } from '@/lib/dal/guard'
import { SidebarClient, type SidebarNavItem } from './SidebarClient'

/**
 * Left sidebar (dark in both themes, per REQ-DS-07).
 *
 * Server component: computes which modules the role can at least `ver` and
 * hands the filtered list to the client `SidebarClient` (collapse UI +
 * logout). Permission filtering MUST stay here — `hasPermission` comes from
 * the guard, which imports `next/headers`; importing it into a client
 * component would poison the client bundle. Route protection still lives in
 * each route's `layout.tsx` via `requireModuleRole()`.
 */

interface NavItem extends SidebarNavItem {
  moduloCodigo: string
  /** Section heading this item sits under in the rail (design system v2). */
  group: NavGroup
}

type NavGroup = 'OPERACIONES' | 'FINANZAS' | 'SISTEMA'

// Heading order in the rail. Groups whose items are all access-filtered
// away are dropped entirely — a lone heading with nothing under it is noise.
const GROUP_ORDER: readonly NavGroup[] = ['OPERACIONES', 'FINANZAS', 'SISTEMA'] as const

// Módulo codes MUST match seed.sql `modulo.codigo` values verbatim.
// See supabase/seed.sql — catalog is: inventario, ventas, precios,
// consignaciones, rendiciones, gastos, reportes, administracion.
const NAV_ITEMS: readonly NavItem[] = [
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

export function Sidebar({ session }: { session: Session }) {
  // `hasModuleAccess`, not `hasPermission`: checking only the role let a
  // module disabled in `tenant_modulo` stay in the rail, and its layout then
  // bounced the user with `module-disabled`.
  const visible = NAV_ITEMS.filter((item) =>
    hasModuleAccess(session, item.moduloCodigo, 'ver'),
  )

  const groups = GROUP_ORDER.map((label) => ({
    label,
    items: visible
      .filter((item) => item.group === label)
      .map(({ href, label: itemLabel, icon }): SidebarNavItem => ({ href, label: itemLabel, icon })),
  })).filter((group) => group.items.length > 0)

  return (
    <SidebarClient
      groups={groups}
      email={session.user.email}
      rolNombre={session.rolNombre}
      marca={session.marca}
    />
  )
}
