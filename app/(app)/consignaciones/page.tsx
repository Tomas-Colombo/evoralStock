import Link from 'next/link'
import { BandAction } from '@/components/shell/BandAction'
import { Topbar } from '@/components/shell/Topbar'
import { hasPermission } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import { listConsignaciones } from '@/lib/dal/consignaciones/consignacion'
import { listProveedoresActivos } from '@/lib/dal/inventario/proveedor'
import {
  esFechaValida,
  inicioDelDia,
  inicioDelDiaSiguiente,
  anioActual,
} from '@/lib/fechas'
import { type EstadoConsignacion } from '@/lib/types/consignaciones'
import { FiltroPeriodo } from '@/components/shell/FiltroPeriodo'
import { ConsignacionesTableClient } from './ConsignacionesTableClient'
import { Card } from '@/components/ui/Card'

function esEstado(v: string | undefined): v is EstadoConsignacion {
  return v === 'activa' || v === 'cerrada'
}

/**
 * Listado de devoluciones a proveedor.
 *
 * Los tres filtros (período, proveedor, estado) viven en la URL y se aplican
 * en la QUERY, no en el render: las métricas de arriba se calculan sobre el
 * mismo recorte que la tabla de abajo. Sin params el período por defecto es el
 * año en curso — una devolución es un evento poco frecuente, un default de
 * "este mes" mostraría vacío la mayoría de los días.
 */
export default async function ConsignacionesPage(props: {
  searchParams: Promise<{
    desde?: string
    hasta?: string
    proveedor?: string
    estado?: string
  }>
}) {
  const session = await verifySession()
  const sp = await props.searchParams

  // Params inválidos o incompletos → año en curso. Nunca reventar por una URL
  // tipeada a mano.
  const porDefecto = anioActual()
  const desde = esFechaValida(sp.desde) ? sp.desde : porDefecto.desde
  const hastaCrudo = esFechaValida(sp.hasta) ? sp.hasta : porDefecto.hasta
  const hasta = hastaCrudo < desde ? desde : hastaCrudo
  const estado = esEstado(sp.estado) ? sp.estado : undefined
  const idProveedor = sp.proveedor || undefined

  const [rows, proveedores] = await Promise.all([
    listConsignaciones({
      estado,
      idProveedor,
      desde: inicioDelDia(desde),
      hastaExclusivo: inicioDelDiaSiguiente(hasta),
    }),
    listProveedoresActivos(),
  ])

  const activas = rows.filter((r) => r.estado === 'activa').length
  const pendientesTotales = rows.reduce((a, r) => a + r.pendientes, 0)
  const devueltosTotales = rows.reduce((a, r) => a + r.devueltos, 0)

  const hayFiltroExtra = Boolean(estado || idProveedor)

  // URL del listado CON los filtros puestos: los detalles a los que salta la
  // tabla la reciben en `?from=` y el botón volver devuelve a esta misma vista.
  const volverHref = (() => {
    const qs = new URLSearchParams({ desde, hasta })
    if (idProveedor) qs.set('proveedor', idProveedor)
    if (estado) qs.set('estado', estado)
    return `/consignaciones?${qs.toString()}`
  })()

  return (
    <>
      <Topbar
        title="Devoluciones a proveedor"
        session={session}
        filters={
          <FiltroPeriodo
            ariaLabel="Filtrar devoluciones"
            idPrefix="cons"
            desde={desde}
            hasta={hasta}
            extras={[
              {
                param: 'proveedor',
                label: 'Proveedor',
                value: idProveedor ?? '',
                ancho: 'w-52',
                options: [
                  { value: '', label: 'Todos' },
                  ...proveedores.map((p) => ({ value: p.id_proveedor, label: p.nombre })),
                ],
              },
              {
                param: 'estado',
                label: 'Estado',
                value: estado ?? '',
                options: [
                  { value: '', label: 'Todos' },
                  { value: 'activa', label: 'Activa' },
                  { value: 'cerrada', label: 'Cerrada' },
                ],
              },
            ]}
          />
        }
        kpis={[
          { label: 'Lotes en el filtro', value: rows.length.toString() },
          { label: 'Activos', value: activas.toString() },
          { label: 'Ítems pendientes', value: pendientesTotales.toString(), tone: pendientesTotales > 0 ? 'warn' : 'default' },
          { label: 'Ítems devueltos', value: devueltosTotales.toString() },
        ]}
        actions={
          <BandAction
            href="/consignaciones/nueva"
            tone="primary"
            title="Nueva devolución"
            description="Devolver mercadería a un proveedor."
          />
        }
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6">

        {rows.length === 0 ? (
          <Card padding="none" className="border-dashed p-10 text-center">
            <p className="font-display text-lg mb-2">
              {hayFiltroExtra || sp.desde || sp.hasta
                ? 'Sin devoluciones con estos filtros'
                : 'Sin consignaciones'}
            </p>
            <p className="text-sm text-muted mb-4">
              {hayFiltroExtra || sp.desde || sp.hasta
                ? 'Probá ampliar el período o quitar el filtro de proveedor o estado.'
                : 'Cuando decidís devolver mercadería a un proveedor, creá un lote de consignación.'}
            </p>
            <Link
              href="/consignaciones/nueva"
              className="inline-flex items-center rounded-md bg-block px-4 py-2 text-sm font-semibold text-block-ink"
            >
              Nueva devolución
            </Link>
          </Card>
        ) : (
          <ConsignacionesTableClient
            rows={rows}
            puedeEliminar={hasPermission(session, 'consignaciones', 'eliminar')}
            volverHref={volverHref}
          />
        )}
      </main>
    </>
  )
}
