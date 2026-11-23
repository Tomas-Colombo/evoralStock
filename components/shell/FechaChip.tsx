'use client'

import { useSyncExternalStore } from 'react'

/**
 * Current date, mono/uppercase, pinned to the top-right of the topbar
 * (design system v2). Format: `MAR 08 · JUL 2026`.
 *
 * Client component on purpose: the server renders with ITS clock and timezone,
 * which can be a day off from the user's near midnight. The first client render
 * recomputes from the browser clock, and `suppressHydrationWarning` absorbs the
 * text difference instead of blanking the slot and shifting the layout.
 */
export function FechaChip({ onDark = false }: { onDark?: boolean }) {
  const label = useSyncExternalStore(subscribeToClock, getLabel, getLabel)

  return (
    <span
      suppressHydrationWarning
      className={`hidden font-mono text-[10.5px] uppercase tracking-[0.06em] sm:inline ${
        onDark ? 'text-band-label' : 'text-muted'
      }`}
    >
      {label}
    </span>
  )
}

/**
 * The clock is the external system here, so it is modelled as a store rather
 * than as `useState` + an effect that immediately overwrites it.
 *
 * The initial `setTimeout(…, 0)` is what actually matters: during hydration
 * React renders from `getServerSnapshot` to match the server HTML, so without
 * a change notification the chip would keep displaying the SERVER's date
 * forever — the very bug this component exists to avoid. Firing once on mount
 * makes React re-read the browser clock and commit it.
 *
 * The interval is the part the old effect-based version never had: it also
 * rolls the date over at midnight for anyone who leaves a tab open.
 */
function subscribeToClock(onStoreChange: () => void) {
  const initial = setTimeout(onStoreChange, 0)
  const tick = setInterval(onStoreChange, 60_000)
  return () => {
    clearTimeout(initial)
    clearInterval(tick)
  }
}

/**
 * Safe as a snapshot despite reading the clock: it returns a STRING that only
 * changes once a day, and React compares snapshots with `Object.is`. An equal
 * string means no re-render, so there is no loop.
 */
function getLabel(): string {
  return formatToday(new Date())
}

const WEEKDAY = new Intl.DateTimeFormat('es-AR', { weekday: 'short' })
const MONTH = new Intl.DateTimeFormat('es-AR', { month: 'short' })

/** `MAR 08 · JUL 2026` — trailing dots that some locales append are stripped. */
function formatToday(date: Date): string {
  const weekday = clean(WEEKDAY.format(date))
  const month = clean(MONTH.format(date))
  const day = String(date.getDate()).padStart(2, '0')
  return `${weekday} ${day} · ${month} ${date.getFullYear()}`
}

function clean(part: string): string {
  return part.replace(/\.$/, '').toUpperCase()
}
