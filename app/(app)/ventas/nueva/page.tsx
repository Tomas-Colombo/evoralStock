import { Topbar } from '@/components/shell/Topbar'
import { verifySession } from '@/lib/dal/session'
import { listClientes } from '@/lib/dal/clientes/cliente'
import {
  getReservaConDetalle,
  listReservas,
  listReservasActivasPorProducto,
} from '@/lib/dal/reservas/reserva'
import { listProductosSinCosto } from '@/lib/dal/inventario/producto'
import { listCuentasDestino } from '@/lib/dal/ventas/cuenta-destino'
import { listArancelesCobro } from '@/lib/dal/ventas/arancel'
import { hasModuleAccess } from '@/lib/dal/guard'
import { listarRevendedoras, listReglasComision } from '@/lib/dal/revendedoras'
import { listPlanesCuotas } from '@/lib/dal/precios/cuotas'
import { listRecargosCuotas } from '@/lib/dal/precios/recargo'
import { nombreCliente } from '@/lib/types/ventas'
import { NuevaVentaView, type PrecargaReserva } from './NuevaVentaView'

export default async function NuevaVentaPage(props: {
  searchParams: Promise<{ reserva?: string }>
}) {
  const session = await verifySession()
  const searchParams = await props.searchParams
  const idReserva = searchParams.reserva ?? null

  const puedeRevendedoras = hasModuleAccess(session, 'revendedoras', 'ver')

  const [
    clientes,
    reservasActivas,
    productos,
    cuentas,
    reservasPorProducto,
    planesCuotas,
    aranceles,
    recargos,
    revendedorasRaw,
    reglasComision,
  ] = await Promise.all([
    listClientes({ soloActivos: true }),
    listReservas({ estado: 'activa' }),
    listProductosSinCosto({ soloActivos: true }),
    listCuentasDestino({ soloActivas: true }),
    listReservasActivasPorProducto(),
    listPlanesCuotas({ soloActivos: true }),
    listArancelesCobro(),
    listRecargosCuotas(),
    puedeRevendedoras ? listarRevendedoras(session) : Promise.resolve([]),
    puedeRevendedoras ? listReglasComision('revendedora') : Promise.resolve([]),
  ])

  const revendedoras = revendedorasRaw
    .filter((r) => r.activo)
    .map((r) => ({
      id: r.id_revendedora,
      nombre: `${r.nombre} ${r.apellido}`.trim(),
    }))

  // Acceso directo desde Reservas: la venta arranca con TODO lo que tenía la
  // reserva (ítems, cliente, observaciones). Sólo los QR viajan al cliente —
  // el precio de cada línea lo resuelve el lookup como en cualquier carga,
  // porque el snapshot de la reserva puede haber quedado viejo.
  let precarga: PrecargaReserva | null = null
  if (idReserva) {
    const reserva = await getReservaConDetalle(idReserva)
    if (reserva && reserva.estado_reserva === 'activa') {
      precarga = {
        idReserva: reserva.id_reserva,
        idCliente: reserva.cliente?.id_cliente ?? null,
        clienteNombre: reserva.cliente ? nombreCliente(reserva.cliente) : null,
        observaciones: reserva.observaciones,
        qrs: reserva.lineas
          .filter((l) => l.estado === 'activa' && l.item?.estado_item === 'disponible')
          .map((l) => l.item!.qr_code),
      }
    }
  }

  return (
    <>
      <Topbar title="Nueva venta" session={session} backHref="/ventas" />
      <main className="flex-1 p-4 sm:p-6">
        <NuevaVentaView
          clientes={clientes.map((c) => ({
            id: c.id_cliente,
            nombre: nombreCliente(c),
            telefono: c.telefono,
          }))}
          reservasActivas={reservasActivas.map((r) => ({
            id: r.id_reserva,
            fecha: r.fecha,
            fecha_vencimiento: r.fecha_vencimiento,
            cliente_nombre: r.cliente ? nombreCliente(r.cliente) : null,
            items_count: r.items_count,
          }))}
          productos={productos.filter((p) => p.stock_disponible > 0)}
          reservasPorProducto={reservasPorProducto}
          cuentas={cuentas}
          planesCuotas={planesCuotas}
          aranceles={aranceles}
          recargos={recargos}
          precargaReserva={precarga}
          puedeRevendedoras={puedeRevendedoras}
          revendedoras={revendedoras}
          reglasComision={reglasComision}
        />
      </main>
    </>
  )
}
