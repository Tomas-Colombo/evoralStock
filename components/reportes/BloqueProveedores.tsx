import React from 'react'
import Link from 'next/link'
import type { FinanzasPosicion } from '@/lib/types/reportes'
import { Card } from '@/components/ui/Card'

function formatMoney(value: number | null | undefined) {
  if (value == null) return 'Sin permiso'
  return Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value)
}

interface BloqueProveedoresProps {
  posicion: FinanzasPosicion
}

export function BloqueProveedores({ posicion }: BloqueProveedoresProps) {
  const deuda = posicion.deuda_proveedores

  return (
    <Card as="section" padding="none" aria-labelledby="h2-proveedores" className="overflow-hidden h-full flex flex-col">
      <div className="p-4 border-b border-border bg-panel flex flex-wrap justify-between items-center gap-2">
        <h2 id="h2-proveedores" className="font-display text-lg">Lo que debés</h2>
      </div>
      
      <div className="p-6 flex-1 flex flex-col justify-center">
        <div className="mb-6">
          <p className="text-sm font-medium text-muted uppercase tracking-wider mb-1">A proveedores</p>
          <p className="font-display text-4xl tabular-nums text-ink leading-none">{formatMoney(deuda)}</p>
          <p className="text-sm text-muted mt-2">
            Total acumulado en rendiciones pendientes de pago.
          </p>
        </div>
        
        {deuda != null && deuda > 0 && (
          <div className="mt-auto">
            <Link 
              href="/rendiciones?estado=pendiente" 
              className="inline-flex items-center text-sm font-medium underline text-ink hover:text-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded"
            >
              Ver rendiciones pendientes →
            </Link>
          </div>
        )}
      </div>
    </Card>
  )
}
