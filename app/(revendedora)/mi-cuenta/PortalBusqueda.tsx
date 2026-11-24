'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FilterBar } from '@/components/ui/FilterBar'

export function PortalBusqueda({
  basePath,
  initialValue,
  placeholder = 'Buscar...',
}: {
  basePath: string
  initialValue: string
  placeholder?: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [valor, setValor] = useState(initialValue)
  const [, startTransition] = useTransition()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function handleChange(nuevoValor: string) {
    setValor(nuevoValor)
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      const actualUrl = searchParams.get('q') ?? ''
      const limpio = nuevoValor.trim()
      if (limpio === actualUrl) return

      const params = new URLSearchParams(searchParams.toString())
      if (limpio) params.set('q', limpio)
      else params.delete('q')
      params.delete('pagina')
      const qs = params.toString()
      startTransition(() => router.push(qs ? `${basePath}?${qs}` : basePath))
    }, 300)
  }

  return (
    <FilterBar
      value={valor}
      onChange={handleChange}
      placeholder={placeholder}
      keyboardShortcut={false}
    />
  )
}
