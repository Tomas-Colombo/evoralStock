'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Kpi } from '@/components/ui/Kpi'
import { buildEtiquetasProductoHref } from '@/lib/inventario/etiquetas'
import type {
  CategoriaRow,
  EstadoItem,
  ItemProductoRow,
  ProductoRow,
} from '@/lib/types/inventario'
import { AsignarTallesModal } from '../../AsignarTallesModal'
import { EditarProductoModal } from '../../../EditarProductoModal'
import { DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Card } from '@/components/ui/Card'

type Proveedor = { id_proveedor: string; nombre: string } | null

const QRS_LISTADO_INICIAL = 50

function esImprimible(estado: EstadoItem, incluirReservados: boolean): boolean {
  return estado === 'disponible' || (incluirReservados && estado === 'reservado')
}

/** Fecha "relevante" del ítem para filtrar por período: la del último
 *  movimiento significativo según su estado actual. */
function fechaRelevante(it: ItemProductoRow): string | null {
  switch (it.estado_item) {
    case 'vendido':
      return it.fecha_venta ?? it.fecha_ingreso
    case 'devuelto':
    case 'devuelto_cliente':
      return it.fecha_devolucion ?? it.fecha_ingreso
    case 'baja':
      return it.updated_at
    default:
      return it.fecha_ingreso
  }
}

/** Cuenta por (talle, estado) — talle null se agrupa como "__sin__". */
function agrupar(items: ItemProductoRow[]) {
  const map = new Map<string, Record<EstadoItem, number>>()
  for (const it of items) {
    const clave = it.talle ?? '__sin__'
    if (!map.has(clave)) {
      map.set(clave, {
        disponible: 0,
        reservado: 0,
        vendido: 0,
        devuelto: 0,
        devuelto_cliente: 0,
        baja: 0,
        en_revendedora: 0,
      })
    }
    map.get(clave)![it.estado_item] += 1
  }
  return map
}

function fmtISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function FichaProductoView({
  producto,
  categoria,
  categorias,
  proveedor,
  items,
  stockDisponible,
  stockTotal,
}: {
  producto: ProductoRow
  categoria: Pick<CategoriaRow, 'id_categoria' | 'nombre' | 'talles'> | null
  /** Lista completa de categorías para el select del modal de edición. */
  categorias: CategoriaRow[]
  proveedor: Proveedor
  items: ItemProductoRow[]
  stockDisponible: number
  stockTotal: number
}) {
  // Ruta actual para el "?from=" del Restock — la flecha del Topbar respeta
  // el origen (ficha) en vez de saltar a /inventario. Editar ya es modal.
  const fichaHref = `/inventario/productos/${producto.id_producto}/ficha`
  const bajoMinimo = producto.stock_minimo > 0 && stockDisponible < producto.stock_minimo
  const [editing, setEditing] = useState(false)
  const [asignarOpen, setAsignarOpen] = useState(false)
  const [incluirReservados, setIncluirReservados] = useState(false)
  const [verTodosQrs, setVerTodosQrs] = useState(false)

  // Disponibles sin talle: candidatos para asignación retroactiva. Vendidos,
  // reservados, etc. no cuentan — el RPC del server los ignora igual.
  const disponiblesSinTalle = useMemo(
    () => items.filter((it) => it.talle === null && it.estado_item === 'disponible').length,
    [items],
  )
  const puedeAsignarTalles =
    disponiblesSinTalle > 0 && (categoria?.talles?.length ?? 0) > 0

  // ─── Filtro por período (solo aplica a la tabla de stock por talle) ─
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  const itemsFiltrados = useMemo(() => {
    if (!desde && !hasta) return items
    return items.filter((it) => {
      const f = fechaRelevante(it)
      if (!f) return false
      const fd = f.slice(0, 10)
      if (desde && fd < desde) return false
      if (hasta && fd > hasta) return false
      return true
    })
  }, [items, desde, hasta])

  const itemsImprimiblesProducto = useMemo(
    () => items.filter((it) => esImprimible(it.estado_item, incluirReservados)),
    [items, incluirReservados],
  )

  const itemsImprimiblesFiltrados = useMemo(
    () => itemsFiltrados.filter((it) => esImprimible(it.estado_item, incluirReservados)),
    [itemsFiltrados, incluirReservados],
  )

  // Solo talles que el producto usa realmente (no todos los de la categoría).
  // Si tiene items sin talle, se muestra como fila "Sin talle".
  const filasBreakdown = useMemo(() => {
    const grupos = agrupar(itemsFiltrados)
    const claves = Array.from(grupos.keys())
    // Orden estable: los talles de la categoría primero (según su orden),
    // luego cualquier otro talle histórico, y "sin talle" al final.
    const ordenCat = categoria?.talles ?? []
    const ordenadas = [
      ...ordenCat.filter((t) => claves.includes(t)),
      ...claves.filter((k) => k !== '__sin__' && !ordenCat.includes(k)).sort(),
      ...(claves.includes('__sin__') ? ['__sin__'] : []),
    ]
    return ordenadas.map((k) => ({
      talle: k,
      label: k === '__sin__' ? 'Sin talle' : k,
      counts: grupos.get(k)!,
    }))
  }, [itemsFiltrados, categoria?.talles])

  const filtroActivo = !!desde || !!hasta

  function preset(kind: 'hoy' | 'mes' | 'anio' | 'todo') {
    if (kind === 'todo') {
      setDesde('')
      setHasta('')
      return
    }
    const now = new Date()
    let d: string
    let h: string
    if (kind === 'hoy') {
      d = h = fmtISO(now)
    } else if (kind === 'mes') {
      d = fmtISO(new Date(now.getFullYear(), now.getMonth(), 1))
      h = fmtISO(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    } else {
      d = `${now.getFullYear()}-01-01`
      h = `${now.getFullYear()}-12-31`
    }
    setDesde(d)
    setHasta(h)
  }

  const qrsVisibles = verTodosQrs
    ? itemsImprimiblesFiltrados
    : itemsImprimiblesFiltrados.slice(0, QRS_LISTADO_INICIAL)

  return (
    <div className="space-y-6">
      {/* Cabecera con acciones */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl text-text">{producto.nombre}</h2>
            {!producto.activo && <Badge variant="warning">Inactivo</Badge>}
          </div>
          <div className="text-sm text-muted">
            {producto.sku ? (
              <span className="font-mono">{producto.sku}</span>
            ) : (
              <span className="text-muted">Sin SKU</span>
            )}
            {categoria && <span> · {categoria.nombre}</span>}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          {itemsImprimiblesProducto.length > 0 && (
            <Link
              href={buildEtiquetasProductoHref({
                idProducto: producto.id_producto,
                incluirReservados,
              })}
            >
              <Button size="sm" variant="secondary">
                Imprimir etiquetas ({itemsImprimiblesProducto.length})
              </Button>
            </Link>
          )}
          <Link
            href={`/inventario/ingresos/nuevo?producto=${producto.id_producto}&from=${encodeURIComponent(fichaHref)}`}
          >
            <Button size="sm">Restock</Button>
          </Link>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Editar
          </Button>
        </div>
      </div>

      {/* KPIs — usa el Kpi shared (tabular-nums + shrink en tablet) */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="Stock disponible"
          value={stockDisponible.toString()}
          variant={bajoMinimo ? 'alert' : 'default'}
        />
        <Kpi label="Stock total" value={stockTotal.toString()} />
        <Kpi label="Stock mínimo" value={producto.stock_minimo.toString()} />
        <Kpi
          label="Precio de venta"
          value={
            producto.precio_venta != null
              ? `$ ${producto.precio_venta.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
              : '—'
          }
        />
      </section>

      {/* Datos generales */}
      <Card as="section" padding="none" className="p-6 space-y-4">
        <h3 className="text-sm font-semibold">Datos del producto</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Dato label="Categoría" value={categoria?.nombre ?? '—'} />
          <Dato label="Proveedor habitual" value={proveedor?.nombre ?? 'Sin proveedor'} />
          <Dato label="Estado" value={producto.activo ? 'Activo' : 'Inactivo'} />
        </div>
        <Dato
          label="Descripción"
          value={producto.descripcion?.trim() || '—'}
          block
        />
      </Card>

      {/* Reasignar talles retroactivamente — solo cuando hay disponibles sin
          talle y la categoría tiene talles definidos. Es una acción destacada
          porque escondida en la tabla pasaba desapercibida. */}
      {puedeAsignarTalles && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink bg-card p-5">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text">Productos sin talle</h3>
            <p className="mt-1 text-sm text-muted">
              Hay <b className="text-text tabular-nums">{disponiblesSinTalle}</b>{' '}
              unidad{disponiblesSinTalle === 1 ? '' : 'es'} disponible{disponiblesSinTalle === 1 ? '' : 's'} sin
              talle. Podés distribuirlas entre los talles de la categoría; los ítems
              vendidos, reservados o dados de baja no se tocan.
            </p>
          </div>
          <Button size="sm" onClick={() => setAsignarOpen(true)}>
            Asignar talles
          </Button>
        </section>
      )}

      {/* Stock por talle — solo talles usados por el producto */}
      <Card as="section" padding="none" className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-semibold">Stock por talle</h3>
            {filtroActivo && (
              <span className="text-xs text-muted">
                Período: {desde || '…'} → {hasta || '…'}
              </span>
            )}
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-muted">
            <Checkbox
              checked={incluirReservados}
              onChange={(e) => setIncluirReservados(e.target.checked)}
            />
            Incluir reservados al imprimir etiquetas
          </label>
        </div>

        {/* Filtro por fecha (mismo patrón que /reportes) */}
        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card-2 p-3"
        >
          <div className="w-40">
            <Field htmlFor="fp-d" label="Desde">
              <Input
                id="fp-d"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                max={hasta || undefined}
              />
            </Field>
          </div>
          <div className="w-40">
            <Field htmlFor="fp-h" label="Hasta">
              <Input
                id="fp-h"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                min={desde || undefined}
              />
            </Field>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => preset('hoy')}>Hoy</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => preset('mes')}>Este mes</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => preset('anio')}>Este año</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => preset('todo')}>Todo</Button>
          </div>
        </form>

        {filasBreakdown.length === 0 ? (
          <p className="text-sm text-muted">
            {filtroActivo
              ? 'No hay movimientos de este producto en el período seleccionado.'
              : 'Este producto no tiene ítems cargados todavía. Usá Restock para ingresar unidades.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <DataTable>
              <THead>
                <Th className="py-2 pr-3">Talle</Th>
                <Th align="right" className="py-2 pr-3">Disponible</Th>
                <Th align="right" className="py-2 pr-3">Reservado</Th>
                <Th align="right" className="py-2 pr-3">Vendido</Th>
                <Th align="right" className="py-2 pr-3">Otros</Th>
                <Th align="right" className="py-2 pr-3">Total</Th>
                <Th align="right" className="py-2 pl-3">Etiquetas</Th>
              </THead>
              <TBody>
                {filasBreakdown.map((f) => {
                  const otros =
                    f.counts.devuelto + f.counts.devuelto_cliente + f.counts.baja + f.counts.en_revendedora
                  const total =
                    f.counts.disponible + f.counts.reservado + f.counts.vendido + otros
                  // La reimpresión por talle opera sobre el total de unidades imprimibles
                  // en stock (disponible / reservado), sin recortarse por el filtro de fechas
                  // que solo aplica a la tabla histórica de movimientos.
                  const cantImprimibleTalle = itemsImprimiblesProducto.filter(
                    (it) => (it.talle ?? '__sin__') === f.talle,
                  ).length
                  const hrefTalle = buildEtiquetasProductoHref({
                    idProducto: producto.id_producto,
                    talle: f.talle === '__sin__' ? '__sin__' : f.talle,
                    incluirReservados,
                  })
                  return (
                    <Tr key={f.talle}>
                      <Td className="py-2 pr-3 font-medium">{f.label}</Td>
                      <Td align="right" className="py-2 pr-3 font-mono">{f.counts.disponible}</Td>
                      <Td align="right" className="py-2 pr-3 font-mono text-muted">
                        {f.counts.reservado}
                      </Td>
                      <Td align="right" className="py-2 pr-3 font-mono text-muted">
                        {f.counts.vendido}
                      </Td>
                      <Td align="right" className="py-2 pr-3 font-mono text-muted">
                        {otros > 0 ? otros : '—'}
                      </Td>
                      <Td align="right" className="py-2 pr-3 font-mono">{total}</Td>
                      <Td align="right" className="py-2 pl-3">
                        {cantImprimibleTalle > 0 ? (
                          <Link
                            href={hrefTalle}
                            className="text-xs font-semibold text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink"
                          >
                            Imprimir ({cantImprimibleTalle})
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </TBody>
            </DataTable>
            <p className="mt-2 text-xs text-muted">
              {filtroActivo
                ? 'Se cuentan los ítems cuyo último movimiento relevante (ingreso, venta o devolución) cae en el período.'
                : '«Otros» incluye devoluciones al proveedor, devoluciones de cliente y bajas.'}
            </p>
          </div>
        )}
      </Card>

      {/* Listado de QRs por ítem para reimprimir etiquetas individuales */}
      <Card as="section" padding="none" className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Listado de QRs por ítem</h3>
            <p className="mt-0.5 text-xs text-muted">
              Reimprimí una etiqueta puntual si se perdió o se dañó en el local.
            </p>
          </div>
          {itemsImprimiblesFiltrados.length > 0 && (
            <span className="text-xs font-mono text-muted">
              {itemsImprimiblesFiltrados.length}{' '}
              {itemsImprimiblesFiltrados.length === 1 ? 'unidad imprimible' : 'unidades imprimibles'}
            </span>
          )}
        </div>

        {itemsImprimiblesFiltrados.length === 0 ? (
          <p className="text-sm text-muted">
            No hay unidades {incluirReservados ? 'disponibles ni reservadas' : 'disponibles'} para
            imprimir con los filtros actuales.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <DataTable>
                <THead>
                  <Th className="py-2 pr-3">Código QR</Th>
                  <Th className="py-2 pr-3">Talle</Th>
                  <Th className="py-2 pr-3">Estado</Th>
                  <Th align="right" className="py-2 pl-3">Etiqueta</Th>
                </THead>
                <TBody>
                  {qrsVisibles.map((it) => (
                    <Tr key={it.id_item}>
                      <Td className="py-2 pr-3 font-mono text-xs">
                        <Link
                          href={`/inventario/ficha/${encodeURIComponent(it.qr_code)}`}
                          className="underline decoration-line-2 underline-offset-2 hover:decoration-ink"
                        >
                          {it.qr_code}
                        </Link>
                      </Td>
                      <Td className="py-2 pr-3 text-sm">{it.talle ?? 'Sin talle'}</Td>
                      <Td className="py-2 pr-3">
                        <Badge variant={it.estado_item === 'disponible' ? 'success' : 'info'}>
                          {it.estado_item === 'disponible' ? 'Disponible' : 'Reservado'}
                        </Badge>
                      </Td>
                      <Td align="right" className="py-2 pl-3">
                        <Link
                          href={`/inventario/imprimir-etiquetas?qrs=${encodeURIComponent(it.qr_code)}`}
                          className="text-xs font-semibold text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink"
                        >
                          Imprimir etiqueta
                        </Link>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </DataTable>
            </div>

            {itemsImprimiblesFiltrados.length > QRS_LISTADO_INICIAL && (
              <div className="flex justify-center pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setVerTodosQrs((prev) => !prev)}
                >
                  {verTodosQrs
                    ? 'Mostrar menos'
                    : `Ver todos (${itemsImprimiblesFiltrados.length})`}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <EditarProductoModal
        open={editing}
        producto={producto}
        categorias={categorias}
        onClose={() => setEditing(false)}
      />

      <AsignarTallesModal
        open={asignarOpen}
        idProducto={producto.id_producto}
        disponiblesSinTalle={disponiblesSinTalle}
        tallesCategoria={categoria?.talles ?? []}
        onClose={() => setAsignarOpen(false)}
      />
    </div>
  )
}

function Dato({
  label,
  value,
  hint,
  block,
}: {
  label: string
  value: string
  hint?: string
  block?: boolean
}) {
  return (
    <div className={block ? 'sm:col-span-2' : undefined}>
      <div className="text-xs uppercase font-mono text-muted">{label}</div>
      <div className="mt-1 text-sm text-text whitespace-pre-wrap">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  )
}
