'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FilterBar } from '@/components/ui/FilterBar'
import { useToast } from '@/components/ui/Toast'
import type { ProductoConPrecioStatus } from '@/lib/types/precios'
import { recalcularBatchAction, recalcularPrecioAction } from '../actions'
import { revaluarCostosUsdAction } from '../cotizacion/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Checkbox } from '@/components/ui/Checkbox'
import { Select } from '@/components/ui/Select'

type Filter = 'todos' | 'desactualizados' | 'sin-precio' | 'sin-regla'

export type CantidadUsdProp = number | { revaluables: number; omitidas: number }

export function ControlDePreciosView({
  initial,
  canRevaluar = false,
  cantidadUsd = 0,
  puedeVerCostos,
  puedeVerMargenes = true,
}: {
  initial: ProductoConPrecioStatus[]
  canRevaluar?: boolean
  cantidadUsd?: CantidadUsdProp
  puedeVerCostos: boolean
  puedeVerMargenes?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [rows, setRows] = useState(initial)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('desactualizados')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, start] = useTransition()
  const [confirmRevaluarOpen, setConfirmRevaluarOpen] = useState(false)
  const [resultadoRevaluacion, setResultadoRevaluacion] = useState<{
    revaluados: number
    sin_cambios: number
    omitidos_sin_original: number
  } | null>(null)

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'desactualizados' && !r.precio_venta_desactualizado) return false
      if (filter === 'sin-precio' && r.precio_venta != null) return false
      if (filter === 'sin-regla' && r.regla_margen_nombre != null) return false
      if (qLower) {
        const hay = `${r.nombre} ${r.sku ?? ''} ${r.categoria_nombre ?? ''}`.toLowerCase()
        if (!hay.includes(qLower)) return false
      }
      return true
    })
  }, [rows, q, filter])

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllVisible() {
    setSelected(new Set(filtered.map((r) => r.id_producto)))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function recalcularUno(id: string) {
    start(async () => {
      const res = await recalcularPrecioAction(id)
      if (!res.ok) return toast.error('No se pudo recalcular', mensajeDeError(res.reason))
      toast.success('Precio actualizado')
      setRows((rs) =>
        rs.map((r) =>
          r.id_producto === id
            ? {
                ...r,
                precio_venta: res.data?.precio ?? null,
                precio_venta_desactualizado: false,
                precio_venta_resuelto_at: new Date().toISOString(),
              }
            : r,
        ),
      )
      router.refresh()
    })
  }

  function recalcularSeleccion() {
    const ids = Array.from(selected)
    if (ids.length === 0) return toast.error('Seleccioná al menos uno')
    start(async () => {
      const res = await recalcularBatchAction(ids)
      if (!res.ok) return toast.error('No se pudo recalcular', mensajeDeError(res.reason))
      const map = res.data!.resultados
      const okCount = Object.values(map).filter((v) => v != null).length
      toast.success(`Actualizados ${okCount} / ${ids.length}`)
      setRows((rs) =>
        rs.map((r) =>
          map[r.id_producto] !== undefined
            ? {
                ...r,
                precio_venta: map[r.id_producto],
                precio_venta_desactualizado: false,
                precio_venta_resuelto_at: new Date().toISOString(),
              }
            : r,
        ),
      )
      clearSelection()
      router.refresh()
    })
  }

  function ejecutarRevaluacion() {
    setConfirmRevaluarOpen(false)
    start(async () => {
      const res = await revaluarCostosUsdAction({})
      if (!res.ok) {
        return toast.error('No se pudo revaluar', mensajeDeError(res.reason))
      }
      setResultadoRevaluacion(res.data!)
      toast.success(
        'Revaluación completada',
        `${res.data!.revaluados} productos revaluados`,
      )
      router.refresh()
    })
  }

  const fmt = (n: number | null) =>
    n == null ? '—' : `$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`

  const revaluables = typeof cantidadUsd === 'number' ? cantidadUsd : (cantidadUsd?.revaluables ?? 0)
  const omitidas = typeof cantidadUsd === 'object' ? (cantidadUsd?.omitidas ?? 0) : 0
  const confirmDesc =
    omitidas > 0
      ? `Esta acción revalúa los costos en dólares al tipo de cambio oficial vigente y marca los precios de venta como desactualizados. Afecta a ${revaluables} producto(s) con costo en USD (${omitidas} omitido(s) por no tener costo original en USD registrado).`
      : `Esta acción revalúa los costos en dólares al tipo de cambio oficial vigente y marca los precios de venta como desactualizados. Afecta a ${revaluables} producto(s) con costo en USD.`

  return (
    <div className="space-y-4">
      {/* Banner de resultado de revaluación */}
      {resultadoRevaluacion && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Resultado de la revaluación de costos USD</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setResultadoRevaluacion(null)}
              aria-label="Cerrar resultado"
            >
              ✕
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted">Revaluados: </span>
              <span className="font-semibold text-success">{resultadoRevaluacion.revaluados}</span>
            </div>
            <div>
              <span className="text-muted">Sin cambios: </span>
              <span className="font-semibold">{resultadoRevaluacion.sin_cambios}</span>
            </div>
            <div>
              <span className="text-muted">Omitidos: </span>
              <span
                className={`font-semibold ${
                  resultadoRevaluacion.omitidos_sin_original > 0 ? 'text-alerta-ink' : ''
                }`}
              >
                {resultadoRevaluacion.omitidos_sin_original}
              </span>
            </div>
          </div>
          {resultadoRevaluacion.omitidos_sin_original > 0 && (
            <p className="text-xs text-muted">
              Los productos omitidos corresponden a costos cargados en USD antes de este cambio y
              que no se pueden revaluar automáticamente al no contar con su costo original registrado.
            </p>
          )}
        </div>
      )}

      {/* Filtros y acciones */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <FilterBar
              value={q}
              onChange={setQ}
              placeholder="Buscar por nombre, SKU o categoría"
            />
          </div>
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            aria-label="Estado de precio"
            className="w-auto"
          >
            <option value="todos">Todos</option>
            <option value="desactualizados">Solo desactualizados</option>
            <option value="sin-precio">Sin precio de venta</option>
            {puedeVerMargenes && <option value="sin-regla">Sin regla de margen</option>}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRevaluar && (
            <Button
              variant="secondary"
              onClick={() => setConfirmRevaluarOpen(true)}
              disabled={pending}
            >
              Revaluar costos USD al dólar vigente
            </Button>
          )}
          <span className="text-sm text-muted">{selected.size} seleccionados</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={selectAllVisible}
            disabled={filtered.length === 0}
          >
            Seleccionar visibles
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={clearSelection}
            disabled={selected.size === 0}
          >
            Limpiar
          </Button>
          <Button onClick={recalcularSeleccion} disabled={pending || selected.size === 0}>
            {pending ? 'Recalculando…' : `Recalcular ${selected.size}`}
          </Button>
        </div>
      </div>

      <TableFrame>
        <DataTable>
          <THead>
            <Th className="px-3 py-3 w-8"></Th>
            <Th className="px-3 py-3">Producto</Th>
            <Th className="px-3 py-3">Categoría</Th>
            {puedeVerMargenes && <Th className="px-3 py-3">Regla margen</Th>}
            {puedeVerCostos && <Th align="right" className="px-3 py-3">Costo</Th>}
            <Th align="right" className="px-3 py-3">Precio actual</Th>
            {puedeVerMargenes && <Th align="right" className="px-3 py-3">Precio proyectado</Th>}
            {puedeVerMargenes && <Th align="right" className="px-3 py-3">Δ%</Th>}
            <Th className="px-3 py-3">Estado</Th>
            <Th className="px-3 py-3"></Th>
          </THead>
          <TBody>
            {filtered.length === 0 ? (
              <Tr>
                <Td align="center" colSpan={10 - (puedeVerCostos ? 0 : 1) - (puedeVerMargenes ? 0 : 3)} className="px-3 py-6 text-muted">
                  Nada para mostrar con los filtros actuales.
                </Td>
              </Tr>
            ) : (
              filtered.map((r) => {
                const desactualizado = r.precio_venta_desactualizado
                const sinPrecio = r.precio_venta == null
                return (
                  <Tr
                    key={r.id_producto}
                    className={selected.has(r.id_producto) ? 'bg-line/60' : ''}
                  >
                    <Td className="px-3 py-3">
                      <Checkbox
                        aria-label={`Seleccionar ${r.nombre}`}
                        checked={selected.has(r.id_producto)}
                        onChange={() => toggleSelected(r.id_producto)}
                      />
                    </Td>
                    <Td className="px-3 py-3">
                      <div className="font-medium">{r.nombre}</div>
                      {r.sku && <div className="font-mono text-xs text-muted">{r.sku}</div>}
                    </Td>
                    <Td className="px-3 py-3">
                      {r.categoria_nombre ?? <span className="text-muted">—</span>}
                    </Td>
                    {puedeVerMargenes && (
                      <Td className="px-3 py-3 text-xs">
                        {r.regla_margen_nombre ?? (
                          <span className="text-muted italic">Sin regla → costo</span>
                        )}
                      </Td>
                    )}
                    {puedeVerCostos && (
                      <Td align="right" className="px-3 py-3 font-mono">{fmt(r.costo_vigente)}</Td>
                    )}
                    <Td align="right" className="px-3 py-3 font-mono">{fmt(r.precio_venta)}</Td>
                    {puedeVerMargenes && (
                      <Td align="right" className="px-3 py-3 font-mono">{fmt(r.precio_proyectado)}</Td>
                    )}
                    {puedeVerMargenes && (
                      <Td align="right" className="px-3 py-3 font-mono">
                        {r.diferencia_pct == null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span
                            className={
                              r.diferencia_pct > 0
                                ? 'text-success'
                                : r.diferencia_pct < 0
                                  ? 'text-alerta-ink'
                                  : ''
                            }
                          >
                            {r.diferencia_pct > 0 ? '+' : ''}
                            {r.diferencia_pct}%
                          </span>
                        )}
                      </Td>
                    )}
                    <Td className="px-3 py-3">
                      {sinPrecio ? (
                        <Badge variant="danger">Sin precio</Badge>
                      ) : desactualizado ? (
                        <Badge variant="warning">Desactualizado</Badge>
                      ) : (
                        <Badge variant="success">OK</Badge>
                      )}
                    </Td>
                    <Td align="right" className="px-3 py-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => recalcularUno(r.id_producto)}
                        disabled={pending || r.costo_vigente == null}
                      >
                        Recalcular
                      </Button>
                    </Td>
                  </Tr>
                )
              })
            )}
          </TBody>
        </DataTable>
      </TableFrame>

      <ConfirmDialog
        open={confirmRevaluarOpen}
        title="¿Revaluar costos en USD al dólar vigente?"
        description={confirmDesc}
        confirmLabel="Revaluar costos"
        cancelLabel="Cancelar"
        onConfirm={ejecutarRevaluacion}
        onCancel={() => setConfirmRevaluarOpen(false)}
      />
    </div>
  )
}
