'use client'

import { useEffect, useId, useState } from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import { Checkbox } from '@/components/ui/Checkbox'

/**
 * Calculadora discreta de costo por peso (peso en gramos × costo por gramo).
 * Completa el campo de costo existente en la misma moneda; si la persona edita
 * el costo a mano después, manda el costo. El costo por gramo no se persiste.
 */
export function CalculadoraCostoPorPeso({
  pesoInicial,
  moneda = 'ARS',
  disabled,
  onCostoCalculado,
}: {
  pesoInicial?: number | null
  moneda?: string
  disabled?: boolean
  onCostoCalculado: (costo: string) => void
}) {
  const uid = useId()
  const [activo, setActivo] = useState(false)
  const [peso, setPeso] = useState(pesoInicial != null && pesoInicial > 0 ? String(pesoInicial) : '')
  const [costoPorGramo, setCostoPorGramo] = useState('')

  useEffect(() => {
    setPeso(pesoInicial != null && pesoInicial > 0 ? String(pesoInicial) : '')
  }, [pesoInicial])

  function recalcular(nextPeso: string, nextCostoPorGramo: string) {
    const p = Number(nextPeso)
    const c = Number(nextCostoPorGramo)
    if (p > 0 && c > 0 && Number.isFinite(p) && Number.isFinite(c)) {
      const total = Math.round(p * c * 100) / 100
      onCostoCalculado(String(total))
    }
  }

  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted hover:text-text">
        <Checkbox
          checked={activo}
          onChange={(e) => setActivo(e.target.checked)}
          disabled={disabled}
        />
        Calcular por peso
      </label>

      {activo && (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-card-2 p-2.5">
          <div>
            <label htmlFor={`${uid}-peso`} className="mb-1 block text-xs text-muted">
              Peso (g)
            </label>
            <NumberInput
              id={`${uid}-peso`}
              min={0.001}
              step={0.001}
              value={peso}
              onChange={(e) => {
                setPeso(e.target.value)
                recalcular(e.target.value, costoPorGramo)
              }}
              disabled={disabled}
              placeholder="Ej: 4.5"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-cpg`} className="mb-1 block text-xs text-muted">
              Costo / g ({moneda})
            </label>
            <NumberInput
              id={`${uid}-cpg`}
              min={0.01}
              step={0.01}
              value={costoPorGramo}
              onChange={(e) => {
                setCostoPorGramo(e.target.value)
                recalcular(peso, e.target.value)
              }}
              disabled={disabled}
              placeholder="Ej: 1500"
            />
          </div>
        </div>
      )}
    </div>
  )
}
