'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { linkWhatsappAcceso } from '@/lib/acceso/whatsapp'

/**
 * Se muestra una sola vez, apenas se crea el acceso: la contraseña temporal
 * no se guarda en ningún lado que el administrador pueda volver a ver.
 * WhatsApp solo se habilita con un teléfono cargado.
 */
export function CompartirAccesoModal({
  open,
  onClose,
  nombre,
  email,
  password,
  telefonoInicial,
}: {
  open: boolean
  onClose: () => void
  nombre: string
  email: string
  password: string
  telefonoInicial?: string | null
}) {
  const toast = useToast()
  const [telefono, setTelefono] = useState(telefonoInicial ?? '')

  const urlIngreso = typeof window === 'undefined' ? '' : `${window.location.origin}/login`
  const linkWhatsapp = linkWhatsappAcceso({ telefono, nombre, email, password, urlIngreso })

  async function copiar() {
    try {
      await navigator.clipboard.writeText(`Email: ${email}\nContraseña temporal: ${password}`)
      toast.success('Datos de acceso copiados.')
    } catch {
      toast.error('No se pudo copiar. Copialos a mano.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Acceso creado"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={copiar}>
            Copiar
          </Button>
          {linkWhatsapp ? (
            <a
              href={linkWhatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md bg-block px-4 py-2 text-sm font-semibold text-block-ink"
            >
              Enviar por WhatsApp
            </a>
          ) : (
            <Button type="button" disabled>
              Enviar por WhatsApp
            </Button>
          )}
          <Button type="button" variant="neutral" onClick={onClose}>
            Listo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Compartile estos datos a {nombre}. Es la única vez que vas a ver la contraseña.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md border border-border bg-card-2 p-3 text-sm">
          <dt className="text-muted">Email</dt>
          <dd className="break-all font-mono">{email}</dd>
          <dt className="text-muted">Contraseña</dt>
          <dd className="break-all font-mono">{password}</dd>
        </dl>
        <Field
          htmlFor="acceso-telefono"
          label="Teléfono para WhatsApp"
          hint={linkWhatsapp ? undefined : 'Cargá un teléfono para enviar el acceso por WhatsApp.'}
        >
          <Input
            id="acceso-telefono"
            type="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="Ej: 11 5555-1234"
            autoComplete="off"
          />
        </Field>
      </div>
    </Modal>
  )
}
