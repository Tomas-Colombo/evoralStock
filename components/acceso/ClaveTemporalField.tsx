'use client'

import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'

/** Crypto-random temp password, avoiding ambiguous chars (0/O, 1/l/I). */
export function generarClaveTemporal(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const arr = new Uint32Array(14)
  crypto.getRandomValues(arr)
  return Array.from(arr, (n) => chars[n % chars.length]).join('')
}

/**
 * Contraseña temporal que escribe el administrador al crear un acceso. La
 * misma para usuarios y revendedoras: la persona entra con ella y lo primero
 * que se le pide es cambiarla.
 */
export function ClaveTemporalField({
  id,
  value,
  onChange,
  error,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  error?: string
}) {
  return (
    <Field
      htmlFor={id}
      label="Contraseña temporal"
      required
      hint="Mínimo 8 caracteres. Al ingresar por primera vez se le pide cambiarla."
      error={error}
    >
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Escribila o generala"
          autoComplete="off"
          invalid={!!error}
        />
        <Button type="button" variant="secondary" onClick={() => onChange(generarClaveTemporal())}>
          Generar
        </Button>
      </div>
    </Field>
  )
}
