import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { NuevoProveedorForm } from '@/components/inventario/NuevoProveedorForm'
import { Card } from '@/components/ui/Card'

export default async function NuevoProveedorPage() {
  const session = await verifySession()
  return (
    <>
      <Topbar title="Nuevo proveedor" session={session} backHref="/proveedores" />
      <main className="flex-1 p-4 sm:p-6">
        <Card padding="none" className="max-w-2xl p-6">
          <NuevoProveedorForm />
        </Card>
      </main>
    </>
  )
}
