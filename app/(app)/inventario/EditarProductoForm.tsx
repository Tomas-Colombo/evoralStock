'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import type { CategoriaRow, ProductoRow } from '@/lib/types/inventario'
import { updateProductoAction } from '@/app/(app)/inventario/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { Checkbox } from '@/components/ui/Checkbox'
import { Select } from '@/components/ui/Select'

/** Campos mínimos que la UI toca para editar un producto. Toma `ProductoRow`
 *  o cualquier subtipo (p. ej. `ProductoConDetalle` de la tabla). */
export type ProductoEditable = Pick<
  ProductoRow,
  'id_producto' | 'nombre' | 'id_categoria' | 'stock_minimo' | 'descripcion' | 'activo'
>

/**
 * Edición de producto. Un solo formulario para la ruta `/inventario/productos/[id]`
 * (enlaces directos desde el buscador) y el modal del listado y de la ficha:
 * antes eran dos copias casi idénticas. Sin `onSuccess` vuelve al inventario.
 * Siembra el estado al montar, así que quien lo reutiliza con otro producto
 * tiene que remontarlo (`key`).
 */
export function EditarProductoForm({
  producto,
  categorias,
  onSuccess,
  onCancel,
}: {
  producto: ProductoEditable
  categorias: CategoriaRow[]
  onSuccess?: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [nombre, setNombre] = useState(producto.nombre)
  const [idCategoria, setIdCategoria] = useState(producto.id_categoria)
  const [stockMinimo, setStockMinimo] = useState(String(producto.stock_minimo))
  const [descripcion, setDescripcion] = useState(producto.descripcion ?? '')
  const [activo, setActivo] = useState(producto.activo)

  const [errors, setErrors] = useState<{ nombre?: string; categoria?: string }>({})

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (nombre.trim().length < 2) errs.nombre = 'Mínimo 2 caracteres'
    if (!idCategoria) errs.categoria = 'Elegí una categoría'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    start(async () => {
      const res = await updateProductoAction(producto.id_producto, {
        nombre: nombre.trim(),
        id_categoria: idCategoria,
        stock_minimo: Number(stockMinimo || 0),
        descripcion: descripcion.trim() || null,
        activo,
      })
      if (!res.ok) return toast.error('No se pudo guardar', mensajeDeError(res.reason))
      toast.success('Producto actualizado')
      if (onSuccess) onSuccess()
      else router.push('/inventario')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field htmlFor="prod-nombre" label="Nombre" required error={errors.nombre}>
        <Input
          id="prod-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoFocus
          invalid={!!errors.nombre}
        />
      </Field>

      <Field htmlFor="prod-cat" label="Categoría" required error={errors.categoria}>
        <Select
          id="prod-cat"
          value={idCategoria}
          onChange={(e) => setIdCategoria(e.target.value)}
          aria-invalid={!!errors.categoria || undefined}
        >
          {categorias.map((c) => (
            <option key={c.id_categoria} value={c.id_categoria}>
              {c.nombre}
            </option>
          ))}
        </Select>
      </Field>

      <Field htmlFor="prod-stock" label="Stock mínimo">
        <NumberInput
          id="prod-stock"
          min={0}
          value={stockMinimo}
          onChange={(e) => setStockMinimo(e.target.value)}
        />
      </Field>

      <Field htmlFor="prod-desc" label="Descripción">
        <Textarea
          id="prod-desc"
          rows={3}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-text">
        <Checkbox
          checked={activo}
          onChange={(e) => setActivo(e.target.checked)}
        />
        Producto activo
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="secondary"
          onClick={() => (onCancel ? onCancel() : router.back())}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}
