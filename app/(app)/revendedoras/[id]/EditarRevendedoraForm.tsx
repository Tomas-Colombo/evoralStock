'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Modal } from '@/components/ui/Modal'
import { ClaveTemporalField } from '@/components/acceso/ClaveTemporalField'
import { CompartirAccesoModal } from '@/components/acceso/CompartirAccesoModal'
import { mensajeDeError } from '@/lib/errores/mensajes'
import type { RevendedoraRow } from '@/lib/types/revendedoras'
import { editarRevendedoraAction } from '../actions'

export function EditarRevendedoraForm({ revendedora }: { revendedora: RevendedoraRow }) {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [accesoOpen, setAccesoOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [compartirOpen, setCompartirOpen] = useState(false)

  const nombreCompleto = `${revendedora.nombre} ${revendedora.apellido}`.trim()

  async function darAcceso() {
    if (!revendedora.email) return
    setLoading(true)
    const { darAccesoRevendedoraAction } = await import('../actions')
    const res = await darAccesoRevendedoraAction({
      idRevendedora: revendedora.id_revendedora,
      email: revendedora.email,
      nombreCompleto,
      password,
    })
    setLoading(false)
    if (!res.ok) {
      const rawR = (res as { reason?: unknown }).reason
      const msg = typeof rawR === 'string' ? rawR : ((rawR as { reason?: string })?.reason || 'error-desconocido')
      return toast.error('No se pudo dar acceso', mensajeDeError(msg))
    }
    setAccesoOpen(false)
    setCompartirOpen(true)
  }

  async function action(formData: FormData) {
    setLoading(true)
    const payload = {
      nombre: formData.get('nombre') as string,
      apellido: formData.get('apellido') as string,
      telefono: (formData.get('telefono') as string) || null,
      email: (formData.get('email') as string) || null,
      notas: (formData.get('notas') as string) || null,
    }

    const res = await editarRevendedoraAction(revendedora.id_revendedora, payload)
    if (!res.ok) {
      toast.error(mensajeDeError(res.reason))
      setLoading(false)
      return
    }

    toast.success('Cambios guardados')
    router.push('/revendedoras')
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="er_nombre" label="Nombre" required>
          <Input id="er_nombre" name="nombre" defaultValue={revendedora.nombre} required autoComplete="off" />
        </Field>
        <Field htmlFor="er_apellido" label="Apellido" required>
          <Input id="er_apellido" name="apellido" defaultValue={revendedora.apellido} required autoComplete="off" />
        </Field>
      </div>
      
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="er_telefono" label="Teléfono">
          <Input id="er_telefono" name="telefono" type="tel" defaultValue={revendedora.telefono || ''} autoComplete="off" />
        </Field>
        <Field htmlFor="er_email" label="Email">
          <Input id="er_email" name="email" type="email" defaultValue={revendedora.email || ''} autoComplete="off" />
        </Field>
      </div>

      <Field htmlFor="er_notas" label="Notas">
        <Textarea id="er_notas" name="notas" rows={3} defaultValue={revendedora.notas || ''} />
      </Field>

      <div className="mt-4 flex flex-wrap justify-between gap-3">
        <div className="flex gap-2">
          {!revendedora.id_usuario ? (
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => {
                if (!revendedora.email) return toast.error('La revendedora debe tener un email para darle acceso')
                setPassword('')
                setAccesoOpen(true)
              }}
            >
              Dar acceso
            </Button>
          ) : (
            <Button
              type="button"
              variant="danger"
              disabled={loading}
              onClick={async () => {
                if (!confirm('¿Seguro que querés revocar el acceso? La revendedora no podrá volver a iniciar sesión.')) return
                setLoading(true)
                const { revocarAccesoRevendedoraAction } = await import('../actions')
                const res = await revocarAccesoRevendedoraAction(revendedora.id_revendedora)
                setLoading(false)
                if (!res.ok) {
                  const rawR = (res as { reason?: unknown }).reason
                  const msg = typeof rawR === 'string' ? rawR : ((rawR as { reason?: string })?.reason || 'error-desconocido')
                  return toast.error('No se pudo revocar', mensajeDeError(msg))
                }
                toast.success('Acceso revocado')
              }}
            >
              Revocar acceso
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="neutral" onClick={() => router.back()} disabled={loading}>
            Volver
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </div>
      </div>

      <Modal
        open={accesoOpen}
        onClose={() => {
          if (!loading) setAccesoOpen(false)
        }}
        title="Dar acceso"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setAccesoOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="button" onClick={darAcceso} disabled={loading || password.trim().length < 8}>
              {loading ? 'Dando acceso...' : 'Dar acceso'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {nombreCompleto} va a ingresar con {revendedora.email}.
          </p>
          <ClaveTemporalField id="er_password" value={password} onChange={setPassword} />
        </div>
      </Modal>

      {compartirOpen && revendedora.email && (
        <CompartirAccesoModal
          open
          onClose={() => {
            setCompartirOpen(false)
            router.refresh()
          }}
          nombre={revendedora.nombre}
          email={revendedora.email}
          password={password}
          telefonoInicial={revendedora.telefono}
        />
      )}
    </form>
  )
}
