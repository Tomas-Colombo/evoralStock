import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { listClientes } from '@/lib/dal/clientes/cliente'
import { nombreCliente } from '@/lib/types/ventas'
import { listProductosSinCosto } from '@/lib/dal/inventario/producto'
import { NuevaReservaView } from './NuevaReservaView'

export default async function NuevaReservaPage() {
  const session = await verifySession()
  const [clientes, productos] = await Promise.all([
    listClientes({ soloActivos: true }),
    listProductosSinCosto({ soloActivos: true }),
  ])
  return (
    <>
      <Topbar title="Nueva reserva" session={session} backHref="/ventas/reservas" />
      <main className="flex-1 p-4 sm:p-6">
        <NuevaReservaView
          clientes={clientes.map((c) => ({
            id: c.id_cliente,
            nombre: nombreCliente(c),
            telefono: c.telefono,
          }))}
          productos={productos.filter((p) => p.stock_disponible > 0)}
        />
      </main>
    </>
  )
}
