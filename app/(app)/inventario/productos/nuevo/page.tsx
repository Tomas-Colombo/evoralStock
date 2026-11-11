import { redirect } from 'next/navigation'
import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { hasModuleAccess } from '@/lib/dal/guard'
import { listCategoriasActivas } from '@/lib/dal/inventario/categoria'
import { listProductosSinCosto } from '@/lib/dal/inventario/producto'
import { listProveedoresActivos } from '@/lib/dal/inventario/proveedor'
import { leerCotizacionVigente } from '@/lib/dal/precios/cotizacion'
import { NuevoProductoForm } from './NuevoProductoForm'
import { Card } from '@/components/ui/Card'

export default async function NuevoProductoPage() {
  const session = await verifySession()
  const puedeCargarCostos = hasModuleAccess(session, 'inventario', 'cargar_costos')
  const [categorias, productos, proveedores, cotizacion] = await Promise.all([
    listCategoriasActivas(),
    listProductosSinCosto(),
    listProveedoresActivos(),
    leerCotizacionVigente().catch(() => null),
  ])
  if (categorias.length === 0) {
    // Sin categorías no se puede crear producto; mandamos a categorías.
    redirect('/inventario/categorias?e=needs-categoria')
  }
  return (
    <>
      <Topbar title="Nuevo producto" session={session} backHref="/inventario" />
      <main className="flex-1 p-4 sm:p-6">
        <Card padding="none" className="max-w-2xl p-6">
          <NuevoProductoForm
            categorias={categorias}
            productos={productos}
            proveedores={proveedores}
            cotizacion={cotizacion}
            puedeCargarCostos={puedeCargarCostos}
          />
        </Card>
      </main>
    </>
  )
}
