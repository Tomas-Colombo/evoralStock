'use client'

import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { useFiltrosUrl, useValorSincronizado } from './useFiltrosUrl'

export interface OpcionSelectUrl {
  value: string
  label: string
}

export interface SelectUrlProps {
  id: string
  param: string
  valor: string
  opciones: OpcionSelectUrl[]
  /** Si se elige este valor, se borra el param de la URL. */
  valorPorDefecto?: string
  /** Si se pasa, envuelve el select en un `Field` con este label. */
  label?: string
  ariaLabel?: string
  paramPagina?: string
  className?: string
}

/**
 * Select conectado a la URL que aplica inmediatamente al cambiar, sin botón
 * "Aplicar".
 */
export function SelectUrl({
  id,
  param,
  valor,
  opciones,
  valorPorDefecto,
  label,
  ariaLabel,
  paramPagina,
  className,
}: SelectUrlProps) {
  const { aplicar, pendiente } = useFiltrosUrl({ paramPagina })
  const [seleccionado, setSeleccionado] = useValorSincronizado(valor)

  function manejarCambio(nuevo: string) {
    setSeleccionado(nuevo)
    const valorUrl = valorPorDefecto !== undefined && nuevo === valorPorDefecto ? null : nuevo
    aplicar({ [param]: valorUrl })
  }

  const select = (
    <Select
      id={id}
      value={seleccionado}
      onChange={(e) => manejarCambio(e.target.value)}
      aria-label={label ? undefined : ariaLabel}
      disabled={pendiente}
      className={className}
    >
      {opciones.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  )

  if (!label) return select

  return (
    <Field htmlFor={id} label={label}>
      {select}
    </Field>
  )
}
