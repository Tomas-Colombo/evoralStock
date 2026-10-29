'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { NumberInput } from '@/components/ui/NumberInput'
import { Select } from '@/components/ui/Select'
import {
  MEDIOS_PAGO_TENANT,
  type MedioPagoTenant,
} from '@/lib/types/plataforma'
import { hoyISO } from '@/lib/utils/hoy'

export const MEDIOS_PAGO_LABELS: Record<MedioPagoTenant, string> = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  mercadopago: 'Mercado Pago',
  otro: 'Otro',
}

interface NuevoPagoModalProps {
  open: boolean
  isPending: boolean
  onClose: () => void
  onSubmit: (datos: {
    fecha: string
    monto: number
    medio: MedioPagoTenant
    nota: string | null
  }) => void
}

export function NuevoPagoModal({
  open,
  isPending,
  onClose,
  onSubmit,
}: NuevoPagoModalProps) {
  const [pagoFecha, setPagoFecha] = useState(() => hoyISO())
  const [pagoMonto, setPagoMonto] = useState('')
  const [pagoMedio, setPagoMedio] = useState<MedioPagoTenant>('transferencia')
  const [pagoNota, setPagoNota] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const montoNum = Number(pagoMonto)
    onSubmit({
      fecha: pagoFecha,
      monto: montoNum,
      medio: pagoMedio,
      nota: pagoNota.trim() || null,
    })
  }

  function handleClose() {
    setPagoMonto('')
    setPagoNota('')
    onClose()
  }

  return (
    <Modal
      open={open}
      title="Registrar nuevo pago"
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
            {isPending ? 'Guardando…' : 'Registrar pago'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          htmlFor="pago-fecha"
          label="Fecha del pago"
          required
          hint="No puede ser una fecha futura"
        >
          <input
            id="pago-fecha"
            type="date"
            max={hoyISO()}
            required
            value={pagoFecha}
            onChange={(e) => setPagoFecha(e.target.value)}
            className="w-full rounded-md border border-control-line bg-control px-3 py-2 text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
          />
        </Field>

        <Field htmlFor="pago-monto" label="Monto" required>
          <NumberInput
            id="pago-monto"
            thousands
            required
            value={pagoMonto}
            onChange={(e) => setPagoMonto(e.target.value)}
            placeholder="0,00"
          />
        </Field>

        <Field htmlFor="pago-medio" label="Medio de pago" required>
          <Select
            id="pago-medio"
            required
            value={pagoMedio}
            onChange={(e) => setPagoMedio(e.target.value as MedioPagoTenant)}
          >
            {MEDIOS_PAGO_TENANT.map((m) => (
              <option key={m} value={m}>
                {MEDIOS_PAGO_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          htmlFor="pago-nota"
          label="Nota u observación"
          hint="Opcional. Código de comprobante o referencia bancaria"
        >
          <input
            id="pago-nota"
            type="text"
            value={pagoNota}
            onChange={(e) => setPagoNota(e.target.value)}
            placeholder="Ej. Transferencia Banco Galicia #44912"
            className="w-full rounded-md border border-control-line bg-control px-3 py-2 text-[13.5px] text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink"
          />
        </Field>
      </form>
    </Modal>
  )
}
