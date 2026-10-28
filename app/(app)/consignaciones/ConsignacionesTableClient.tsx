'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import {
  ESTADO_CONSIGNACION_LABEL,
  ESTADO_CONSIGNACION_VARIANT,
  type ConsignacionConResumen,
} from '@/lib/types/consignaciones'
import {
  cerrarConsignacionAction,
  confirmarConsignacionAction,
  eliminarConsignacionAction,
} from './actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'

/**
 * Tabla del listado de devoluciones con las acciones del lote en la fila.
 *
 * Las mismas operaciones del detalle (confirmar, cerrar, eliminar) viven acá
 * para no obligar a entrar al lote por cada una. Comparten las Server Actions
 * del módulo, así que la validación y la auditoría son idénticas: esto es otro
 * punto de entrada, no otra implementación. Editar observaciones NO está acá:
 * se hace desde el detalle, que es donde se revisa el lote antes de confirmar.
 *
 * `Abrir` lleva el `?from=` con la URL filtrada actual, para que el botón
 * volver del Topbar devuelva al listado con los filtros puestos.
 */
export function ConsignacionesTableClient({
  rows,
  puedeEliminar,
  volverHref,
}: {
  rows: ConsignacionConResumen[]
  puedeEliminar: boolean
  volverHref: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [confirmar, setConfirmar] = useState<ConsignacionConResumen | null>(null)
  const [cerrar, setCerrar] = useState<ConsignacionConResumen | null>(null)
  const [eliminar, setEliminar] = useState<ConsignacionConResumen | null>(null)

  const from = encodeURIComponent(volverHref)

  function ejecutarConfirmar() {
    const row = confirmar
    setConfirmar(null)
    if (!row) return
    start(async () => {
      const res = await confirmarConsignacionAction({ idConsignacion: row.id_consignacion })
      if (!res.ok) return toast.error('No se pudo confirmar', mensajeDeError(res.reason))
      toast.success(`Lote confirmado · ${res.data!.confirmados} ítem(s) devueltos`)
      router.refresh()
    })
  }

  function ejecutarCerrar() {
    const row = cerrar
    setCerrar(null)
    if (!row) return
    start(async () => {
      const res = await cerrarConsignacionAction({ idConsignacion: row.id_consignacion })
      if (!res.ok) return toast.error('No se pudo cerrar', mensajeDeError(res.reason))
      toast.success('Consignación cerrada')
      router.refresh()
    })
  }

  function ejecutarEliminar() {
    const row = eliminar
    setEliminar(null)
    if (!row) return
    start(async () => {
      const res = await eliminarConsignacionAction({ idConsignacion: row.id_consignacion })
      if (!res.ok) return toast.error('No se pudo eliminar', mensajeDeError(res.reason))
      const n = res.data!.reestockeados
      toast.success(
        'Consignación eliminada',
        n > 0 ? `${n} ítem(s) volvieron al stock disponible` : undefined,
      )
      router.refresh()
    })
  }

  return (
    <>
      <TableFrame>
        <DataTable>
          <THead>
            <Th>Fecha</Th>
            <Th>Proveedor</Th>
            <Th align="right">Pendientes</Th>
            <Th>Estado</Th>
            <Th align="right">
              <span className="sr-only">Acciones</span>
            </Th>
          </THead>
          <TBody>
            {rows.map((r) => {
              const activa = r.estado === 'activa'
              return (
                <Tr key={r.id_consignacion}>
                  <Td>{new Date(r.fecha).toLocaleDateString('es-AR')}</Td>
                  <Td>{r.proveedor?.nombre ?? '—'}</Td>
                  <Td align="right" className="font-mono">
                    {r.pendientes > 0 ? (
                      <span className="text-warn-ink">{r.pendientes}</span>
                    ) : (
                      r.pendientes
                    )}
                  </Td>
                  <Td>
                    <Badge variant={ESTADO_CONSIGNACION_VARIANT[r.estado]}>{ESTADO_CONSIGNACION_LABEL[r.estado]}</Badge>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <Link href={`/consignaciones/${r.id_consignacion}?from=${from}`}>
                        <Button size="sm" variant="secondary" disabled={pending}>
                          Abrir
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmar(r)}
                        disabled={pending || !activa || r.pendientes === 0}
                        title={
                          !activa
                            ? 'El lote ya está cerrado'
                            : r.pendientes === 0
                              ? 'No quedan ítems pendientes'
                              : 'Confirmar la salida de todos los pendientes y cerrar'
                        }
                      >
                        Confirmar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCerrar(r)}
                        disabled={pending || !activa || r.pendientes > 0}
                        title={
                          !activa
                            ? 'El lote ya está cerrado'
                            : r.pendientes > 0
                              ? 'Resolvé todos los pendientes primero'
                              : 'Cerrar el lote'
                        }
                      >
                        Cerrar lote
                      </Button>
                      {puedeEliminar && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEliminar(r)}
                          disabled={pending}
                          title="Borra el lote; los ítems que ya salieron vuelven al stock"
                        >
                          Eliminar
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </TBody>
        </DataTable>
      </TableFrame>

      <ConfirmDialog
        open={!!confirmar}
        title="Confirmar el lote completo"
        description={`Se confirma la salida de los ${confirmar?.pendientes ?? 0} ítem(s) pendientes y el lote queda cerrado. Los ítems dejan de estar en stock.`}
        confirmLabel="Sí, salió todo"
        cancelLabel="Cancelar"
        onConfirm={ejecutarConfirmar}
        onCancel={() => setConfirmar(null)}
      />

      <ConfirmDialog
        open={!!cerrar}
        title="Cerrar consignación"
        description="No se van a poder apartar más ítems en este lote. Solo se puede cerrar si no quedan ítems pendientes."
        confirmLabel="Sí, cerrar"
        cancelLabel="Cancelar"
        onConfirm={ejecutarCerrar}
        onCancel={() => setCerrar(null)}
      />

      <ConfirmDialog
        open={!!eliminar}
        title="Eliminar la consignación"
        description={
          (eliminar?.devueltos ?? 0) > 0
            ? `El lote se borra definitivamente y los ${eliminar?.devueltos} ítem(s) que ya habían salido VUELVEN al stock disponible. Usalo solo si la devolución se cargó por error.`
            : 'El lote se borra definitivamente. Los ítems apartados quedan libres para venta o para otro lote.'
        }
        variant="danger"
        confirmLabel="Sí, eliminar"
        cancelLabel="Volver"
        onConfirm={ejecutarEliminar}
        onCancel={() => setEliminar(null)}
      />
    </>
  )
}

