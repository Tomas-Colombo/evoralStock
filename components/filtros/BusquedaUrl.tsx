'use client'

import { useEffect, useRef, useState } from 'react'
import { FilterBar } from '@/components/ui/FilterBar'
import { useFiltrosUrl } from './useFiltrosUrl'

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
  const [texto, setTexto] = useState(valor)
  const [prevValor, setPrevValor] = useState(valor)
  const [enviados, setEnviados] = useState<string[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (prevValor !== valor) {
    setPrevValor(valor)
    const indice = enviados.indexOf(valor)
    if (indice !== -1) {
      // Cola de envíos en vuelo: un eco tardío de un envío anterior no debe
      // pisar lo que se siguió tipeando ni desfasar el siguiente eco.
      setEnviados(enviados.slice(indice + 1))
    } else {
      setTexto(valor)
      if (enviados.length > 0) setEnviados([])
    }
  }

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
      setEnviados((prev) => [...prev, recortado])
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
