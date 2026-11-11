'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { NumberInput } from '@/components/ui/NumberInput'
import { useToast } from '@/components/ui/Toast'
import { clampUnidades, MAX_UNIDADES_LINEA } from '@/components/inventario/StockTalleLoader'
import { buildEtiquetasIngresoHref } from '@/lib/inventario/etiquetas'
import type {
  CategoriaRow,
  IngresoMercaderiaDetalleRow,
  IngresoMercaderiaRow,
  ProductoConDetalle,
  ProductoSinCosto,
  ProveedorRow,
} from '@/lib/types/inventario'
import {
  confirmarIngresoAction,
  importarRemitoAction,
  removeIngresoDetalleAction,
} from '../../actions'
import { RemitoImportPanel, type DetalleImportado } from './RemitoImportPanel'
import {
  ProductoNombreCombobox,
  type ProductoNombreValue,
} from '@/components/inventario/ProductoNombreCombobox'
import { buscarMatchNombre, indexarPorNombre } from '@/lib/inventario/producto-match'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/TableParts'
import { Select } from '@/components/ui/Select'
import { Card } from '@/components/ui/Card'

type Ingreso = IngresoMercaderiaRow & {
  proveedor: Pick<ProveedorRow, 'id_proveedor' | 'nombre' | 'telefono'> | null
  detalle: IngresoMercaderiaDetalleRow[]
}

export function IngresoDetalleView({
  ingreso,
  productos,
  categorias,
  qrs = [],
  cotizacion,
  puedeVerCostos,
}: {
  ingreso: Ingreso
  productos: (ProductoConDetalle | ProductoSinCosto)[]
  categorias: CategoriaRow[]
  qrs?: string[]
  cotizacion?: { valor: number; fechaValor?: string | null; desactualizada?: boolean } | null
  puedeVerCostos: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [detalles, setDetalles] = useState(ingreso.detalle)
  // Nombres de productos creados en esta sesión (import PDF) que aún no están
  // en `productos` (viene del server), para resolver el nombre en la tabla.
  const [nombresImportados, setNombresImportados] = useState<Record<string, string>>({})
  // Línea a agregar a mano: nombre + vínculo (esNuevo/idProducto). El nombre se
  // escribe libremente; si matchea un producto existente se vincula solo.
  const [linea, setLinea] = useState<ProductoNombreValue>({
    nombre: '',
    idProducto: '',
    esNuevo: true,
  })
  const catInicial = categorias[0]?.id_categoria ?? ''
  const [idCategoriaAdd, setIdCategoriaAdd] = useState(catInicial)
  const [cantidad, setCantidad] = useState('1')
  const [costoUnitario, setCostoUnitario] = useState('')
  const [talleAdd, setTalleAdd] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const index = useMemo(() => indexarPorNombre(productos), [productos])
  // Match vivo del nombre escrito: sirve para el aviso "ya existe" y para
  // bloquear "es nuevo" sobre un nombre que ya está en el inventario.
  const matchLinea = buscarMatchNombre(index, linea.nombre)

  // Talles disponibles para la línea: si es nuevo, según su categoría elegida;
  // si está vinculado, según la categoría del producto existente.
  const tallesAdd = (() => {
    const catId = linea.esNuevo
      ? idCategoriaAdd
      : productos.find((p) => p.id_producto === linea.idProducto)?.categoria?.id_categoria
    return categorias.find((c) => c.id_categoria === catId)?.talles ?? []
  })()

  const readonly = ingreso.confirmado
  const mostrarCostos = !readonly || puedeVerCostos
  const totalCantidad = detalles.reduce((a, d) => a + d.cantidad, 0)
  const totalCosto = mostrarCostos ? detalles.reduce((a, d) => a + d.cantidad * (d.costo_unitario ?? 0), 0) : null

  function addLinea(e: React.FormEvent) {
    e.preventDefault()
    const nombre = linea.nombre.trim()
    if (!nombre) return toast.error('Escribí el producto')
    // Invariante: es nuevo → nombre único; no es nuevo → producto seleccionado.
    if (linea.esNuevo && matchLinea) {
      return toast.error('Ese nombre ya existe', 'Cambiá el nombre o desmarcá "es nuevo" para vincularlo')
    }
    if (linea.esNuevo && !idCategoriaAdd) return toast.error('Elegí la categoría del producto nuevo')
    if (!linea.esNuevo && !linea.idProducto) {
      return toast.error('Elegí un producto del inventario', 'O marcá "es nuevo" si no existe')
    }
    const cant = Number(cantidad || 0)
    const costo = Number(costoUnitario || 0)
    if (cant <= 0) return toast.error('Cantidad inválida')
    if (costo < 0) return toast.error('Costo inválido')

    start(async () => {
      const res = await importarRemitoAction({
        idIngreso: ingreso.id_ingreso,
        lineas: [
          {
            esNuevo: linea.esNuevo,
            idProducto: linea.esNuevo ? null : linea.idProducto || null,
            idCategoria: linea.esNuevo ? idCategoriaAdd || null : null,
            nombre,
            cantidad: cant,
            costoUnitario: costo,
            talles: talleAdd ? [{ talle: talleAdd, cantidad: cant }] : undefined,
          },
        ],
      })
      if (!res.ok) return toast.error('No se pudo agregar', mensajeDeError(res.reason))
      onImported(res.data!.detalles)
      setLinea({ nombre: '', idProducto: '', esNuevo: true })
      setIdCategoriaAdd(catInicial)
      setCantidad('1')
      setCostoUnitario('')
      setTalleAdd('')
    })
  }

  function removeLinea(idDetalle: string) {
    start(async () => {
      const res = await removeIngresoDetalleAction({
        idIngreso: ingreso.id_ingreso,
        idDetalle,
      })
      if (!res.ok) return toast.error('No se pudo eliminar', mensajeDeError(res.reason))
      setDetalles((d) => d.filter((x) => x.id_detalle !== idDetalle))
    })
  }

  function confirmar() {
    setConfirmOpen(false)
    start(async () => {
      const res = await confirmarIngresoAction({ idIngreso: ingreso.id_ingreso })
      if (!res.ok) return toast.error('No se pudo confirmar', mensajeDeError(res.reason))
      toast.success(`Ingreso confirmado`, `Se generaron ${res.data?.itemsGenerados ?? 0} ítems con QR único`)
      router.refresh()
    })
  }

  const productoNombre = (id: string) =>
    productos.find((p) => p.id_producto === id)?.nombre ?? nombresImportados[id] ?? id

  function onImported(nuevos: DetalleImportado[]) {
    setDetalles((d) => [
      ...d,
      ...nuevos.map((n) => ({
        id_detalle: n.id_detalle,
        id_tenant: ingreso.id_tenant,
        id_ingreso: ingreso.id_ingreso,
        id_producto: n.id_producto,
        cantidad: n.cantidad,
        costo_unitario: n.costo_unitario,
        talle: n.talle,
        created_at: new Date().toISOString(),
      })),
    ])
    setNombresImportados((m) => {
      const next = { ...m }
      for (const n of nuevos) next[n.id_producto] = n.nombre
      return next
    })
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* Metadata */}
      <Card className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <div>
          <div className="text-xs uppercase text-muted font-mono">Proveedor</div>
          <div className="mt-1">{ingreso.proveedor?.nombre ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-muted font-mono">Tipo</div>
          <div className="mt-1 capitalize">{ingreso.tipo_ingreso}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-muted font-mono">Remito</div>
          <div className="mt-1 font-mono">{ingreso.numero_remito ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-muted font-mono">Fecha</div>
          <div className="mt-1">{new Date(ingreso.fecha).toLocaleString('es-AR')}</div>
        </div>
      </Card>

      {/* Líneas */}
      <TableFrame>
        <DataTable>
          <THead>
            <Th>Producto</Th>
            <Th>Talle</Th>
            <Th align="right">Cantidad</Th>
            {mostrarCostos && <Th align="right">Costo unit.</Th>}
            {mostrarCostos && <Th align="right">Subtotal</Th>}
            {!readonly && <Th></Th>}
          </THead>
          <TBody>
            {detalles.length === 0 ? (
              <Tr>
                <Td align="center" colSpan={mostrarCostos ? (readonly ? 5 : 6) : (readonly ? 3 : 4)} className="px-4 py-6 text-muted">
                  Sin líneas. Agregá al menos una antes de confirmar.
                </Td>
              </Tr>
            ) : (
              detalles.map((d) => (
                <Tr key={d.id_detalle}>
                  <Td>{productoNombre(d.id_producto)}</Td>
                  <Td>{d.talle ?? <span className="text-muted">—</span>}</Td>
                  <Td align="right" className="font-mono">{d.cantidad}</Td>
                  {mostrarCostos && (
                    <Td align="right" className="font-mono">
                      {d.costo_unitario != null
                        ? `$ ${Number(d.costo_unitario).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
                        : '—'}
                    </Td>
                  )}
                  {mostrarCostos && (
                    <Td align="right" className="font-mono">
                      {d.costo_unitario != null
                        ? `$ ${(d.cantidad * d.costo_unitario).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
                        : '—'}
                    </Td>
                  )}
                  {!readonly && (
                    <Td align="right">
                      <Button size="sm" variant="ghost" onClick={() => removeLinea(d.id_detalle)} disabled={pending}>
                        Quitar
                      </Button>
                    </Td>
                  )}
                </Tr>
              ))
            )}
          </TBody>
          <TFoot>
            <Tr className="border-t bg-card-2">
              <Td className="font-semibold" colSpan={2}>Total</Td>
              <Td align="right" className="font-mono font-semibold">{totalCantidad}</Td>
              {mostrarCostos && <Td></Td>}
              {mostrarCostos && (
                <Td align="right" className="font-mono font-semibold">
                  $ {totalCosto?.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </Td>
              )}
              {!readonly && <Td></Td>}
            </Tr>
          </TFoot>
        </DataTable>
      </TableFrame>

      {/* Import desde PDF (planilla de precarga) */}
      {!readonly && (
        <RemitoImportPanel
          idIngreso={ingreso.id_ingreso}
          productos={productos}
          categorias={categorias}
          cotizacion={cotizacion}
          onImported={onImported}
        />
      )}

      {/* Add line form */}
      {!readonly && (
        <form onSubmit={addLinea} className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Agregar producto a mano</h3>
            {/* Toggle Nuevo/Vincular: doble verificación del nombre. */}
            <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border text-xs">
              <button
                type="button"
                onClick={() => {
                  setLinea((l) => ({ ...l, esNuevo: true, idProducto: '' }))
                  setTalleAdd('')
                }}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  linea.esNuevo ? 'bg-block text-block-ink' : 'text-muted hover:bg-card-2'
                }`}
              >
                Es nuevo
              </button>
              <button
                type="button"
                onClick={() => {
                  // Vincular: si el nombre matchea uno existente, lo dejamos
                  // enganchado; si no, queda a la espera de elegir del listado.
                  setLinea((l) => ({
                    ...l,
                    esNuevo: false,
                    idProducto: matchLinea?.id_producto ?? l.idProducto,
                  }))
                  setTalleAdd('')
                }}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  !linea.esNuevo ? 'bg-block text-block-ink' : 'text-muted hover:bg-card-2'
                }`}
              >
                Del inventario
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-6 md:items-end">
            <div className="md:col-span-2">
              <Field htmlFor="l-prod" label="Producto">
                <ProductoNombreCombobox
                  productos={productos}
                  value={linea}
                  onChange={(next) => {
                    setLinea(next)
                    setTalleAdd('') // los talles dependen de la categoría/producto
                  }}
                />
              </Field>
            </div>

            {linea.esNuevo && (
              <Field htmlFor="l-cat" label="Categoría (nuevo)">
                <Select
                  id="l-cat"
                  value={idCategoriaAdd}
                  onChange={(e) => {
                    setIdCategoriaAdd(e.target.value)
                    setTalleAdd('')
                  }}
                >
                  {categorias.map((c) => (
                    <option key={c.id_categoria} value={c.id_categoria}>
                      {c.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field htmlFor="l-talle" label="Talle">
              <Select
                id="l-talle"
                value={talleAdd}
                onChange={(e) => setTalleAdd(e.target.value)}
                disabled={tallesAdd.length === 0}
              >
                <option value="">Sin talle</option>
                {tallesAdd.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>

            <Field htmlFor="l-cant" label="Cantidad">
              <NumberInput
                id="l-cant"
                min={1}
                max={MAX_UNIDADES_LINEA}
                step={1}
                value={cantidad}
                onChange={(e) => setCantidad(clampUnidades(e.target.value))}
              />
            </Field>
            <Field htmlFor="l-costo" label="Costo unitario">
              <NumberInput
                id="l-costo"
                thousands
                value={costoUnitario}
                onChange={(e) => setCostoUnitario(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={pending}>
              {pending ? 'Agregando…' : 'Agregar línea'}
            </Button>
          </div>

          {/* Aviso del invariante, según el estado del nombre. */}
          {linea.esNuevo && matchLinea && (
            <p className="text-xs text-alerta-ink">
              Ya existe un producto con este nombre. Cambiá el nombre o usá «Del inventario» para vincularlo.
            </p>
          )}
          {!linea.esNuevo && linea.nombre.trim() && !linea.idProducto && (
            <p className="text-xs text-muted">
              Ese producto no está en tu inventario. Elegí uno del listado o marcá «Es nuevo» para crearlo.
            </p>
          )}
        </form>
      )}

      {/* Confirmar */}
      {!readonly && (
        <Card className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted">
            Al confirmar se generan {totalCantidad} ítem(s) con QR único y estado <b>disponible</b>.
          </div>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={pending || detalles.length === 0}
          >
            Confirmar ingreso
          </Button>
        </Card>
      )}

      {/* Etiquetas QR generadas cuando el ingreso ya está confirmado */}
      {readonly && qrs.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted">
            Este ingreso generó <b className="text-text tabular-nums">{qrs.length}</b>{' '}
            {qrs.length === 1 ? 'ítem físico con QR único.' : 'ítems físicos con QR único.'}
          </div>
          <Link href={buildEtiquetasIngresoHref(ingreso.id_ingreso)}>
            <Button size="sm" variant="secondary">
              Imprimir etiquetas ({qrs.length})
            </Button>
          </Link>
        </Card>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar ingreso"
        description={`Se van a generar ${totalCantidad} ítems físicos con QR único. Esta acción no se puede deshacer.`}
        confirmLabel="Confirmar"
        cancelLabel="Cancelar"
        onConfirm={confirmar}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
