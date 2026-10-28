'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { crearClienteAction } from '../../ventas/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import {
  CLIENTE_VACIO,
  ClienteFields,
  validarCliente,
  type ClienteErrores,
  type ClienteValores,
} from '@/components/clientes/ClienteFields'

/**
 * Alta de cliente. Se usa desde el modal del listado y desde la ruta
 * `/clientes/nuevo`, que sobrevive para enlaces directos: `onSuccess` decide
 * cuál de los dos cierres corresponde.
 */
export function NuevoClienteForm({ onSuccess }: { onSuccess?: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [valores, setValores] = useState<ClienteValores>(CLIENTE_VACIO)
  const [errores, setErrores] = useState<ClienteErrores>({ apellido: null, nombre: null })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validarCliente(valores)
    setErrores(errs)
    if (errs.nombre || errs.apellido) return

    const { nombre, apellido, telefono, email, notas } = valores
    start(async () => {
      const res = await crearClienteAction({
        nombre,
        apellido,
        telefono: telefono || null,
        email: email || null,
        notas: notas || null,
      })
      if (!res.ok) return toast.error('No se pudo crear', mensajeDeError(res.reason))
      toast.success('Cliente creado')
      if (onSuccess) onSuccess()
      else router.push('/clientes')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ClienteFields
        idPrefix="nc"
        values={valores}
        errors={errores}
        onChange={(patch) => setValores((v) => ({ ...v, ...patch }))}
      />
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => (onSuccess ? onSuccess() : router.back())}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Crear cliente'}
        </Button>
      </div>
    </form>
  )
}
