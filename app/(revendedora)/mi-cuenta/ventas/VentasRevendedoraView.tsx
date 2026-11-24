'use client'

import Link from 'next/link'
import type { RvpMisVentasRow } from '@/lib/types/revendedoras'
import { formatearMoneda } from '@/lib/utils/moneda'
import { Badge } from '@/components/ui/Badge'
import { FiltroPeriodo } from '@/components/shell/FiltroPeriodo'
import { PortalBusqueda } from '../PortalBusqueda'
import { PortalPaginacion } from '../PortalPaginacion'

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight">Artículos vendidos</h1>
          <p className="text-sm text-muted">
            Detalle por artículo de las ventas registradas y confirmadas a tu nombre.
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent-fg/10 text-accent-fg">
          {total} {total === 1 ? 'artículo' : 'artículos'}
        </span>
      </div>

      <div className="p-4 rounded-lg border border-border bg-card space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <FiltroPeriodo
            key={`${desde}-${hasta}-${estado}`}
            basePath="/mi-cuenta/ventas"
            ariaLabel="Filtrar ventas por período y estado"
            idPrefix="mi-cuenta-ventas"
            desde={desde}
            hasta={hasta}
            conservar={{ q }}
            extras={[
              {
                param: 'estado',
                label: 'Estado',
                value: estado,
                ancho: 'w-40',
                aplicarAlCambiar: true,
                options: [
                  { value: '', label: 'Todos' },
                  { value: 'liquidada', label: 'Liquidada' },
                  { value: 'pendiente', label: 'Pendiente' },
                ],
              },
            ]}
          />
          {hayFiltros && (
            <Link
              href="/mi-cuenta/ventas"
              className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Limpiar filtros
            </Link>
          )}
        </div>
        <PortalBusqueda
          key={q}
          basePath="/mi-cuenta/ventas"
          initialValue={q}
          placeholder="Buscar por descripción..."
        />
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
                      Pendiente de liquidar
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <PortalPaginacion
        basePath="/mi-cuenta/ventas"
        page={pagina}
        pageSize={pageSize}
        total={total}
      />
    </div>
  )
}
