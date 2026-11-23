import Link from 'next/link'
import { verifySession } from '@/lib/dal/session'
import { obtenerMiCuenta } from '@/lib/dal/revendedoras'
import { formatearMoneda } from '@/lib/utils/moneda'
import { Badge } from '@/components/ui/Badge'

export const metadata = {
  title: 'Mi cuenta | Revendedor',
}

export default async function MiCuentaResumenPage() {
  const session = await verifySession()
  const res = await obtenerMiCuenta(session)

  if (!res.ok) {
    return (
      <div className="p-6 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive">
        <p className="font-medium">No se pudo cargar tu resumen de cuenta.</p>
      </div>
    )
  }

  const cuenta = res.data

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-display tracking-tight">Tu resumen de cuenta</h1>
        <p className="text-sm text-muted mt-1">
          Estado actual de mercadería, ventas y comisión con el local.
        </p>
      </div>

      {/* Grid de KPIs principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Piezas en poder */}
        <div className="p-5 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] space-y-2">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">
            Mercadería en tu poder
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold font-display">{cuenta.piezas_en_poder}</span>
            <span className="text-xs text-muted">piezas</span>
          </div>
          <p className="text-xs text-muted">
            Valor de venta: <span className="font-semibold text-text">{formatearMoneda(cuenta.valor_en_poder)}</span>
          </p>
          <div className="pt-2">
            <Link
              href="/mi-cuenta/stock"
              className="min-h-[44px] inline-flex items-center text-sm font-medium text-accent-fg hover:underline"
            >
              Ver mi stock &rarr;
            </Link>
          </div>
        </div>

        {/* Total vendido */}
        <div className="p-5 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] space-y-2">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">
            Total vendido
          </span>
          <div className="text-3xl font-bold font-display">
            {formatearMoneda(cuenta.total_vendido)}
          </div>
          <p className="text-xs text-muted">
            Comisión liquidada: <span className="font-semibold text-text">{formatearMoneda(cuenta.comision_liquidada)}</span>
          </p>
          <div className="pt-2">
            <Link
              href="/mi-cuenta/ventas"
              className="min-h-[44px] inline-flex items-center text-sm font-medium text-accent-fg hover:underline"
            >
              Ver mis ventas &rarr;
            </Link>
          </div>
        </div>

        {/* Saldo adeudado */}
        <div className="p-5 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] space-y-2">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">
            Saldo a rendir al local
          </span>
          <div className="text-3xl font-bold font-display text-accent-fg">
            {formatearMoneda(cuenta.total_adeudado)}
          </div>
          <p className="text-xs text-muted">
            Total pagado: <span className="font-semibold text-text">{formatearMoneda(cuenta.total_pagado)}</span>
          </p>
          <div className="pt-2">
            <Link
              href="/mi-cuenta/liquidaciones"
              className="min-h-[44px] inline-flex items-center text-sm font-medium text-accent-fg hover:underline"
            >
              Ver liquidaciones &rarr;
            </Link>
          </div>
        </div>

        {/* Comisión estimada (rotulada claramente) */}
        <div className="p-5 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">
              Comisión estimada
            </span>
            <Badge variant="warning">
              Estimada
            </Badge>
          </div>
          <div className="text-3xl font-bold font-display">
            {formatearMoneda(cuenta.comision_estimada)}
          </div>
          <p className="text-xs text-muted">
            Ventas confirmadas sin liquidar aún por el local.
          </p>
        </div>

        {/* Tu escala o tramo de comisión */}
        <div className="p-5 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] space-y-2">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">
            Tu comisión vigente
          </span>
          <div className="text-3xl font-bold font-display">
            {cuenta.porcentaje_comision_actual}%
          </div>
          <p className="text-xs text-muted">
            Tramo: {cuenta.tramo_comision_actual || 'Vigente'}
          </p>
        </div>

        {/* Declaraciones pendientes */}
        <div className="p-5 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)] space-y-2">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">
            Declaraciones de venta
          </span>
          <div className="text-3xl font-bold font-display">
            {cuenta.declaraciones_pendientes}
          </div>
          <p className="text-xs text-muted">
            {cuenta.declaraciones_pendientes === 1
              ? '1 venta pendiente de confirmar por el local'
              : `${cuenta.declaraciones_pendientes} ventas pendientes de confirmar por el local`}
          </p>
          <div className="pt-2">
            <Link
              href="/mi-cuenta/declaraciones"
              className="min-h-[44px] inline-flex items-center text-sm font-medium text-accent-fg hover:underline"
            >
              Ver declaraciones &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
