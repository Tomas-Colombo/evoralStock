'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { NumberInput } from '@/components/ui/NumberInput'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { IMPRESORA_MM_MAX, IMPRESORA_MM_MIN } from '@/lib/inventario/limites'
import type { ConfiguracionImpresora } from '@/lib/dal/administracion/administracion'
import { updateConfiguracionImpresoraAction } from './actions'

// Se configura en cm (como mide el usuario la cinta) y se guarda en mm enteros.
function cmAMm(cm: string): number | null | 'invalido' {
  if (cm.trim() === '') return null
  const mm = Math.round(Number(cm.replace(',', '.')) * 10)
  if (!Number.isFinite(mm) || mm < IMPRESORA_MM_MIN || mm > IMPRESORA_MM_MAX) return 'invalido'
  return mm
}

const mmACm = (mm: number | null) => (mm == null ? '' : String(mm / 10))

export function ConfiguracionImpresoraCard({
  inicial,
  canEdit,
}: {
  inicial: ConfiguracionImpresora
  canEdit: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [anchoCm, setAnchoCm] = useState(mmACm(inicial.anchoMm))
  const [altoCm, setAltoCm] = useState(mmACm(inicial.altoMm))

  const anchoMm = cmAMm(anchoCm)
  const altoMm = cmAMm(altoCm)
  const valido = anchoMm !== 'invalido' && altoMm !== 'invalido'
  const sinCambios = valido && anchoMm === inicial.anchoMm && altoMm === inicial.altoMm

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) return
    if (anchoMm === 'invalido' || altoMm === 'invalido') {
      return toast.error('Medida inválida', mensajeDeError('impresora-medida-invalida'))
    }
    start(async () => {
      const res = await updateConfiguracionImpresoraAction({ anchoMm, altoMm })
      if (!res.ok) return toast.error('No se pudo guardar', mensajeDeError(res.reason))
      toast.success('Configuración guardada', 'Las etiquetas se imprimirán con esta medida de página.')
      router.refresh()
    })
  }

  const equivalencia = (mm: number | null | 'invalido') =>
    mm === 'invalido' ? 'Fuera de rango' : mm == null ? 'A4' : `= ${mm} mm`

  return (
    <Card as="section" className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg">Impresora de etiquetas</h3>
          <span className="group relative inline-flex">
            <button
              type="button"
              aria-label="Cómo funcionan el ancho y el alto"
              aria-describedby="cfg-impresora-ayuda"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-border-2 text-[11px] font-bold text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-text"
            >
              !
            </button>
            <span
              id="cfg-impresora-ayuda"
              role="tooltip"
              className="pointer-events-none invisible absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs leading-relaxed text-text opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
            >
              <strong>Ancho:</strong> el de la cinta o papel de tu impresora. Las etiquetas se
              ponen una al lado de la otra mientras entren, con 2 mm de margen y 2 mm entre cada
              una. Ej.: QR de 1,5 cm en un ancho de 4 cm = 2 por fila.
              <br />
              <strong>Alto:</strong> solo si tu impresora usa etiquetas de alto fijo; si no, dejalo
              vacío.
              <br />
              Un campo vacío toma la medida de una hoja A4 (21 × 29,7 cm).
            </span>
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted">
          Medida de página de tu impresora, en centímetros. Las etiquetas se acomodan una al lado
          de la otra según el ancho. Dejá un campo vacío para usar la medida de una hoja A4.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        {(
          [
            ['cfg-impresora-ancho', 'Ancho (cm)', anchoCm, setAnchoCm, anchoMm],
            ['cfg-impresora-alto', 'Alto (cm, opcional)', altoCm, setAltoCm, altoMm],
          ] as const
        ).map(([id, label, valor, set, mm]) => (
          <div key={id} className="w-40">
            <Field htmlFor={id} label={label}>
              <NumberInput
                id={id}
                min={IMPRESORA_MM_MIN / 10}
                max={IMPRESORA_MM_MAX / 10}
                step={0.1}
                value={valor}
                onChange={(e) => set(e.target.value)}
                disabled={!canEdit || pending}
              />
            </Field>
            <p className="mt-1 font-mono text-xs text-muted">{equivalencia(mm)}</p>
          </div>
        ))}
        {canEdit && (
          <Button type="submit" size="sm" disabled={pending || !valido || sinCambios}>
            {pending ? 'Guardando…' : 'Guardar medida'}
          </Button>
        )}
      </form>
    </Card>
  )
}
