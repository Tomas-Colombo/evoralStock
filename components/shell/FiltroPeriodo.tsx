'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import {
  anioActual,
  hoyRango,
  mesActual,
  mesAnterior,
  type RangoFechas,
} from '@/lib/fechas'

type Preset = 'hoy' | 'mes' | 'mesAnterior' | 'anio'

const PRESETS: Array<{ id: Preset; label: string; rango: () => RangoFechas }> = [
  { id: 'hoy', label: 'Hoy', rango: hoyRango },
  { id: 'mes', label: 'Este mes', rango: mesActual },
  { id: 'mesAnterior', label: 'Mes anterior', rango: mesAnterior },
  { id: 'anio', label: 'Este año', rango: anioActual },
]

/** Desplegable extra que acompaña al período (canal, proveedor, estado…). */
export interface FiltroExtra {
  /** Nombre del query param. Un valor vacío no se manda. */
  param: string
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  /** Clase de ancho de Tailwind (estática, para que el JIT la vea). */
  ancho?: string
  /** Aplica en el momento de elegir, sin esperar a "Aplicar". */
  aplicarAlCambiar?: boolean
}

/**
 * Filtro de período de las pages con franja (`PageBand`): Desde / Hasta,
 * desplegables opcionales, presets y "Aplicar". Pensado para ir en el slot
 * `filters` de la franja.
 *
 * Todo vive en la URL (`?desde=&hasta=` + los params de los extras, días
 * calendario inclusivos) para que el filtro sea compartible y sobreviva a un
 * refresh; el server re-consulta con esos valores.
 *
 * Los presets se calculan en el cliente a propósito: el rango tiene que salir
 * de la zona horaria del USUARIO, no de la del server. Todo el cálculo pasa
 * por `lib/fechas`, que evita el corrimiento de día de `toISOString()`.
 */
export function FiltroPeriodo({
  basePath,
  ariaLabel,
  idPrefix,
  desde,
  hasta,
  extras = [],
}: RangoFechas & {
  basePath: string
  ariaLabel: string
  /** Prefijo de los ids de los controles (únicos por page). */
  idPrefix: string
  extras?: FiltroExtra[]
}) {
  const router = useRouter()
  const [d, setD] = useState(desde)
  const [h, setH] = useState(hasta)
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(extras.map((e) => [e.param, e.value])),
  )
  const [pendiente, startTransition] = useTransition()

  const rangoInvertido = d > h

  function aplicar(nd: string, nh: string, nv: Record<string, string>) {
    const params = new URLSearchParams({ desde: nd, hasta: nh })
    for (const e of extras) {
      if (nv[e.param]) params.set(e.param, nv[e.param])
    }
    startTransition(() => router.push(`${basePath}?${params.toString()}`))
  }

  function aplicarPreset(preset: Preset) {
    const { desde: nd, hasta: nh } = PRESETS.find((p) => p.id === preset)!.rango()
    setD(nd)
    setH(nh)
    aplicar(nd, nh, vals)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!rangoInvertido) aplicar(d, h, vals)
      }}
      className="flex w-full flex-wrap items-end gap-3 lg:w-auto"
      aria-label={ariaLabel}
    >
      {/* Desde/Hasta side by side at 375px instead of one per row. */}
      <div className="w-[calc(50%-0.375rem)] sm:w-40">
        <Field
          htmlFor={`${idPrefix}-desde`}
          label="Desde"
          error={rangoInvertido ? 'Posterior a "Hasta"' : undefined}
        >
          <Input
            id={`${idPrefix}-desde`}
            type="date"
            value={d}
            max={h}
            invalid={rangoInvertido}
            onChange={(e) => setD(e.target.value)}
            disabled={pendiente}
          />
        </Field>
      </div>
      <div className="w-[calc(50%-0.375rem)] sm:w-40">
        <Field htmlFor={`${idPrefix}-hasta`} label="Hasta">
          <Input
            id={`${idPrefix}-hasta`}
            type="date"
            value={h}
            min={d}
            onChange={(e) => setH(e.target.value)}
            disabled={pendiente}
          />
        </Field>
      </div>

      {extras.map((x) => (
        <div key={x.param} className={`max-w-full ${x.ancho ?? 'w-40'}`}>
          <Field htmlFor={`${idPrefix}-${x.param}`} label={x.label}>
            <Select
              id={`${idPrefix}-${x.param}`}
              value={vals[x.param] ?? ''}
              onChange={(e) => {
                const next = { ...vals, [x.param]: e.target.value }
                setVals(next)
                if (x.aplicarAlCambiar && !rangoInvertido) aplicar(d, h, next)
              }}
              disabled={pendiente}
            >
              {x.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ))}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-md border border-band-line p-[3px]">
        {PRESETS.map((p) => (
          <Button
            key={p.id}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => aplicarPreset(p.id)}
            disabled={pendiente}
          >
            {p.label}
          </Button>
        ))}
        </div>
        <Button type="submit" disabled={pendiente || rangoInvertido}>
          {pendiente ? 'Filtrando…' : 'Aplicar'}
        </Button>
      </div>
    </form>
  )
}
