'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import type { ProveedorRow, TipoProveedor } from '@/lib/types/inventario'
import { createProveedorAction } from '@/lib/proveedores/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { Select } from '@/components/ui/Select'

const TIPOS_LABEL: Record<TipoProveedor, string> = {
  mayorista: 'Mayorista',
  particular: 'Particular',
  consignatario: 'Consignatario',
}

/**
 * Alta de proveedor. Un solo formulario para la ruta `/proveedores/nuevo`
 * (enlaces directos), el modal del listado y el alta rápida desde el ingreso:
 * antes había dos copias y cualquier campo nuevo había que agregarlo dos veces.
 * Sin `onSuccess` vuelve al listado; con `onSuccess` devuelve la fila (parcial)
 * para que el llamador decida, p. ej. preseleccionarla en el select del ingreso.
 */
export function NuevoProveedorForm({
  onSuccess,
  onCancel,
  tiposPermitidos,
}: {
  onSuccess?: (proveedor: ProveedorRow) => void
  onCancel?: () => void
  tiposPermitidos: readonly TipoProveedor[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const opciones = tiposPermitidos.map((val) => ({
    value: val,
    label: TIPOS_LABEL[val] ?? val,
  }))

  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoProveedor>(() => {
    return opciones[0]?.value ?? 'mayorista'
  })
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [cuit, setCuit] = useState('')
  const [dias, setDias] = useState('')
  const [notas, setNotas] = useState('')
  const [errNombre, setErrNombre] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (nombre.trim().length < 2) {
      setErrNombre('Mínimo 2 caracteres')
      return
    }
    setErrNombre(null)
    start(async () => {
      const res = await createProveedorAction({
        nombre,
        tipo,
        telefono: telefono || null,
        email: email || null,
        cuit: cuit || null,
        dias_rotacion: dias ? Number(dias) : null,
        notas: notas || null,
      })
      if (!res.ok) return toast.error('No se pudo crear', mensajeDeError(res.reason))
      if (!res.data) return toast.error('No se pudo crear')
      toast.success('Proveedor creado')
      if (!onSuccess) {
        router.push('/proveedores')
        router.refresh()
        return
      }
      onSuccess({
        id_proveedor: res.data.id,
        id_tenant: '',
        nombre: nombre.trim(),
        tipo,
        telefono: telefono || null,
        email: email || null,
        cuit: cuit || null,
        dias_rotacion: dias ? Number(dias) : null,
        notas: notas || null,
        activo: true,
        created_at: '',
        updated_at: '',
      })
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field htmlFor="p-nombre" label="Nombre" required error={errNombre ?? undefined}>
        <Input
          id="p-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoFocus
          invalid={!!errNombre}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="p-tipo" label="Tipo" required>
          <Select
            id="p-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoProveedor)}
          >
            {opciones.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          htmlFor="p-dias"
          label="Días de rotación esperados"
          hint="Usado por Reportes (RF-12)"
        >
          <NumberInput
            id="p-dias"
            min={0}
            value={dias}
            onChange={(e) => setDias(e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="p-tel" label="Teléfono" hint="Se usa para link WhatsApp">
          <Input
            id="p-tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="+54 9 11 ..."
          />
        </Field>
        <Field htmlFor="p-email" label="Email">
          <Input
            id="p-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      </div>

      <Field htmlFor="p-cuit" label="CUIT">
        <Input id="p-cuit" value={cuit} onChange={(e) => setCuit(e.target.value)} />
      </Field>

      <Field htmlFor="p-notas" label="Notas">
        <Textarea
          id="p-notas"
          rows={3}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
        />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="secondary"
          onClick={() => (onCancel ? onCancel() : router.back())}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Crear proveedor'}
        </Button>
      </div>
    </form>
  )
}
