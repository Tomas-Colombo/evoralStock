'use client'

import { forwardRef, useState } from 'react'
import { Input, type InputProps } from './Input'

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  /**
   * Render a plain `<input>` with only `className`, for surfaces that bring
   * their own field style (the login panel). Otherwise it is the `Input`
   * primitive, whose base classes would clash with a foreign palette.
   */
  bare?: boolean
  /** Color classes for the eye button, to match the surface it sits on. */
  toggleClassName?: string
}

/**
 * Password field with an eye button that reveals what is being typed, so a
 * typo can be caught before submitting. Always starts hidden.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    { bare = false, className = '', toggleClassName = 'text-muted hover:text-ink focus-visible:ring-ink', disabled, ...rest },
    ref,
  ) {
    const [visible, setVisible] = useState(false)
    const type = visible ? 'text' : 'password'
    // "clave", not "contraseña": label lookups match by substring, so
    // getByLabel('Contraseña') would hit this button too (e2e login).
    const label = visible ? 'Ocultar clave' : 'Mostrar clave'

    return (
      <div className="relative w-full">
        {bare ? (
          <input ref={ref} type={type} disabled={disabled} className={`w-full pr-11 ${className}`} {...rest} />
        ) : (
          <Input ref={ref} type={type} disabled={disabled} className={`pr-11 ${className}`} {...rest} />
        )}
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={label}
          aria-pressed={visible}
          title={label}
          className={`absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-md transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-50 ${toggleClassName}`}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    )
  },
)

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.9" />
      <path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  )
}
