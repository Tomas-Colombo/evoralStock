'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { RvpMisVentasRow } from '@/lib/types/revendedoras'
import { formatearMoneda } from '@/lib/utils/moneda'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { BusquedaUrl } from '@/components/filtros/BusquedaUrl'
import { PaginacionUrl } from '@/components/filtros/PaginacionUrl'
import { anularVentaRevendedoraAction } from '../actions'

interface Props {
  ventas: RvpMisVentasRow[]
  total: number
  pagina: number
  pageSize: number
  desde: string
  hasta: string
  estado: string
  q: string
}

interface VentaAgrupada {
  id_venta: string
  fecha_venta: string
  estado_venta: 'registrada' | 'anulada'
  liquidada: boolean
  total: number
  comision_total: number
  contacto_nombre: string | null
  contacto_telefono: string | null
  articulos: RvpMisVentasRow[]
}

function agruparVentas(rows: RvpMisVentasRow[]): VentaAgrupada[] {
  const mapa = new Map<string, VentaAgrupada>()
  for (const r of rows) {
    const existente = mapa.get(r.id_venta)
    if (!existente) {
      mapa.set(r.id_venta, {
        id_venta: r.id_venta,
        fecha_venta: r.fecha_venta,
        estado_venta: r.estado_venta,
        liquidada: r.liquidada,
        total: r.precio_venta,
        comision_total: r.comision_total,
        contacto_nombre: r.contacto_nombre,
        contacto_telefono: r.contacto_telefono,
        articulos: [r],
      })
    } else {
      existente.total += r.precio_venta
      existente.comision_total += r.comision_total
      existente.liquidada = existente.liquidada && r.liquidada
      existente.articulos.push(r)
    }
  }
  return Array.from(mapa.values())
}

export function VentasRevendedoraView({
  ventas,
  total,
  pagina,
  pageSize,
  desde,
  hasta,
  estado,
  q,
}: Props) {
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [ventaAnular, setVentaAnular] = useState<VentaAgrupada | null>(null)
  const [motivo, setMotivo] = useState('')

  const hayFiltros = Boolean(desde || hasta || estado || q)
  const ventasAgrupadas = useMemo(() => agruparVentas(ventas), [ventas])

  function cerrarModal() {
    if (isPending) return
    setVentaAnular(null)
    setMotivo('')
  }

  function confirmarAnulacion() {
    if (!ventaAnular || isPending) return
    startTransition(async () => {
      const res = await anularVentaRevendedoraAction({
        id_venta: ventaAnular.id_venta,
        motivo: motivo.trim() || null,
      })
      if (res.ok) {
        toast.success('Venta anulada', 'Los artículos volvieron a tu stock.')
        setVentaAnular(null)
        setMotivo('')
        router.refresh()
      } else {
        toast.error('No se pudo anular la venta', mensajeDeError(res.reason))
      }
    })
  }

  return (
    <>
      <div className="p-4 rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <BusquedaUrl
              valor={q}
              placeholder="Buscar por artículo..."
            />
          </div>
          {hayFiltros && (
            <Link
              href="/mi-cuenta/ventas"
              className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Limpiar filtros
            </Link>
          )}
        </div>
      </div>

      {ventasAgrupadas.length === 0 ? (
        <div className="p-8 text-center rounded-lg border border-dashed border-border bg-card">
          <p className="text-muted text-sm">
            {hayFiltros
              ? 'No hay ventas que coincidan con los filtros elegidos.'
              : 'No tenés ventas registradas todavía.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {ventasAgrupadas.map((v) => {
            const anulada = v.estado_venta === 'anulada'
            return (
              <Card key={v.id_venta} padding="md" className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-base">
                        {new Date(v.fecha_venta).toLocaleDateString('es-AR')}
                      </span>
                      {anulada ? (
                        <Badge variant="danger">Anulada</Badge>
                      ) : v.liquidada ? (
                        <Badge variant="success">Liquidada</Badge>
                      ) : (
                        <Badge variant="warning">No liquidada</Badge>
                      )}
                    </div>
                    {(v.contacto_nombre || v.contacto_telefono) && (
                      <p className="text-xs text-muted">
                        Cliente:{' '}
                        <span className="text-ink font-medium">
                          {v.contacto_nombre ?? 'Sin nombre'}
                        </span>
                        {v.contacto_telefono ? ` · ${v.contacto_telefono}` : ''}
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    <div className="text-base font-bold text-ink">
                      {formatearMoneda(v.total)}
                    </div>
                    {!anulada && (
                      <div className="text-xs text-muted">
                        Tu comisión:{' '}
                        <strong className="text-accent-fg">
                          {formatearMoneda(v.comision_total)}
                        </strong>
                      </div>
                    )}
                  </div>
                </div>

                <ul className="divide-y divide-border/50 text-sm">
                  {v.articulos.map((art) => (
                    <li
                      key={art.id_detalle_venta}
                      className="flex items-center justify-between gap-3 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{art.descripcion}</span>
                        {art.talle && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-muted/10 text-muted">
                            Talle: {art.talle}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-xs text-muted">
                        {formatearMoneda(art.precio_venta)}
                      </span>
                    </li>
                  ))}
                </ul>

                {!anulada && !v.liquidada && (
                  <div className="flex justify-end border-t border-border/60 pt-2">
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      className="min-h-[44px]"
                      onClick={() => setVentaAnular(v)}
                    >
                      Anular venta
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <PaginacionUrl
        page={pagina}
        pageSize={pageSize}
        total={total}
      />

      <Modal
        open={ventaAnular !== null}
        onClose={cerrarModal}
        title="Anular venta"
        size="md"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={cerrarModal}
              disabled={isPending}
              className="min-h-[44px]"
            >
              Volver
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={confirmarAnulacion}
              disabled={isPending}
              className="min-h-[44px]"
            >
              {isPending ? 'Anulando...' : 'Confirmar anulación'}
            </Button>
          </>
        }
      >
        {ventaAnular && (
          <div className="space-y-4 text-sm">
            <p className="text-muted">
              Vas a anular la venta del{' '}
              <strong className="text-ink">
                {new Date(ventaAnular.fecha_venta).toLocaleDateString('es-AR')}
              </strong>{' '}
              por{' '}
              <strong className="text-ink">
                {formatearMoneda(ventaAnular.total)}
              </strong>
              . Los artículos volverán a tu stock disponible.
            </p>
            <div className="space-y-1">
              <label htmlFor="motivo-anulacion-portal" className="text-xs text-muted">
                Motivo (opcional)
              </label>
              <Textarea
                id="motivo-anulacion-portal"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Ej. Se equivocó de talle"
                disabled={isPending}
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
