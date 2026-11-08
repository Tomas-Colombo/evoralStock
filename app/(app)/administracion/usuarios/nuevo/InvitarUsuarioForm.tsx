'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { invitarUsuarioAction } from '../../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { Select } from '@/components/ui/Select'
import { ClaveTemporalField } from '@/components/acceso/ClaveTemporalField'
import { CompartirAccesoModal } from '@/components/acceso/CompartirAccesoModal'

export interface DatosAccesoCreado {
  nombre: string
  email: string
  password: string
  telefono: string | null
}

export function InvitarUsuarioForm({
  roles,
  revendedorasLibres,
  onSuccess,
  onCancel,
}: {
  roles: Array<{ id: string; nombre: string }>
  revendedorasLibres?: Array<{
    id_revendedora: string
    nombre: string
    apellido: string
    telefono: string | null
  }>
  onSuccess?: (datos: DatosAccesoCreado) => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [idRol, setIdRol] = useState('')
  const [idRevendedora, setIdRevendedora] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [creado, setCreado] = useState(false)

  const isRevendedoraRole = roles.find((r) => r.id === idRol)?.nombre === 'Revendedora'
  const revendedoraElegida = revendedorasLibres?.find((r) => r.id_revendedora === idRevendedora)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    start(async () => {
      let res
      if (isRevendedoraRole) {
        if (!idRevendedora) return setErr('Debe elegir una revendedora sin acceso')
        const { darAccesoRevendedoraAction } = await import('@/lib/revendedoras/actions')
        res = await darAccesoRevendedoraAction({
          idRevendedora,
          email,
          nombreCompleto: nombre,
          password
        })
      } else {
        res = await invitarUsuarioAction({
          email,
          nombreCompleto: nombre,
          idRol,
          password,
        })
      }
      if (!res.ok) {
        const rawReason = (res as { reason?: unknown }).reason
        const msg = typeof rawReason === 'string' ? rawReason : ((rawReason as { reason?: string })?.reason || 'error-desconocido')
        const finalMsg = mensajeDeError(msg, { accion: 'invitar usuarios' })
        setErr(finalMsg)
        return toast.error('No se pudo invitar', finalMsg)
      }
      if (onSuccess) {
        onSuccess({
          nombre,
          email,
          password,
          telefono: (isRevendedoraRole ? revendedoraElegida?.telefono : null) ?? null,
        })
      } else {
        setCreado(true)
      }
    })
  }

  function cerrarCompartir() {
    router.push('/administracion/usuarios')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-md border border-border bg-card-2 p-3 text-xs text-muted">
        Se crea la cuenta con una contraseña temporal. Compartila con la
        persona: al ingresar por primera vez se le pide cambiarla.
      </div>

      <Field htmlFor="ue" label="Email" required error={err ?? undefined}>
        <Input
          id="ue"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          invalid={!!err}
        />
      </Field>

      <Field htmlFor="un" label="Nombre completo" required>
        <Input id="un" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </Field>

      <Field htmlFor="ur" label="Rol" required hint="Define qué módulos podrá ver y usar">
        <Select
          id="ur"
          value={idRol}
          onChange={(e) => setIdRol(e.target.value)}
        >
          <option value="">— Elegí un rol —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </Select>
      </Field>

      {isRevendedoraRole && revendedorasLibres && (
        <Field htmlFor="idRev" label="Revendedora a enlazar" required hint="Solo se muestran revendedoras activas sin usuario">
          {revendedorasLibres.length > 0 ? (
            <Select
              id="idRev"
              value={idRevendedora}
              onChange={(e) => setIdRevendedora(e.target.value)}
              className="px-2 py-1"
            >
              <option value="">— Elegí la revendedora —</option>
              {revendedorasLibres.map((r) => (
                <option key={r.id_revendedora} value={r.id_revendedora}>
                  {r.nombre} {r.apellido}
                </option>
              ))}
            </Select>
          ) : (
            <div className="text-sm text-muted-2">No hay revendedoras libres para invitar.</div>
          )}
        </Field>
      )}

      <ClaveTemporalField id="up" value={password} onChange={setPassword} />

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => (onCancel ? onCancel() : router.back())}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Invitando…' : 'Invitar usuario'}
        </Button>
      </div>

      {creado && !onSuccess && (
        <CompartirAccesoModal
          open
          onClose={cerrarCompartir}
          nombre={nombre}
          email={email}
          password={password}
          telefonoInicial={isRevendedoraRole ? revendedoraElegida?.telefono : null}
        />
      )}
    </form>
  )
}
