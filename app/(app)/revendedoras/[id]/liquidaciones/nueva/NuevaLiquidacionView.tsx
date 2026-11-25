'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FiltroPeriodo } from '@/components/shell/FiltroPeriodo'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { Kpi } from '@/components/ui/Kpi'
import { Table, type Column } from '@/components/ui/Table'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'
import type {
  PreviewLineaLiquidacion,
  PreviewLiquidacionResponse,
  RevendedoraRow,
} from '@/lib/types/revendedoras'
import { formatearMoneda } from '@/lib/utils/moneda'
import {
  excluirDetalleLiquidacionAction,
  generarLiquidacionAction,
  reincluirDetalleLiquidacionAction,
} from '../actions'
import { Card } from '@/components/ui/Card'

interface NuevaLiquidacionViewProps {
  revendedora: RevendedoraRow
  desde: string
  hasta: string
  preview: PreviewLiquidacionResponse
}

export function NuevaLiquidacionView({
  revendedora,
  desde,
  hasta,
  preview,
}: NuevaLiquidacionViewProps) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [observaciones, setObservaciones] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Tracking de exclusiones locales optimistas
  const [excluidosLocales, setExcluidosLocales] = useState<Set<string>>(new Set())

  const idRevendedora = revendedora.id_revendedora
  const lineas = preview.lineas || []

  const visibles = lineas.filter((l) => !l.excluida && !excluidosLocales.has(l.id_detalle_venta))
  const excluidas = lineas.filter((l) => l.excluida || excluidosLocales.has(l.id_detalle_venta))

  function excluirLinea(idDetalle: string) {
    start(async () => {
      const res = await excluirDetalleLiquidacionAction({ id_detalle: idDetalle })
      if (!res.ok) {
        return toast.error('No se pudo excluir la línea', mensajeDeError(res.reason))
      }
      setExcluidosLocales((prev) => new Set(prev).add(idDetalle))
      toast.info('Línea excluida', 'No se incluirá en esta liquidación.')
      router.refresh()
    })
  }

  function reincluirLinea(idDetalle: string) {
    start(async () => {
      const res = await reincluirDetalleLiquidacionAction({ id_detalle: idDetalle })
      if (!res.ok) {
        return toast.error('No se pudo reincluir la línea', mensajeDeError(res.reason))
      }
      setExcluidosLocales((prev) => {
        const next = new Set(prev)
        next.delete(idDetalle)
        return next
      })
      toast.success('Línea reincluida', 'Volverá a formar parte de la liquidación.')
      router.refresh()
    })
  }

  function confirmarGeneracion() {
    start(async () => {
      const res = await generarLiquidacionAction({
        id_revendedora: idRevendedora,
        desde,
        hasta,
        observaciones: observaciones.trim() || null,
      })

      if (!res.ok) {
        setConfirmOpen(false)
        return toast.error('No se pudo generar la liquidación', mensajeDeError(res.reason))
      }

      toast.success('Liquidación generada', 'Las ventas del período fueron selladas.')
      router.push(`/revendedoras/${idRevendedora}/liquidaciones/${res.data}`)
    })
  }

  const columnasVisibles: Column<PreviewLineaLiquidacion>[] = [
    {
      key: 'fecha_venta',
      label: 'Fecha venta',
      render: (l) => (
        <span className="font-mono text-xs">
          {new Date(l.fecha_venta).toLocaleDateString('es-AR')}
        </span>
      ),
    },
    {
      key: 'producto',
      label: 'Producto',
      render: (l) => (
        <div>
          <div className="font-medium text-sm">{l.nombre_producto}</div>
          <div className="font-mono text-xs text-muted">SKU: {l.sku}</div>
        </div>
      ),
    },
    {
      key: 'precio_venta',
      label: 'Precio venta',
      render: (l) => <span className="font-mono">{formatearMoneda(Number(l.precio_venta))}</span>,
    },
    {
      key: 'porcentaje_preview',
      label: '% Est.',
      render: (l) => <span className="font-mono text-xs">{Number(l.porcentaje_preview)} %</span>,
    },
    {
      key: 'comision_estimada',
      label: 'Comisión est.',
      render: (l) => (
        <span className="font-mono">{formatearMoneda(Number(l.monto_comision_estimada))}</span>
      ),
    },
    {
      key: 'acciones',
      label: '',
      render: (l) => (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => excluirLinea(l.id_detalle_venta)}
        >
          Excluir
        </Button>
      ),
    },
  ]

  const columnasExcluidas: Column<PreviewLineaLiquidacion>[] = [
    {
      key: 'fecha_venta',
      label: 'Fecha venta',
      render: (l) => (
        <span className="font-mono text-xs">
          {new Date(l.fecha_venta).toLocaleDateString('es-AR')}
        </span>
      ),
    },
    {
      key: 'producto',
      label: 'Producto',
      render: (l) => (
        <div>
          <div className="font-medium text-sm text-muted">{l.nombre_producto}</div>
          <div className="font-mono text-xs text-muted">SKU: {l.sku}</div>
        </div>
      ),
    },
    {
      key: 'precio_venta',
      label: 'Precio venta',
      render: (l) => (
        <span className="font-mono text-muted">{formatearMoneda(Number(l.precio_venta))}</span>
      ),
    },
    {
      key: 'acciones',
      label: '',
      render: (l) => (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => reincluirLinea(l.id_detalle_venta)}
        >
          Reincluir
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Selector de período */}
      <Card padding="none" className="p-6">
        <h2 className="font-display text-lg mb-4">Período de liquidación</h2>
        <FiltroPeriodo
          ariaLabel="Período de liquidación"
          idPrefix="liq"
          desde={desde}
          hasta={hasta}
        />
      </Card>

      {/* Tarjetas resumen devueltas por el SP preview_liquidacion */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Monto vendido"
          value={formatearMoneda(Number(preview.monto_vendido))}
          sub={`${preview.cantidad_lineas} ventas registradas`}
        />
        <Kpi
          label="Tramo resuelto"
          value={`${Number(preview.porcentaje_resuelto)} %`}
          sub="Por escala acumulada"
        />
        <Kpi
          label="Monto comisión"
          value={formatearMoneda(Number(preview.monto_comision))}
          sub="A favor de revendedora"
        />
        <Kpi
          label="Total a cobrar"
          value={formatearMoneda(Number(preview.monto_a_cobrar))}
          sub="A favor del negocio"
          variant={Number(preview.monto_a_cobrar) > 0 ? 'alert' : 'default'}
        />
      </div>

      {/* Líneas pendientes a liquidar */}
      <Card padding="none" className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Líneas a liquidar</h3>
          <span className="text-sm text-muted">{visibles.length} línea(s)</span>
        </div>

        <div className="overflow-x-auto">
          <Table
            data={visibles}
            columns={columnasVisibles}
            getRowId={(l) => l.id_detalle_venta}
            emptyState={
              <p className="p-4 text-center text-sm text-muted">
                No hay ventas pendientes de liquidación para el período seleccionado.
              </p>
            }
          />
        </div>
      </Card>

      {/* Líneas excluidas */}
      {excluidas.length > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base text-muted font-medium">Líneas excluidas de este período</h3>
            <span className="text-xs text-muted">{excluidas.length} línea(s)</span>
          </div>

          <div className="overflow-x-auto">
            <Table
              data={excluidas}
              columns={columnasExcluidas}
              getRowId={(l) => l.id_detalle_venta}
            />
          </div>
        </div>
      )}

      {/* Observaciones y confirmación */}
      <Card padding="none" className="p-4 sm:p-6 space-y-4">
        <Field htmlFor="liq-obs" label="Observaciones (opcional)">
          <Textarea
            id="liq-obs"
            placeholder="Anotaciones para la liquidación..."
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={3}
          />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            onClick={() => router.push(`/revendedoras/${idRevendedora}/liquidaciones`)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={pending || visibles.length === 0}
          >
            Generar liquidación
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="¿Confirmar liquidación?"
        description={`Se sellarán ${visibles.length} líneas de venta por un total vendido de ${formatearMoneda(
          Number(preview.monto_vendido),
        )} y un total a cobrar de ${formatearMoneda(Number(preview.monto_a_cobrar))}.`}
        confirmLabel={pending ? 'Generando…' : 'Confirmar liquidación'}
        onConfirm={confirmarGeneracion}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
