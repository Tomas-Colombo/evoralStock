import Link from 'next/link'
import { BandAction } from '@/components/shell/BandAction'
import { Topbar } from '@/components/shell/Topbar'
import { Badge } from '@/components/ui/Badge'
import { verifySession } from '@/lib/dal/session'
import { listRendiciones } from '@/lib/dal/rendiciones/rendicion'
import {
  ESTADO_RENDICION_LABEL,
  ESTADO_RENDICION_VARIANT,
} from '@/lib/types/rendiciones'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Card } from '@/components/ui/Card'

export default async function RendicionesPage() {
  const session = await verifySession()
  const rows = await listRendiciones()
  const pendientes = rows.filter((r) => r.estado === 'pendiente')
  const totalPendiente = pendientes.reduce((a, r) => a + Number(r.monto_total), 0)

  return (
    <>
      <Topbar
        title="Rendiciones"
        session={session}
        kpis={[
          { label: 'Total', value: rows.length.toString() },
          { label: 'Pendientes de pago', value: pendientes.length.toString(), tone: pendientes.length > 0 ? 'warn' : 'default' },
          { label: 'Monto adeudado', value: `$ ${totalPendiente.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`, tone: totalPendiente > 0 ? 'warn' : 'default' },
          { label: 'Pagadas', value: (rows.length - pendientes.length).toString() },
        ]}
        actions={
          <BandAction
            href="/rendiciones/nueva"
            tone="primary"
            title="Generar rendición"
            description="Armar la rendición de un proveedor."
          />
        }
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6">

        {rows.length === 0 ? (
          <Card padding="none" className="border-dashed p-10 text-center">
            <p className="font-display text-lg mb-2">Sin rendiciones generadas</p>
            <p className="text-sm text-muted mb-4">
              Elegí un proveedor y previsualizá las ventas pendientes antes de saldar.
            </p>
            <Link
              href="/rendiciones/nueva"
              className="inline-flex items-center rounded-md bg-block px-4 py-2 text-sm font-semibold text-block-ink"
            >
              Generar rendición
            </Link>
          </Card>
        ) : (
          <TableFrame>
            <DataTable>
              <THead>
                <Th>Fecha</Th>
                <Th>Proveedor</Th>
                <Th>Período</Th>
                <Th align="right">Líneas</Th>
                <Th align="right">Total</Th>
                <Th>Estado</Th>
                <Th></Th>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <Tr key={r.id_rendicion}>
                    <Td>
                      {new Date(r.fecha_generacion).toLocaleDateString('es-AR')}
                    </Td>
                    <Td>{r.proveedor?.nombre ?? '—'}</Td>
                    <Td className="text-xs text-muted">
                      {r.periodo_desde
                        ? new Date(r.periodo_desde).toLocaleDateString('es-AR')
                        : '—'}{' '}
                      →{' '}
                      {r.periodo_hasta
                        ? new Date(r.periodo_hasta).toLocaleDateString('es-AR')
                        : '—'}
                    </Td>
                    <Td align="right" className="font-mono">{r.cantidad_lineas}</Td>
                    <Td align="right" className="font-mono font-semibold">
                      $ {Number(r.monto_total).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    </Td>
                    <Td>
                      <Badge variant={ESTADO_RENDICION_VARIANT[r.estado]}>{ESTADO_RENDICION_LABEL[r.estado]}</Badge>
                      {r.fecha_pago && (
                        <div className="text-xs text-muted mt-1">
                          {new Date(r.fecha_pago).toLocaleDateString('es-AR')}
                        </div>
                      )}
                    </Td>
                    <Td align="right">
                      <Link
                        href={`/rendiciones/${r.id_rendicion}`}
                        className="-mx-2 rounded-[4px] px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      >
                        Ver
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          </TableFrame>
        )}
      </main>
    </>
  )
}

