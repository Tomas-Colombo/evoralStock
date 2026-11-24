'use client'

import { useActionState } from 'react'
import { loginAction, type LoginActionState } from './actions'
import { Button } from '@/components/ui/Button'
import { PasswordInput } from '@/components/ui/PasswordInput'

const initialState: LoginActionState = { ok: false }

/**
 * The form sits on its own translucent petrol panel over the animated
 * backdrop; the fields are one step deeper (--band-deep) so they read as
 * wells inside it.
 */
const FIELD_CLASS =
  'h-11 rounded-md border border-band-line bg-band-deep/80 px-3.5 text-[15px] text-band-ink placeholder:text-band-label transition-colors focus-visible:border-band-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-band-muted'

const LABEL_CLASS = 'eyebrow text-band-muted'

/**
 * Login form (design §5, spec 3.1/3.2). `useActionState` is React 19's
 * current API (replaces the deprecated `useFormState`, see Next.js 16
 * upgrade guide) — exposes `[state, formAction, pending]`.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState)

  return (
    <form
      action={formAction}
      className="flex flex-col gap-5 rounded-lg border border-band-line bg-band/80 p-6 shadow-[0_18px_40px_-20px_rgb(0_0_0/0.6)] backdrop-blur-sm"
    >
      <div className="flex flex-col gap-2.5">
        <label htmlFor="email" className={LABEL_CLASS}>
          Correo electrónico
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="nombre@empresa.com"
          required
          className={FIELD_CLASS}
        />
      </div>
      <div className="flex flex-col gap-2.5">
        <label htmlFor="password" className={LABEL_CLASS}>
          Contraseña
        </label>
        <PasswordInput
          bare
          id="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          className={FIELD_CLASS}
          toggleClassName="text-band-label hover:text-band-ink focus-visible:ring-band-muted"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-alerta-ink">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-1 h-11 w-full text-[15px]!">
        {pending ? 'Ingresando…' : 'Ingresar'}
        {!pending && <span aria-hidden className="text-lg leading-none">→</span>}
      </Button>
    </form>
  )
}
