'use client'

import { useEffect, useRef } from 'react'
import { SelectUrl } from '@/components/filtros/SelectUrl'
import { useFiltrosUrl, useValorSincronizado } from '@/components/filtros/useFiltrosUrl'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
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
  /** Si se elige este valor, se borra el param de la URL. */
  valorPorDefecto?: string
  /** Clase de ancho de Tailwind (estática, para que el JIT la vea). */
  ancho?: string
}

/**
 * Filtro de período compartido (franja `PageBand` y portal revendedor):
 * Desde / Hasta, desplegables opcionales y presets. Sin botón "Aplicar": cada
 * cambio filtra solo. Las fechas esperan un momento porque el input nativo
 * dispara un cambio por cada dígito del año (0002, 0020, 0202, 2026) y serían
 * cuatro navegaciones.
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
  ariaLabel,
  idPrefix,
  desde,
  hasta,
  extras = [],
  apilado = false,
  paramPagina,
}: RangoFechas & {
  ariaLabel: string
  /** Prefijo de los ids de los controles (únicos por page). */
  idPrefix: string
  extras?: FiltroExtra[]
  /**
   * Para una card angosta (portal revendedor) en vez de la franja: campos en
   * grilla pareja y presets en su propia fila. En la fila suelta, los
   * presets caían solos a la derecha y quedaba desordenado.
   */
  apilado?: boolean
  paramPagina?: string
}) {
  const { aplicar: aplicarUrl, pendiente } = useFiltrosUrl({ paramPagina })
  const [d, setD] = useValorSincronizado(desde)
  const [h, setH] = useValorSincronizado(hasta)

  const rangoInvertido = d > h
  const timerFecha = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerFecha.current) clearTimeout(timerFecha.current)
    }
  }, [])

  function aplicarFechas(nd: string, nh: string) {
    if (timerFecha.current) clearTimeout(timerFecha.current)
    // Una fecha vacía no se manda: si se borra un extremo, el filtro queda
    // abierto de ese lado y la page aplica su default.
    aplicarUrl({
      desde: nd || null,
      hasta: nh || null,
    })
  }

  function cambiarFecha(nd: string, nh: string) {
    setD(nd)
    setH(nh)
    if (timerFecha.current) clearTimeout(timerFecha.current)
    if (nd && nh && nd > nh) return
    timerFecha.current = setTimeout(() => aplicarFechas(nd, nh), 600)
  }

  function aplicarPreset(preset: Preset) {
    const { desde: nd, hasta: nh } = PRESETS.find((p) => p.id === preset)!.rango()
    setD(nd)
    setH(nh)
    aplicarFechas(nd, nh)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!rangoInvertido) aplicarFechas(d, h)
      }}
      className={apilado ? 'flex w-full flex-col gap-3' : 'flex w-full flex-wrap items-end gap-3 lg:w-auto'}
      aria-label={ariaLabel}
    >
      {/* `contents` keeps the band layout untouched: the fields stay direct
          flex items of the form. */}
      <div className={apilado ? 'grid grid-cols-2 items-start gap-3 sm:grid-cols-3' : 'contents'}>
      {/* Desde/Hasta side by side at 375px instead of one per row. */}
      <div className={apilado ? undefined : 'w-[calc(50%-0.375rem)] sm:w-40'}>
        <Field
          htmlFor={`${idPrefix}-desde`}
          label="Desde"
          error={rangoInvertido ? 'Posterior a "Hasta"' : undefined}
        >
          {/* No se deshabilitan mientras está pendiente para no perder el foco al tipear. */}
          <Input
            id={`${idPrefix}-desde`}
            type="date"
            value={d}
            max={h}
            invalid={rangoInvertido}
            onChange={(e) => cambiarFecha(e.target.value, h)}
          />
        </Field>
      </div>
      <div className={apilado ? undefined : 'w-[calc(50%-0.375rem)] sm:w-40'}>
        <Field htmlFor={`${idPrefix}-hasta`} label="Hasta">
          <Input
            id={`${idPrefix}-hasta`}
            type="date"
            value={h}
            min={d}
            onChange={(e) => cambiarFecha(d, e.target.value)}
          />
        </Field>
      </div>

      {extras.map((x) => (
        <div key={x.param} className={apilado ? 'col-span-2 sm:col-span-1' : `max-w-full ${x.ancho ?? 'w-40'}`}>
          <SelectUrl
            id={`${idPrefix}-${x.param}`}
            param={x.param}
            valor={x.value}
            opciones={x.options}
            valorPorDefecto={x.valorPorDefecto}
            label={x.label}
            paramPagina={paramPagina}
          />
        </div>
      ))}
      </div>

      <div className={apilado ? 'flex flex-wrap items-center justify-between gap-2' : 'ml-auto flex flex-wrap items-center gap-2'}>
        <div className="flex flex-wrap rounded-md border border-control-line p-[3px]">
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
        {pendiente && <span className="text-xs text-muted" role="status">Filtrando…</span>}
      </div>
    </form>
  )
}
