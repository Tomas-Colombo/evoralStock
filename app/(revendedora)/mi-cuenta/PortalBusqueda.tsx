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
  const esPrimerRender = useRef(true)

  useEffect(() => {
    if (esPrimerRender.current) {
      esPrimerRender.current = false
      return
    }

    const timer = setTimeout(() => {
      const actualUrl = searchParams.get('q') ?? ''
      const limpio = valor.trim()
      if (limpio === actualUrl) return

      const params = new URLSearchParams(searchParams.toString())
      if (limpio) params.set('q', limpio)
      else params.delete('q')
      params.delete('pagina')
      const qs = params.toString()
      startTransition(() => router.push(qs ? `${basePath}?${qs}` : basePath))
    }, 300)

    return () => clearTimeout(timer)
  }, [valor, basePath, router, searchParams])

  return (
    <FilterBar
      value={valor}
      onChange={setValor}
      placeholder={placeholder}
      keyboardShortcut={false}
    />
  )
}
