'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Table, type Column } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'
import type {
  ConsignacionRevendedoraConDetalle,
  ConsignacionRevendedoraItemDetalle,
  EstadoConsignacionRevendedoraDetalle,
} from '@/lib/types/revendedoras'
import {
  confirmarConsignacionRevendedoraAction,
  registrarDevolucionRevendedoraAction,
  cerrarConsignacionRevendedoraAction,
  eliminarConsignacionRevendedoraAction,
} from '../actions'
import { Checkbox } from '@/components/ui/Checkbox'
import { Card } from '@/components/ui/Card'

const DETALLE_VARIANT: Record<
  EstadoConsignacionRevendedoraDetalle,
  'warning' | 'info' | 'success' | 'neutral' | 'danger'
> = {
  pendiente: 'warning',
  en_poder: 'info',
  vendido: 'success',
  devuelto: 'neutral',
  baja: 'danger',
}

const DETALLE_LABEL: Record<EstadoConsignacionRevendedoraDetalle, string> = {
  pendiente: 'Pendiente de entrega',
  en_poder: 'En poder',
  vendido: 'Vendido',
  devuelto: 'Devuelto',
  baja: 'Baja',
}

export function ConsignacionRevendedoraDetalleView({
  cons,
  puedeCrear,
  puedeEditar,
  puedeEliminar,
}: {
  cons: ConsignacionRevendedoraConDetalle
  puedeCrear: boolean
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()

  const [confirmarOpen, setConfirmarOpen] = useState(false)
  const [eliminarOpen, setEliminarOpen] = useState(false)
  const [cerrarOpen, setCerrarOpen] = useState(false)

  // Devolución state
  const [devolucionOpen, setDevolucionOpen] = useState(false)
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [estadoDestino, setEstadoDestino] = useState<'disponible' | 'devuelto' | 'baja'>('disponible')
  const [motivoDevolucion, setMotivoDevolucion] = useState('')

  const itemsEnPoder = cons.detalles.filter((d) => d.estado_detalle === 'en_poder')
  const itemsPendientes = cons.detalles.filter((d) => d.estado_detalle === 'pendiente')

  function handleSelectAllEnPoder() {
    if (selectedItems.length === itemsEnPoder.length) {
      setSelectedItems([])
    } else {
      setSelectedItems(itemsEnPoder.map((i) => i.id_item))
    }
  }

  function handleToggleItem(idItem: string) {
    setSelectedItems((prev) =>
      prev.includes(idItem) ? prev.filter((id) => id !== idItem) : [...prev, idItem]
    )
  }

  function handleConfirmarEntrega() {
    startTransition(async () => {
      const res = await confirmarConsignacionRevendedoraAction(cons.id_revendedora, {
        id_consignacion_revendedora: cons.id_consignacion_revendedora,
      })

      if (!res.ok) {
        toast.error(mensajeDeError(res.reason))
        return
      }

      toast.success('Entrega confirmada. Los ítems pasaron al estado "En revendedora".')
      setConfirmarOpen(false)
      router.refresh()
    })
  }

  function handleEliminarBorrador() {
    startTransition(async () => {
      const res = await eliminarConsignacionRevendedoraAction(cons.id_revendedora, {
        id_consignacion_revendedora: cons.id_consignacion_revendedora,
      })

      if (!res.ok) {
        toast.error(mensajeDeError(res.reason))
        return
      }

      toast.success('Consignación eliminada.')
      setEliminarOpen(false)
      router.push(`/revendedoras/${cons.id_revendedora}/consignaciones`)
    })
  }

  function handleRegistrarDevolucion() {
    if (selectedItems.length === 0) {
      toast.error('Seleccioná al menos un ítem para devolver.')
      return
    }

    startTransition(async () => {
      const res = await registrarDevolucionRevendedoraAction(cons.id_revendedora, {
        id_consignacion_revendedora: cons.id_consignacion_revendedora,
        items: selectedItems,
        estado_destino: estadoDestino,
        motivo: motivoDevolucion || null,
      })

      if (!res.ok) {
        toast.error(mensajeDeError(res.reason))
        return
      }

      toast.success(
        `Devolución de ${selectedItems.length} ítem${
          selectedItems.length === 1 ? '' : 's'
        } registrada correctamente.`
      )
      setDevolucionOpen(false)
      setSelectedItems([])
      setMotivoDevolucion('')
      router.refresh()
    })
  }

  function handleCerrarConsignacion() {
    startTransition(async () => {
      const res = await cerrarConsignacionRevendedoraAction(cons.id_revendedora, {
        id_consignacion_revendedora: cons.id_consignacion_revendedora,
      })

      if (!res.ok) {
        toast.error(mensajeDeError(res.reason))
        return
      }

      toast.success('Consignación cerrada correctamente.')
      setCerrarOpen(false)
      router.refresh()
    })
  }

  const columns: Column<ConsignacionRevendedoraItemDetalle>[] = [
    ...(cons.confirmada && cons.estado === 'abierta' && puedeEditar
      ? [
          {
            key: 'seleccion',
            label: 'Sel.',
            render: (r: ConsignacionRevendedoraItemDetalle) =>
              r.estado_detalle === 'en_poder' ? (
                <Checkbox
                  aria-label={`Seleccionar ítem ${r.sku}`}
                  checked={selectedItems.includes(r.id_item)}
                  onChange={() => handleToggleItem(r.id_item)}
                />
              ) : null,
          },
        ]
      : []),
    {
      key: 'sku',
      label: 'Código / SKU',
      render: (r) => (
        <div>
          <span className="font-mono text-sm">{r.sku}</span>
          {r.codigo_barra && <div className="font-mono text-xs text-muted">{r.codigo_barra}</div>}
        </div>
      ),
    },
    {
      key: 'nombre_producto',
      label: 'Producto',
      render: (r) => <span className="font-medium text-sm">{r.nombre_producto}</span>,
    },
    {
      key: 'talle',
      label: 'Talle',
      render: (r) => <span className="text-sm">{r.talle || '—'}</span>,
    },
    {
      key: 'precio',
      label: 'Precio venta',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-sm">
          $ {r.precio_actual.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
        </span>
      ),
    },
    {
      key: 'estado_detalle',
      label: 'Estado del ítem',
      render: (r) => (
        <Badge variant={DETALLE_VARIANT[r.estado_detalle]}>
          {DETALLE_LABEL[r.estado_detalle]}
        </Badge>
      ),
    },
    {
      key: 'fechas',
      label: 'Fechas',
      render: (r) => (
        <div className="text-xs text-muted">
          {r.fecha_entrega && (
            <div>Entrega: {new Date(r.fecha_entrega).toLocaleDateString('es-AR')}</div>
          )}
          {r.fecha_devolucion && (
            <div>Devolución: {new Date(r.fecha_devolucion).toLocaleDateString('es-AR')}</div>
          )}
        </div>
      ),
    },
    {
      key: 'motivo',
      label: 'Motivo',
      render: (r) => (
        <span className="text-xs text-muted truncate max-w-xs block">{r.motivo || '—'}</span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <Card padding="none" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-xl">Lote de consignación</h2>
            {!cons.confirmada && <Badge variant="warning">Sin confirmar</Badge>}
            {cons.confirmada && cons.estado === 'abierta' && <Badge variant="success">Abierta</Badge>}
            {cons.estado === 'cerrada' && <Badge variant="neutral">Cerrada</Badge>}
          </div>
          <p className="text-sm text-muted">
            Revendedora: {cons.revendedora.nombre} {cons.revendedora.apellido}
            {cons.revendedora.telefono && ` · Tel: ${cons.revendedora.telefono}`}
          </p>
          {cons.observaciones && (
            <p className="text-sm text-text pt-2 italic">“{cons.observaciones}”</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!cons.confirmada && puedeCrear && (
            <Button onClick={() => setConfirmarOpen(true)} disabled={pending}>
              Confirmar entrega ({itemsPendientes.length})
            </Button>
          )}

          {!cons.confirmada && puedeEliminar && (
            <Button
              variant="secondary"
              onClick={() => setEliminarOpen(true)}
              disabled={pending}
            >
              Eliminar
            </Button>
          )}

          {cons.confirmada && cons.estado === 'abierta' && puedeEditar && (
            <>
              <Button
                onClick={() => setDevolucionOpen(true)}
                disabled={pending || itemsEnPoder.length === 0}
              >
                Registrar devolución {selectedItems.length > 0 && `(${selectedItems.length})`}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setCerrarOpen(true)}
                disabled={pending || itemsEnPoder.length > 0}
                title={
                  itemsEnPoder.length > 0
                    ? 'No se puede cerrar mientras queden ítems en poder de la revendedora'
                    : 'Cerrar consignación'
                }
              >
                Cerrar lote
              </Button>
            </>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <div className="text-xs uppercase font-mono text-muted">Total ítems</div>
          <div className="mt-1 font-display text-2xl">{cons.detalles.length}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase font-mono text-muted">En su poder</div>
          <div className="mt-1 font-display text-2xl text-ink">{itemsEnPoder.length}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase font-mono text-muted">Vendidos</div>
          <div className="mt-1 font-display text-2xl text-ink">
            {cons.detalles.filter((d) => d.estado_detalle === 'vendido').length}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase font-mono text-muted">Devueltos / Baja</div>
          <div className="mt-1 font-display text-2xl text-muted">
            {cons.detalles.filter((d) => d.estado_detalle === 'devuelto' || d.estado_detalle === 'baja').length}
          </div>
        </Card>
      </div>

      <Card padding="none" className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg">Ítems del lote</h3>
          {cons.confirmada && cons.estado === 'abierta' && puedeEditar && itemsEnPoder.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted">
                Seleccioná ítems en poder para registrar su devolución al local.
              </span>
              <Button
                variant="bare"
                type="button"
                onClick={handleSelectAllEnPoder}
                className="text-xs text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink font-medium"
              >
                {selectedItems.length === itemsEnPoder.length
                  ? 'Deseleccionar todos'
                  : 'Seleccionar todos'}
              </Button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <Table
            data={cons.detalles}
            columns={columns}
            getRowId={(r: ConsignacionRevendedoraItemDetalle) => r.id_consignacion_revendedora_detalle}
          />
        </div>
      </Card>

      {/* Confirmar entrega Dialog */}
      <ConfirmDialog
        open={confirmarOpen}
        onCancel={() => setConfirmarOpen(false)}
        title="Confirmar entrega de mercadería"
        description={`Se confirmará la salida de ${itemsPendientes.length} ítem(s) hacia la revendedora ${cons.revendedora.nombre}. Su estado cambiará a "En revendedora" y dejarán de estar disponibles en el stock central.`}
        confirmLabel="Confirmar entrega"
        onConfirm={handleConfirmarEntrega}
      />

      {/* Eliminar borrador Dialog */}
      <ConfirmDialog
        open={eliminarOpen}
        onCancel={() => setEliminarOpen(false)}
        title="Eliminar consignación"
        description="¿Querés eliminar esta consignación sin confirmar? Los ítems siguen disponibles en el local."
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={handleEliminarBorrador}
      />

      {/* Cerrar consignación Dialog */}
      <ConfirmDialog
        open={cerrarOpen}
        onCancel={() => setCerrarOpen(false)}
        title="Cerrar consignación"
        description="Se marcará este lote de consignación como cerrado definitivamente."
        confirmLabel="Cerrar consignación"
        onConfirm={handleCerrarConsignacion}
      />

      {/* Esc, clic afuera y la × no cierran mientras se registra: cerrar a mitad
          del envío escondería el resultado de la devolución. */}
      <Modal
        open={devolucionOpen}
        onClose={() => {
          if (!pending) setDevolucionOpen(false)
        }}
        title="Registrar devolución de ítems"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDevolucionOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleRegistrarDevolucion}
              disabled={pending || selectedItems.length === 0}
            >
              {pending ? 'Registrando...' : 'Confirmar devolución'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {selectedItems.length > 0
              ? `Devolviendo ${selectedItems.length} ítem(s) seleccionado(s).`
              : 'Seleccioná los ítems a devolver de la lista antes de continuar.'}
          </p>

          <Field htmlFor="estado-destino" label="Estado de destino de la mercadería">
            <Select
              id="estado-destino"
              value={estadoDestino}
              onChange={(e) =>
                setEstadoDestino(e.target.value as 'disponible' | 'devuelto' | 'baja')
              }
            >
              <option value="disponible">
                Mercadería en perfecto estado (vuelve a stock disponible central)
              </option>
              <option value="devuelto">
                Devuelto al proveedor (mercadería apartada / defectuosa)
              </option>
              <option value="baja">
                Baja definitiva (mercadería rota, manchada o inutilizable)
              </option>
            </Select>
          </Field>

          <Field htmlFor="motivo-devolucion" label="Motivo o detalle (opcional)">
            <Input
              id="motivo-devolucion"
              value={motivoDevolucion}
              onChange={(e) => setMotivoDevolucion(e.target.value)}
              placeholder="Ej: Cambio de temporada, rotura de costura..."
            />
          </Field>

        </div>
      </Modal>
    </div>
  )
}
