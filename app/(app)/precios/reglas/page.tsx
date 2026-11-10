import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { listReglasPrecio } from '@/lib/dal/precios/regla'
import { listPlanesCuotas } from '@/lib/dal/precios/cuotas'
import { listCategoriasActivas } from '@/lib/dal/inventario/categoria'
import { listProveedoresActivos } from '@/lib/dal/inventario/proveedor'
import { listProductosSinCosto } from '@/lib/dal/inventario/producto'
import { ReglasView } from './ReglasView'
import { NuevaReglaModalButton } from './NuevaReglaModalButton'

export default async function ReglasPage() {
  const session = await verifySession()
  const [rows, planesCuotas, categorias, proveedores, productos] = await Promise.all([
    listReglasPrecio({ incluirBaja: false }),
    listPlanesCuotas(),
    listCategoriasActivas(),
    listProveedoresActivos(),
    listProductosSinCosto({ soloActivos: true }),
  ])

  return (
    <>
      <Topbar
        title="Reglas de precios"
        session={session}
        backHref="/precios"
        actions={
          <NuevaReglaModalButton
            categorias={categorias.map((c) => ({ id: c.id_categoria, nombre: c.nombre }))}
            proveedores={proveedores.map((p) => ({ id: p.id_proveedor, nombre: p.nombre }))}
            productos={productos.map((p) => ({
              id: p.id_producto,
              nombre: p.nombre,
              sku: p.sku,
            }))}
          />
        }
      />
      <main className="flex-1 p-4 sm:p-6">
        <ReglasView initial={rows} planesCuotas={planesCuotas} />
      </main>
    </>
  )
}
