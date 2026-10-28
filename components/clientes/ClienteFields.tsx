'use client'

import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'

export interface ClienteValores {
  apellido: string
  nombre: string
  telefono: string
  email: string
  notas: string
}

export interface ClienteErrores {
  apellido: string | null
  nombre: string | null
}

export const CLIENTE_VACIO: ClienteValores = {
  apellido: '',
  nombre: '',
  telefono: '',
  email: '',
  notas: '',
}

/**
 * `apellido` es obligatorio desde 00058, también al editar: los clientes
 * anteriores lo tienen en `null` y la edición es por donde se corrigen.
 */
export function validarCliente(v: ClienteValores): ClienteErrores {
  return {
    apellido: v.apellido.trim().length >= 2 ? null : 'Apellido muy corto',
    nombre: v.nombre.trim().length >= 2 ? null : 'Nombre muy corto',
  }
}

/**
 * Los cinco campos del cliente, sin estado ni submit. Antes el alta y la
 * edición copiaban el mismo markup (grillas, hints, placeholder) y cualquier
 * campo nuevo había que agregarlo dos veces; cada contenedor conserva su
 * propia acción y su cierre. `idPrefix` distingue los ids si los dos
 * formularios llegan a convivir en la misma página.
 */
export function ClienteFields({
  idPrefix,
  values,
  errors,
  onChange,
}: {
  idPrefix: string
  values: ClienteValores
  errors: ClienteErrores
  onChange: (patch: Partial<ClienteValores>) => void
}) {
  const id = (campo: string) => `${idPrefix}-${campo}`
  return (
    <>
      {/* Apellido primero: es por donde se busca y por donde se ordena la
          cartera. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor={id('apellido')} label="Apellido" required error={errors.apellido ?? undefined}>
          <Input
            id={id('apellido')}
            value={values.apellido}
            onChange={(e) => onChange({ apellido: e.target.value })}
            autoFocus
            invalid={!!errors.apellido}
          />
        </Field>
        <Field htmlFor={id('nombre')} label="Nombre" required error={errors.nombre ?? undefined}>
          <Input
            id={id('nombre')}
            value={values.nombre}
            onChange={(e) => onChange({ nombre: e.target.value })}
            invalid={!!errors.nombre}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor={id('tel')} label="Teléfono" hint="Se usa para link WhatsApp">
          <Input
            id={id('tel')}
            value={values.telefono}
            onChange={(e) => onChange({ telefono: e.target.value })}
            placeholder="+54 9 11 ..."
          />
        </Field>
        <Field htmlFor={id('email')} label="Email">
          <Input
            id={id('email')}
            type="email"
            value={values.email}
            onChange={(e) => onChange({ email: e.target.value })}
          />
        </Field>
      </div>

      <Field htmlFor={id('notas')} label="Notas">
        <Textarea
          id={id('notas')}
          rows={3}
          value={values.notas}
          onChange={(e) => onChange({ notas: e.target.value })}
        />
      </Field>
    </>
  )
}
