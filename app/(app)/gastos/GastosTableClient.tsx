'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { useToast } from '@/components/ui/Toast'
import type { GastoConCategoria } from '@/lib/types/rendiciones'
import type { GastosOrden } from '@/lib/dal/gastos/gasto'
import { eliminarGastoAction } from './actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Select } from '@/components/ui/Select'

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
  const [pending, startTransition] = useTransition()
  const [desde, setDesde] = useState(initialDesde)
  const [hasta, setHasta] = useState(initialHasta)
  const [cat, setCat] = useState(initialCategoria)
  const [orden, setOrden] = useState<GastosOrden>(initialOrden)
  const [aEliminar, setAEliminar] = useState<GastoConCategoria | null>(null)
  const [eliminando, startEliminar] = useTransition()

  const invertido = desde && hasta && desde > hasta

  function navigate(params: URLSearchParams) {
    const qs = params.toString()
    startTransition(() => router.push(qs ? `/gastos?${qs}` : '/gastos'))
  }

  function buildParams(nextPage: number, next: {
    desde?: string; hasta?: string; cat?: string; orden?: GastosOrden
  } = {}) {
    const d = next.desde ?? desde
    const h = next.hasta ?? hasta
    const c = next.cat ?? cat
    const o = next.orden ?? orden
    const params = new URLSearchParams()
    if (d) params.set('desde', d)
    if (h) params.set('hasta', h)
    if (c) params.set('cat', c)
    if (o && o !== 'fecha_desc') params.set('orden', o)
    if (nextPage > 1) params.set('page', String(nextPage))
    return params
  }

  function aplicar() {
    if (invertido) return
    navigate(buildParams(1))
  }

  function limpiar() {
    setDesde('')
    setHasta('')
    setCat('')
    setOrden('fecha_desc')
    navigate(new URLSearchParams())
  }

  function goToPage(nextPage: number) {
    navigate(buildParams(nextPage))
  }

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
      <form
        onSubmit={(e) => {
          e.preventDefault()
          aplicar()
        }}
        className="rounded-lg border border-border bg-card p-4 flex flex-wrap items-end gap-3"
        aria-label="Filtrar gastos"
      >
        <div className="w-40">
          <Field
            htmlFor="g-desde"
            label="Desde"
            error={invertido ? 'Posterior a "Hasta"' : undefined}
          >
            <Input
              id="g-desde"
              type="date"
              value={desde}
              max={hasta || undefined}
              invalid={!!invertido}
              onChange={(e) => setDesde(e.target.value)}
              disabled={pending}
            />
          </Field>
        </div>
        <div className="w-40">
          <Field htmlFor="g-hasta" label="Hasta">
            <Input
              id="g-hasta"
              type="date"
              value={hasta}
              min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)}
              disabled={pending}
            />
          </Field>
        </div>
        <div className="w-56">
          <Field htmlFor="g-cat-f" label="Categoría">
            <Select
              id="g-cat-f"
              value={cat}
              onChange={(e) => {
                setCat(e.target.value)
                navigate(buildParams(1, { cat: e.target.value }))
              }}
              disabled={pending}
            >
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-48">
          <Field htmlFor="g-orden" label="Ordenar por">
            <Select
              id="g-orden"
              value={orden}
              onChange={(e) => {
                const o = e.target.value as GastosOrden
                setOrden(o)
                navigate(buildParams(1, { orden: o }))
              }}
              disabled={pending}
            >
              <option value="fecha_desc">Fecha (más reciente)</option>
              <option value="fecha_asc">Fecha (más antiguo)</option>
              <option value="monto_desc">Monto (mayor a menor)</option>
              <option value="monto_asc">Monto (menor a mayor)</option>
            </Select>
          </Field>
        </div>
        <div className="flex gap-2 ml-auto">
          <Button type="button" variant="secondary" onClick={limpiar} disabled={pending}>
            Limpiar
          </Button>
          <Button type="submit" disabled={pending || !!invertido}>
            {pending ? 'Filtrando…' : 'Aplicar'}
          </Button>
        </div>
      </form>

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

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={goToPage}
        disabled={pending}
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
