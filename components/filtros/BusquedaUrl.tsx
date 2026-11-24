'use client'

import { useEffect, useRef } from 'react'
import { FilterBar } from '@/components/ui/FilterBar'
import { useFiltrosUrl, useValorSincronizado } from './useFiltrosUrl'

export interface BusquedaUrlProps {
  /** Nombre del query param. */
  param?: string
  /** Valor inicial que viene del server. */
  valor: string
  placeholder?: string
  paramPagina?: string
}

const DEBOUNCE_MS = 300

/**
 * Barra de búsqueda conectada a la URL con debounce de 300 ms en el handler
 * (no en un `useEffect` dependiente de la URL) para no re-disparar navegaciones
 * cuando otros filtros cambian.
 */
export function BusquedaUrl({
  param = 'q',
  valor,
  placeholder,
  paramPagina,
}: BusquedaUrlProps) {
  const { aplicar } = useFiltrosUrl({ paramPagina })
  const [texto, setTexto] = useValorSincronizado(valor)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  function manejarCambio(nuevo: string) {
    setTexto(nuevo)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const recortado = nuevo.trim()
      const actualEnUrl = new URLSearchParams(window.location.search).get(param) ?? ''
      if (recortado === actualEnUrl) return
      aplicar({ [param]: recortado || null })
    }, DEBOUNCE_MS)
  }

  return (
    <FilterBar
      value={texto}
      onChange={manejarCambio}
      placeholder={placeholder}
    />
  )
}
