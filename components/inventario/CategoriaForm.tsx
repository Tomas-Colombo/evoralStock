'use client'

import { useId, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { TallesEditor } from '@/components/inventario/TallesEditor'
import type { CategoriaRow } from '@/lib/types/inventario'
import { createCategoriaAction, updateCategoriaAction } from '@/app/(app)/inventario/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'

/**
 * Alta y edición de categoría. Un solo formulario para el ABM de
 * `/inventario/categorias` y el alta rápida desde el ingreso: antes eran dos
 * copias (la del ingreso sin descripción) y la validación y la fila optimista
 * se mantenían por duplicado.
 *
 * Con `categoria` edita; sin ella crea. En ambos casos devuelve la fila
 * resultante para que el llamador la ponga en su lista (y el ingreso la asigne
 * a la línea que disparó el alta). Siembra el estado al montar: quien lo
 * reutiliza con otra categoría tiene que remontarlo (`key`).
 */
export function CategoriaForm({
  categoria,
  onSaved,
  onCancel,
}: {
  categoria?: CategoriaRow
  onSaved: (categoria: CategoriaRow) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const [pending, start] = useTransition()
  const uid = useId()

  const [nombre, setNombre] = useState(categoria?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(categoria?.descripcion ?? '')
  const [talles, setTalles] = useState<string[]>(categoria?.talles ?? [])
  const [errNombre, setErrNombre] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (nombre.trim().length < 2) {
      setErrNombre('Mínimo 2 caracteres')
      return
    }
    setErrNombre(null)
    const campos = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || null,
      talles,
    }
    start(async () => {
      if (categoria) {
        const res = await updateCategoriaAction(categoria.id_categoria, {
          nombre,
          descripcion: descripcion || null,
          talles,
        })
        if (!res.ok) return toast.error('No se pudo guardar', mensajeDeError(res.reason))
        toast.success('Categoría actualizada')
        onSaved({ ...categoria, ...campos })
        return
      }

      const res = await createCategoriaAction({
        nombre,
        descripcion: descripcion || null,
        talles,
      })
      if (!res.ok) return toast.error('No se pudo crear', mensajeDeError(res.reason))
      if (!res.data) return toast.error('No se pudo crear')
      toast.success('Categoría creada')
      const now = new Date().toISOString()
      onSaved({
        id_categoria: res.data.id,
        id_tenant: '',
        activa: true,
        created_at: now,
        updated_at: now,
        ...campos,
      })
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field htmlFor={`${uid}-nombre`} label="Nombre" required error={errNombre ?? undefined}>
        <Input
          id={`${uid}-nombre`}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoFocus
          invalid={!!errNombre}
        />
      </Field>
      <Field htmlFor={`${uid}-desc`} label="Descripción">
        <Textarea
          id={`${uid}-desc`}
          rows={2}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </Field>
      <Field
        htmlFor={`${uid}-talles`}
        label="Talles"
        hint="Los talles/medidas de esta categoría (ej: S, M, L). Se usan al cargar productos e ingresos."
      >
        <TallesEditor id={`${uid}-talles`} value={talles} onChange={setTalles} disabled={pending} />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : categoria ? 'Guardar' : 'Crear categoría'}
        </Button>
      </div>
    </form>
  )
}
