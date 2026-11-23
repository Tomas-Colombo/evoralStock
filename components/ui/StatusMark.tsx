import type { ReactNode } from 'react'

/**
 * Estados de una fila, en el lenguaje del tema Grafito + Lino.
 *
 * Nunca se comunica solo por color: cada marca lleva su texto visible al lado
 * (la forma —punto, anillo, segmentos— es el refuerzo, no el mensaje).
 */

type DotTone = 'ok' | 'ink' | 'alerta'

const DOT_TONE: Record<DotTone, string> = {
  // "Pagada" / "Registrada": punto petróleo, sin verde.
  ok: 'bg-petrol',
  ink: 'bg-ink',
  // Errores y anulaciones: el canal de alerta.
  alerta: 'bg-alerta',
}

/** Punto de 7px + texto. `ok` para Pagada/Registrada, `alerta` para Anulada. */
export function StatusDot({
  tone = 'ok',
  children,
}: {
  tone?: DotTone
  children: ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink">
      <span
        aria-hidden
        data-status-dot={tone}
        className={`h-[7px] w-[7px] shrink-0 rounded-full ${DOT_TONE[tone]}`}
      />
      {children}
    </span>
  )
}

/**
 * Reserva: anillo de 7px en `warn` + fecha de vencimiento en mono `warn-ink`.
 * `warn-ink` (no `warn`) porque es el único de los dos que llega a AA como
 * texto chico.
 */
export function ReservaMark({
  label = 'Reserva',
  vence,
}: {
  label?: string
  /** Fecha ya formateada para mostrar (ej. `14/10/2026`). */
  vence?: string
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink">
      <span
        aria-hidden
        data-status-ring
        className="h-[7px] w-[7px] shrink-0 rounded-full border-[1.5px] border-warn"
      />
      {label}
      {vence && (
        <span className="font-mono text-xs text-warn-ink">
          <span className="sr-only">vence </span>
          {vence}
        </span>
      )}
    </span>
  )
}

/**
 * Cuotas: un segmento de 12x5px por cuota (lleno en `ink`, vacío en `line-2`)
 * y el contador en mono ("1/3"). Los segmentos son decorativos; el contador es
 * el dato.
 */
export function CuotasProgress({ pagadas, total }: { pagadas: number; total: number }) {
  const llenas = Math.max(0, Math.min(pagadas, total))
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="inline-flex gap-[3px]">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            data-segment={i < llenas ? 'llena' : 'vacia'}
            className={`h-[5px] w-3 rounded-sm ${i < llenas ? 'bg-ink' : 'bg-line-2'}`}
          />
        ))}
      </span>
      <span className="font-mono text-xs text-muted">
        {llenas}/{total}
        <span className="sr-only"> cuotas pagas</span>
      </span>
    </span>
  )
}
