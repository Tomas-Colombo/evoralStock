'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { createCategoriaGastoAction } from '@/app/(app)/rendiciones/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'

export interface NuevaCategoriaGastoInlineProps {
  onCreated: (cat: { id: string; nombre: string }) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultExpanded?: boolean
  label?: string
  submitLabel?: string
  placeholder?: string
  className?: string
}

/**
 * Alta rápida e inline de categoría de gasto. Se usa dentro de formularios
 * (evitando anidar etiquetas `<form>` y atrapando Enter para no disparar el submit exterior)
 * y en la vista de presupuestos para unificar la creación de categorías.
 */
export function NuevaCategoriaGastoInline({
  onCreated,
  open: controlledOpen,
  onOpenChange,
  defaultExpanded = false,
  label,
  submitLabel = 'Crear',
  placeholder = 'Ej: Alquiler, Servicios, Impuestos',
  className = '',
}: NuevaCategoriaGastoInlineProps) {
  const toast = useToast()
  const [pending, start] = useTransition()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultExpanded)
  const isExpanded = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen

  function setIsExpanded(val: boolean) {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(val)
    }
    onOpenChange?.(val)
  }

  const [nombre, setNombre] = useState('')
  const [errNombre, setErrNombre] = useState<string | null>(null)

  function reset() {
    setNombre('')
    setErrNombre(null)
  }

  function handleCreate() {
    const trimmed = nombre.trim()
    if (trimmed.length < 2) {
      setErrNombre('Mínimo 2 caracteres')
      return
    }
    setErrNombre(null)
    start(async () => {
      const res = await createCategoriaGastoAction({ nombre: trimmed })
      if (!res.ok) return toast.error('No se pudo crear', mensajeDeError(res.reason))
      if (!res.data) return toast.error('No se pudo crear')
      toast.success('Categoría creada')
      onCreated({ id: res.data.id, nombre: trimmed })
      reset()
      if (!defaultExpanded) {
        setIsExpanded(false)
      }
    })
  }

  if (!isExpanded) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="text-xs font-medium text-muted hover:text-ink hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
        >
          + Nueva categoría
        </button>
      </div>
    )
  }

  const inputComponent = (
    <Input
      id="cat-nueva"
      value={nombre}
      onChange={(e) => {
        setNombre(e.target.value)
        if (errNombre) setErrNombre(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          handleCreate()
        }
      }}
      placeholder={placeholder}
      autoFocus={!defaultExpanded}
      disabled={pending}
      invalid={!!errNombre}
    />
  )

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          {label ? (
            <Field htmlFor="cat-nueva" label={label} error={errNombre ?? undefined}>
              {inputComponent}
            </Field>
          ) : (
            inputComponent
          )}
        </div>
        <Button
          type="button"
          size={label ? 'md' : 'sm'}
          onClick={handleCreate}
          disabled={pending}
        >
          {pending ? 'Guardando…' : submitLabel}
        </Button>
        {!defaultExpanded && (
          <Button
            type="button"
            variant="ghost"
            size={label ? 'md' : 'sm'}
            onClick={() => {
              reset()
              setIsExpanded(false)
            }}
            disabled={pending}
          >
            Cancelar
          </Button>
        )}
      </div>
      {!label && errNombre && (
        <p role="alert" className="text-xs font-medium text-alerta-ink">
          {errNombre}
        </p>
      )}
    </div>
  )
}
