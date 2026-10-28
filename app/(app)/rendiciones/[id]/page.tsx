import { notFound } from 'next/navigation'
import { Topbar } from '@/components/shell/Topbar'
import { Badge } from '@/components/ui/Badge'
import { verifySession } from '@/lib/dal/session'
import { getRendicionConDetalle } from '@/lib/dal/rendiciones/rendicion'
import {
  ESTADO_RENDICION_LABEL,
  ESTADO_RENDICION_VARIANT,
} from '@/lib/types/rendiciones'
import { RendicionActions } from './RendicionActions'
import { TableFrame, DataTable, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/TableParts'
import { Card } from '@/components/ui/Card'
import { safeBackHref } from '@/lib/utils/safeBackHref'

export default async function RendicionDetallePage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const session = await verifySession()
  const { id } = await props.params
  const { from } = await props.searchParams
  const rendicion = await getRendicionConDetalle(id)
  if (!rendicion) notFound()

  const total = Number(rendicion.monto_total)

  return (
    <>
      <Topbar
        title={`Rendición ${new Date(rendicion.fecha_generacion).toLocaleDateString('es-AR')}`}
        session={session}
        backHref={safeBackHref(from, '/rendiciones')}
        actions={
          <Badge variant={ESTADO_RENDICION_VARIANT[rendicion.estado]}>
            {ESTADO_RENDICION_LABEL[rendicion.estado]}
          </Badge>
        }
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6">
        <Card className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <div className="text-xs uppercase font-mono text-muted">Proveedor</div>
            <div className="mt-1">{rendicion.proveedor?.nombre ?? '—'}</div>
            {rendicion.proveedor?.telefono && (
              <div className="text-xs text-muted">{rendicion.proveedor.telefono}</div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase font-mono text-muted">Período incluido</div>
            <div className="mt-1 text-xs">
              {rendicion.periodo_desde ? new Date(rendicion.periodo_desde).toLocaleDateString('es-AR') : '—'}{' '}
              →{' '}
              {rendicion.periodo_hasta ? new Date(rendicion.periodo_hasta).toLocaleDateString('es-AR') : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase font-mono text-muted">Total</div>
            <div className="mt-1 font-mono font-semibold text-lg">
              $ {total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-muted">{rendicion.cantidad_lineas} líneas</div>
          </div>
          <div className="flex items-end justify-end">
            {rendicion.estado === 'pendiente' && (
              <RendicionActions idRendicion={rendicion.id_rendicion} />
            )}
            {rendicion.estado === 'pagada' && rendicion.fecha_pago && (
              <div className="text-xs text-muted">
                Pagada el {new Date(rendicion.fecha_pago).toLocaleDateString('es-AR')}
              </div>
            )}
          </div>
        </Card>

        <TableFrame>
          <div className="border-b border-border px-4 py-3">
            <h3 className="font-display text-lg">Líneas rendidas</h3>
          </div>
          <DataTable>
            <THead>
              <Th>Fecha venta</Th>
              <Th>Producto</Th>
              <Th>QR</Th>
              <Th>Cliente</Th>
              <Th align="right">Precio venta</Th>
              <Th align="right">Monto proveedor</Th>
            </THead>
            <TBody>
              {rendicion.lineas.map((l) => (
                <Tr key={l.id_detalle_venta}>
                  <Td>
                    {new Date(l.fecha).toLocaleDateString('es-AR')}
                  </Td>
                  <Td>
                    <div className="font-medium">{l.producto_nombre}</div>
                    {l.producto_sku && (
                      <div className="text-xs font-mono text-muted">{l.producto_sku}</div>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{l.qr_code}</Td>
                  <Td className="text-xs">
                    {l.cliente_nombre ?? <span className="text-muted">Mostrador</span>}
                  </Td>
                  <Td align="right" className="font-mono text-muted">
                    $ {Number(l.precio_venta).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </Td>
                  <Td align="right" className="font-mono">
                    $ {Number(l.monto_proveedor).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </Td>
                </Tr>
              ))}
            </TBody>
            <TFoot>
              <Tr className="border-t bg-card-2">
                <Td colSpan={5} className="font-semibold">Total</Td>
                <Td align="right" className="font-mono font-semibold">
                  $ {total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </Td>
              </Tr>
            </TFoot>
          </DataTable>
        </TableFrame>

        {rendicion.observaciones && (
          <div className="rounded-lg border border-border bg-card-2 p-4 text-sm">
            <div className="text-xs uppercase font-mono text-muted mb-1">Observaciones</div>
            <div>{rendicion.observaciones}</div>
          </div>
        )}
      </main>
    </>
  )
}
