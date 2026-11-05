'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import type { PreviewLineaRendicion } from '@/lib/types/rendiciones'
import {
  excluirDetalleAction,
  generarRendicionAction,
  reincluirDetalleAction,
} from '../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/TableParts'
import { Select } from '@/components/ui/Select'
import { Card } from '@/components/ui/Card'

interface Prov { id: string; nombre: string; tipo: string }

/**
 * Vista de "Generar rendición" (Ejecucion §L227/L228):
 *  1. Elegir proveedor → URL param `?prov=` → server re-renderea con `previewRendicion`.
 *  2. Ver líneas pendientes (todas las detalle_venta con id_rendicion IS NULL
 *     + monto_prov>0 + excluida_rendicion=false + venta no anulada).
 *  3. Excluir líneas manualmente (persiste excluida_rendicion=true; NUNCA
 *     vuelve a aparecer en futuras rendiciones).
 *  4. Confirmar → sp_generar_rendicion en una tx atómica.
 */
export function NuevaRendicionView({
  proveedores,
  idProvSeleccionado,
  lineas,
}: {
  proveedores: Prov[]
  idProvSeleccionado: string
  lineas: PreviewLineaRendicion[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  // Set local para tracking optimista de exclusiones (no bloquea al usuario
  // por round-trip). El estado real vive en DB: si excluye una línea el
  // server-render próximo ya no la va a traer.
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set())

  const [obs, setObs] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const visibles = lineas.filter((l) => !excluidos.has(l.id_detalle_venta))
  const total = useMemo(
    () => visibles.reduce((a, l) => a + Number(l.monto_proveedor), 0),
    [visibles],
  )

  function elegirProveedor(id: string) {
    router.push(id ? `/rendiciones/nueva?prov=${id}` : '/rendiciones/nueva')
  }

  function excluir(idDetalle: string) {
    start(async () => {
      const res = await excluirDetalleAction({ idDetalle })
      if (!res.ok) return toast.error('No se pudo excluir', mensajeDeError(res.reason))
      setExcluidos((s) => new Set(s).add(idDetalle))
      toast.info('Línea excluida', 'No aparecerá en futuras rendiciones')
    })
  }

  function reincluir(idDetalle: string) {
    start(async () => {
      const res = await reincluirDetalleAction({ idDetalle })
      if (!res.ok) return toast.error('No se pudo reincluir', mensajeDeError(res.reason))
      setExcluidos((s) => {
        const n = new Set(s)
        n.delete(idDetalle)
        return n
      })
    })
  }

  function confirmar() {
    setConfirmOpen(false)
    start(async () => {
      const res = await generarRendicionAction({
        idProveedor: idProvSeleccionado,
        observaciones: obs || null,
      })
      if (!res.ok) return toast.error('No se pudo generar', mensajeDeError(res.reason))
      toast.success('Rendición generada', `Total $ ${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`)
      router.push(`/rendiciones/${res.data!.id}`)
      router.refresh()
    })
  }

  const puedeGenerar = !!idProvSeleccionado && visibles.length > 0 && !pending

  return (
    <div className="space-y-6">
      {/* Paso 1: seleccionar proveedor */}
      <Card>
        <Field htmlFor="r-prov" label="Proveedor" required>
          <Select
            id="r-prov"
            value={idProvSeleccionado}
            onChange={(e) => elegirProveedor(e.target.value)}
          >
            <option value="">— Elegí un proveedor —</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} · {p.tipo}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {/* Paso 2: preview de líneas */}
      {!idProvSeleccionado ? (
        <div className="rounded-md border border-border bg-card-2 p-4 text-sm text-muted">
          Elegí un proveedor para ver las ventas pendientes de rendirle.
        </div>
      ) : lineas.length === 0 ? (
        <Card padding="none" className="border-dashed p-10 text-center">
          <p className="font-display text-lg mb-2">No hay líneas pendientes</p>
          <p className="text-sm text-muted">
            Este proveedor no tiene ventas de consignación con saldo pendiente
            de rendir. Todas las ventas anteriores ya fueron rendidas o
            excluidas manualmente.
          </p>
        </Card>
      ) : (
        <>
          <TableFrame>
            <div className="border-b border-border px-4 py-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-lg">Ventas pendientes de rendir</h3>
              <span className="text-sm text-muted">
                {visibles.length} de {lineas.length} líneas seleccionadas
              </span>
            </div>
            <DataTable>
              <THead>
                <Th>Fecha</Th>
                <Th>Producto</Th>
                <Th>QR</Th>
                <Th>Cliente</Th>
                <Th align="right">Precio venta</Th>
                <Th align="right">Monto proveedor</Th>
                <Th></Th>
              </THead>
              <TBody>
                {lineas.map((l) => {
                  const excluida = excluidos.has(l.id_detalle_venta)
                  return (
                    <Tr
                      key={l.id_detalle_venta}
                      className={excluida ? 'opacity-40' : ''}
                    >
                      <Td>
                        {new Date(l.fecha).toLocaleDateString('es-AR')}
                      </Td>
                      <Td>
                        <div className="font-medium">{l.producto_nombre}</div>
                        {l.producto_sku && (
                          <div className="text-xs font-mono text-muted">{l.producto_sku}</div>
                        )}
                      </Td>
                      <Td className="font-mono text-xs">{l.qr_code}</Td>
                      <Td className="text-xs">
                        {l.cliente_nombre ?? <span className="text-muted">Mostrador</span>}
                      </Td>
                      <Td align="right" className="font-mono text-muted">
                        $ {Number(l.precio_venta).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </Td>
                      <Td align="right" className="font-mono font-semibold">
                        $ {Number(l.monto_proveedor).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </Td>
                      <Td align="right">
                        {excluida ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => reincluir(l.id_detalle_venta)}
                            disabled={pending}
                          >
                            Reincluir
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => excluir(l.id_detalle_venta)}
                            disabled={pending}
                          >
                            Excluir
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </TBody>
              <TFoot>
                <Tr className="border-t bg-card-2">
                  <Td colSpan={5} className="font-semibold">
                    Total a rendir ({visibles.length} líneas)
                  </Td>
                  <Td align="right" className="font-mono font-semibold">
                    $ {total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </Td>
                  <Td></Td>
                </Tr>
              </TFoot>
            </DataTable>
          </TableFrame>

          <div className="rounded-md border border-border bg-card-2 p-3 text-xs text-muted">
            <b>Excluir</b> marca la línea con <code>excluida_rendicion=true</code>{' '}
            en la base de datos: <b>nunca más</b> vuelve a aparecer en una rendición
            futura. Usalo cuando decidís no rendirle un artículo de consignación
            al proveedor. Se puede reincluir mientras no confirmes esta rendición.
          </div>

          <Card className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Field htmlFor="r-obs" label="Observaciones">
                <Textarea
                  id="r-obs"
                  rows={2}
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="Ej. Rendición mensual noviembre"
                />
              </Field>
            </div>
            <Button
              size="lg"
              onClick={() => setConfirmOpen(true)}
              disabled={!puedeGenerar}
            >
              {pending ? 'Generando…' : `Confirmar rendición · $ ${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`}
            </Button>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Generar rendición"
        description={`Se van a marcar ${visibles.length} línea(s) como rendidas por un total de $ ${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}. Esta acción no se puede deshacer.`}
        confirmLabel="Sí, generar"
        cancelLabel="Cancelar"
        onConfirm={confirmar}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
