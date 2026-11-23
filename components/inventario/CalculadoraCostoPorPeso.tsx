'use client'

import { useId, useState } from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import { Checkbox } from '@/components/ui/Checkbox'

/**
 * Calculadora discreta de costo por peso (peso en gramos × costo por gramo).
 * Completa el campo de costo existente en la misma moneda; si la persona edita
 * el costo a mano después, manda el costo. El costo por gramo no se persiste.
 *
 * Soporta `peso`/`onPesoChange` y `activo`/`onActivoChange` controlados (p. ej.
 * en alta de producto para no duplicar el input de peso) o estado interno
 * inicializado desde `pesoInicial` (p. ej. en líneas de ingreso, usando `key`
 * con el id del producto para reiniciar al cambiar de producto).
 */
export function CalculadoraCostoPorPeso({
  pesoInicial,
  peso: pesoControlado,
  onPesoChange,
  activo: activoControlado,
  onActivoChange,
  moneda = 'ARS',
  disabled,
  onCostoCalculado,
}: {
  pesoInicial?: number | null
  peso?: string
  onPesoChange?: (peso: string) => void
  activo?: boolean
  onActivoChange?: (activo: boolean) => void
  moneda?: string
  disabled?: boolean
  onCostoCalculado: (costo: string) => void
}) {
  const uid = useId()
  const [activoInterno, setActivoInterno] = useState(false)
  const [pesoInterno, setPesoInterno] = useState(
    pesoInicial != null && pesoInicial > 0 ? String(pesoInicial) : '',
  )
  const [costoPorGramo, setCostoPorGramo] = useState('')

  const activo = activoControlado !== undefined ? activoControlado : activoInterno
  const peso = pesoControlado !== undefined ? pesoControlado : pesoInterno

  function setActivo(next: boolean) {
    if (onActivoChange) onActivoChange(next)
    else setActivoInterno(next)
  }

  function recalcular(nextPeso: string, nextCostoPorGramo: string) {
    const p = Number(nextPeso)
    const c = Number(nextCostoPorGramo)
    if (p > 0 && c > 0 && Number.isFinite(p) && Number.isFinite(c)) {
      const total = Math.round(p * c * 100) / 100
      onCostoCalculado(String(total))
    }
  }

  function handlePesoChange(nextPeso: string) {
    if (onPesoChange) onPesoChange(nextPeso)
    else setPesoInterno(nextPeso)
    recalcular(nextPeso, costoPorGramo)
  }

  function handleCostoPorGramoChange(nextCostoPorGramo: string) {
    setCostoPorGramo(nextCostoPorGramo)
    recalcular(peso, nextCostoPorGramo)
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
              onChange={(e) => handlePesoChange(e.target.value)}
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
              onChange={(e) => handleCostoPorGramoChange(e.target.value)}
              disabled={disabled}
              placeholder="Ej: 1500"
            />
          </div>
        </div>
      )}
    </div>
  )
}
