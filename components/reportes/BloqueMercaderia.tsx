import React from 'react'
import Link from 'next/link'
import type { FinanzasPosicion } from '@/lib/types/reportes'
import { Card } from '@/components/ui/Card'

function formatMoney(value: number | null | undefined) {
  if (value == null) return '—'
  return Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value)
}

interface BloqueMercaderiaProps {
  posicion: FinanzasPosicion
  tieneConsignacion: boolean
}

export function BloqueMercaderia({ posicion, tieneConsignacion }: BloqueMercaderiaProps) {
  const tieneSinPrecio = posicion.productos_sin_precio > 0
  const capital = posicion.capital_propio ?? 0
  const consignacion = tieneConsignacion ? (posicion.mercaderia_terceros ?? 0) : 0

  return (
    <Card as="section" padding="none" aria-labelledby="h2-mercaderia" className="overflow-hidden h-full flex flex-col">
      <div className="p-4 border-b border-border bg-panel flex flex-wrap justify-between items-center gap-2">
        <h2 id="h2-mercaderia" className="font-display text-lg">Tu stock hoy</h2>
      </div>
      
      <div className="p-6 flex-1 flex flex-col justify-center">
        <div className="mb-6">
          <p className="text-sm font-medium text-muted uppercase tracking-wider mb-1">Costo total inventario</p>
          <p className="font-display text-4xl tabular-nums text-ink leading-none">{formatMoney(capital + consignacion)}</p>
          <p className="text-sm text-muted mt-2">
            Lo que te costó (o debes por) la mercadería que tenés disponible.
          </p>
        </div>
        
        <div className={`grid ${tieneConsignacion ? 'grid-cols-2' : 'grid-cols-1'} gap-4 mb-4`}>
          <div className="bg-panel-2 p-3 rounded-lg border border-border">
            <p className="text-xs text-muted mb-1">Capital propio</p>
            <p className="font-medium tabular-nums text-ink">{formatMoney(capital)}</p>
          </div>
          
          {tieneConsignacion && (
            <div className="bg-panel-2 p-3 rounded-lg border border-border">
              <p className="text-xs text-muted mb-1">Mercadería de terceros</p>
              <p className="font-medium tabular-nums text-ink">{formatMoney(consignacion)}</p>
            </div>
          )}
        </div>

        <div className="bg-panel p-3 rounded-lg border border-border mt-auto">
          <div className="flex justify-between items-center mb-1">
            <p className="text-xs text-muted font-medium">Valor de venta potencial</p>
            <p className="font-bold tabular-nums text-ink">{formatMoney(posicion.valor_venta_potencial)}</p>
          </div>
          <p className="text-xs text-muted">Lo que entraría si vendés todo hoy.</p>

          {tieneSinPrecio && (
            <div className="mt-3 p-2 bg-alerta-bg border border-alerta-ink/20 rounded flex justify-between items-center">
              <span className="text-xs font-medium text-alerta-ink">
                {posicion.productos_sin_precio} {posicion.productos_sin_precio === 1 ? 'producto' : 'productos'} sin precio
              </span>
              <Link 
                href="/inventario?filtro=sin-precio" 
                className="text-xs font-bold underline text-alerta-ink hover:text-alerta-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded"
              >
                Revisar →
              </Link>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
