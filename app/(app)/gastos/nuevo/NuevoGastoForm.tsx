'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { registrarGastoAction } from '../../rendiciones/actions'
import { NuevaCategoriaGastoInline } from '@/components/gastos/NuevaCategoriaGastoInline'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { hoyISO } from '@/lib/utils/hoy'
import { Select } from '@/components/ui/Select'

interface Cat { id: string; nombre: string }

const NUEVA_CAT = '__nueva__'

/**
 * Formulario de alta de gasto. Se usa tanto en `/gastos/nuevo` (página completa)
 * como dentro de `NuevoGastoModalButton` (modal sobre `/gastos`).
 * Sin `onSuccess` navega a `/gastos`; con `onSuccess` cede el control al llamador
 * (cerrar modal y refrescar la tabla de gastos).
 */
export function NuevoGastoForm({
  categorias,
  onSuccess,
  onCancel,
}: {
  categorias: Cat[]
  onSuccess?: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [cats, setCats] = useState<Cat[]>(categorias)
  const [idCat, setIdCat] = useState(categorias[0]?.id ?? '')
  const [monto, setMonto] = useState('')
  const [descripcion, setDescripcion] = useState('')
  // `toISOString()` daba la fecha UTC: de noche en Argentina el gasto quedaba
  // con el día siguiente.
  const [fecha, setFecha] = useState(() => hoyISO())
  const [comprobante, setComprobante] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [inlineOpen, setInlineOpen] = useState(false)

  function onCategoriaChange(v: string) {
    if (v === NUEVA_CAT) {
      setInlineOpen(true)
      return
    }
    setIdCat(v)
  }

  function onCategoriaCreada(nueva: Cat) {
    setCats((prev) => [...prev, nueva].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')))
    setIdCat(nueva.id)
    setInlineOpen(false)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const m = Number(monto || 0)
    if (m <= 0) return setErr('Monto inválido')
    if (!idCat || idCat === NUEVA_CAT) return setErr('Elegí una categoría')
    setErr(null)
    start(async () => {
      const res = await registrarGastoAction({
        idCategoriaGasto: idCat,
        monto: m,
        descripcion: descripcion.trim() || null,
        fecha: fecha ? new Date(fecha).toISOString() : null,
        comprobanteRef: comprobante || null,
      })
      if (!res.ok) return toast.error('No se pudo registrar', mensajeDeError(res.reason))
      toast.success('Gasto registrado')
      if (!onSuccess) {
        router.push('/gastos')
        router.refresh()
        return
      }
      onSuccess()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Field htmlFor="g-cat" label="Categoría" required>
          <Select
            id="g-cat"
            value={idCat}
            onChange={(e) => onCategoriaChange(e.target.value)}
          >
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
            <option value={NUEVA_CAT}>+ Nueva categoría…</option>
          </Select>
        </Field>
        {/* Sólo abierto: la opción del select ya ofrece «+ Nueva categoría…»,
            el botón colapsado del componente la duplicaba. */}
        {inlineOpen && (
          <NuevaCategoriaGastoInline
            open
            onOpenChange={setInlineOpen}
            onCreated={onCategoriaCreada}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="g-monto" label="Monto" required>
          <NumberInput
            id="g-monto"
            thousands
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            autoFocus
          />
        </Field>
        <Field htmlFor="g-fecha" label="Fecha">
          <Input
            id="g-fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </Field>
      </div>

      <Field htmlFor="g-desc" label="Descripción" hint="Opcional">
        <Textarea
          id="g-desc"
          rows={3}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </Field>

      <Field htmlFor="g-comp" label="Referencia de comprobante" hint="Número de factura/recibo (opcional)">
        <Input id="g-comp" value={comprobante} onChange={(e) => setComprobante(e.target.value)} />
      </Field>

      {err && (
        <div role="alert" className="rounded-md border border-alerta-ink bg-alerta-bg px-3 py-2 text-sm text-alerta-ink">
          {err}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="secondary"
          onClick={() => (onCancel ? onCancel() : router.back())}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Registrar gasto'}
        </Button>
      </div>
    </form>
  )
}
