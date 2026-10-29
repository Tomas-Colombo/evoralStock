'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { NumberInput } from '@/components/ui/NumberInput'
import { hoyISO } from '@/lib/utils/hoy'

interface NuevoCargoModalProps {
  open: boolean
  isPending: boolean
  onClose: () => void
  onSubmit: (datos: { periodo: string; monto: number; concepto: string }) => void
}

export function NuevoCargoModal({
  open,
  isPending,
  onClose,
  onSubmit,
}: NuevoCargoModalProps) {
  const [cargoPeriodo, setCargoPeriodo] = useState(() => hoyISO().slice(0, 7))
  const [cargoMonto, setCargoMonto] = useState('')
  const [cargoConcepto, setCargoConcepto] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const montoNum = Number(cargoMonto)
    onSubmit({
      periodo: cargoPeriodo,
      monto: montoNum,
      concepto: cargoConcepto,
    })
  }

  function handleClose() {
    setCargoMonto('')
    setCargoConcepto('')
    onClose()
  }

  return (
    <Modal
      open={open}
      title="Registrar nuevo cargo"
      onClose={handleClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={isPending}
            onClick={handleClose}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isPending}
            onClick={handleSubmit}
          >
            {isPending ? 'Guardando…' : 'Registrar cargo'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          htmlFor="cargo-periodo"
          label="Período contable"
          required
          hint="Elegí el mes al que corresponde este abono"
        >
          <input
            id="cargo-periodo"
            type="month"
            required
            value={cargoPeriodo}
            onChange={(e) => setCargoPeriodo(e.target.value)}
            className="w-full rounded-md border border-control-line bg-control px-3 py-2 text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
          />
        </Field>

        <Field htmlFor="cargo-monto" label="Monto" required>
          <NumberInput
            id="cargo-monto"
            thousands
            required
            value={cargoMonto}
            onChange={(e) => setCargoMonto(e.target.value)}
            placeholder="0,00"
          />
        </Field>

        <Field
          htmlFor="cargo-concepto"
          label="Concepto"
          required
          hint="Motivo o descripción del cargo"
        >
          <input
            id="cargo-concepto"
            type="text"
            required
            value={cargoConcepto}
            onChange={(e) => setCargoConcepto(e.target.value)}
            placeholder="Ej. Abono mensual Plan Base"
            className="w-full rounded-md border border-control-line bg-control px-3 py-2 text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
          />
        </Field>
      </form>
    </Modal>
  )
}
