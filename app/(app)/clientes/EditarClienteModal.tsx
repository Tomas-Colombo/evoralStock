'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import type { ClienteRow } from '@/lib/types/ventas'
import { updateClienteAction } from '../ventas/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import {
  ClienteFields,
  validarCliente,
  type ClienteErrores,
  type ClienteValores,
} from '@/components/clientes/ClienteFields'

/**
 * Edición de cliente en modal. Se usa desde el listado y desde la ficha: es
 * el mismo formulario, y una ruta `/clientes/[id]/editar` sólo agregaría una
 * pantalla para cambiar un teléfono.
 *
 * `apellido` es obligatorio desde 00058. Los clientes anteriores lo tienen en
 * `null` — este formulario es justamente por donde se van corrigiendo, así
 * que la validación aplica también al editar.
 */
export function EditarClienteModal({
  cliente,
  open,
  onClose,
}: {
  cliente: ClienteRow | null
  open: boolean
  onClose: () => void
}) {
  return (
    <Modal open={open} title="Editar cliente" onClose={onClose}>
      {/* `key` por cliente: al abrir el modal sobre otra fila el formulario se
          REMONTA con sus valores iniciales. Sincronizarlo con un efecto
          funcionaba, pero encadenaba un render extra por apertura — y el
          estado inicial derivado de props es justo lo que `key` resuelve. */}
      {cliente && (
        <FormularioEditar key={cliente.id_cliente} cliente={cliente} onClose={onClose} />
      )}
    </Modal>
  )
}

function FormularioEditar({
  cliente,
  onClose,
}: {
  cliente: ClienteRow
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [valores, setValores] = useState<ClienteValores>({
    apellido: cliente.apellido ?? '',
    nombre: cliente.nombre,
    telefono: cliente.telefono ?? '',
    email: cliente.email ?? '',
    notas: cliente.notas ?? '',
  })
  const [errores, setErrores] = useState<ClienteErrores>({ apellido: null, nombre: null })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validarCliente(valores)
    setErrores(errs)
    if (errs.nombre || errs.apellido) return

    const { nombre, apellido, telefono, email, notas } = valores
    start(async () => {
      const res = await updateClienteAction({
        id: cliente.id_cliente,
        patch: {
          nombre: nombre.trim(),
          apellido: apellido.trim(),
          telefono: telefono.trim() || null,
          email: email.trim() || null,
          notas: notas.trim() || null,
        },
      })
      if (!res.ok) {
        return toast.error(
          'No se pudo guardar',
          mensajeDeError(res.reason, { accion: 'editar clientes' }),
        )
      }
      toast.success('Cliente actualizado')
      onClose()
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {!cliente.apellido && (
        <p className="rounded-md border border-border bg-card-2 px-3 py-2 text-xs text-muted">
          Este cliente se cargó con el nombre completo en un solo campo.
          Separalo para que aparezca en el orden alfabético.
        </p>
      )}

      <ClienteFields
        idPrefix="ec"
        values={valores}
        errors={errores}
        onChange={(patch) => setValores((v) => ({ ...v, ...patch }))}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}
