import type { ReactNode } from 'react'
import Link from 'next/link'
import { FechaChip } from './FechaChip'

export interface BandKpi {
  label: string
  value: ReactNode
  /** `warn` recolors the value with the warn channel that is AA on the band. */
  tone?: 'default' | 'warn'
  /** Small caption under the value. */
  sub?: ReactNode
  /** Right-aligned note on the label row ("por nivel", "▲ 12 % vs. sep"). */
  hint?: ReactNode
  /** Mini chart under the value (segmented bar, sparkline). */
  viz?: ReactNode
}

interface PageBandProps {
  /** Plain text trail, last item is the current page. Not links on purpose:
   *  a link named like a sidebar item would double the nav landmark. */
  breadcrumb: string[]
  title: string
  /** One line under the title (scope, counts). */
  subtitle?: ReactNode
  /** Period filter etc. Rendered inside the `band-scope`, so ordinary
   *  Input/Button/Field components re-theme themselves for the dark strip. */
  filters?: ReactNode
  kpis?: BandKpi[]
  /** Right-hand side of the KPI row (secondary action + main action). */
  actions?: ReactNode
  /** Explicit "volver" link to the parent section (detail / form pages). */
  backHref?: string
  backLabel?: string
}

/**
 * Dark strip on top of a page (tema Grafito + Lino): breadcrumb, title, period
 * filters, KPIs separated by `band-line`, and the page actions on the right.
 * The area below it is the light `bg`, with the table on `panel`.
 *
 * It replaces `Topbar` on the pages that adopt it, so it keeps the same
 * contract: ONE `<h1>` holding exactly the title (e2e asserts it), the
 * `Barra superior` landmark, the left gutter that leaves room for the mobile
 * hamburger, and the date chip.
 *
 * `band-scope` (globals.css) remaps --ink/--muted/--control/... inside the
 * strip, which is what lets the shared form components work on a dark surface
 * without per-call overrides.
 */
export function PageBand({ breadcrumb, title, subtitle, filters, kpis, actions, backHref, backLabel }: PageBandProps) {
  const hasKpis = !!kpis && kpis.length > 0
  const filasKpi = kpis?.some((k) => k.sub || k.viz) ? 'row-span-3' : 'row-span-2'
  return (
    <header
      aria-label="Barra superior"
      className="band-scope relative isolate overflow-hidden w-full min-w-full bg-band text-band-ink"
    >
      <div
        aria-hidden="true"
        className="band-tatau pointer-events-none absolute inset-0 hidden sm:block print:hidden"
      />
      <div className="relative z-10 flex flex-col gap-3.5 pb-4 pl-16 pr-4 pt-3 sm:pr-6 md:px-6 md:pb-5">
        <div className="flex items-center justify-between gap-4">
          <nav aria-label="Ubicación" className="min-w-0">
            <ol className="eyebrow flex flex-wrap items-center gap-x-2 gap-y-1 text-band-label">
              {breadcrumb.map((item, i) => {
                const last = i === breadcrumb.length - 1
                return (
                  <li key={`${item}-${i}`} className="flex items-center gap-2">
                    {i > 0 && <span aria-hidden>/</span>}
                    <span aria-current={last ? 'page' : undefined} className={last ? 'text-band-ink' : ''}>
                      {item}
                    </span>
                  </li>
                )
              })}
            </ol>
          </nav>
          <FechaChip onDark />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            {backHref && (
              <Link
                href={backHref}
                aria-label={backLabel ?? 'Volver'}
                title={backLabel ?? 'Volver'}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-band-muted transition-colors hover:text-band-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-band-ink"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 12H5" />
                  <path d="M12 19l-7-7 7-7" />
                </svg>
              </Link>
            )}
            <div className="flex min-w-0 flex-col gap-2">
              <h1 className="break-words font-display text-3xl leading-[1.05] text-band-ink md:text-[38px]">{title}</h1>
              {subtitle && <p className="text-[13px] text-band-muted">{subtitle}</p>}
            </div>
          </div>
          {filters}
          {/* Without KPIs there is no column to hang the actions on: they sit on the title row. */}
          {/* Below sm the `size="sm"` buttons are the page's main tap target: 40px minimum. */}
          {!hasKpis && actions && (
            <div className="flex flex-wrap items-center gap-2 [&_button]:min-h-10 sm:[&_button]:min-h-0">{actions}</div>
          )}
        </div>

        {hasKpis && (
          // Single KPI row from lg and the actions column from xl: at md the sidebar
          // leaves ~190px for 4-5 KPIs plus the 260px column, and the eyebrow labels
          // overflowed into the next cell.
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
            {kpis && (
              <dl
                style={{ ["--kpi-cols" as string]: `minmax(0,1.7fr) repeat(${kpis.length - 1},minmax(0,1fr))` }}
                // Each KPI spans the same row tracks (subgrid): a label that wraps to two
                // lines in a narrow column grows the shared label row instead of pushing
                // only its own number down, so every value stays on one baseline.
                // `content-start self-start`: the grid row is as tall as the actions
                // column, and stretched auto tracks left a tall gap between label and value.
                className="@container grid grid-cols-2 content-start self-start border-t border-band-line lg:[grid-template-columns:var(--kpi-cols)]"
              >
                {kpis.map((k) => (
                  <div
                    key={k.label}
                    className={`grid min-w-0 grid-rows-subgrid content-start gap-y-3 pb-2 pr-4 pt-4 ${filasKpi} lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:border-band-line lg:[&:not(:first-child)]:pl-5`}
                  >
                    <dt className="flex min-w-0 items-baseline justify-between gap-2">
                      <span className={`eyebrow ${k.tone === 'warn' ? 'text-warn-on-dark' : 'text-band-label'}`}>
                        {k.label}
                      </span>
                      {k.hint && <span className="shrink-0 text-xs text-band-muted">{k.hint}</span>}
                    </dt>
                    <dd
                      // Sized from the whole strip (cqi of the <dl>), not per cell: every
                      // value gets the same height whatever its column width.
                      className={`font-figure text-[clamp(1.75rem,3.8cqi,2.5rem)] font-bold leading-none [font-stretch:100%] [overflow-wrap:anywhere] ${
                        k.tone === 'warn' ? 'text-warn-on-dark' : 'text-band-ink'
                      }`}
                    >
                      {k.value}
                    </dd>
                    {(k.viz || k.sub) && (
                      <div className="flex flex-col gap-2">
                        {k.viz}
                        {k.sub && <div className="text-xs text-band-muted">{k.sub}</div>}
                      </div>
                    )}
                  </div>
                ))}
              </dl>
            )}
            {actions && (
              <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2 xl:flex xl:flex-col [&_a]:block [&_button]:min-h-10 [&_button]:w-full [&_button]:justify-between">
                {actions}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
