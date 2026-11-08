'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import type { ProveedorRow } from '@/lib/types/inventario'
import { updateProveedorAction } from '../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import {
  ProveedorFields,
  validarProveedor,
  type ProveedorErrores,
  type ProveedorValores,
} from '@/components/inventario/ProveedorFields'

export function EditarProveedorButton({ proveedor }: { proveedor: ProveedorRow }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Editar
      </Button>
      <Modal open={open} title="Editar proveedor" size="lg" onClose={() => setOpen(false)}>
        {open && (
          <FormularioEditar
            key={proveedor.id_proveedor}
            proveedor={proveedor}
            onClose={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  )
}

function FormularioEditar({
  proveedor,
  onClose,
}: {
  proveedor: ProveedorRow
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [valores, setValores] = useState<ProveedorValores>({
    nombre: proveedor.nombre,
    tipo: proveedor.tipo,
    telefono: proveedor.telefono ?? '',
    email: proveedor.email ?? '',
    cuit: proveedor.cuit ?? '',
    dias: proveedor.dias_rotacion != null ? String(proveedor.dias_rotacion) : '',
    notas: proveedor.notas ?? '',
  })
  const [errores, setErrores] = useState<ProveedorErrores>({ nombre: null })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validarProveedor(valores)
    setErrores(errs)
    if (errs.nombre) return

    const { nombre, telefono, email, cuit, dias, notas } = valores
    start(async () => {
      const res = await updateProveedorAction(proveedor.id_proveedor, {
        nombre: nombre.trim(),
        telefono: telefono.trim() || null,
        email: email.trim() || null,
        cuit: cuit.trim() || null,
        dias_rotacion: dias ? Number(dias) : null,
        notas: notas.trim() || null,
      })
      if (!res.ok) {
        return toast.error(
          'No se pudo guardar',
          mensajeDeError(res.reason, { accion: 'editar proveedores' }),
        )
      }
      toast.success('Proveedor actualizado')
      onClose()
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ProveedorFields
        idPrefix="ep"
        values={valores}
        errors={errores}
        onChange={(patch) => setValores((prev) => ({ ...prev, ...patch }))}
        tiposPermitidos={[proveedor.tipo]}
        tipoBloqueado
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" type="button" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}
