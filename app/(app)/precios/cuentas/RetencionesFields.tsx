'use client'

import { Field } from '@/components/ui/Field'
import { NumberInput } from '@/components/ui/NumberInput'
import type { CuentaDestinoRow } from '@/lib/types/ventas'
import { parsearDecimal } from '@/lib/utils/numero'

export type CampoRetencion = keyof Pick<
  CuentaDestinoRow,
  'ret_iva_pct' | 'ret_ganancias_pct' | 'ret_iibb_pct' | 'imp_deb_cred_pct'
>

/** Borrador de retenciones: texto, porque se tipea con coma decimal. */
export type RetencionesBorrador = Record<CampoRetencion, string>

/** Las cuatro retenciones fiscales de una cuenta (00057), en orden de pantalla. */
export const RETENCIONES: readonly (readonly [CampoRetencion, string])[] = [
  ['ret_iva_pct', 'IVA %'],
  ['ret_ganancias_pct', 'Ganancias %'],
  ['ret_iibb_pct', 'IIBB %'],
  ['imp_deb_cred_pct', 'Imp. déb./créd. %'],
]

/** Borrador → patch de la cuenta. Un campo vacío retiene 0. */
export function retencionesANumeros(r: RetencionesBorrador): Record<CampoRetencion, number> {
  return {
    ret_iva_pct: parsearDecimal(r.ret_iva_pct) ?? 0,
    ret_ganancias_pct: parsearDecimal(r.ret_ganancias_pct) ?? 0,
    ret_iibb_pct: parsearDecimal(r.ret_iibb_pct) ?? 0,
    imp_deb_cred_pct: parsearDecimal(r.imp_deb_cred_pct) ?? 0,
  }
}

/**
 * Grilla de las cuatro retenciones. La usan el alta de cuenta y la edición
 * desde el panel de aranceles: antes cada uno tenía su copia de la tupla y
 * del markup.
 */
export function RetencionesFields({
  idPrefix,
  values,
  onChange,
  disabled,
}: {
  idPrefix: string
  values: RetencionesBorrador
  onChange: (campo: CampoRetencion, valor: string) => void
  disabled?: boolean
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {RETENCIONES.map(([campo, label]) => (
          <Field key={campo} htmlFor={`${idPrefix}-${campo}`} label={label}>
            <NumberInput
              id={`${idPrefix}-${campo}`}
              min={0}
              max={100}
              value={values[campo]}
              onChange={(e) => onChange(campo, e.target.value)}
              disabled={disabled}
              className="text-right"
            />
          </Field>
        ))}
      </div>
      <p className="text-xs text-muted">
        Las retenciones sólo se aplican a los medios que tengan arancel cargado.
        Un cobro en efectivo nunca retiene.
      </p>
    </>
  )
}
