'use client'

import { useState } from 'react'
import type { RvpMiStockRow } from '@/lib/types/revendedoras'
import { formatearMoneda } from '@/lib/utils/moneda'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { BusquedaUrl } from '@/components/filtros/BusquedaUrl'
import { SelectUrl } from '@/components/filtros/SelectUrl'
import { PaginacionUrl } from '@/components/filtros/PaginacionUrl'
import { VenderModal, type ItemCarritoPortal } from '../VenderModal'

interface Props {
  items: RvpMiStockRow[]
  total: number
  pagina: number
  pageSize: number
  estado: string
  q: string
}

export function StockRevendedoraView({ items, total, pagina, pageSize, estado, q }: Props) {
  const [itemsModal, setItemsModal] = useState<ItemCarritoPortal[] | null>(null)

  const hayFiltros = Boolean(estado || q)

  const handleOpenVender = (item: RvpMiStockRow) => {
    setItemsModal([
      {
        id_item: item.id_item,
        descripcion: item.nombre_producto,
        sku: item.sku,
        talle: item.talle,
        precio_venta: item.precio_venta,
      },
    ])
  }

  return (
    <>
      <div className="p-4 rounded-lg border border-border bg-card flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <BusquedaUrl
            valor={q}
            placeholder="Buscar por nombre o SKU..."
          />
        </div>
        <div className="w-full sm:w-56">
          <SelectUrl
            id="stock-estado"
            param="estado"
            valor={estado}
            label="Estado"
            opciones={[
              { value: '', label: 'Todos' },
              { value: 'con_pendiente', label: 'Con declaración pendiente' },
              { value: 'sin_declaracion', label: 'Sin declaración' },
            ]}
          />
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-8 text-center rounded-lg border border-dashed border-border bg-card">
          <p className="text-muted text-sm">
            {hayFiltros
              ? 'No hay artículos que coincidan con los filtros elegidos.'
              : 'No tenés artículos en tu poder en este momento.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((item) => (
            <div
              key={item.id_item}
              className="p-4 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] flex flex-col justify-between space-y-3"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-base leading-snug">{item.nombre_producto}</h2>
                  <span className="text-base font-bold text-accent-fg whitespace-nowrap">
                    {formatearMoneda(item.precio_venta)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted">
                  {item.sku && (
                    <span className="font-mono px-2 py-0.5 rounded bg-muted/10">{item.sku}</span>
                  )}
                  {item.talle && (
                    <span className="px-2 py-0.5 rounded bg-muted/10">Talle: {item.talle}</span>
                  )}
                  <span>Entregado: {new Date(item.fecha_entrega).toLocaleDateString('es-AR')}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                {item.declaracion_pendiente ? (
                  <Badge variant="warning">
                    <span className="w-1.5 h-1.5 rounded-full bg-warn motion-safe:animate-pulse" />
                    Pendiente de confirmar
                  </Badge>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    className="min-h-[44px] px-4 w-full sm:w-auto"
                    onClick={() => handleOpenVender(item)}
                  >
                    Vender
                  </Button>
                )}
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

      <VenderModal
        open={itemsModal !== null}
        onClose={() => setItemsModal(null)}
        itemsIniciales={itemsModal ?? undefined}
      />
    </>
  )
}
