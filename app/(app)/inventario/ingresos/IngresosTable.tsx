'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Pagination } from '@/components/ui/Pagination'
import { useToast } from '@/components/ui/Toast'
import type { IngresoConResumen } from '@/lib/types/inventario'
import { cancelarIngresoAction } from '../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

export function IngresosTable({
  initial,
  page,
  pageSize,
  total,
  puedeVerCostos,
}: {
  initial: IngresoConResumen[]
  page: number
  pageSize: number
  total: number
  puedeVerCostos: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [rows, setRows] = useState(initial)
  const [pending, start] = useTransition()
  const [target, setTarget] = useState<IngresoConResumen | null>(null)

  function goToPage(nextPage: number) {
    const params = new URLSearchParams()
    if (nextPage > 1) params.set('page', String(nextPage))
    const qs = params.toString()
    router.push(qs ? `/inventario/ingresos?${qs}` : '/inventario/ingresos')
  }

  function cancelar() {
    const row = target
    setTarget(null)
    if (!row) return
    start(async () => {
      const res = await cancelarIngresoAction({ idIngreso: row.id_ingreso })
      if (!res.ok) {
        return toast.error(
          'No se pudo cancelar',
          mensajeDeError(res.reason, { accion: 'cancelar ingresos' }),
        )
      }
      // Cancelar borra el ingreso de verdad: sale de la lista en ambos casos.
      setRows((rs) => rs.filter((r) => r.id_ingreso !== row.id_ingreso))
      if (res.data?.modo === 'borrador') {
        toast.success('Borrador eliminado')
      } else {
        const partes = [`${res.data?.itemsBaja ?? 0} ítem(s)`]
        if ((res.data?.productosEliminados ?? 0) > 0) {
          partes.push(`${res.data!.productosEliminados} producto(s) nuevo(s)`)
        }
        toast.success('Ingreso cancelado', `Se eliminaron ${partes.join(' y ')} del inventario`)
      }
      router.refresh()
    })
  }

  if (rows.length === 0) {
    return (
      <Card padding="none" className="border-dashed p-10 text-center">
        <p className="font-display text-lg mb-2">Sin ingresos registrados</p>
        <p className="text-sm text-muted mb-4">
          Registrá el primer ingreso de mercadería (compra o consignación).
        </p>
        <Link
          href="/inventario/ingresos/nuevo"
          className="inline-flex items-center rounded-md bg-block px-4 py-2 text-sm font-semibold text-block-ink"
        >
          Nuevo ingreso
        </Link>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <TableFrame>
      <DataTable>
        <THead>
          <Th>Fecha</Th>
          <Th>Proveedor</Th>
          <Th>Tipo</Th>
          <Th>Remito</Th>
          <Th align="right">Líneas</Th>
          <Th align="right">Unidades</Th>
          {puedeVerCostos && <Th align="right">Costo total</Th>}
          <Th>Estado</Th>
          <Th></Th>
        </THead>
        <TBody>
          {rows.map((r) => {
            const cancelado = !!r.cancelado_at
            return (
              <Tr key={r.id_ingreso}>
                <Td>{new Date(r.fecha).toLocaleDateString('es-AR')}</Td>
                <Td>{r.proveedor?.nombre ?? '—'}</Td>
                <Td>
                  <Badge variant={r.tipo_ingreso === 'compra' ? 'info' : 'warning'}>{r.tipo_ingreso}</Badge>
                </Td>
                <Td className="font-mono text-xs">{r.numero_remito ?? '—'}</Td>
                <Td align="right" className="font-mono">{r.total_lineas}</Td>
                <Td align="right" className="font-mono">{r.total_cantidad}</Td>
                {puedeVerCostos && (
                  <Td align="right" className="font-mono">
                    {r.total_costo != null
                      ? `$ ${r.total_costo.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
                      : '—'}
                  </Td>
                )}
                <Td>
                  {cancelado ? (
                    <Badge variant="neutral">Cancelado</Badge>
                  ) : (
                    <Badge variant={r.confirmado ? 'success' : 'neutral'}>
                      {r.confirmado ? 'Confirmado' : 'Borrador'}
                    </Badge>
                  )}
                </Td>
                <Td align="right">
                  <div className="flex justify-end gap-3">
                    <Link
                      href={`/inventario/ingresos/${r.id_ingreso}`}
                      className="-mx-2 rounded-[4px] px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    >
                      Abrir
                    </Link>
                    {!cancelado && (
                      <Button
                        variant="bare"
                        type="button"
                        onClick={() => setTarget(r)}
                        disabled={pending}
                        className="text-sm text-muted hover:text-text"
                      >
                        {r.confirmado ? 'Cancelar' : 'Eliminar'}
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

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={goToPage}
        disabled={pending}
      />

      <ConfirmDialog
        open={!!target}
        title={target?.confirmado ? 'Cancelar ingreso' : 'Eliminar borrador'}
        description={
          target?.confirmado
            ? 'Esto ELIMINA del inventario los ítems y los productos que se crearon en este ingreso, y borra el ingreso de la lista. Solo funciona si ningún ítem se vendió, reservó o apartó. No se puede deshacer.'
            : 'Se elimina este borrador y sus líneas. No genera stock, así que no afecta al inventario.'
        }
        confirmLabel={target?.confirmado ? 'Cancelar ingreso' : 'Eliminar'}
        cancelLabel="Volver"
        onConfirm={cancelar}
        onCancel={() => setTarget(null)}
      />
    </div>
  )
}
