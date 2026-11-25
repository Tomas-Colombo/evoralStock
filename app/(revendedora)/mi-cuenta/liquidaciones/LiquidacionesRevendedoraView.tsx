'use client'

import Link from 'next/link'
import type { RvpMisLiquidacionesRow } from '@/lib/types/revendedoras'
import { formatearFecha } from '@/lib/fechas'
import { formatearMoneda } from '@/lib/utils/moneda'
import { Badge } from '@/components/ui/Badge'
import { PaginacionUrl } from '@/components/filtros/PaginacionUrl'

interface Props {
  liquidaciones: RvpMisLiquidacionesRow[]
  total: number
  pagina: number
  pageSize: number
  desde: string
  hasta: string
  estado: string
}

export function LiquidacionesRevendedoraView({
  liquidaciones,
  total,
  pagina,
  pageSize,
  desde,
  hasta,
  estado,
}: Props) {
  const hayFiltros = Boolean(desde || hasta || estado)

  return (
    <>
      {hayFiltros && (
        <div className="p-4 rounded-lg border border-border bg-card flex items-center justify-between gap-3">
          <span className="text-xs text-muted">Mostrando liquidaciones filtradas.</span>
          <Link
            href="/mi-cuenta/liquidaciones"
            className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Limpiar filtros
          </Link>
        </div>
      )}

      {liquidaciones.length === 0 ? (
        <div className="p-8 text-center rounded-lg border border-dashed border-border bg-card">
          <p className="text-muted text-sm">
            {hayFiltros
              ? 'No hay liquidaciones que coincidan con los filtros elegidos.'
              : 'No tenés liquidaciones registradas todavía.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {liquidaciones.map((l) => (
            <div
              key={l.id_liquidacion}
              className="p-4 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/50 pb-2">
                <div>
                  <span className="font-semibold text-sm">
                    Liquidación del {formatearFecha(l.fecha_liquidacion)}
                  </span>
                  <p className="text-xs text-muted">
                    Período: {formatearFecha(l.periodo_desde)} al{' '}
                    {formatearFecha(l.periodo_hasta)}
                  </p>
                </div>
                <div>
                  {l.estado === 'pagada' ? (
                    <Badge variant="success">
                      Rendición pagada
                    </Badge>
                  ) : (
                    <Badge variant="warning">
                      Saldo pendiente de rendir
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-muted block">Total vendido</span>
                  <span className="font-semibold text-sm text-text">{formatearMoneda(l.total_venta)}</span>
                </div>
                <div>
                  <span className="text-muted block">Tu comisión</span>
                  <span className="font-semibold text-sm text-accent-fg">{formatearMoneda(l.monto_comision)}</span>
                </div>
                <div>
                  <span className="text-muted block">A rendir al local</span>
                  <span className="font-semibold text-sm text-text">{formatearMoneda(l.monto_a_cobrar)}</span>
                </div>
                <div>
                  <span className="text-muted block">Pagado / Rendido</span>
                  <span className="font-semibold text-sm text-text">{formatearMoneda(l.total_pagado)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <PaginacionUrl
        page={pagina}
        pageSize={pageSize}
        total={total}
      />
    </>
  )
}
