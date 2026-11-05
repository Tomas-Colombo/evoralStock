'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { NumberInput } from '@/components/ui/NumberInput'
import { useToast } from '@/components/ui/Toast'
import type { CotizacionVigente } from '@/lib/dal/precios/cotizacion'
import {
  actualizarCotizacionManualAction,
  cambiarModoCotizacionAction,
  sincronizarCotizacionBcraAction,
} from './actions'
import { mensajeDeError } from '@/lib/errores/mensajes'

export function CotizacionView({
  initial,
  canEdit,
}: {
  initial: CotizacionVigente | null
  canEdit: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [modo, setModo] = useState<'automatica' | 'manual'>(
    initial?.modo ?? 'automatica',
  )
  const [valorManual, setValorManual] = useState(
    initial?.modo === 'manual' && initial.valor ? String(initial.valor) : '',
  )

  const desactualizada = initial?.desactualizada ?? false
  const tieneValor = initial && initial.valor > 0

  function formatearFecha(fechaStr: string | null | undefined): string {
    if (!fechaStr) return '—'
    // fechaStr viene en formato YYYY-MM-DD
    const [y, m, d] = fechaStr.split('-').map(Number)
    if (!y || !m || !d) return fechaStr
    return new Date(y, m - 1, d).toLocaleDateString('es-AR')
  }

  function cambiarModo(nuevoModo: 'automatica' | 'manual') {
    if (!canEdit || pending) return
    setModo(nuevoModo)
    start(async () => {
      const res = await cambiarModoCotizacionAction({ modo: nuevoModo })
      if (!res.ok) {
        setModo(initial?.modo ?? 'automatica')
        return toast.error('No se pudo cambiar el modo', mensajeDeError(res.reason))
      }
      toast.success(
        nuevoModo === 'automatica'
          ? 'Modo automático activado (sincronización con el BCRA)'
          : 'Modo manual activado',
      )
      router.refresh()
    })
  }

  function guardarManual(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit || pending) return
    const num = Number(valorManual)
    if (!num || num <= 0) {
      return toast.error('Ingresá un valor válido', 'La cotización tiene que ser un número mayor a cero.')
    }
    start(async () => {
      const res = await actualizarCotizacionManualAction({ valor: num })
      if (!res.ok) {
        return toast.error('No se pudo guardar la cotización', mensajeDeError(res.reason))
      }
      toast.success('Cotización manual actualizada')
      router.refresh()
    })
  }

  function reintentarSincronizacion() {
    if (!canEdit || pending) return
    start(async () => {
      const res = await sincronizarCotizacionBcraAction({})
      if (!res.ok) {
        return toast.error('No se pudo sincronizar con el BCRA', mensajeDeError(res.reason))
      }
      toast.success('Cotización sincronizada con el BCRA')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Cartel explicativo obligatorio */}
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted">
        <p>
          Es la cotización oficial del BCRA (cierre del último día hábil), no el dólar billete. Para
          operar con dólar billete o financiero, utilizá el modo manual.
        </p>
      </div>

      {/* Banner de advertencia si la cotización está desactualizada */}
      {desactualizada && (
        <div className="rounded-lg border border-alerta-line bg-alerta-bg p-4 text-alerta-ink">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="font-semibold text-sm">Cotización del BCRA no actualizada</div>
              <p className="text-xs">
                El servicio del BCRA no respondió hoy o no se pudo sincronizar. El sistema está
                utilizando el último valor oficial registrado.
              </p>
            </div>
            {canEdit && (
              <Button
                variant="secondary"
                size="sm"
                onClick={reintentarSincronizacion}
                disabled={pending}
                className="shrink-0"
              >
                {pending ? 'Reintentando…' : 'Reintentar'}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Tarjeta de estado vigente */}
      <Card padding="none" className="p-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
          <div>
            <h2 className="text-sm font-semibold">Cotización vigente</h2>
            <p className="text-xs text-muted">
              Valor aplicado para la conversión de costos cargados en dólares.
            </p>
          </div>
          <div>
            {tieneValor ? (
              desactualizada ? (
                <Badge variant="warning">Desactualizada</Badge>
              ) : (
                <Badge variant="success">Al día</Badge>
              )
            ) : (
              <Badge variant="danger">Sin cotización</Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <div className="text-xs text-muted">Tipo de cambio</div>
            <div className="font-mono text-2xl font-bold">
              {tieneValor
                ? `$ ${initial.valor.toLocaleString('es-AR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 4,
                  })}`
                : '—'}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted">Origen</div>
            <div className="text-sm font-medium">
              {initial?.origen === 'bcra'
                ? 'Oficial BCRA'
                : initial?.origen === 'manual'
                  ? 'Manual'
                  : '—'}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted">Fecha del valor oficial</div>
            <div className="text-sm font-medium">{formatearFecha(initial?.fechaValor)}</div>
          </div>
        </div>
      </Card>

      {/* Controles de edición (solo si canEdit) */}
      {canEdit ? (
        <Card padding="none" className="p-6 space-y-6">
          <div className="space-y-1 border-b border-border pb-4">
            <h2 className="text-sm font-semibold">Configuración de modo</h2>
            <p className="text-xs text-muted">
              Elegí si la cotización se actualiza automáticamente desde el BCRA o si definís un
              valor manual fijo.
            </p>
          </div>

          {/* Toggle de Modo */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="inline-flex rounded-lg border border-border p-1 bg-card-2">
              <button
                type="button"
                onClick={() => cambiarModo('automatica')}
                disabled={pending}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  modo === 'automatica'
                    ? 'bg-block text-block-ink shadow-sm'
                    : 'text-muted hover:text-ink'
                }`}
              >
                Automático (BCRA)
              </button>
              <button
                type="button"
                onClick={() => cambiarModo('manual')}
                disabled={pending}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  modo === 'manual'
                    ? 'bg-block text-block-ink shadow-sm'
                    : 'text-muted hover:text-ink'
                }`}
              >
                Manual
              </button>
            </div>

            {modo === 'automatica' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={reintentarSincronizacion}
                disabled={pending}
              >
                {pending ? 'Sincronizando…' : 'Sincronizar con el BCRA ahora'}
              </Button>
            )}
          </div>

          {/* Formulario de valor manual (visible solo en modo manual) */}
          {modo === 'manual' && (
            <form onSubmit={guardarManual} className="max-w-md space-y-4 pt-2">
              <Field
                htmlFor="cotizacion-manual-input"
                label="Cotización manual del dólar"
                hint="Ingresá el valor en pesos por cada dólar (ej: 1600)."
                required
              >
                <div className="flex gap-2">
                  <NumberInput
                    id="cotizacion-manual-input"
                    value={valorManual}
                    onChange={(e) => setValorManual(e.target.value)}
                    placeholder="1600"
                    min={0.0001}
                    max={10000000}
                    step="0.01"
                    className="flex-1"
                    disabled={pending}
                  />
                  <Button type="submit" disabled={pending || !valorManual}>
                    {pending ? 'Guardando…' : 'Guardar'}
                  </Button>
                </div>
              </Field>
            </form>
          )}
        </Card>
      ) : (
        <div className="rounded-md border border-border bg-card-2 p-4 text-xs text-muted">
          Tu rol cuenta con permiso de visualización. Para modificar el modo o ingresar una
          cotización manual se requiere el permiso de edición de cotización.
        </div>
      )}
    </div>
  )
}
