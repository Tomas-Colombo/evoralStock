'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { NumberInput } from '@/components/ui/NumberInput'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { registrarAjusteInventarioAction } from '../../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { Checkbox } from '@/components/ui/Checkbox'

/**
 * Ajuste de inventario (Planificacion.txt Etapa 6 §108, Ejecucion §L86).
 * Registra diferencia entre stock del sistema y conteo real.
 * Opcionalmente da de baja el ítem (uso típico: perdido/robado).
 */
export function AjusteInventarioAction({
  idItem,
  estadoItem,
}: {
  idItem: string
  estadoItem: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)

  const [cantSistema, setCantSistema] = useState('1')
  const [cantContada, setCantContada] = useState('0')
  const [obs, setObs] = useState('')
  const [darDeBaja, setDarDeBaja] = useState(false)

  const puedeDarBaja = estadoItem === 'disponible' || estadoItem === 'devuelto_cliente'

  function submit() {
    const cs = Number(cantSistema || 0)
    const cc = Number(cantContada || 0)
    if (!obs.trim()) return toast.error('Observaciones son obligatorias')
    if (cs === cc && !darDeBaja) {
      return toast.error('Sin diferencia', 'No hay diferencia que registrar; o marcá "dar de baja"')
    }
    start(async () => {
      const res = await registrarAjusteInventarioAction({
        idItem,
        cantidadSistema: cs,
        cantidadContada: cc,
        observaciones: obs,
        darDeBaja,
      })
      if (!res.ok) return toast.error('No se pudo registrar', mensajeDeError(res.reason))
      toast.success('Ajuste registrado')
      setOpen(false)
      setObs('')
      setDarDeBaja(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Ajuste de inventario
      </Button>
      <Modal
        open={open}
        title="Ajuste de inventario"
        onClose={() => setOpen(false)}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? 'Registrando…' : 'Registrar ajuste'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Registrá la diferencia entre lo que dice el sistema y lo que contaste físicamente.
            Queda como movimiento tipo <span className="font-mono">ajuste_inventario</span> en el historial.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field htmlFor="ai-cs" label="Cantidad en sistema" required>
              <NumberInput
                id="ai-cs"
                min={0}
                value={cantSistema}
                onChange={(e) => setCantSistema(e.target.value)}
              />
            </Field>
            <Field htmlFor="ai-cc" label="Cantidad contada" required>
              <NumberInput
                id="ai-cc"
                min={0}
                value={cantContada}
                onChange={(e) => setCantContada(e.target.value)}
              />
            </Field>
            <div className="flex flex-col justify-end">
              <div className="text-xs uppercase font-mono text-muted mb-1">Diferencia</div>
              <div
                className={`font-mono text-lg ${
                  Number(cantContada || 0) - Number(cantSistema || 0) < 0
                    ? 'text-alerta-ink'
                    : Number(cantContada || 0) - Number(cantSistema || 0) > 0
                      ? 'text-success'
                      : ''
                }`}
              >
                {Number(cantContada || 0) - Number(cantSistema || 0)}
              </div>
            </div>
          </div>

          <Field htmlFor="ai-obs" label="Observaciones" required>
            <Textarea
              id="ai-obs"
              rows={3}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Qué pasó, dónde se contó, quién validó"
            />
          </Field>

          {puedeDarBaja && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={darDeBaja}
                onChange={(e) => setDarDeBaja(e.target.checked)}
              />
              Dar de baja el ítem (perdido / robado / dañado)
            </label>
          )}
        </div>
      </Modal>
    </>
  )
}
