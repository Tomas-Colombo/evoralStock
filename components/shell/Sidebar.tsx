import type { Session } from '@/lib/dal/session'
import { GROUP_ORDER, itemsPermitidos } from '@/lib/modulos/rutas'
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
export function Sidebar({ session }: { session: Session }) {
  // `hasModuleAccess`, not `hasPermission`: checking only the role let a
  // module disabled in `tenant_modulo` stay in the rail, and its layout then
  // bounced the user with `module-disabled`.
  const visible = itemsPermitidos(session)

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
