type KpiVariant = 'default' | 'alert' | 'highlight' | 'nested'
type KpiTone = 'default' | 'muted'

const BOX: Record<KpiVariant, string> = {
  default: 'border-border bg-card',
  alert: 'border-alerta-ink bg-alerta-bg',
  highlight: 'border-ink bg-card',
  nested: 'border-border bg-card-2',
}

export interface KpiProps {
  label: string
  value: string
  sub?: React.ReactNode
  variant?: KpiVariant
  tone?: KpiTone
}

/**
 * Tarjeta de KPI estandarizada para las home-pages de módulos.
 *
 * El tamaño del valor baja a `text-xl` en el rango tablet (md) — donde el
 * grid pasa de 2 a 4 columnas y las cajas quedan angostas — y vuelve a
 * `text-2xl` en desktop. `[overflow-wrap:anywhere]` es la red de seguridad
 * para montos muy largos ("$ 1.234.567,89") que igual sobrarían: quiebran
 * dentro de la caja en vez de rebalsarla. `tabular-nums` mantiene los
 * dígitos alineados entre tarjetas.
 */
export function Kpi({ label, value, sub, variant = 'default', tone = 'default' }: KpiProps) {
  return (
    <div className={`min-w-0 rounded-lg border p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ${BOX[variant]}`}>
      <div className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted [overflow-wrap:anywhere]">
        {label}
      </div>
      <div
        className={`mt-2 font-figure text-[28px] font-bold leading-none [font-stretch:100%] md:text-2xl lg:text-[28px] [overflow-wrap:anywhere] ${
          tone === 'muted' ? 'text-muted' : 'text-text'
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  )
}
