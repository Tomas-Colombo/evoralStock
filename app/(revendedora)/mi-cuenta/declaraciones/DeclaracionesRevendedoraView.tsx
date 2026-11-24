'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { RvpMisDeclaracionesRow } from '@/lib/types/revendedoras'
import { formatearMoneda } from '@/lib/utils/moneda'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { Badge } from '@/components/ui/Badge'
import { BusquedaUrl } from '@/components/filtros/BusquedaUrl'
import { PaginacionUrl } from '@/components/filtros/PaginacionUrl'

interface Props {
  declaraciones: RvpMisDeclaracionesRow[]
  total: number
  pagina: number
  pageSize: number
  desde: string
  hasta: string
  estado: string
  q: string
}

export function DeclaracionesRevendedoraView({
  declaraciones,
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
  const [selectedParaRetirar, setSelectedParaRetirar] = useState<RvpMisDeclaracionesRow | null>(null)
  const [isPending, startTransition] = useTransition()

  const hayFiltros = Boolean(desde || hasta || estado || q)

  const handleRetirar = () => {
    if (!selectedParaRetirar) return
    startTransition(async () => {
      toast.error('Error al retirar', mensajeDeError('no-permission'))
      setSelectedParaRetirar(null)
      router.refresh()
    })
  }

  return (
    <>
      <div className="p-4 rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <BusquedaUrl
              valor={q}
              placeholder="Buscar por nombre o SKU..."
            />
          </div>
          {hayFiltros && (
            <Link
              href="/mi-cuenta/declaraciones"
              className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Limpiar filtros
            </Link>
          )}
        </div>
      </div>

      {declaraciones.length === 0 ? (
        <div className="p-8 text-center rounded-lg border border-dashed border-border bg-card">
          <p className="text-muted text-sm">
            {hayFiltros
              ? 'No hay declaraciones que coincidan con los filtros elegidos.'
              : 'No tenés declaraciones de venta registradas.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {declaraciones.map((d) => (
            <div
              key={d.id_declaracion}
              className="p-4 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/50 pb-2">
                <div>
                  <h2 className="font-semibold text-base">{d.nombre_producto}</h2>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted">
                    {d.sku && <span className="font-mono">{d.sku} ·</span>}
                    {d.talle && <span>Talle {d.talle} ·</span>}
                    <span>Declarada el {new Date(d.fecha).toLocaleDateString('es-AR')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-accent-fg whitespace-nowrap">
                    {formatearMoneda(d.precio_venta)}
                  </span>
                  {d.estado === 'pendiente' && (
                    <Badge variant="warning">
                      <span className="w-1.5 h-1.5 rounded-full bg-warn motion-safe:animate-pulse" />
                      Pendiente
                    </Badge>
                  )}
                  {d.estado === 'confirmada' && (
                    <Badge variant="success">
                      Confirmada
                    </Badge>
                  )}
                  {d.estado === 'rechazada' && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                      Rechazada
                    </span>
                  )}
                  {d.estado === 'retirada' && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted/10 text-muted">
                      Retirada
                    </span>
                  )}
                </div>
              </div>

              {d.nota && (
                <p className="text-xs text-muted italic">
                  Nota: &ldquo;{d.nota}&rdquo;
                </p>
              )}

              {d.estado === 'rechazada' && d.motivo_rechazo && (
                <div className="p-2.5 rounded-lg bg-destructive/5 border border-destructive/20 text-xs text-destructive">
                  <span className="font-semibold">Motivo de rechazo del local:</span> {d.motivo_rechazo}
                </div>
              )}

              {d.estado === 'pendiente' && (
                <div className="pt-2 flex justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-[44px] px-4 text-xs border-border hover:bg-hover"
                    onClick={() => setSelectedParaRetirar(d)}
                  >
                    Retirar declaración
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <PaginacionUrl
        page={pagina}
        pageSize={pageSize}
        total={total}
      />

      {/* Modal para confirmar retiro de declaración */}
      {selectedParaRetirar && (
        <Modal
          open={true}
          onClose={() => {
            if (!isPending) setSelectedParaRetirar(null)
          }}
          title="¿Retirar declaración de venta?"
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Vas a retirar la declaración de venta de{' '}
              <strong className="text-text">{selectedParaRetirar.nombre_producto}</strong>. El artículo volverá a figurar disponible en tu stock para declarar más adelante.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-border">
              <Button
                variant="secondary"
                className="min-h-[44px] px-4"
                onClick={() => setSelectedParaRetirar(null)}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                className="min-h-[44px] px-4"
                onClick={handleRetirar}
                disabled={isPending}
              >
                {isPending ? 'Retirando...' : 'Sí, retirar'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
