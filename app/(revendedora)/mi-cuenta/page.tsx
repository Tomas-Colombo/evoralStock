import Link from 'next/link'
import { verifySession } from '@/lib/dal/session'
import { obtenerMiCuenta } from '@/lib/dal/revendedoras'
import { formatearMoneda } from '@/lib/utils/moneda'
import { BandAction } from '@/components/shell/BandAction'
import { FiltroPeriodo } from '@/components/shell/FiltroPeriodo'
import { PageBand } from '@/components/shell/PageBand'
import { parsearPeriodoPortal } from './filtros'
import { VenderBandAction } from './VenderBandAction'

export const metadata = {
  title: 'Mi cuenta | Revendedor',
}

export default async function MiCuentaResumenPage(props: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const session = await verifySession()
  const searchParams = await props.searchParams
  const { desde, hasta } = parsearPeriodoPortal(searchParams.desde, searchParams.hasta)

  const res = await obtenerMiCuenta(session, { desde, hasta })
  const hayPeriodo = Boolean(desde || hasta)

  const filtroPeriodo = (
    <FiltroPeriodo
      ariaLabel="Filtrar resumen por período"
      idPrefix="mi-cuenta"
      desde={desde ?? ''}
      hasta={hasta ?? ''}
    />
  )

  if (!res.ok) {
    return (
      <>
        <PageBand
          breadcrumb={['Mi cuenta']}
          title="Tu resumen de cuenta"
          subtitle="Estado actual de mercadería, ventas y comisión con el local."
          filters={filtroPeriodo}
        />
        <main className="flex-1 p-4 sm:p-6 space-y-6">
          <div className="p-6 rounded-lg border border-destructive/30 bg-card text-destructive">
            <p className="font-medium">No se pudo cargar tu resumen de cuenta.</p>
          </div>
        </main>
      </>
    )
  }

  const cuenta = res.data

  return (
    <>
      <PageBand
        breadcrumb={['Mi cuenta']}
        title="Tu resumen de cuenta"
        subtitle="Estado actual de mercadería, ventas y comisión con el local."
        filters={filtroPeriodo}
        kpis={[
          {
            label: 'Mercadería en tu poder',
            hint: 'Estado actual',
            value: cuenta.piezas_en_poder.toString(),
            sub: `Valor de venta: ${formatearMoneda(cuenta.valor_en_poder)}`,
          },
          {
            label: 'Total vendido',
            hint: 'Del período',
            value: formatearMoneda(cuenta.total_vendido),
            sub: `Comisión liquidada: ${formatearMoneda(cuenta.comision_liquidada)}`,
          },
          {
            label: 'Saldo a rendir al local',
            hint: 'Estado actual',
            value: formatearMoneda(cuenta.total_adeudado),
            sub: `Total pagado: ${formatearMoneda(cuenta.total_pagado)}`,
          },
          {
            label: 'Comisión estimada',
            hint: 'Del período · Estimada',
            value: formatearMoneda(cuenta.comision_estimada),
            sub: 'Ventas confirmadas sin liquidar aún por el local.',
          },
          {
            label: 'Tu comisión vigente',
            hint: 'Estado actual',
            value: `${cuenta.porcentaje_comision_actual}%`,
            sub: `Tramo: ${cuenta.tramo_comision_actual || 'Vigente'}`,
          },
          {
            label: 'Declaraciones de venta',
            hint: 'Estado actual',
            value: cuenta.declaraciones_pendientes.toString(),
            sub:
              cuenta.declaraciones_pendientes === 1
                ? '1 venta pendiente de confirmar por el local'
                : `${cuenta.declaraciones_pendientes} ventas pendientes de confirmar por el local`,
          },
        ]}
        actions={
          <>
            <VenderBandAction />
            <BandAction href="/mi-cuenta/stock" title="Ver mi stock" />
            <BandAction href="/mi-cuenta/ventas" title="Ver mis ventas" />
            <BandAction href="/mi-cuenta/liquidaciones" title="Ver liquidaciones" />
            <BandAction href="/mi-cuenta/declaraciones" title="Ver declaraciones" />
          </>
        }
      />
      <main className="flex-1 p-4 sm:p-6 space-y-6">
        {hayPeriodo && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <span className="text-muted">
              Período filtrado{desde ? ` desde ${desde}` : ''}{hasta ? ` hasta ${hasta}` : ''}.
            </span>
            <Link
              href="/mi-cuenta"
              className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Ver todo el histórico
            </Link>
          </div>
        )}
      </main>
    </>
  )
}
