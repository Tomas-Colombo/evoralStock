import { redirect } from 'next/navigation'
import { AuthorizationError } from '@/lib/dal/errors'
import { debeCambiarClave, verifySession } from '@/lib/dal/session'
import { PasswordChangeForm } from '../settings/PasswordChangeForm'

export const metadata = {
  title: 'Creá tu contraseña | Utopía',
}

export default async function CambiarClavePage() {
  try {
    await verifySession()
  } catch (error) {
    if (error instanceof AuthorizationError) redirect('/login')
    throw error
  }

  // Sin contraseña temporal pendiente no hay nada que hacer acá.
  if (!(await debeCambiarClave())) redirect('/ventas')

  return (
    <div className="w-full rounded-md border border-border bg-card p-8 shadow-sm">
      <div className="mb-6">
        <h1 className="font-display text-2xl text-text">Creá tu contraseña</h1>
        <p className="text-sm text-muted">
          Entraste con una contraseña temporal. Antes de seguir, elegí una propia: en el
          primer campo va la que te pasaron.
        </p>
      </div>
      <PasswordChangeForm />
    </div>
  )
}
