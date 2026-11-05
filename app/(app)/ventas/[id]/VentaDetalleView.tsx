'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { formaPagoLabel } from '@/lib/types/precios'
import {
  CONCEPTO_RETENCION_LABEL,
  desgloseCosto,
  ESTADO_CUOTA_LABEL,
  MEDIO_PAGO_LABEL,
  nombreCliente,
  TIPO_COMPROBANTE_LABEL,
  type CuentaDestinoRow,
  type CuotaFinanciadaRow,
  type EstadoCuota,
  type MedioPago,
  type PagoVentaRow,
  type TipoComprobante,
  type VentaConDetalle,
} from '@/lib/types/ventas'
import { saldoCuota } from '@/lib/cuotas/generar-plan'
import {
  anularVentaAction,
  cambiarItemVentaAction,
  devolverItemVentaAction,
  emitirComprobanteAction,
} from '../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/TableParts'
import { Select } from '@/components/ui/Select'
import { Card } from '@/components/ui/Card'

const CUOTA_VARIANT: Record<EstadoCuota, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  pendiente: 'info',
  parcial: 'warning',
  pagada: 'success',
  incobrable: 'danger',
  anulada: 'neutral',
}

export function VentaDetalleView({
  venta,
  cuotas,
  cuentas,
}: {
  venta: VentaConDetalle
  cuotas: CuotaFinanciadaRow[]
  cuentas: Array<Pick<CuentaDestinoRow, 'id_cuenta_destino' | 'nombre' | 'tipo'>>
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [anularOpen, setAnularOpen] = useState(false)
  // Motivo de anulación. El SP lo guarda en `venta.motivo_anulacion` y esta
  // misma vista lo muestra más abajo; hasta ahora nada lo capturaba, así que
  // ese cartel no podía aparecer nunca. Es opcional (`p_motivo default null`).
  const [motivoAnulacion, setMotivoAnulacion] = useState('')
  const [devolverOpen, setDevolverOpen] = useState<string | null>(null)
  const [cambiarLinea, setCambiarLinea] = useState<VentaConDetalle['lineas'][number] | null>(null)
  const [codigoBusqueda, setCodigoBusqueda] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [itemCandidato, setItemCandidato] = useState<{
    id_item: string
    producto_nombre: string
    qr_code: string
    talle?: string | null
    precio: number
  } | null>(null)
  const [motivoCambio, setMotivoCambio] = useState('')
  const [tallesCandidatos, setTallesCandidatos] = useState<{
    idProducto: string
    productoNombre: string
    talles: Array<{ talle: string; disponibles: number }>
    sinTalle: number
  } | null>(null)
  const [cambioMedio, setCambioMedio] = useState<MedioPago | ''>('')
  const [cambioCuenta, setCambioCuenta] = useState<string>('')
  const [comprobanteOpen, setComprobanteOpen] = useState(false)
  const [tipoComp, setTipoComp] = useState<TipoComprobante>('ticket')
  const [numeroComp, setNumeroComp] = useState('')
  const [reintegroMedio, setReintegroMedio] = useState<MedioPago | ''>('')
  const [reintegroCuenta, setReintegroCuenta] = useState<string>('')

  const readonly = venta.estado_venta === 'anulada'
  const tieneComprobante = venta.comprobantes.length > 0
  const total = Number(venta.total)

  // Neto de la cobranza. Sólo se muestra si hubo algo que descontar: si el
  // neto es igual al total, repetirlo abajo no informa nada.
  const costoTotal = venta.pagos.reduce((a, p) => a + Number(p.costo_cobro), 0)
  const netoTotal =
    costoTotal > 0
      ? venta.pagos.reduce((a, p) => a + Number(p.neto_acreditado ?? p.monto), 0)
      : null
  // La fecha en la que termina de acreditar todo: la más lejana de los pagos.
  const fechaAcreditacion = (() => {
    const fechas = venta.pagos.map((p) => p.fecha_acreditacion).filter((f): f is string => !!f)
    if (fechas.length === 0) return null
    const max = fechas.reduce((a, f) => (f > a ? f : a))
    // Acreditación el mismo día = ya está en la cuenta, no hay nada que avisar.
    return max <= venta.fecha.slice(0, 10)
      ? null
      : `acredita el ${new Date(`${max}T00:00:00`).toLocaleDateString('es-AR')}`
  })()

  function anular() {
    setAnularOpen(false)
    const motivo = motivoAnulacion.trim()
    start(async () => {
      const res = await anularVentaAction({
        idVenta: venta.id_venta,
        // Vacío va como `undefined`, no como `''`: `spAnularVenta` lo manda como
        // NULL y la vista distingue "sin motivo" de "motivo en blanco".
        motivo: motivo || undefined,
      })
      if (!res.ok) return toast.error('No se pudo anular', mensajeDeError(res.reason))
      setMotivoAnulacion('')
      setReintegroMedio('')
      setReintegroCuenta('')
      const reintegro = res.data?.total_reintegrado ?? 0
      if (reintegro > 0) {
        toast.success(`Venta anulada. Se generó un reintegro de $${reintegro.toLocaleString('es-AR')}.`)
      } else {
        toast.success('Venta anulada sin reintegros.')
      }
      router.refresh()
    })
  }

  function devolver() {
    if (!devolverOpen) return
    const id = devolverOpen
    setDevolverOpen(null)
    start(async () => {
      const res = await devolverItemVentaAction({
        idDetalleVenta: id,
        idVenta: venta.id_venta,
        idCuentaReintegro: reintegroCuenta || undefined,
        medioReintegro: (reintegroMedio as MedioPago) || undefined,
      })
      if (!res.ok) return toast.error('No se pudo devolver', mensajeDeError(res.reason))
      setReintegroMedio('')
      setReintegroCuenta('')
      const reintegro = res.data?.reintegro ?? 0
      if (reintegro > 0) {
        toast.success(`Ítem devuelto. Se generó un reintegro de $${reintegro.toLocaleString('es-AR')}.`)
      } else {
        toast.success('Ítem devuelto sin reintegros.')
      }
      router.refresh()
    })
  }

  const precioOriginal = cambiarLinea ? Number(cambiarLinea.precio_venta) : 0
  const precioNuevo = itemCandidato ? Number(itemCandidato.precio) : null
  const diferenciaCambio = precioNuevo !== null ? precioNuevo - precioOriginal : null

  async function buscarItemEntregado(e?: React.FormEvent) {
    if (e) e.preventDefault()
    const codigo = codigoBusqueda.trim()
    if (!codigo) return
    setBuscando(true)
    try {
      const url =
        venta.canal === 'revendedora' && venta.id_revendedora
          ? `/api/revendedoras/lookup-item?code=${encodeURIComponent(codigo)}&id_revendedora=${venta.id_revendedora}&modo=venta`
          : `/api/ventas/lookup-item?code=${encodeURIComponent(codigo)}`
      const res = await fetch(url)
      const data = await res.json()
      if (!data.ok) {
        if (data.reason === 'elegir-talle') {
          setItemCandidato(null)
          setTallesCandidatos({
            idProducto: (data.id_producto as string) ?? '',
            productoNombre: (data.producto_nombre as string) ?? 'Producto',
            talles: (
              (data.talles as Array<{ talle: string; disponibles: number }>) ?? []
            ).filter((t) => t.disponibles > 0),
            sinTalle: Number(data.sin_talle ?? 0),
          })
          return
        }
        setTallesCandidatos(null)
        toast.error('No se encontró el ítem', mensajeDeError(data.reason))
        setItemCandidato(null)
        return
      }
      const linea = data.linea || data.item
      setTallesCandidatos(null)
      const precio = Number(linea.precio_final ?? linea.precio_lista ?? linea.precio_venta ?? 0)
      setItemCandidato({
        id_item: linea.id_item,
        producto_nombre: linea.producto_nombre || linea.nombre || '(producto)',
        qr_code: linea.qr_code || codigo,
        talle: linea.talle,
        precio,
      })
    } catch {
      toast.error('Error al buscar el ítem', 'Verificá la conexión y probá de nuevo.')
    } finally {
      setBuscando(false)
    }
  }

  async function elegirTalleCandidato(talle: string | null) {
    if (!tallesCandidatos || buscando) return
    setBuscando(true)
    try {
      const qs = new URLSearchParams({ id_producto: tallesCandidatos.idProducto })
      if (talle === null) qs.set('sin_talle', '1')
      else qs.set('talle', talle)
      if (venta.canal === 'revendedora' && venta.id_revendedora) {
        qs.set('id_revendedora', venta.id_revendedora)
        qs.set('modo', 'venta')
      }
      const base =
        venta.canal === 'revendedora' && venta.id_revendedora
          ? '/api/revendedoras/lookup-item'
          : '/api/ventas/lookup-item'
      const res = await fetch(`${base}?${qs.toString()}`)
      const data = await res.json()
      if (!data.ok) {
        toast.error('No se encontró el ítem', mensajeDeError(data.reason))
        return
      }
      const linea = data.linea || data.item
      const precio = Number(linea.precio_final ?? linea.precio_lista ?? linea.precio_venta ?? 0)
      setTallesCandidatos(null)
      setItemCandidato({
        id_item: linea.id_item,
        producto_nombre: linea.producto_nombre || linea.nombre || '(producto)',
        qr_code: linea.qr_code || codigoBusqueda.trim(),
        talle: linea.talle,
        precio,
      })
    } catch {
      toast.error('Error al buscar el ítem', 'Verificá la conexión y probá de nuevo.')
    } finally {
      setBuscando(false)
    }
  }

  function confirmarCambio() {
    if (!cambiarLinea || !itemCandidato) return
    start(async () => {
      const res = await cambiarItemVentaAction({
        idDetalleOriginal: cambiarLinea.id_detalle_venta,
        idItemEntregado: itemCandidato.id_item,
        idVenta: venta.id_venta,
        canal: venta.canal,
        idRevendedora: venta.id_revendedora,
        motivo: motivoCambio.trim() || undefined,
        medioCobro: (diferenciaCambio ?? 0) > 0 && venta.canal === 'local' ? (cambioMedio as MedioPago) : undefined,
        idCuentaDestino: (diferenciaCambio ?? 0) > 0 && venta.canal === 'local' ? cambioCuenta : undefined,
      })
      if (!res.ok) {
        return toast.error('No se pudo registrar el cambio', mensajeDeError(res.reason))
      }
      toast.success('Cambio de producto registrado correctamente.')
      setCambiarLinea(null)
      setTallesCandidatos(null)
      setItemCandidato(null)
      router.refresh()
    })
  }

  function emitir(e: React.FormEvent) {
    e.preventDefault()
    if (!numeroComp.trim()) return toast.error('Falta número')
    start(async () => {
      const res = await emitirComprobanteAction({
        idVenta: venta.id_venta,
        tipo: tipoComp,
        numero: numeroComp,
      })
      if (!res.ok) return toast.error('No se pudo emitir', mensajeDeError(res.reason))
      toast.success('Comprobante emitido')
      setComprobanteOpen(false)
      setNumeroComp('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Metadata + acciones */}
      <Card className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <div>
          <div className="text-xs uppercase font-mono text-muted">Cliente</div>
          <div className="mt-1">{nombreCliente(venta.cliente)}</div>
          {venta.cliente?.telefono && (
            <div className="text-xs text-muted">{venta.cliente.telefono}</div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase font-mono text-muted">Forma de pago</div>
          <div className="mt-1">{formaPagoLabel(venta.forma_pago)}</div>
        </div>
        <div>
          <div className="text-xs uppercase font-mono text-muted">Total</div>
          <div className="mt-1 font-mono font-semibold">
            $ {total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2">
          {!readonly && !tieneComprobante && (
            <Button size="sm" variant="secondary" onClick={() => setComprobanteOpen(true)}>
              Emitir comprobante
            </Button>
          )}
          {!readonly && (
            <Button size="sm" variant="danger" onClick={() => setAnularOpen(true)}>
              Anular venta
            </Button>
          )}
        </div>
      </Card>

      {venta.motivo_anulacion && (
        <div className="rounded-md border border-alerta-ink bg-alerta-bg px-3 py-2 text-sm text-alerta-ink">
          Anulada: {venta.motivo_anulacion}
        </div>
      )}

      {/* Líneas */}
      <TableFrame>
        <DataTable>
          <THead>
            <Th>Producto</Th>
            <Th>QR</Th>
            <Th align="right">Precio</Th>
            {!readonly && <Th></Th>}
          </THead>
          <TBody>
            {venta.lineas.map((l) => (
              <Tr key={l.id_detalle_venta}>
                <Td>
                  <div className="font-medium">{l.producto?.nombre ?? '—'}</div>
                  {l.producto?.sku && (
                    <div className="text-xs font-mono text-muted">{l.producto.sku}</div>
                  )}
                </Td>
                <Td className="font-mono text-xs">{l.item?.qr_code ?? '—'}</Td>
                <Td align="right" className="font-mono">
                  $ {Number(l.precio_venta).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </Td>
                <Td align="right">
                  {l.devolucion ? (
                    <Badge variant="neutral">Devuelto</Badge>
                  ) : l.cambio ? (
                    <Badge variant="warning">Cambiado</Badge>
                  ) : !readonly ? (
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCambiarLinea(l)
                          setTallesCandidatos(null)
                          setCodigoBusqueda('')
                          setItemCandidato(null)
                          setMotivoCambio('')
                          setCambioMedio('')
                          setCambioCuenta('')
                        }}
                      >
                        Cambiar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDevolverOpen(l.id_detalle_venta)}
                      >
                        Devolver
                      </Button>
                    </div>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      </TableFrame>

      {/* Cobranza: dónde entró la plata. Separada de "Forma de pago", que es
          cómo se precio la venta. */}
      {venta.pagos.length > 0 && (
        <Card>
          <h3 className="font-display text-lg mb-3">Cobranza</h3>
          <ul className="space-y-2 text-sm">
            {venta.pagos.map((p) => (
              <li
                key={p.id_pago_venta}
                className="flex flex-wrap items-start justify-between gap-2 border-b border-border-2 pb-2 last:border-0"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {MEDIO_PAGO_LABEL[p.medio]}
                    {p.cuotas != null && p.cuotas > 1 && (
                      <span className="text-muted"> · {p.cuotas} cuotas</span>
                    )}
                    {p.cuenta && <span className="text-muted"> · {p.cuenta.nombre}</span>}
                  </div>
                  {p.referencia && (
                    <div className="font-mono text-xs text-muted">Ref. {p.referencia}</div>
                  )}
                  {p.vuelto != null && p.vuelto > 0 && (
                    <div className="text-xs text-muted">
                      Recibido $ {Number(p.monto_recibido).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      {' · '}
                      vuelto $ {Number(p.vuelto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    </div>
                  )}
                  <DesgloseCobro pago={p} />
                </div>
                <div className="text-right whitespace-nowrap">
                  <div className="font-mono font-semibold">
                    $ {Number(p.monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </div>
                  {Number(p.costo_cobro) > 0 && (
                    <div className="font-mono text-xs text-muted">
                      neto $ {Number(p.neto_acreditado).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {netoTotal !== null && (
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted">
                Neto acreditado
                {fechaAcreditacion && ` · ${fechaAcreditacion}`}
              </span>
              <span className="font-mono font-semibold">
                $ {netoTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </span>
            </div>
          )}
        </Card>
      )}

      {/* Plan de cuotas financiado por la casa. */}
      {cuotas.length > 0 && (
        <Card>
          <h3 className="mb-3 font-display text-lg">Cuotas financiadas</h3>
          <div className="overflow-x-auto">
            <DataTable>
              <THead>
                <Th className="px-2 py-2">Cuota</Th>
                <Th className="px-2 py-2">Vence</Th>
                <Th align="right" className="px-2 py-2">Monto</Th>
                <Th align="right" className="px-2 py-2">Pagado</Th>
                <Th className="px-2 py-2">Estado</Th>
              </THead>
              <TBody>
                {cuotas.map((c) => (
                  <Tr key={c.id_cuota_financiada}>
                    <Td className="px-2 py-2 font-mono text-xs">#{c.numero}</Td>
                    <Td className="px-2 py-2">
                      {new Date(`${c.fecha_vencimiento}T00:00:00`).toLocaleDateString('es-AR')}
                    </Td>
                    <Td align="right" className="px-2 py-2 font-mono">{money(Number(c.monto))}</Td>
                    <Td align="right" className="px-2 py-2 font-mono text-muted">
                      {Number(c.monto_pagado) > 0 ? money(Number(c.monto_pagado)) : '—'}
                    </Td>
                    <Td className="px-2 py-2">
                      <Badge variant={CUOTA_VARIANT[c.estado]}>
                        {ESTADO_CUOTA_LABEL[c.estado]}
                      </Badge>
                      {c.estado === 'incobrable' && c.motivo_incobrable && (
                        <div className="mt-1 text-xs text-muted">{c.motivo_incobrable}</div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
              <TFoot>
                <Tr className="border-t bg-card-2">
                  <Td colSpan={2} className="px-2 py-2 font-semibold">
                    Pendiente de cobro
                  </Td>
                  <Td align="right" colSpan={3} className="px-2 py-2 font-mono font-semibold">
                    {money(
                      cuotas
                        .filter((c) => c.estado === 'pendiente' || c.estado === 'parcial')
                        .reduce((a, c) => a + saldoCuota(c), 0),
                    )}
                  </Td>
                </Tr>
              </TFoot>
            </DataTable>
          </div>
        </Card>
      )}

      {/* Comprobantes */}
      {venta.comprobantes.length > 0 && (
        <Card>
          <h3 className="font-display text-lg mb-3">Comprobantes</h3>
          <ul className="space-y-2 text-sm">
            {venta.comprobantes.map((c) => (
              <li key={c.id_comprobante} className="flex items-center justify-between border-b border-border-2 pb-2 last:border-0">
                <div>
                  <div className="font-medium">{TIPO_COMPROBANTE_LABEL[c.tipo]} — {c.numero}</div>
                  <div className="text-xs text-muted">
                    Emitido: {new Date(c.fecha_emision).toLocaleString('es-AR')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {venta.observaciones && (
        <div className="rounded-lg border border-border bg-card-2 p-4 text-sm">
          <div className="text-xs uppercase font-mono text-muted mb-1">Observaciones</div>
          <div>{venta.observaciones}</div>
        </div>
      )}

      {/* Modales */}
      <ConfirmDialog
        open={anularOpen}
        title="Anular venta"
        description="Los ítems vuelven a stock disponible. Si alguna línea ya fue rendida al proveedor, no se puede anular."
        variant="danger"
        confirmLabel="Sí, anular"
        cancelLabel="Cancelar"
        onConfirm={anular}
        onCancel={() => {
          setAnularOpen(false)
          setMotivoAnulacion('')
        }}
      >
        <div className="space-y-4">
          <Field
            htmlFor="motivo-anulacion"
            label="Motivo (opcional)"
            hint="Queda guardado en la venta y en la auditoría."
          >
            <Textarea
              id="motivo-anulacion"
              rows={2}
              maxLength={300}
              value={motivoAnulacion}
              onChange={(e) => setMotivoAnulacion(e.target.value)}
              placeholder="Ej: el cliente se arrepintió"
            />
          </Field>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!devolverOpen}
        title="Devolución del cliente"
        description="El ítem pasa a estado 'devuelto por cliente'. La venta no se anula."
        confirmLabel="Sí, devolver"
        cancelLabel="Cancelar"
        onConfirm={devolver}
        onCancel={() => {
          setDevolverOpen(null)
          setReintegroMedio('')
          setReintegroCuenta('')
        }}
      >
        <div className="space-y-4">
          <div className="rounded border border-border p-3 space-y-3 bg-card-2 mt-2">
            <h4 className="font-medium text-sm">Opciones de reintegro (opcional)</h4>
            <p className="text-xs text-muted mb-2">Si corresponde devolver plata, seleccioná por dónde sale.</p>
            <Field htmlFor="reint-medio-dev" label="Medio de pago">
              <Select
                id="reint-medio-dev"
                value={reintegroMedio}
                onChange={(e) => setReintegroMedio(e.target.value as MedioPago | '')}
              >
                <option value="">(Ninguno)</option>
                {(Object.keys(MEDIO_PAGO_LABEL) as MedioPago[])
                  .filter((m) => m !== 'cuenta_revendedora')
                  .map((m) => (
                    <option key={m} value={m}>{MEDIO_PAGO_LABEL[m]}</option>
                  ))}
              </Select>
            </Field>
            {reintegroMedio && (
              <Field htmlFor="reint-cuenta-dev" label="Cuenta origen">
                <Select
                  id="reint-cuenta-dev"
                  value={reintegroCuenta}
                  onChange={(e) => setReintegroCuenta(e.target.value)}
                >
                  <option value="">Seleccionar cuenta...</option>
                  {cuentas.map((c) => (
                    <option key={c.id_cuenta_destino} value={c.id_cuenta_destino}>
                      {c.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </div>
      </ConfirmDialog>

      <Modal
        open={cambiarLinea !== null}
        title="Cambiar producto"
        onClose={() => {
          if (pending) return
          setCambiarLinea(null)
      setTallesCandidatos(null)
          setItemCandidato(null)
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCambiarLinea(null)
      setTallesCandidatos(null)
                setItemCandidato(null)
              }}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmarCambio}
              disabled={
                pending ||
                !itemCandidato ||
                (diferenciaCambio !== null && diferenciaCambio < 0) ||
                (diferenciaCambio !== null &&
                  diferenciaCambio > 0 &&
                  venta.canal === 'local' &&
                  (!cambioMedio || !cambioCuenta))
              }
            >
              {pending ? 'Registrando cambio…' : 'Confirmar cambio'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {cambiarLinea && (
            <div className="rounded border border-border p-3 bg-card-2 text-sm">
              <div className="text-xs uppercase font-mono text-muted">Producto original</div>
              <div className="font-medium mt-0.5">{cambiarLinea.producto?.nombre}</div>
              <div className="flex justify-between text-xs text-muted mt-1">
                <span>QR: {cambiarLinea.item?.qr_code ?? '—'}</span>
                <span className="font-mono font-medium text-foreground">
                  $ {Number(cambiarLinea.precio_venta).toLocaleString('es-AR')}
                </span>
              </div>
            </div>
          )}

          <form onSubmit={buscarItemEntregado} className="space-y-2">
            <Field htmlFor="c-codigo" label="Código o QR del nuevo producto" required>
              <div className="flex gap-2">
                <Input
                  id="c-codigo"
                  value={codigoBusqueda}
                  onChange={(e) => setCodigoBusqueda(e.target.value)}
                  placeholder="Escaneá el QR o escribí el código"
                  autoFocus
                />
                <Button type="submit" variant="secondary" disabled={buscando || !codigoBusqueda.trim()}>
                  {buscando ? 'Buscando…' : 'Buscar'}
                </Button>
              </div>
            </Field>
          </form>

          {tallesCandidatos && (
            <div className="rounded border border-border p-3 bg-card-2 text-sm space-y-2">
              <div className="text-xs text-muted">
                Elegí un talle de <b>{tallesCandidatos.productoNombre}</b>:
              </div>
              <div className="flex flex-wrap gap-2">
                {tallesCandidatos.talles.map((t) => (
                  <Button
                    key={t.talle}
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={buscando}
                    onClick={() => void elegirTalleCandidato(t.talle)}
                  >
                    {t.talle} ({t.disponibles})
                  </Button>
                ))}
                {tallesCandidatos.sinTalle > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={buscando}
                    onClick={() => void elegirTalleCandidato(null)}
                  >
                    Sin talle ({tallesCandidatos.sinTalle})
                  </Button>
                )}
              </div>
            </div>
          )}

          {itemCandidato && (
            <div className="rounded border border-border p-3 bg-card-2 text-sm space-y-2">
              <div className="text-xs uppercase font-mono text-muted">Producto a entregar</div>
              <div className="font-medium">{itemCandidato.producto_nombre}</div>
              <div className="flex justify-between text-xs text-muted">
                <span>
                  QR: {itemCandidato.qr_code}
                  {itemCandidato.talle && ` · Talle: ${itemCandidato.talle}`}
                </span>
                <span className="font-mono font-medium text-foreground">
                  $ {itemCandidato.precio.toLocaleString('es-AR')}
                </span>
              </div>

              {diferenciaCambio !== null && (
                <div className="border-t border-border-2 pt-2 mt-2">
                  {diferenciaCambio < 0 ? (
                    <div className="text-xs text-danger font-medium">
                      El nuevo producto tiene un precio menor al original. No se permiten cambios con diferencia negativa.
                    </div>
                  ) : diferenciaCambio === 0 ? (
                    <div className="text-xs text-success font-medium">
                      Diferencia: $ 0 (cambio directo, sin diferencia de precio).
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-sm font-semibold text-warning">
                        Diferencia a cobrar: $ {diferenciaCambio.toLocaleString('es-AR')}
                        {venta.canal === 'revendedora' && (
                          <span className="block text-xs font-normal text-muted mt-0.5">
                            Se cargará a la cuenta de la revendedora sin entrar a caja directa.
                          </span>
                        )}
                      </div>

                      {venta.canal === 'local' && (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <Field htmlFor="c-medio" label="Medio de cobro" required>
                            <Select
                              id="c-medio"
                              className="text-sm"
                              value={cambioMedio}
                              onChange={(e) => setCambioMedio(e.target.value as MedioPago | '')}
                            >
                              <option value="">Seleccionar medio...</option>
                              {(Object.keys(MEDIO_PAGO_LABEL) as MedioPago[])
                                .filter((m) => m !== 'cuenta_revendedora')
                                .map((m) => (
                                  <option key={m} value={m}>
                                    {MEDIO_PAGO_LABEL[m]}
                                  </option>
                                ))}
                            </Select>
                          </Field>

                          <Field htmlFor="c-cuenta" label="Cuenta destino" required>
                            <Select
                              id="c-cuenta"
                              className="text-sm"
                              value={cambioCuenta}
                              onChange={(e) => setCambioCuenta(e.target.value)}
                            >
                              <option value="">Seleccionar cuenta...</option>
                              {cuentas.map((c) => (
                                <option key={c.id_cuenta_destino} value={c.id_cuenta_destino}>
                                  {c.nombre}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <Field htmlFor="c-motivo" label="Motivo del cambio (opcional)">
            <Textarea
              id="c-motivo"
              value={motivoCambio}
              onChange={(e) => setMotivoCambio(e.target.value)}
              placeholder="Ej: Cambio de medida o variante"
              rows={2}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={comprobanteOpen}
        title="Emitir comprobante"
        onClose={() => setComprobanteOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setComprobanteOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={(e: React.MouseEvent) => emitir(e as unknown as React.FormEvent)} disabled={pending}>
              {pending ? 'Emitiendo…' : 'Emitir'}
            </Button>
          </>
        }
      >
        <form onSubmit={emitir} className="space-y-3">
          <Field htmlFor="c-tipo" label="Tipo" required>
            <Select
              id="c-tipo"
              value={tipoComp}
              onChange={(e) => setTipoComp(e.target.value as TipoComprobante)}
            >
              {(Object.keys(TIPO_COMPROBANTE_LABEL) as TipoComprobante[]).map((t) => (
                <option key={t} value={t}>{TIPO_COMPROBANTE_LABEL[t]}</option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="c-num" label="Número" required>
            <Input
              id="c-num"
              value={numeroComp}
              onChange={(e) => setNumeroComp(e.target.value)}
              autoFocus
            />
          </Field>
        </form>
      </Modal>
    </div>
  )
}

/**
 * Desglose de lo que se llevó el procesador de un cobro. Lee el SNAPSHOT
 * guardado en el pago (00057), no recalcula: el tarifario de hoy no es el que
 * se aplicó cuando se vendió.
 */
function DesgloseCobro({ pago }: { pago: Pick<PagoVentaRow, 'desglose_costo'> }) {
  const d = desgloseCosto(pago.desglose_costo)
  if (!d || d.sin_tarifario || d.costo_total <= 0) return null
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted">
      <li>
        Arancel {d.arancel_pct}% · −{money(d.arancel_monto)}
      </li>
      {d.iva_arancel_monto > 0 && (
        <li>
          IVA s/arancel {d.iva_arancel_pct}% · −{money(d.iva_arancel_monto)}
        </li>
      )}
      {d.retenciones.map((r) => (
        <li key={r.concepto}>
          {CONCEPTO_RETENCION_LABEL[r.concepto]} {r.pct}% · −{money(r.monto)}
        </li>
      ))}
    </ul>
  )
}

function money(n: number): string {
  return `$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}
