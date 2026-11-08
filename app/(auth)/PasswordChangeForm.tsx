'use client'

import { useActionState, useState, type FormEvent } from 'react'
import { changePasswordAction, type ChangePasswordActionState } from './settings/password-actions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

const initialState: ChangePasswordActionState = { ok: false }
const MIN_PASSWORD_LENGTH = 8

/**
 * Password-change form (SECURITY-CRITICAL — spec 3.3/3.4, REQ-AUTH-07).
 * Client-side validation (min length + confirm match) runs in `onSubmit`
 * BEFORE the Server Action fires — `event.preventDefault()` stops the
 * `action={formAction}` submission entirely when validation fails, so no
 * request reaches the server for an obviously-invalid input. The server
 * action re-validates the same rules independently (defense in depth); the
 * server is always the authority.
 */
export function PasswordChangeForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState)
  const [clientError, setClientError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget)
    const newPassword = String(formData.get('new_password') ?? '')
    const confirmPassword = String(formData.get('confirm_new_password') ?? '')

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      event.preventDefault()
      setClientError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }

    if (newPassword !== confirmPassword) {
      event.preventDefault()
      setClientError('New password and confirmation do not match')
      return
    }

    setClientError(null)
  }

  const error = clientError ?? state.error

  return (
    <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="current_password" className="text-sm font-medium text-text">
          Current password
        </label>
        <Input
          id="current_password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="new_password" className="text-sm font-medium text-text">
          New password
        </label>
        <Input
          id="new_password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="confirm_new_password" className="text-sm font-medium text-text">
          Confirm new password
        </label>
        <Input
          id="confirm_new_password"
          name="confirm_new_password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-alerta-ink">
          {error}
        </p>
      )}
      {!error && state.ok && (
        <p role="status" className="text-sm text-success">
          Password updated successfully.
        </p>
      )}
      <Button
        type="submit"
        disabled={pending}
        className="self-start"
      >
        {pending ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  )
}
