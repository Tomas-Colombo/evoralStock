import { verifySession } from '@/lib/dal/session'
import { listarMisLiquidaciones } from '@/lib/dal/revendedoras'
import { formatearMoneda } from '@/lib/utils/moneda'
import { Badge } from '@/components/ui/Badge'

export const metadata = {
  title: 'Mis liquidaciones | Revendedor',
}

export default async function MisLiquidacionesPage() {
  const session = await verifySession()
  const res = await listarMisLiquidaciones(session, { limit: 100, offset: 0 })

  if (!res.ok) {
    return (
      <div className="p-6 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive">
        <p className="font-medium">No se pudieron cargar tus liquidaciones.</p>
      </div>
    )
  }

  const liquidaciones = res.data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight">Liquidaciones de cuenta</h1>
          <p className="text-sm text-muted">
            Cierres periódicos de ventas y rendiciones con el local.
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent-fg/10 text-accent-fg">
          {liquidaciones.length} {liquidaciones.length === 1 ? 'cierre' : 'cierres'}
        </span>
      </div>

      {liquidaciones.length === 0 ? (
        <div className="p-8 text-center rounded-lg border border-dashed border-border bg-card">
          <p className="text-muted text-sm">No tenés liquidaciones registradas todavía.</p>
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
                    Liquidación del {new Date(l.fecha_liquidacion).toLocaleDateString('es-AR')}
                  </span>
                  <p className="text-xs text-muted">
                    Período: {new Date(l.periodo_desde).toLocaleDateString('es-AR')} al{' '}
                    {new Date(l.periodo_hasta).toLocaleDateString('es-AR')}
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
    </div>
  )
}
