'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import {
  buscarMatchNombre,
  indexarPorNombre,
  normalizar,
} from '@/lib/inventario/producto-match'
import type { ProductoSinCosto } from '@/lib/types/inventario'

import { QrScanner } from '@/components/inventario/QrScanner'

/**
 * Buscador unificado de la ficha de un ítem: el mismo input acepta QR, SKU o
 * nombre. Mientras se escribe aparecen sugerencias por NOMBRE (nunca por SKU,
 * para no abrir un ítem equivocado); Enter selecciona la resaltada. Sin
 * sugerencias, el texto se resuelve como código vía
 * `/inventario/buscar/{codigo}` (QR o SKU).
 */
export function BuscadorFicha({ productos }: { productos: ProductoSinCosto[] }) {
  const router = useRouter()
  const [qr, setQr] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [camaraOpen, setCamaraOpen] = useState(false)

  const [sugerenciasOpen, setSugerenciasOpen] = useState(false)
  const [resaltado, setResaltado] = useState(0)
  const indexNombres = useMemo(() => indexarPorNombre(productos), [productos])
  const sugerencias = useMemo(() => {
    const q = normalizar(qr)
    if (!q) return []
    return productos.filter((p) => normalizar(p.nombre).includes(q)).slice(0, 8)
  }, [productos, qr])

  // Al elegir un producto por nombre navegamos por su SKU (el usuario nunca lo
  // tipea, así que no hay riesgo de equivocación). Sin SKU, caemos a su ficha
  // de producto por id.
  function irAProducto(p: ProductoSinCosto) {
    if (p.sku) router.push(`/inventario/buscar/${encodeURIComponent(p.sku)}`)
    else router.push(`/inventario/productos/${p.id_producto}`)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (sugerenciasOpen && sugerencias.length > 0) {
      irAProducto(sugerencias[Math.min(resaltado, sugerencias.length - 1)])
      return
    }
    const trimmed = qr.trim()
    // Nombre exacto → producto; si no, se resuelve como código (QR/SKU).
    const match = buscarMatchNombre(indexNombres, trimmed)
    if (match) {
      setError(null)
      irAProducto(match)
      return
    }
    if (trimmed.length < 3) {
      setError('El código debe tener al menos 3 caracteres')
      return
    }
    setError(null)
    router.push(`/inventario/buscar/${encodeURIComponent(trimmed)}`)
  }

  function onBuscadorKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!sugerenciasOpen || sugerencias.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setResaltado((i) => Math.min(sugerencias.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setResaltado((i) => Math.max(0, i - 1))
    } else if (e.key === 'Escape') {
      setSugerenciasOpen(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-dashed border-border bg-card-2 p-6 text-center">
        {camaraOpen ? (
          <QrScanner
            onDetected={(code) => {
              setQr(code)
              setCamaraOpen(false)
              router.push(`/inventario/buscar/${encodeURIComponent(code)}`)
            }}
            onClose={() => setCamaraOpen(false)}
          />
        ) : (
          <>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-card-3 text-muted">
              <svg aria-hidden viewBox="0 0 16 16" fill="none" className="h-6 w-6">
                <path
                  d="M2 5.5A1.5 1.5 0 0 1 3.5 4h1.3l1-1.5h4.4l1 1.5h1.3A1.5 1.5 0 0 1 14 5.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-6Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <circle cx="8" cy="8.5" r="2.25" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </div>
            <p className="text-sm text-muted">Buscar ítem o producto mediante la cámara.</p>
            <Button variant="secondary" onClick={() => setCamaraOpen(true)} className="mt-3">
              Abrir cámara
            </Button>
          </>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Field
          htmlFor="qr-manual"
          label="Buscar por nombre o código"
          hint="Nombre del producto, QR del ítem o SKU (ej: REM-0007-M)."
          error={error ?? undefined}
        >
          <div className="relative">
            <Input
              id="qr-manual"
              value={qr}
              onChange={(e) => {
                setQr(e.target.value)
                setSugerenciasOpen(true)
                setResaltado(0)
              }}
              onFocus={() => setSugerenciasOpen(true)}
              onBlur={() => setTimeout(() => setSugerenciasOpen(false), 120)}
              onKeyDown={onBuscadorKeyDown}
              placeholder="Nombre, QR o SKU"
              autoFocus
              invalid={!!error}
              role="combobox"
              aria-expanded={sugerenciasOpen && sugerencias.length > 0}
              aria-autocomplete="list"
            />
            {sugerenciasOpen && sugerencias.length > 0 && (
              <ul
                role="listbox"
                className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card-2 shadow"
              >
                {sugerencias.map((p, i) => {
                  const activo = i === Math.min(resaltado, sugerencias.length - 1)
                  return (
                    <li
                      key={p.id_producto}
                      role="option"
                      aria-selected={activo}
                      // onMouseDown para seleccionar antes del blur del input.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        irAProducto(p)
                      }}
                      onMouseEnter={() => setResaltado(i)}
                      className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${
                        activo ? 'bg-line text-text' : 'text-text'
                      }`}
                    >
                      <span>{p.nombre}</span>
                      <span className="shrink-0 font-mono text-xs text-muted">
                        {p.stock_disponible} u.
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Field>
        <Button type="submit">Buscar ítem</Button>
      </form>
    </div>
  )
}
