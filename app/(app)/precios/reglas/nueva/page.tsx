import { Topbar } from '@/components/shell/Topbar'
import { GuiaReglas } from '@/components/precios/GuiaReglas'
import { verifySession } from '@/lib/dal/session'
import { hasModuleAccess, hasPermission } from '@/lib/dal/guard'
import { listCategoriasActivas } from '@/lib/dal/inventario/categoria'
import { listProveedoresActivos } from '@/lib/dal/inventario/proveedor'
import { listProductosSinCosto } from '@/lib/dal/inventario/producto'
import { NuevaReglaView } from './NuevaReglaView'

export default async function NuevaReglaPage() {
  const session = await verifySession()
  const puedeVerMargenes = hasModuleAccess(session, 'precios', 'ver_margenes')
  const puedeVerCostos = hasModuleAccess(session, 'inventario', 'ver_costos')
  const puedeEditarPrecios = hasPermission(session, 'precios', 'editar')
  const puedeEliminarPrecios = hasPermission(session, 'precios', 'eliminar')
  const puedeAplicar = puedeEditarPrecios && puedeVerCostos && puedeVerMargenes
  const puedeDeshacer = puedeEliminarPrecios
  const [categorias, proveedores, productos] = await Promise.all([
    listCategoriasActivas(),
    listProveedoresActivos(),
    listProductosSinCosto({ soloActivos: true }),
  ])
  return (
    <>
      <Topbar title="Nueva regla de precio" session={session} backHref="/precios/reglas" />
      <main className="flex-1 space-y-4 p-4 sm:p-6">
        <details className="max-w-2xl rounded-lg border border-dashed border-border bg-card">
          <summary className="cursor-pointer list-none px-6 py-4 font-medium text-text marker:content-none hover:bg-card-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink">
            <span className="text-ink">¿Cómo funcionan las reglas de precios?</span>
            <span className="mt-1 block text-sm font-normal text-muted">
              Tipos de regla, cascada de especificidad, prioridad y un ejemplo paso a paso.
            </span>
          </summary>
          <div className="border-t border-border px-6 py-5">
            <GuiaReglas />
          </div>
        </details>

        <NuevaReglaView
          categorias={categorias.map((c) => ({ id: c.id_categoria, nombre: c.nombre }))}
          proveedores={proveedores.map((p) => ({ id: p.id_proveedor, nombre: p.nombre }))}
          productos={productos.map((p) => ({
            id: p.id_producto,
            nombre: p.nombre,
            sku: p.sku,
          }))}
          puedeVerMargenes={puedeVerMargenes}
          puedeAplicar={puedeAplicar}
          puedeDeshacer={puedeDeshacer}
          puedeVerCostos={puedeVerCostos}
        />
      </main>
    </>
  )
}
