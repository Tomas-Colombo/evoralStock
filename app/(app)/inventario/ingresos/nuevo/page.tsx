import { Topbar } from '@/components/shell/Topbar'
import { hasModuleAccess } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { listProveedoresActivos } from '@/lib/dal/inventario/proveedor'
import { listCategoriasActivas } from '@/lib/dal/inventario/categoria'
import { getProducto, listProductosConDetalle, listProductosSinCosto } from '@/lib/dal/inventario/producto'
import { getUltimoContextoIngresoProducto } from '@/lib/dal/inventario/item'
import { leerCotizacionVigente } from '@/lib/dal/precios/cotizacion'
import { capacidades, tiposIngresoPermitidos, tiposProveedorPermitidos } from '@/lib/modulos/capacidades'
import type { TipoIngreso } from '@/lib/types/inventario'
import { NuevoIngresoView } from './NuevoIngresoView'
import { safeBackHref } from '@/lib/utils/safeBackHref'

export default async function NuevoIngresoPage(props: {
  searchParams: Promise<{ producto?: string; from?: string }>
}) {
  const session = await verifySession()
  const puedeCargarCostos = hasModuleAccess(session, 'inventario', 'cargar_costos')
  const cap = capacidades(session.modulosHabilitados)
  const tiposIngreso = tiposIngresoPermitidos(cap)
  const tiposProveedor = tiposProveedorPermitidos(cap)
  const { producto: idProductoParam, from } = await props.searchParams

  // Todo se carga en una sola pantalla: proveedores para la cabecera y
  // productos/categorías para la carga de líneas (PDF o a mano). El ingreso
  // puede ser «sin proveedor», y el proveedor se crea inline desde el form.
  const [proveedores, productos, categorias, cotizacion] = await Promise.all([
    listProveedoresActivos(),
    puedeCargarCostos
      ? listProductosConDetalle({ soloActivos: true })
      : listProductosSinCosto({ soloActivos: true }),
    listCategoriasActivas(),
    leerCotizacionVigente().catch(() => null),
  ])

  // Modo restock: si viene ?producto=<id>, prefiliamos la línea con ese
  // producto vinculado y bloqueamos el proveedor (mono-proveedor por producto).
  // Arrastramos proveedor y tipo del último ingreso siempre (el proveedor fijo
  // sostiene el mono-proveedor por producto); el costo solo si puedeCargarCostos.
  let prefill: {
    idProducto: string
    idProveedor: string | null
    tipoIngreso: TipoIngreso
    costoUnitario: number | null
  } | null = null
  if (idProductoParam) {
    const [prod, ultimo] = await Promise.all([
      getProducto(idProductoParam),
      getUltimoContextoIngresoProducto(idProductoParam),
    ])
    if (prod) {
      const tipoPrefill = ultimo?.tipoIngreso && tiposIngreso.includes(ultimo.tipoIngreso)
        ? ultimo.tipoIngreso
        : tiposIngreso[0]

      prefill = {
        idProducto: prod.id_producto,
        idProveedor: ultimo?.proveedor?.id_proveedor ?? null,
        tipoIngreso: tipoPrefill,
        costoUnitario: puedeCargarCostos ? (ultimo?.costoUnitario ?? null) : null,
      }
    }
  }

  return (
    <>
      <Topbar
        title={prefill ? 'Restock de producto' : 'Nuevo ingreso'}
        session={session}
        backHref={safeBackHref(from, '/inventario')}
      />
      <main className="flex-1 p-4 sm:p-6">
        <NuevoIngresoView
          proveedores={proveedores}
          productos={productos}
          categorias={categorias}
          prefill={prefill}
          tiposIngreso={tiposIngreso}
          tiposProveedor={tiposProveedor}
          cotizacion={cotizacion}
          puedeCargarCostos={puedeCargarCostos}
        />
      </main>
    </>
  )
}
