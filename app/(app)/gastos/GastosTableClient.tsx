'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import type { GastoConCategoria } from '@/lib/types/rendiciones'
import type { GastosOrden } from '@/lib/dal/gastos/gasto'
import { eliminarGastoAction } from './actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { FiltroPeriodo } from '@/components/shell/FiltroPeriodo'
import { PaginacionUrl } from '@/components/filtros/PaginacionUrl'

interface CatOpt { id: string; nombre: string }

/**
 * Listado de gastos con filtros por fecha, categoría y orden, todos
 * sincronizados a la URL. La paginación es server-side (`listGastosPaginado`)
 * para escalar aunque el histórico crezca.
 */
export function GastosTableClient({
  rows,
  categorias,
  initialDesde,
  initialHasta,
  initialCategoria,
  initialOrden,
  page,
  pageSize,
  total,
}: {
  rows: GastoConCategoria[]
  categorias: CatOpt[]
  initialDesde: string
  initialHasta: string
  initialCategoria: string
  initialOrden: GastosOrden
  page: number
  pageSize: number
  total: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [aEliminar, setAEliminar] = useState<GastoConCategoria | null>(null)
  const [eliminando, startEliminar] = useTransition()

  const hayFiltros = Boolean(
    initialDesde || initialHasta || initialCategoria || initialOrden !== 'fecha_desc',
  )

  function confirmarEliminar() {
    const gasto = aEliminar
    if (!gasto) return
    startEliminar(async () => {
      const res = await eliminarGastoAction({ idGasto: gasto.id_gasto })
      setAEliminar(null)
      if (!res.ok) return toast.error('No se pudo eliminar el gasto', mensajeDeError(res.reason))
      toast.success('Gasto eliminado')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <FiltroPeriodo
          ariaLabel="Filtrar gastos"
          idPrefix="gastos"
          desde={initialDesde}
          hasta={initialHasta}
          paramPagina="page"
          extras={[
            {
              param: 'cat',
              label: 'Categoría',
              value: initialCategoria,
              ancho: 'w-56',
              options: [
                { value: '', label: 'Todas' },
                ...categorias.map((c) => ({ value: c.id, label: c.nombre })),
              ],
            },
            {
              param: 'orden',
              label: 'Ordenar por',
              value: initialOrden,
              valorPorDefecto: 'fecha_desc',
              ancho: 'w-48',
              options: [
                { value: 'fecha_desc', label: 'Fecha (más reciente)' },
                { value: 'fecha_asc', label: 'Fecha (más antiguo)' },
                { value: 'monto_desc', label: 'Monto (mayor a menor)' },
                { value: 'monto_asc', label: 'Monto (menor a mayor)' },
              ],
            },
          ]}
        />
        {hayFiltros && (
          <div>
            <Link
              href="/gastos"
              className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Limpiar
            </Link>
          </div>
        )}
      </div>

      <TableFrame>
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">
            Sin gastos que coincidan con los filtros.
          </div>
        ) : (
          <DataTable>
            <THead>
              <Th>Fecha</Th>
              <Th>Categoría</Th>
              <Th>Descripción</Th>
              <Th>Comprobante</Th>
              <Th align="right">Monto</Th>
              <Th align="right">
                <span className="sr-only">Acciones</span>
              </Th>
            </THead>
            <TBody>
              {rows.map((g) => (
                <Tr key={g.id_gasto}>
                  <Td>
                    {new Date(g.fecha).toLocaleDateString('es-AR')}
                  </Td>
                  <Td>{g.categoria?.nombre ?? '—'}</Td>
                  <Td>{g.descripcion || '—'}</Td>
                  <Td className="font-mono text-xs text-muted">
                    {g.comprobante_ref ?? '—'}
                  </Td>
                  <Td align="right" className="font-mono font-semibold">
                    $ {Number(g.monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </Td>
                  <Td align="right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAEliminar(g)}
                      disabled={eliminando}
                      aria-label={`Eliminar gasto del ${new Date(g.fecha).toLocaleDateString('es-AR')}`}
                    >
                      Eliminar
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </DataTable>
        )}
      </TableFrame>

      <PaginacionUrl
        page={page}
        pageSize={pageSize}
        total={total}
        param="page"
      />

      <ConfirmDialog
        open={aEliminar !== null}
        variant="danger"
        title="Eliminar gasto"
        description={
          aEliminar
            ? `Se borra definitivamente el gasto de $ ${Number(aEliminar.monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })} en "${aEliminar.categoria?.nombre ?? 'sin categoría'}" del ${new Date(aEliminar.fecha).toLocaleDateString('es-AR')}. El total gastado del mes, el presupuesto de la categoría y los reportes se recalculan sin él. No se puede deshacer: usalo sólo si el gasto se cargó mal.`
            : undefined
        }
        confirmLabel={eliminando ? 'Eliminando…' : 'Eliminar'}
        cancelLabel="Cancelar"
        onConfirm={confirmarEliminar}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  )
}
