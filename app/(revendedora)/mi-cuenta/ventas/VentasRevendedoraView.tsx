'use client'

import Link from 'next/link'
import type { RvpMisVentasRow } from '@/lib/types/revendedoras'
import { formatearMoneda } from '@/lib/utils/moneda'
import { Badge } from '@/components/ui/Badge'
import { BusquedaUrl } from '@/components/filtros/BusquedaUrl'
import { PaginacionUrl } from '@/components/filtros/PaginacionUrl'

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
  const hayFiltros = Boolean(desde || hasta || estado || q)

  return (
    <>
      <div className="p-4 rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <BusquedaUrl
              valor={q}
              placeholder="Buscar por descripción..."
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

      {ventas.length === 0 ? (
        <div className="p-8 text-center rounded-lg border border-dashed border-border bg-card">
          <p className="text-muted text-sm">
            {hayFiltros
              ? 'No hay artículos vendidos que coincidan con los filtros elegidos.'
              : 'No tenés artículos vendidos registrados todavía.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {ventas.map((v) => (
            <div
              key={v.id_detalle_venta}
              className="p-4 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-base">
                    {v.descripcion}
                  </span>
                  {v.talle && (
                    <span className="text-xs px-2 py-0.5 rounded bg-muted/10 font-medium">
                      Talle: {v.talle}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span>Precio: <strong className="text-foreground">{formatearMoneda(v.precio_venta)}</strong></span>
                  <span>·</span>
                  <span>Fecha: {new Date(v.fecha_venta).toLocaleDateString('es-AR')}</span>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-2 sm:pt-0 border-border/50">
                <div className="text-left sm:text-right">
                  <div className="text-xs text-muted">Tu comisión</div>
                  <div className="text-sm font-bold text-accent-fg">
                    {formatearMoneda(v.comision_total)}
                  </div>
                </div>

                <div>
                  {v.liquidada ? (
                    <Badge variant="success">
                      Liquidada
                    </Badge>
                  ) : (
                    <Badge variant="warning">
                      No liquidada
                    </Badge>
                  )}
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
