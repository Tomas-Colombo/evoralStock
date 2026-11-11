'use client'

import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/Input'
import type { ProductoConDetalle, ProductoSinCosto } from '@/lib/types/inventario'
import { buscarMatchNombre, indexarPorNombre, normalizar } from '@/lib/inventario/producto-match'

export type ProductoNombreValue = {
  nombre: string
  /** Producto vinculado cuando el nombre matchea uno existente (esNuevo=false). */
  idProducto: string
  /** true = producto nuevo (nombre único); false = vinculado a uno existente. */
  esNuevo: boolean
}

/**
 * Campo de nombre de producto con autocompletado creable.
 *
 * Comportamiento (compartido con el import de PDF):
 *  - Se escribe libremente. Si el texto coincide (normalizado) con un producto
 *    del inventario, se selecciona ese producto y se destilda "es nuevo".
 *  - Si no coincide con ninguno, el nombre es único → queda como nuevo.
 *  - El desplegable sugiere productos existentes; al elegir uno, se vincula.
 *
 * El toggle Nuevo/Vincular vive afuera; este campo solo mantiene el nombre y el
 * vínculo coherentes con lo que se escribe.
 */
export function ProductoNombreCombobox({
  productos,
  value,
  onChange,
  disabled,
  placeholder = 'Escribí el producto…',
  className,
}: {
  productos: (ProductoConDetalle | ProductoSinCosto)[]
  value: ProductoNombreValue
  onChange: (next: ProductoNombreValue) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const index = useMemo(() => indexarPorNombre(productos), [productos])

  const sugerencias = useMemo(() => {
    const q = normalizar(value.nombre)
    const list = q
      ? productos.filter((p) => normalizar(p.nombre).includes(q))
      : productos
    return list.slice(0, 8)
  }, [productos, value.nombre])

  function escribir(nombre: string) {
    // Al escribir, si el nombre coincide con un producto existente lo vinculamos
    // y destildamos "es nuevo" (auto). Si no coincide, conservamos el modo
    // elegido con el toggle y soltamos cualquier vínculo viejo.
    const match = buscarMatchNombre(index, nombre)
    onChange(
      match
        ? { nombre, idProducto: match.id_producto, esNuevo: false }
        : { ...value, nombre, idProducto: '' },
    )
  }

  function elegir(p: ProductoConDetalle | ProductoSinCosto) {
    onChange({ nombre: p.nombre, idProducto: p.id_producto, esNuevo: false })
    setOpen(false)
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <Input
        value={value.nombre}
        onChange={(e) => {
          escribir(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && sugerencias.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card-2 shadow"
        >
          {sugerencias.map((p) => (
            <li
              key={p.id_producto}
              role="option"
              aria-selected={p.id_producto === value.idProducto}
              // onMouseDown para seleccionar antes de que el input haga blur.
              onMouseDown={(e) => {
                e.preventDefault()
                elegir(p)
              }}
              className={`cursor-pointer px-3 py-2 text-sm hover:bg-line ${
                p.id_producto === value.idProducto ? 'bg-line' : 'text-text'
              }`}
            >
              {p.nombre}
              {p.sku ? <span className="text-muted"> · {p.sku}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
