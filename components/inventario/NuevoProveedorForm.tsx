'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import type { ProveedorRow, TipoProveedor } from '@/lib/types/inventario'
import { createProveedorAction } from '@/lib/proveedores/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import {
  ProveedorFields,
  validarProveedor,
  type ProveedorErrores,
  type ProveedorValores,
} from './ProveedorFields'

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

  const [values, setValues] = useState<ProveedorValores>(() => ({
    nombre: '',
    tipo: tiposPermitidos[0] ?? 'mayorista',
    telefono: '',
    email: '',
    cuit: '',
    dias: '',
    notas: '',
  }))
  const [errors, setErrors] = useState<ProveedorErrores>({ nombre: null })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const err = validarProveedor(values)
    if (err.nombre) {
      setErrors(err)
      return
    }
    setErrors({ nombre: null })
    start(async () => {
      const res = await createProveedorAction({
        nombre: values.nombre,
        tipo: values.tipo,
        telefono: values.telefono || null,
        email: values.email || null,
        cuit: values.cuit || null,
        dias_rotacion: values.dias ? Number(values.dias) : null,
        notas: values.notas || null,
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
        nombre: values.nombre.trim(),
        tipo: values.tipo,
        telefono: values.telefono || null,
        email: values.email || null,
        cuit: values.cuit || null,
        dias_rotacion: values.dias ? Number(values.dias) : null,
        notas: values.notas || null,
        activo: true,
        created_at: '',
        updated_at: '',
      })
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ProveedorFields
        idPrefix="p"
        values={values}
        errors={errors}
        onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
        tiposPermitidos={tiposPermitidos}
      />

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
