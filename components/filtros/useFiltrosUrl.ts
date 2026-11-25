'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export interface OpcionesFiltrosUrl {
  /** Nombre del query param de paginación que se limpia al cambiar filtros. */
  paramPagina?: string
  /** Si se preserva el scroll al navegar (default `true`). */
  scroll?: boolean
}

/**
 * Hook compartido para filtros gobernados por URL.
 *
 * Lee `window.location.search` y `window.location.pathname` al momento de
 * aplicar (no los `searchParams` del render) para que cada filtro modifique
 * solo sus params sin pisar lo que otro aplicó en paralelo.
 */
export function useFiltrosUrl({ paramPagina = 'pagina', scroll = true }: OpcionesFiltrosUrl = {}) {
  const router = useRouter()
  const [pendiente, startTransition] = useTransition()

  function aplicar(cambios: Record<string, string | null | undefined>) {
    const params = new URLSearchParams(window.location.search)

    // Al cambiar un filtro se vuelve a la primera página, salvo que este mismo
    // cambio esté actualizando la página.
    if (!Object.prototype.hasOwnProperty.call(cambios, paramPagina)) {
      params.delete(paramPagina)
    }

    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor === '' || valor == null) {
        params.delete(clave)
      } else {
        params.set(clave, valor)
      }
    }

    const qs = params.toString()
    const destino = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    startTransition(() => router.push(destino, { scroll }))
  }

  return { aplicar, pendiente }
}

/**
 * Estado local que se resincroniza cuando cambia la prop que viene del server,
 * ajustando el estado durante el render ("adjusting state when a prop changes")
 * para evitar `key={...}` o efectos que pinten el valor viejo un frame antes.
 */
export function useValorSincronizado<T>(externo: T) {
  const [valor, setValor] = useState(externo)
  const [previo, setPrevio] = useState(externo)

  if (previo !== externo) {
    setPrevio(externo)
    setValor(externo)
  }

  return [valor, setValor] as const
}
