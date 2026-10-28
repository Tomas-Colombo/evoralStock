'use client'

import { useId, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { crearClienteAction } from '@/app/(app)/ventas/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'

/** Lo que el selector de cliente necesita para listar y preseleccionar al nuevo. */
export interface ClienteCreado {
  id: string
  nombre: string
  telefono: string | null
}

/**
 * Alta rápida de cliente en línea (nombre, apellido, teléfono) desde la venta
 * y la reserva. Antes eran dos copias idénticas del estado, la validación y el
 * markup. El llamador lo monta y desmonta con su botón «+ Nuevo»: al
 * desmontarse se descarta lo tipeado y el error, sin un reset a mano.
 */
export function ClienteQuickCreate({
  onCreated,
  className = '',
  botonAnchoCompleto = false,
}: {
  onCreated: (cliente: ClienteCreado) => void
  className?: string
  botonAnchoCompleto?: boolean
}) {
  const toast = useToast()
  const uid = useId()
  const [guardando, start] = useTransition()
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [telefono, setTelefono] = useState('')
  const [error, setError] = useState<string | null>(null)

  function crear() {
    const n = nombre.trim()
    const a = apellido.trim()
    if (n.length < 2) return setError('Nombre muy corto')
    // Obligatorio igual que en el alta completa: la cartera se ordena y se
    // busca por apellido, y con cuotas financiadas es como se rastrea la deuda.
    if (a.length < 2) return setError('Falta el apellido')
    setError(null)
    start(async () => {
      const res = await crearClienteAction({
        nombre: n,
        apellido: a,
        telefono: telefono.trim() || null,
      })
      if (!res.ok) return setError(mensajeDeError(res.reason))
      if (!res.data) return setError(mensajeDeError(''))
      // Mismo armado que la columna generada `nombre_completo` (00058):
      // nombre y después apellido. Si divergen, el cliente recién creado se
      // vería distinto que al recargar la página.
      const completo = `${n} ${a}`
      toast.success('Cliente creado', completo)
      onCreated({ id: res.data.id, nombre: completo, telefono: telefono.trim() || null })
    })
  }

  function enterCrea(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      crear()
    }
  }

  return (
    <div className={`space-y-3 rounded-md border border-border bg-card-2 p-3 ${className}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field htmlFor={`${uid}-nombre`} label="Nombre" required error={error ?? undefined}>
          <Input
            id={`${uid}-nombre`}
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            invalid={!!error}
            onKeyDown={enterCrea}
          />
        </Field>
        <Field htmlFor={`${uid}-apellido`} label="Apellido" required>
          <Input
            id={`${uid}-apellido`}
            value={apellido}
            onChange={(e) => setApellido(e.target.value)}
            onKeyDown={enterCrea}
          />
        </Field>
      </div>
      <Field htmlFor={`${uid}-tel`} label="Teléfono" hint="Se usa para link WhatsApp">
        <Input
          id={`${uid}-tel`}
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="+54 9 11 ..."
          onKeyDown={enterCrea}
        />
      </Field>
      <Button
        type="button"
        size="sm"
        className={botonAnchoCompleto ? 'w-full' : undefined}
        onClick={crear}
        disabled={guardando || nombre.trim().length < 2 || apellido.trim().length < 2}
      >
        {guardando ? 'Creando…' : 'Crear y seleccionar'}
      </Button>
    </div>
  )
}
