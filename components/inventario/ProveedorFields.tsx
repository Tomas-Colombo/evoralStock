'use client'

import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import type { TipoProveedor } from '@/lib/types/inventario'

export interface ProveedorValores {
  nombre: string
  tipo: TipoProveedor
  telefono: string
  email: string
  cuit: string
  dias: string
  notas: string
}

export interface ProveedorErrores {
  nombre: string | null
}

export function validarProveedor(v: ProveedorValores): ProveedorErrores {
  return {
    nombre: v.nombre.trim().length >= 2 ? null : 'Mínimo 2 caracteres',
  }
}

export const TIPOS_LABEL: Record<TipoProveedor, string> = {
  mayorista: 'Mayorista',
  particular: 'Particular',
  consignatario: 'Consignatario',
}

export function ProveedorFields({
  idPrefix,
  values,
  errors,
  onChange,
  tiposPermitidos,
  tipoBloqueado,
}: {
  idPrefix: string
  values: ProveedorValores
  errors: ProveedorErrores
  onChange: (patch: Partial<ProveedorValores>) => void
  tiposPermitidos: readonly TipoProveedor[]
  tipoBloqueado?: boolean
}) {
  const id = (campo: string) => `${idPrefix}-${campo}`

  const opciones = tiposPermitidos.map((val) => ({
    value: val,
    label: TIPOS_LABEL[val] ?? val,
  }))

  return (
    <>
      <Field htmlFor={id('nombre')} label="Nombre" required error={errors.nombre ?? undefined}>
        <Input
          id={id('nombre')}
          value={values.nombre}
          onChange={(e) => onChange({ nombre: e.target.value })}
          autoFocus
          invalid={!!errors.nombre}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          htmlFor={id('tipo')}
          label="Tipo"
          required
          hint={tipoBloqueado ? 'El tipo no se puede cambiar.' : undefined}
        >
          <Select
            id={id('tipo')}
            value={values.tipo}
            onChange={(e) => onChange({ tipo: e.target.value as TipoProveedor })}
            disabled={tipoBloqueado}
          >
            {opciones.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          htmlFor={id('dias')}
          label="Días de rotación esperados"
          hint="Usado por Reportes (RF-12)"
        >
          <NumberInput
            id={id('dias')}
            min={0}
            value={values.dias}
            onChange={(e) => onChange({ dias: e.target.value })}
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

      <Field htmlFor={id('cuit')} label="CUIT">
        <Input id={id('cuit')} value={values.cuit} onChange={(e) => onChange({ cuit: e.target.value })} />
      </Field>

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
