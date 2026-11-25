'use client'

import { Button } from '@/components/ui/Button'

/** Un talle con su stock, tal como lo devuelve `elegir-talle`. */
export interface TalleOpcion {
  talle: string
  disponibles: number
  /** Unidades del talle tomadas por una reserva activa ajena. */
  reservados?: number
}

/** Clave interna de la fila "sin talle" dentro de `cantidades`. */
export const SIN_TALLE_KEY = '__sin__'

export interface SelectorTalle {
  idProducto: string
  productoNombre: string
  /** null = agregar líneas nuevas; si tiene valor, es la key del grupo a reestructurar. */
  grupoKey: string | null
  opciones: TalleOpcion[]
  /** Unidades disponibles SIN talle asignado — se ofrecen aparte. */
  sinTalle: number
  /** Unidades sin talle tomadas por una reserva activa ajena. */
  sinTalleReservados?: number
  /**
   * Reserva a la que se puede enganchar la venta para liberar las unidades
   * reservadas. `null`/ausente = las reservadas no son tomables (es el caso
   * del alta de reserva, donde no existe la noción de adoptar).
   */
  idReservaAdoptable?: string | null
  /** Etiqueta corta de esa reserva (cliente), para el cartel. */
  reservaLabel?: string | null
  /** Cantidad por talle elegida por el operador. Clave = talle o '__sin__'. */
  cantidades: Record<string, number>
}

/**
 * Selector multi-talle. El operador ve TODOS los talles del producto con su
 * stock libre y un input de cantidad por talle. Puede combinar (ej. 1 M + 1 S)
 * y confirmar todo en una sola acción. En modo "cambiar" arranca precargado
 * con la distribución actual del grupo, así se reestructura sin tener que
 * reescribir desde cero.
 *
 * Compartido entre el carrito de venta y el alta de reserva: el gate de
 * desambiguación de talle es del server (`elegir-talle`), y ambos flujos lo
 * resuelven con la misma UI.
 */
export function SelectorTalleMulti({
  selector,
  disabled,
  onChangeCantidad,
  onConfirm,
  onCancel,
}: {
  selector: SelectorTalle
  disabled: boolean
  onChangeCantidad: (key: string, nueva: number, max: number) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  // Las unidades reservadas suman al tope SÓLO si la venta puede adoptar esa
  // reserva. Si no, se muestran igual pero no se pueden tomar.
  const adopta = !!selector.idReservaAdoptable
  const filas: Array<{
    key: string
    label: string
    corto: string
    libres: number
    reservados: number
    max: number
  }> = selector.opciones.map((o) => {
    const reservados = o.reservados ?? 0
    return {
      key: o.talle,
      label: `Talle ${o.talle}`,
      corto: o.talle,
      libres: o.disponibles,
      reservados,
      max: o.disponibles + (adopta ? reservados : 0),
    }
  })
  const sinTalleReservados = selector.sinTalleReservados ?? 0
  if (selector.sinTalle > 0 || sinTalleReservados > 0) {
    filas.push({
      key: SIN_TALLE_KEY,
      label: 'Sin talle',
      corto: 'Sin talle',
      libres: selector.sinTalle,
      reservados: sinTalleReservados,
      max: selector.sinTalle + (adopta ? sinTalleReservados : 0),
    })
  }
  const totalElegido = Object.values(selector.cantidades).reduce((a, b) => a + b, 0)
  const esCambio = !!selector.grupoKey
  const hayReservados = filas.some((f) => f.reservados > 0)

  return (
    <div className="space-y-3 rounded-lg border border-line-2 bg-card p-4 shadow-[var(--band-lift)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex min-w-0 shrink-0 flex-col gap-0.5 lg:max-w-[220px] lg:border-r lg:border-line lg:pr-4">
          <span className="eyebrow text-dim">
            {esCambio ? 'Reestructurar talles' : 'Elegí talle y cantidad'}
          </span>
          <span className="truncate font-display text-base text-ink">{selector.productoNombre}</span>
        </div>

        <div className="flex flex-1 flex-wrap gap-2">
          {filas.map((f) => {
            const cant = selector.cantidades[f.key] ?? 0
            const agotado = f.max === 0
            return (
              <ChipTalle
                key={f.key}
                label={f.label}
                corto={f.corto}
                libres={f.libres}
                reservados={f.reservados}
                max={f.max}
                cant={cant}
                disabled={disabled || agotado}
                onChange={(n) => onChangeCantidad(f.key, n, f.max)}
              />
            )
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
          <span className="text-xs text-muted">
            {totalElegido === 0 ? (
              'Tocá un talle para sumar unidades.'
            ) : (
              <>
                <span className="font-semibold text-ink">{totalElegido}</span> unidad
                {totalElegido === 1 ? '' : 'es'} a {esCambio ? 'dejar en el carrito' : 'agregar'}.
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={disabled || totalElegido === 0}
              onClick={onConfirm}
            >
              {esCambio ? 'Aplicar cambio' : `Agregar ${totalElegido || ''}`.trim()}
            </Button>
            <Button
              type="button"
              variant="bare"
              onClick={onCancel}
              className="px-2 py-1.5 text-[13px] text-alerta-ink hover:underline"
            >
              Cancelar
            </Button>
          </div>
        </div>
      </div>

      {hayReservados && (
        <p className="rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-xs text-warn-ink">
          {adopta
            ? `Hay unidades reservadas${selector.reservaLabel ? ` para ${selector.reservaLabel}` : ''}. Si las tomás, la venta queda ligada a esa reserva.`
            : 'Hay unidades reservadas por otra reserva activa: no se pueden tomar desde acá.'}
        </p>
      )}
    </div>
  )
}

/**
 * Un talle como chip: tocarlo suma una unidad (hasta el tope) y el «−» resta.
 * Con unidades elegidas el chip se invierte a oscuro y la cantidad va en cobre,
 * así lo elegido se lee de un vistazo en una fila de talles.
 */
function ChipTalle({
  label,
  corto,
  libres,
  reservados,
  max,
  cant,
  disabled,
  onChange,
}: {
  label: string
  corto: string
  libres: number
  reservados: number
  max: number
  cant: number
  disabled: boolean
  onChange: (n: number) => void
}) {
  const activo = cant > 0
  return (
    <div
      className={`inline-flex items-center rounded-full border transition-colors ${
        activo ? 'border-band bg-band text-band-ink' : 'border-line-2 bg-card text-ink'
      } ${disabled && !activo ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        onClick={() => onChange(cant + 1)}
        disabled={disabled || cant >= max}
        aria-label={`Sumar ${label}`}
        className="inline-flex items-center gap-2 rounded-full py-1.5 pl-3.5 pr-1.5 disabled:cursor-not-allowed"
      >
        <span className="text-sm font-bold">{corto}</span>
        <span className={`font-mono text-[10.5px] ${activo ? 'text-band-muted' : 'text-dim'}`}>
          {libres} disp.
        </span>
        {reservados > 0 && (
          <span className="font-mono text-[10.5px] text-warn-ink">
            · {reservados} res.
          </span>
        )}
        <span
          className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-mono text-xs ${
            activo ? 'bg-copper text-band' : 'bg-panel-2 text-dim'
          }`}
        >
          {cant}
        </span>
      </button>
      {activo && (
        <button
          type="button"
          onClick={() => onChange(cant - 1)}
          disabled={disabled}
          aria-label={`Restar ${label}`}
          className="rounded-full py-1.5 pl-1 pr-3 text-sm leading-none text-band-ink hover:text-copper"
        >
          −
        </button>
      )}
    </div>
  )
}
