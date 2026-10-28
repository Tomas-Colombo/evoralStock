'use client'

import { useId, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { NumberInput } from '@/components/ui/NumberInput'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { MEDIO_PAGO_LABEL, type CuentaDestinoRow } from '@/lib/types/ventas'
import type { MedioPagoRecargo, PlanCuotasRow } from '@/lib/types/precios'
import { MEDIOS_FINANCIABLES } from '@/lib/cobros/medios'
import { parsearDecimal } from '@/lib/utils/numero'
import { crearRecargoCuotasAction } from '../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'

type Destino =
  /** Panel de UNA cuenta: el financiador es esa cuenta y sólo se elige el medio. */
  | { cuenta: CuentaDestinoRow; cuentas?: never }
  /** Tabla global: se elige quién financia entre comodín, medio, cuenta o propia. */
  | { cuenta?: never; cuentas: CuentaDestinoRow[] }

/**
 * Alta de un recargo por cuotas. La usan la tabla global de recargos y el
 * panel de aranceles de cada cuenta: antes eran dos formularios con la misma
 * action, el mismo select de plan y el mismo «Recargo %», y ya habían
 * divergido (uno listaba planes inactivos, el otro tenía los medios escritos
 * a mano). El llamador lo monta y desmonta: al cerrarse arranca vacío.
 */
export function RecargoForm({
  planesCuotas,
  onCreated,
  className = 'border-line-2 bg-card-2',
  ...destino
}: Destino & {
  planesCuotas: PlanCuotasRow[]
  onCreated: () => void
  className?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const uid = useId()
  const [pending, start] = useTransition()
  const cuentaFija = destino.cuenta

  // Sólo planes activos: un recargo sobre un plan que ya no se ofrece no lo
  // va a usar ninguna venta.
  const planes = useMemo(
    () => planesCuotas.filter((p) => p.activo).sort((a, b) => a.cuotas - b.cuotas),
    [planesCuotas],
  )

  const [cuotas, setCuotas] = useState<number>(planes[0]?.cuotas ?? 3)
  // Sin cuenta fija, el financiador se elige con un solo `select`: las formas
  // (comodín / medio / cuenta / propia) son excluyentes, y ofrecerlas como
  // campos separados dejaba armar combinaciones que la tabla rechaza.
  const [financiador, setFinanciador] = useState(
    cuentaFija ? `c:${cuentaFija.id_cuenta_destino}:${MEDIOS_FINANCIABLES[0]}` : '*',
  )
  const [valor, setValor] = useState('')
  const [errValor, setErrValor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function crear() {
    const v = parsearDecimal(valor)
    if (v === null) return setErrValor('Cargá el recargo.')
    setErrValor(null)
    setError(null)
    start(async () => {
      const res = await crearRecargoCuotasAction({
        cuotas,
        tipoValor: 'porcentaje',
        valor: v,
        ...parseFinanciador(financiador),
      })
      if (!res.ok) return setError(mensajeDeError(res.reason))
      toast.success('Recargo creado')
      onCreated()
      router.refresh()
    })
  }

  const medioLabel = (m: MedioPagoRecargo) => MEDIO_PAGO_LABEL[m]

  if (planes.length === 0) {
    return (
      <p className={`rounded-md border px-3 py-2 text-xs text-muted ${className}`}>
        Todavía no hay planes de cuotas activos. Cargá al menos uno en Precios
        antes de definir el recargo: el recargo cuelga del plan, no al revés.
      </p>
    )
  }

  return (
    <div className={`space-y-3 rounded-md border p-3 ${className}`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field htmlFor={`${uid}-cuotas`} label="Plan" required>
          <Select
            id={`${uid}-cuotas`}
            value={cuotas}
            onChange={(e) => setCuotas(Number(e.target.value))}
            disabled={pending}
          >
            {planes.map((p) => (
              <option key={p.cuotas} value={p.cuotas}>
                {p.cuotas} cuotas
              </option>
            ))}
          </Select>
        </Field>

        {cuentaFija ? (
          <Field htmlFor={`${uid}-fin`} label="Medio" required>
            <Select
              id={`${uid}-fin`}
              value={financiador}
              onChange={(e) => setFinanciador(e.target.value)}
              disabled={pending}
            >
              {MEDIOS_FINANCIABLES.map((m) => (
                <option key={m} value={`c:${cuentaFija.id_cuenta_destino}:${m}`}>
                  {medioLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field
            htmlFor={`${uid}-fin`}
            label="Quién financia"
            required
            hint="Lo más específico gana: una cuenta le gana a un medio, y un medio al comodín."
          >
            <Select
              id={`${uid}-fin`}
              value={financiador}
              onChange={(e) => setFinanciador(e.target.value)}
              disabled={pending}
            >
              <option value="*">Cualquier destino (comodín)</option>
              <option value="propia">Crédito del local</option>
              {MEDIOS_FINANCIABLES.map((m) => (
                <option key={`m:${m}`} value={`m:${m}`}>
                  Cualquier {medioLabel(m).toLowerCase()}
                </option>
              ))}
              {(destino.cuentas ?? [])
                .filter((c) => c.activo && c.tipo !== 'efectivo')
                .map((c) =>
                  MEDIOS_FINANCIABLES.map((m) => (
                    <option
                      key={`c:${c.id_cuenta_destino}:${m}`}
                      value={`c:${c.id_cuenta_destino}:${m}`}
                    >
                      {c.nombre} · {medioLabel(m).toLowerCase()}
                    </option>
                  )),
                )}
            </Select>
          </Field>
        )}

        <Field
          htmlFor={`${uid}-valor`}
          label="Recargo %"
          required
          error={errValor ?? undefined}
          hint="Sobre el precio ya descontado."
        >
          <NumberInput
            id={`${uid}-valor`}
            min={0}
            max={100}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="12"
            invalid={!!errValor}
            disabled={pending}
            className="text-right"
          />
        </Field>
      </div>

      {financiador === 'propia' && (
        <p className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted">
          El crédito del local no hereda el recargo de las tarjetas. Si no
          cargás esta fila, financiar vos sale sin recargo — que es lo
          prudente, pero probablemente no lo que querés.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-alerta-ink bg-alerta-bg px-3 py-2 text-xs text-alerta-ink">
          {error}
        </p>
      )}

      <Button type="button" size="sm" onClick={crear} disabled={pending}>
        {pending ? 'Creando…' : 'Crear recargo'}
      </Button>
    </div>
  )
}

/** `'c:<uuid>:<medio>'` / `'m:<medio>'` / `'propia'` / `'*'` → input de la action. */
function parseFinanciador(v: string): {
  idCuentaDestino?: string | null
  medio?: MedioPagoRecargo | null
  propia?: boolean
} {
  if (v === 'propia') return { propia: true }
  if (v.startsWith('m:')) return { medio: v.slice(2) as MedioPagoRecargo }
  if (v.startsWith('c:')) {
    const [, id, medio] = v.split(':')
    return { idCuentaDestino: id, medio: medio as MedioPagoRecargo }
  }
  return {}
}
