import { Topbar } from '@/components/shell/Topbar'
import { Badge } from '@/components/ui/Badge'
import { verifySession } from '@/lib/dal/session'
import { listProveedores } from '@/lib/dal/inventario/proveedor'
import { waMeLink } from '@/lib/utils/waMeLink'
import { capacidades, tiposProveedorPermitidos } from '@/lib/modulos/capacidades'
import type { TipoProveedor } from '@/lib/types/inventario'
import { ProveedoresTableClient } from './ProveedoresTableClient'
import { NuevoProveedorModalButton } from './NuevoProveedorModalButton'
import { Card } from '@/components/ui/Card'

export default async function ProveedoresPage() {
  const session = await verifySession()
  const tipos = tiposProveedorPermitidos(capacidades(session.modulosHabilitados))
  const rows = await listProveedores()
  const enriched = rows.map((r) => ({ ...r, wa: waMeLink(r.telefono) }))

  return (
    <>
      <Topbar
        title="Proveedores"
        session={session}
        actions={<NuevoProveedorModalButton tiposPermitidos={tipos} />}
      />
      <main className="flex-1 p-4 sm:p-6">
        {rows.length === 0 ? (
          <EmptyStateWrapper tiposPermitidos={tipos} />
        ) : (
          <Card padding="none" className="overflow-x-auto">
            <ProveedoresTableClient rows={enriched} />
          </Card>
        )}
      </main>
    </>
  )
}

function EmptyStateWrapper({
  tiposPermitidos,
}: {
  tiposPermitidos: readonly TipoProveedor[]
}) {
  return (
    <Card padding="none" className="border-dashed p-10 text-center">
      <p className="font-display text-lg mb-2">Sin proveedores todavía</p>
      <p className="text-sm text-muted mb-4">
        Agregá el primer proveedor para poder registrar ingresos.
      </p>
      <NuevoProveedorModalButton tiposPermitidos={tiposPermitidos} />
    </Card>
  )
}

export function _renderBadge(activo: boolean) {
  return <Badge variant={activo ? 'success' : 'neutral'}>{activo ? 'Activo' : 'Inactivo'}</Badge>
}
