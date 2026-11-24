'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { cambiarMiPasswordAction } from './actions'

export function CambiarPasswordCard() {
  const toast = useToast()
  const [pending, start] = useTransition()
  const [passwordActual, setPasswordActual] = useState('')
  const [passwordNuevo, setPasswordNuevo] = useState('')
  const [passwordConfirmacion, setPasswordConfirmacion] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!passwordActual) {
      return toast.error('Falta la contraseña actual', mensajeDeError('password-actual-requerida'))
    }

    if (passwordNuevo.length < 8) {
      return toast.error('Contraseña demasiado corta', mensajeDeError('password-corto'))
    }

    if (passwordNuevo !== passwordConfirmacion) {
      return toast.error('Las contraseñas no coinciden', mensajeDeError('passwords-no-coinciden'))
    }

    start(async () => {
      const res = await cambiarMiPasswordAction({
        passwordActual,
        passwordNuevo,
        passwordConfirmacion,
      })

      if (!res.ok) {
        return toast.error('No se pudo cambiar la contraseña', mensajeDeError(res.reason))
      }

      toast.success('Contraseña actualizada', 'Tu nueva contraseña ya está activa para los próximos inicios de sesión.')
      setPasswordActual('')
      setPasswordNuevo('')
      setPasswordConfirmacion('')
    })
  }

  return (
    <Card as="section" className="space-y-4">
      <div>
        <h3 className="font-display text-lg">Seguridad de la cuenta</h3>
        <p className="mt-0.5 text-sm text-muted">
          Cambiá tu contraseña de acceso personal. La nueva contraseña debe tener al menos 8 caracteres.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-3xl pt-2">
        <Field htmlFor="cfg-pwd-actual" label="Contraseña actual">
          <PasswordInput
            id="cfg-pwd-actual"
            autoComplete="current-password"
            value={passwordActual}
            onChange={(e) => setPasswordActual(e.target.value)}
            disabled={pending}
            required
          />
        </Field>

        <Field htmlFor="cfg-pwd-nuevo" label="Nueva contraseña">
          <PasswordInput
            id="cfg-pwd-nuevo"
            autoComplete="new-password"
            value={passwordNuevo}
            onChange={(e) => setPasswordNuevo(e.target.value)}
            disabled={pending}
            required
            minLength={8}
          />
        </Field>

        <Field htmlFor="cfg-pwd-confirmar" label="Confirmar contraseña">
          <PasswordInput
            id="cfg-pwd-confirmar"
            autoComplete="new-password"
            value={passwordConfirmacion}
            onChange={(e) => setPasswordConfirmacion(e.target.value)}
            disabled={pending}
            required
            minLength={8}
          />
        </Field>

        <div className="sm:col-span-3 pt-1">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pending || !passwordActual || !passwordNuevo || !passwordConfirmacion}
          >
            {pending ? 'Actualizando contraseña…' : 'Actualizar contraseña'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
