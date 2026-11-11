'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { BuscadorProductos, type SugerenciaProducto } from '@/components/inventario/BuscadorProductos'
import { normalizar } from '@/lib/inventario/producto-match'
import type { ItemElegibleConsignacion } from '@/lib/dal/consignaciones/consignacion'
import {
  ESTADO_DETALLE_LABEL,
  type ConsignacionConDetalle,
  type EstadoConsignacionDetalle,
} from '@/lib/types/consignaciones'
import { Textarea } from '@/components/ui/Textarea'
import {
  agregarItemConsignacionAction,
  cancelarItemConsignacionAction,
  cerrarConsignacionAction,
  confirmarConsignacionAction,
  confirmarSalidaItemAction,
  editarConsignacionAction,
  eliminarConsignacionAction,
} from '../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/TableParts'
import { Card } from '@/components/ui/Card'

const DETALLE_VARIANT: Record<EstadoConsignacionDetalle, 'success' | 'warning' | 'neutral'> = {
  pendiente: 'warning',
  devuelto: 'success',
  cancelado: 'neutral',
}

interface LookupOk {
  ok: true
  item: {
    id_item: string
    qr_code: string
    producto_nombre: string
    sku: string | null
    categoria_nombre: string | null
    costo_ingreso: number | null
    fecha_ingreso: string
  }
}
interface LookupFail { ok: false; reason: string; estado?: string }
type LookupResp = LookupOk | LookupFail

export function ConsignacionDetalleView({
  cons,
  itemsElegibles,
  puedeEliminar,
  volverHref,
  puedeVerCostos,
}: {
  puedeVerCostos: boolean
  cons: ConsignacionConDetalle
  itemsElegibles: ItemElegibleConsignacion[]
  puedeEliminar: boolean
  volverHref: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [qrInput, setQrInput] = useState('')
  const [motivoItem, setMotivoItem] = useState('')
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  const [buscando, setBuscando] = useState(false)

  const [confirmarSalida, setConfirmarSalida] = useState<string | null>(null)
  const [cancelarItem, setCancelarItem] = useState<string | null>(null)
  const [cerrarOpen, setCerrarOpen] = useState(false)
  const [confirmarLoteOpen, setConfirmarLoteOpen] = useState(false)
  const [eliminarOpen, setEliminarOpen] = useState(false)

  const [editando, setEditando] = useState(false)
  const [obs, setObs] = useState(cons.observaciones ?? '')

  const readonly = cons.estado === 'cerrada'
  const pendientes = cons.detalles.filter((d) => d.estado === 'pendiente').length
  const devueltos = cons.detalles.filter((d) => d.estado === 'devuelto').length

  // Sugerencias por nombre / SKU / QR sobre los ítems elegibles del proveedor.
  const sugerencias = useMemo<SugerenciaProducto[]>(() => {
    const term = normalizar(qrInput)
    if (!term) return []
    return itemsElegibles
      .filter(
        (it) =>
          normalizar(it.producto_nombre).includes(term) ||
          (it.sku ? normalizar(it.sku).includes(term) : false) ||
          normalizar(it.qr_code).includes(term),
      )
      .slice(0, 8)
      .map((it) => ({
        id: it.id_item,
        nombre: it.producto_nombre,
        sku: it.sku,
        detalle: it.talle ? `${it.talle} · ${it.qr_code}` : it.qr_code,
      }))
  }, [itemsElegibles, qrInput])

  async function agregarPorQr(rawQr: string) {
    const qr = rawQr.trim()
    if (!qr) return
    if (!cons.proveedor) return setErrorBusqueda('Consignación sin proveedor')
    setBuscando(true)
    setErrorBusqueda(null)
    try {
      const r = await fetch(
        `/api/consignaciones/lookup-item?qr=${encodeURIComponent(qr)}&id_proveedor=${cons.proveedor.id_proveedor}`,
      )
      const data = (await r.json()) as LookupResp
      if (!data.ok) {
        setErrorBusqueda(mensajeDeError(data.reason, { extra: data }))
        return
      }
      // Llamar al RPC vía Server Action
      start(async () => {
        const res = await agregarItemConsignacionAction({
          idConsignacion: cons.id_consignacion,
          idItem: data.item.id_item,
          motivo: motivoItem || null,
        })
        if (!res.ok) {
          setErrorBusqueda(mensajeDeError(res.reason))
          return
        }
        toast.success('Ítem apartado')
        setQrInput('')
        router.refresh()
      })
    } catch (err) {
      setErrorBusqueda((err as Error).message)
    } finally {
      setBuscando(false)
    }
  }

  function ejecutarConfirmar() {
    if (!confirmarSalida) return
    const id = confirmarSalida
    setConfirmarSalida(null)
    start(async () => {
      const res = await confirmarSalidaItemAction({
        idDetalle: id,
        idConsignacion: cons.id_consignacion,
      })
      if (!res.ok) return toast.error('No se pudo confirmar salida', mensajeDeError(res.reason))
      toast.success('Ítem devuelto al proveedor')
      router.refresh()
    })
  }

  function ejecutarCancelar() {
    if (!cancelarItem) return
    const id = cancelarItem
    setCancelarItem(null)
    start(async () => {
      const res = await cancelarItemConsignacionAction({
        idDetalle: id,
        idConsignacion: cons.id_consignacion,
      })
      if (!res.ok) return toast.error('No se pudo cancelar', mensajeDeError(res.reason))
      toast.success('Ítem liberado')
      router.refresh()
    })
  }

  function ejecutarCerrar() {
    setCerrarOpen(false)
    start(async () => {
      const res = await cerrarConsignacionAction({ idConsignacion: cons.id_consignacion })
      if (!res.ok) return toast.error('No se pudo cerrar', mensajeDeError(res.reason))
      toast.success('Consignación cerrada')
      router.refresh()
    })
  }

  /** Salida de TODOS los pendientes + cierre, en una transacción. */
  function ejecutarConfirmarLote() {
    setConfirmarLoteOpen(false)
    start(async () => {
      const res = await confirmarConsignacionAction({ idConsignacion: cons.id_consignacion })
      if (!res.ok) return toast.error('No se pudo confirmar', mensajeDeError(res.reason))
      toast.success(`Lote confirmado · ${res.data!.confirmados} ítem(s) devueltos`)
      router.refresh()
    })
  }

  function ejecutarGuardarObs() {
    start(async () => {
      const res = await editarConsignacionAction({
        idConsignacion: cons.id_consignacion,
        observaciones: obs,
      })
      if (!res.ok) return toast.error('No se pudo guardar', mensajeDeError(res.reason))
      setEditando(false)
      toast.success('Observaciones actualizadas')
      router.refresh()
    })
  }

  function ejecutarEliminar() {
    setEliminarOpen(false)
    start(async () => {
      const res = await eliminarConsignacionAction({ idConsignacion: cons.id_consignacion })
      if (!res.ok) return toast.error('No se pudo eliminar', mensajeDeError(res.reason))
      const n = res.data!.reestockeados
      toast.success(
        'Consignación eliminada',
        n > 0 ? `${n} ítem(s) volvieron al stock disponible` : undefined,
      )
      router.push(volverHref)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Metadata */}
      <Card className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <div>
          <div className="text-xs uppercase font-mono text-muted">Proveedor</div>
          <div className="mt-1">{cons.proveedor?.nombre ?? '—'}</div>
          {cons.proveedor?.telefono && (
            <div className="text-xs text-muted">{cons.proveedor.telefono}</div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase font-mono text-muted">Fecha</div>
          <div className="mt-1">{new Date(cons.fecha).toLocaleString('es-AR')}</div>
        </div>
        <div>
          <div className="text-xs uppercase font-mono text-muted">Ítems</div>
          <div className="mt-1 font-mono">
            {cons.detalles.length}
            {pendientes > 0 && (
              <span className="text-warn-ink"> ({pendientes} pendientes)</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2">
          {!readonly && pendientes > 0 && (
            <Button
              size="sm"
              onClick={() => setConfirmarLoteOpen(true)}
              disabled={pending}
              title="El proveedor se llevó todo: confirma la salida de los pendientes y cierra"
            >
              Confirmar lote
            </Button>
          )}
          {!readonly && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCerrarOpen(true)}
              disabled={pending || pendientes > 0}
              title={pendientes > 0 ? 'Resolvé todos los pendientes primero' : ''}
            >
              Cerrar lote
            </Button>
          )}
          {puedeEliminar && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEliminarOpen(true)}
              disabled={pending}
              title="Borra el lote; los ítems que ya salieron vuelven al stock"
            >
              Eliminar
            </Button>
          )}
        </div>
      </Card>

      {/* Agregar item */}
      {!readonly && (
        <Card className="space-y-3">
          <h3 className="font-display text-lg">Apartar ítem</h3>
          <BuscadorProductos
            id="qr-c"
            label="Buscar ítem"
            error={errorBusqueda ?? undefined}
            hint="Nombre, SKU o QR. Solo ítems de consignación disponibles de este proveedor."
            placeholder="Escaneá, tipeá el QR o buscá por nombre"
            value={qrInput}
            onChange={setQrInput}
            sugerencias={sugerencias}
            onElegir={(s) => {
              const it = itemsElegibles.find((x) => x.id_item === s.id)
              if (it) void agregarPorQr(it.qr_code)
            }}
            onSubmit={(texto) => void agregarPorQr(texto)}
            disabled={buscando || pending}
            autoFocus
            actions={
              <Button type="submit" disabled={buscando || pending || !qrInput.trim()}>
                {buscando ? 'Buscando…' : pending ? 'Apartando…' : 'Apartar'}
              </Button>
            }
          />
          <Field htmlFor="mot-c" label="Motivo (aplica al próximo)" hint="Opcional; se guarda por línea">
            <Input
              id="mot-c"
              value={motivoItem}
              onChange={(e) => setMotivoItem(e.target.value)}
              placeholder="Ej: sin rotación, defecto de fábrica"
            />
          </Field>
        </Card>
      )}

      {/* Tabla de items */}
      <TableFrame>
        <DataTable>
          <THead>
            <Th>Producto</Th>
            <Th>QR</Th>
            {puedeVerCostos && <Th align="right">Costo</Th>}
            <Th>Motivo</Th>
            <Th>Estado</Th>
            <Th>Fechas</Th>
            {!readonly && <Th></Th>}
          </THead>
          <TBody>
            {cons.detalles.length === 0 ? (
              <Tr>
                <Td align="center" colSpan={puedeVerCostos ? (readonly ? 6 : 7) : (readonly ? 5 : 6)} className="px-4 py-8 text-muted">
                  Sin ítems apartados todavía.
                </Td>
              </Tr>
            ) : (
              cons.detalles.map((d) => (
                <Tr key={d.id_consignacion_detalle}>
                  <Td>
                    <div className="font-medium">{d.producto?.nombre ?? '—'}</div>
                    {d.producto?.sku && (
                      <div className="text-xs font-mono text-muted">{d.producto.sku}</div>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{d.item?.qr_code ?? '—'}</Td>
                  {puedeVerCostos && (
                    <Td align="right" className="font-mono">
                      {d.item?.costo_ingreso != null
                        ? `$ ${Number(d.item.costo_ingreso).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
                        : '—'}
                    </Td>
                  )}
                  <Td className="text-xs">{d.motivo ?? <span className="text-muted">—</span>}</Td>
                  <Td>
                    <Badge variant={DETALLE_VARIANT[d.estado]}>
                      {ESTADO_DETALLE_LABEL[d.estado]}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-muted">
                    <div>Apart: {new Date(d.fecha_apartado).toLocaleDateString('es-AR')}</div>
                    {d.fecha_devolucion && (
                      <div>Sal: {new Date(d.fecha_devolucion).toLocaleDateString('es-AR')}</div>
                    )}
                  </Td>
                  {!readonly && (
                    <Td align="right" className="whitespace-nowrap">
                      {d.estado === 'pendiente' && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setCancelarItem(d.id_consignacion_detalle)}
                            disabled={pending}
                          >
                            Liberar
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="ml-2"
                            onClick={() => setConfirmarSalida(d.id_consignacion_detalle)}
                            disabled={pending}
                          >
                            Confirmar salida
                          </Button>
                        </>
                      )}
                    </Td>
                  )}
                </Tr>
              ))
            )}
          </TBody>
          {cons.detalles.length > 0 && (
            <TFoot>
              <Tr className="border-t bg-card-2">
                <Td colSpan={puedeVerCostos ? 4 : 3} className="font-semibold">
                  Total {cons.detalles.length} ítem(s)
                </Td>
                <Td colSpan={readonly ? 2 : 3} className="text-xs text-muted">
                  {pendientes} pendientes · {devueltos} devueltos
                </Td>
              </Tr>
            </TFoot>
          )}
        </DataTable>
      </TableFrame>

      {/* Observaciones — editables mientras el lote esté activo. */}
      <div className="rounded-lg border border-border bg-card-2 p-4 text-sm space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs uppercase font-mono text-muted">Observaciones</div>
          {!readonly && !editando && (
            <Button size="sm" variant="ghost" onClick={() => setEditando(true)} disabled={pending}>
              Editar
            </Button>
          )}
        </div>
        {editando ? (
          <div className="space-y-2">
            <Textarea
              id="cons-obs"
              rows={3}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Motivo general del lote"
              disabled={pending}
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setObs(cons.observaciones ?? '')
                  setEditando(false)
                }}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button size="sm" onClick={ejecutarGuardarObs} disabled={pending}>
                {pending ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        ) : (
          <div className={cons.observaciones ? '' : 'text-muted'}>
            {cons.observaciones || 'Sin observaciones.'}
          </div>
        )}
      </div>

      {/* Modales */}
      <ConfirmDialog
        open={!!confirmarSalida}
        title="Confirmar salida del ítem"
        description="El ítem pasa a estado 'devuelto'. Esta acción no se puede deshacer; el ítem no vuelve al stock disponible."
        confirmLabel="Sí, salió"
        cancelLabel="Cancelar"
        onConfirm={ejecutarConfirmar}
        onCancel={() => setConfirmarSalida(null)}
      />
      <ConfirmDialog
        open={!!cancelarItem}
        title="Liberar ítem apartado"
        description="El ítem vuelve a estar disponible para venta o para otra consignación."
        variant="danger"
        confirmLabel="Sí, liberar"
        cancelLabel="Volver"
        onConfirm={ejecutarCancelar}
        onCancel={() => setCancelarItem(null)}
      />
      <ConfirmDialog
        open={cerrarOpen}
        title="Cerrar consignación"
        description="No se van a poder apartar más ítems en este lote. Solo se puede cerrar si no quedan ítems pendientes."
        confirmLabel="Sí, cerrar"
        cancelLabel="Cancelar"
        onConfirm={ejecutarCerrar}
        onCancel={() => setCerrarOpen(false)}
      />
      <ConfirmDialog
        open={confirmarLoteOpen}
        title="Confirmar el lote completo"
        description={`Se confirma la salida de los ${pendientes} ítem(s) pendientes y el lote queda cerrado. Los ítems dejan de estar en stock. Esta acción no se puede deshacer desde acá.`}
        confirmLabel="Sí, salió todo"
        cancelLabel="Cancelar"
        onConfirm={ejecutarConfirmarLote}
        onCancel={() => setConfirmarLoteOpen(false)}
      />
      <ConfirmDialog
        open={eliminarOpen}
        title="Eliminar la consignación"
        description={
          devueltos > 0
            ? `El lote se borra definitivamente y los ${devueltos} ítem(s) que ya habían salido VUELVEN al stock disponible. Usalo solo si la devolución se cargó por error.`
            : 'El lote se borra definitivamente. Los ítems apartados quedan libres para venta o para otro lote.'
        }
        variant="danger"
        confirmLabel="Sí, eliminar"
        cancelLabel="Volver"
        onConfirm={ejecutarEliminar}
        onCancel={() => setEliminarOpen(false)}
      />
    </div>
  )
}
