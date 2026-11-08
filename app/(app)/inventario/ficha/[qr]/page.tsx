import Link from 'next/link'
import { Topbar } from '@/components/shell/Topbar'
import { Badge } from '@/components/ui/Badge'
import { AjusteInventarioAction } from './AjusteInventarioAction'
import { QrDisplay } from '@/components/inventario/QrDisplay'
import { verifySession } from '@/lib/dal/session'
import { findItemByQr, getItemConDetalle } from '@/lib/dal/inventario/item'
import { ESTADO_ITEM_LABEL, ESTADO_ITEM_VARIANT } from '@/lib/types/inventario'
import { EscanearOtro } from './EscanearOtro'
import { FichaActions } from './FichaActions'
import { hasModuleAccess } from '@/lib/dal/guard'
import { quienTieneItem } from '@/lib/dal/revendedoras'
import { Card } from '@/components/ui/Card'

export default async function FichaItemPage(props: {
  params: Promise<{ qr: string }>
}) {
  const session = await verifySession()
  const { qr } = await props.params
  const decoded = decodeURIComponent(qr)

  const base = await findItemByQr(decoded)

  if (!base) {
    return (
      <>
        <Topbar title="Ítem no encontrado" session={session} backHref="/inventario/ficha" />
        <main className="flex-1 p-4 sm:p-6">
          <Card padding="none" className="mx-auto max-w-md p-6 text-center">
            <p className="font-display text-lg mb-2">QR no reconocido</p>
            <p className="text-sm text-muted mb-4">
              No existe un ítem con el código <span className="font-mono">{decoded}</span> en
              este tenant.
            </p>
            <Link
              href="/inventario/ficha"
              className="inline-flex items-center rounded-md bg-block px-4 py-2 text-sm font-semibold text-block-ink"
            >
              Volver a escanear
            </Link>
          </Card>
        </main>
      </>
    )
  }

  const detalle = await getItemConDetalle(base.id_item)
  if (!detalle) return null // RLS could hide between calls

  const puedeVerRevendedoras = hasModuleAccess(session, 'revendedoras', 'ver')
  const quienTieneRes = puedeVerRevendedoras ? await quienTieneItem(decoded) : null
  const enPoderDe = quienTieneRes?.ok ? quienTieneRes.data : null
  const puedeImprimirEtiqueta =
    detalle.estado_item === 'disponible' || detalle.estado_item === 'reservado'

  return (
    <>
      <Topbar title="Ficha de ítem" session={session} backHref="/inventario/ficha" />
      <main className="flex-1 p-4 sm:p-6">
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
          {/* QR + estado */}
          <aside className="rounded-lg border border-border bg-card p-4">
            <QrDisplay value={detalle.qr_code} size={220} />
            <div className="mt-4 flex flex-col items-center gap-3">
              <Badge variant={ESTADO_ITEM_VARIANT[detalle.estado_item]}>
                {ESTADO_ITEM_LABEL[detalle.estado_item]}
              </Badge>
              {puedeImprimirEtiqueta && (
                <Link
                  href={`/inventario/imprimir-etiquetas?qrs=${encodeURIComponent(detalle.qr_code)}`}
                  target="_blank"
                  className="w-full text-center rounded-md bg-card-3 border border-border px-3 py-2 text-sm font-semibold hover:bg-hover"
                >
                  Imprimir Etiqueta
                </Link>
              )}
              <EscanearOtro />
            </div>
          </aside>

          {/* Datos + acciones + historial */}
          <section className="space-y-4">
            <Card>
              <h2 className="font-display text-xl">{detalle.producto.nombre}</h2>
              {detalle.producto.sku && (
                <div className="text-xs font-mono text-muted mt-1">
                  SKU: {detalle.producto.sku}
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs uppercase font-mono text-muted">Categoría</div>
                  <div>{detalle.producto.categoria?.nombre ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs uppercase font-mono text-muted">Tipo ingreso</div>
                  <div className="capitalize">{detalle.tipo_ingreso}</div>
                </div>
                <div>
                  <div className="text-xs uppercase font-mono text-muted">Costo ingreso</div>
                  <div className="font-mono">
                    $ {Number(detalle.costo_ingreso).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase font-mono text-muted">Fecha ingreso</div>
                  <div>{new Date(detalle.fecha_ingreso).toLocaleDateString('es-AR')}</div>
                </div>
                {detalle.proveedor && (
                  <div className="col-span-2">
                    <div className="text-xs uppercase font-mono text-muted">Proveedor</div>
                    <div>{detalle.proveedor.nombre}</div>
                  </div>
                )}
              </div>
            </Card>

            <FichaActions
              idItem={detalle.id_item}
              qr={qr}
              estadoActual={detalle.estado_item}
            />

            {enPoderDe && (
              <Card className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg">En poder de revendedora</h3>
                  <Link
                    href={`/revendedoras/${enPoderDe.id_revendedora}`}
                    className="text-sm font-semibold text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink"
                  >
                    Ver revendedora
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs uppercase font-mono text-muted">Revendedora</div>
                    <div className="font-medium">
                      {enPoderDe.nombre} {enPoderDe.apellido}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase font-mono text-muted">Entregado el</div>
                    <div>
                      {enPoderDe.fecha_entrega
                        ? new Date(enPoderDe.fecha_entrega).toLocaleDateString('es-AR')
                        : '—'}
                    </div>
                  </div>
                  {enPoderDe.telefono && (
                    <div>
                      <div className="text-xs uppercase font-mono text-muted">Teléfono</div>
                      <div>{enPoderDe.telefono}</div>
                    </div>
                  )}
                  {enPoderDe.email && (
                    <div>
                      <div className="text-xs uppercase font-mono text-muted">Email</div>
                      <div>{enPoderDe.email}</div>
                    </div>
                  )}
                </div>
              </Card>
            )}

            <Card className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-lg">Ajuste de inventario</h3>
                <p className="text-sm text-muted">
                  Diferencia entre stock del sistema y conteo real. Registra movimiento auditable.
                </p>
              </div>
              <AjusteInventarioAction
                idItem={detalle.id_item}
                estadoItem={detalle.estado_item}
              />
            </Card>

            {/* Historial de movimientos */}
            <Card>
              <h3 className="font-display text-lg mb-3">Historial</h3>
              {detalle.movimientos.length === 0 ? (
                <p className="text-sm text-muted">Sin movimientos.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {detalle.movimientos.map((m) => (
                    <li
                      key={m.id_movimiento}
                      className="flex items-start justify-between border-b border-border-2 pb-2 last:border-0"
                    >
                      <div>
                        <div className="font-mono text-xs uppercase text-muted">
                          {m.tipo_movimiento}
                        </div>
                        <div>
                          {m.estado_desde ?? '—'} → <b>{m.estado_hasta}</b>
                        </div>
                      </div>
                      <div className="text-xs text-muted">
                        {new Date(m.ts).toLocaleString('es-AR')}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      </main>
    </>
  )
}
