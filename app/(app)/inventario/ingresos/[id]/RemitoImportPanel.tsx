'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { useToast } from '@/components/ui/Toast'
import {
  clampUnidades,
  MAX_UNIDADES_LINEA,
  StockTalleLoader,
  type LineaTalle,
} from '@/components/inventario/StockTalleLoader'
import type { CategoriaRow, ProductoConDetalle } from '@/lib/types/inventario'
import { buscarMatchNombre, indexarPorNombre } from '@/lib/inventario/producto-match'
import { MAX_PDF_BYTES } from '@/lib/inventario/limites'
import { importarRemitoAction, parseRemitoPdfAction } from '../../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { IconButton } from '@/components/ui/IconButton'
import { Select } from '@/components/ui/Select'
import { Card } from '@/components/ui/Card'

export type DetalleImportado = {
  id_detalle: string
  id_producto: string
  nombre: string
  cantidad: number
  costo_unitario: number
  talle: string | null
}

type Fila = {
  nombre: string
  cantidad: string
  costoUnitario: string
  esNuevo: boolean
  idProducto: string // producto vinculado cuando esNuevo=false
  idCategoria: string // categoría del producto nuevo (por línea)
  talles: LineaTalle[] // desglose por talle (opcional)
  tallesAbierto: boolean
}

export function RemitoImportPanel({
  idIngreso,
  productos,
  categorias,
  cotizacion,
  onImported,
}: {
  idIngreso: string
  productos: ProductoConDetalle[]
  categorias: CategoriaRow[]
  cotizacion?: { valor: number; fechaValor?: string | null; desactualizada?: boolean } | null
  onImported: (detalles: DetalleImportado[]) => void
}) {
  const toast = useToast()
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const [filas, setFilas] = useState<Fila[]>([])
  const [advertencias, setAdvertencias] = useState<string[]>([])
  const [abierto, setAbierto] = useState(false)
  const [moneda, setMoneda] = useState<'ARS' | 'USD'>('ARS')

  const catInicial = categorias[0]?.id_categoria ?? ''

  // Índice nombre-normalizado → producto existente, para auto-match.
  const porNombre = useMemo(() => indexarPorNombre(productos), [productos])

  /** Producto existente con el mismo nombre que la fila (match vivo). */
  const matchDe = (f: Fila) => buscarMatchNombre(porNombre, f.nombre)

  const tallesDeCategoria = (idCat?: string | null) =>
    categorias.find((c) => c.id_categoria === idCat)?.talles ?? []

  /** Talles que aplican a la fila: los de la categoría elegida (si es nuevo)
   *  o los de la categoría del producto vinculado (si ya existe). */
  const tallesDisponibles = (f: Fila): string[] => {
    if (f.esNuevo) return tallesDeCategoria(f.idCategoria)
    const prod = productos.find((p) => p.id_producto === f.idProducto)
    return tallesDeCategoria(prod?.id_categoria)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_PDF_BYTES) {
      toast.error('Archivo muy grande', 'El remito tiene que pesar menos de 5 MB.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    start(async () => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await parseRemitoPdfAction(fd)
      if (fileRef.current) fileRef.current.value = ''

      if (!res.ok) {
        toast.error('No se pudo leer el PDF', mensajeDeError(res.reason))
        return
      }
      const parsed = res.data!

      if (parsed.lineas.length === 0) {
        toast.error('No se detectaron productos', parsed.advertencias[0] ?? 'Revisá el formato del PDF')
        return
      }
      setFilas(
        parsed.lineas.map((l) => {
          // Si ya existe un producto con ese nombre, arrancamos en "Vincular"
          // (es nuevo destildado); si no, se trata como producto nuevo.
          const match = buscarMatchNombre(porNombre, l.nombre)
          return {
            nombre: l.nombre,
            cantidad: String(l.cantidad),
            costoUnitario: String(l.costoUnitario),
            esNuevo: !match,
            idProducto: match?.id_producto ?? '',
            idCategoria: catInicial,
            talles: [],
            tallesAbierto: false,
          }
        }),
      )
      setAdvertencias(parsed.advertencias)
      setAbierto(true)
    })
  }

  function actualizar(i: number, patch: Partial<Fila>) {
    setFilas((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  // Al editar el nombre: si pasa a coincidir con un producto existente,
  // destildamos "es nuevo" y lo vinculamos automáticamente.
  function cambiarNombre(i: number, nombre: string) {
    setFilas((fs) =>
      fs.map((f, idx) => {
        if (idx !== i) return f
        const match = buscarMatchNombre(porNombre, nombre)
        return match
          ? { ...f, nombre, esNuevo: false, idProducto: match.id_producto }
          : { ...f, nombre }
      }),
    )
  }

  // Al cambiar la cantidad (que manda), si los talles asignados la superan,
  // se resetean para volver a distribuir.
  function cambiarCantidad(i: number, val: string) {
    const limpio = clampUnidades(val)
    const n = Number(limpio || 0)
    setFilas((fs) =>
      fs.map((f, idx) => {
        if (idx !== i) return f
        const sum = f.talles.reduce((a, t) => a + t.cantidad, 0)
        return { ...f, cantidad: limpio, talles: f.talles.length > 0 && sum > n ? [] : f.talles }
      }),
    )
  }

  function quitar(i: number) {
    setFilas((fs) => fs.filter((_, idx) => idx !== i))
  }

  const totalMonto = filas.reduce(
    (a, f) => a + Number(f.cantidad || 0) * Number(f.costoUnitario || 0),
    0,
  )
  const totalEstimadoArs =
    moneda === 'USD' && cotizacion?.valor ? Math.round(totalMonto * cotizacion.valor) : null

  function importar() {
    if (filas.length === 0) return
    for (const f of filas) {
      if (!f.nombre.trim()) return toast.error('Hay una línea sin nombre')
      if (Number(f.cantidad || 0) <= 0) return toast.error('Cantidad inválida', f.nombre)
      // Invariante: es nuevo → nombre único. Si el nombre ya existe, hay que
      // cambiarlo o vincularlo, no crear un duplicado.
      if (f.esNuevo && matchDe(f)) {
        return toast.error('Ese nombre ya existe', `Cambiá el nombre de "${f.nombre}" o usá «Vincular»`)
      }
      if (f.esNuevo && !f.idCategoria) return toast.error('Elegí la categoría', f.nombre)
      if (!f.esNuevo && !f.idProducto) return toast.error('Elegí un producto', f.nombre)
    }

    start(async () => {
      const res = await importarRemitoAction({
        idIngreso,
        moneda,
        lineas: filas.map((f) => ({
          esNuevo: f.esNuevo,
          idProducto: f.esNuevo ? null : f.idProducto || null,
          idCategoria: f.esNuevo ? f.idCategoria || null : null,
          nombre: f.nombre.trim(),
          cantidad: Number(f.cantidad || 0),
          costoUnitario: Number(f.costoUnitario || 0),
          talles: f.talles.length > 0 ? f.talles : undefined,
        })),
      })
      if (!res.ok) return toast.error('No se pudo importar', mensajeDeError(res.reason))
      const { creados, vinculados, detalles, cotizacionDesactualizada } = res.data!
      toast.success('Importado', `${creados} nuevos · ${vinculados} vinculados`)
      if (cotizacionDesactualizada) {
        toast.info(
          'Cotización desactualizada',
          'La cotización oficial del BCRA no se encuentra al día; se utilizó el último valor disponible.',
        )
      }
      onImported(detalles)
      setFilas([])
      setAdvertencias([])
      setAbierto(false)
    })
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Importar desde PDF</h3>
          <p className="text-xs text-muted">
            Subí el remito del proveedor. Leemos cantidad, detalle y precio; el archivo no se guarda.
          </p>
        </div>
        <label className="shrink-0">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            onChange={handleFile}
            disabled={pending}
            className="hidden"
          />
          <span className="inline-flex cursor-pointer items-center rounded-md border border-border bg-card-2 px-4 py-2 text-sm hover:bg-card">
            {pending && !abierto ? 'Leyendo…' : 'Elegir PDF'}
          </span>
        </label>
      </div>

      {abierto && (
        <>
          {/* Selector de moneda del remito */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Moneda del remito:</span>
              <Select
                value={moneda}
                onChange={(e) => setMoneda(e.target.value as 'ARS' | 'USD')}
                aria-label="Moneda del remito"
                className="w-auto"
                disabled={pending}
              >
                <option value="ARS">ARS (Pesos)</option>
                <option value="USD">USD (Dólares)</option>
              </Select>
            </div>
            {moneda === 'USD' && cotizacion?.valor && (
              <span className="text-xs text-muted">
                Cotización oficial: ${' '}
                {cotizacion.valor.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                {cotizacion.desactualizada ? ' (desactualizada)' : ''}{' '}
                · Total est.: ${' '}
                {totalEstimadoArs?.toLocaleString('es-AR')} ARS
              </span>
            )}
          </div>

          <div className="space-y-2">
            {filas.map((f, i) => {
              const talles = tallesDisponibles(f)
              const conTalles = f.talles.length > 0
              const cantNum = Number(f.cantidad || 0)
              const match = matchDe(f)
              const costoNum = Number(f.costoUnitario || 0)
              const estLinea =
                moneda === 'USD' && cotizacion?.valor && costoNum > 0
                  ? Math.round(costoNum * cotizacion.valor)
                  : null

              return (
                <div key={i} className="rounded-lg border border-border bg-card-2 px-3 py-2.5">
                  {/* Fila única: nombre · nuevo/vincular · categoría/producto · cantidad · precio · quitar */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Input
                      value={f.nombre}
                      onChange={(e) => cambiarNombre(i, e.target.value)}
                      placeholder="Producto"
                      className="min-w-[9rem] flex-[2]"
                    />

                    <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border text-xs">
                      <button
                        type="button"
                        onClick={() =>
                          actualizar(i, {
                            esNuevo: true,
                            idCategoria: f.idCategoria || catInicial,
                            talles: [],
                            tallesAbierto: false,
                          })
                        }
                        className={`px-3 py-1.5 font-medium transition-colors ${
                          f.esNuevo ? 'bg-block text-block-ink' : 'text-muted hover:bg-card'
                        }`}
                      >
                        Nuevo
                      </button>
                      <button
                        type="button"
                        onClick={() => actualizar(i, { esNuevo: false, talles: [], tallesAbierto: false })}
                        className={`px-3 py-1.5 font-medium transition-colors ${
                          !f.esNuevo ? 'bg-block text-block-ink' : 'text-muted hover:bg-card'
                        }`}
                      >
                        Vincular
                      </button>
                    </div>

                    {f.esNuevo ? (
                      <Select
                        value={f.idCategoria}
                        onChange={(e) =>
                          actualizar(i, { idCategoria: e.target.value, talles: [], tallesAbierto: false })
                        }
                        aria-label="Categoría del producto nuevo"
                        className="min-w-[8rem] flex-1"
                      >
                        {categorias.map((c) => (
                          <option key={c.id_categoria} value={c.id_categoria}>
                            {c.nombre}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Select
                        value={f.idProducto}
                        onChange={(e) =>
                          actualizar(i, { idProducto: e.target.value, talles: [], tallesAbierto: false })
                        }
                        aria-label="Producto existente"
                        className="min-w-[8rem] flex-1"
                      >
                        <option value="">— Elegí el producto —</option>
                        {productos.map((p) => (
                          <option key={p.id_producto} value={p.id_producto}>
                            {p.nombre}
                            {p.sku ? ` · ${p.sku}` : ''}
                          </option>
                        ))}
                      </Select>
                    )}

                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-xs text-muted">Cant.</span>
                      <NumberInput
                        min={1}
                        max={MAX_UNIDADES_LINEA}
                        step={1}
                        value={f.cantidad}
                        onChange={(e) => cambiarCantidad(i, e.target.value)}
                        aria-label="Cantidad"
                        className="w-16 text-right"
                      />
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-xs text-muted">{moneda === 'USD' ? 'USD' : '$'}</span>
                      <NumberInput
                        thousands
                        value={f.costoUnitario}
                        onChange={(e) => actualizar(i, { costoUnitario: e.target.value })}
                        aria-label="Precio unitario"
                        className="w-24 text-right"
                      />
                      {estLinea != null && (
                        <span className="text-xs text-muted shrink-0">
                          ≈ ${estLinea.toLocaleString('es-AR')} ARS
                        </span>
                      )}
                    </div>

                    <IconButton
                      type="button"
                      onClick={() => quitar(i)}
                      disabled={pending}
                      aria-label="Quitar línea"
                      className="ml-auto"
                    >
                      ✕
                    </IconButton>
                  </div>

                  {/* Segunda fila (solo si aplica): aviso + talles */}
                  {(match && f.esNuevo) || talles.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      {match && f.esNuevo && (
                        <span className="text-xs text-alerta-ink">
                          Ya existe un producto con este nombre. Cambiá el nombre o usá «Vincular».
                        </span>
                      )}
                      {talles.length > 0 && (
                        <div className="flex flex-1 flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-muted">Talles:</span>
                          {conTalles && !f.tallesAbierto && (
                            <div className="flex flex-wrap gap-1.5">
                              {f.talles.map((t) => (
                                <span
                                  key={t.talle ?? '_'}
                                  className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs"
                                >
                                  {t.cantidad}×{t.talle ?? 'sin talle'}
                                </span>
                              ))}
                            </div>
                          )}
                          <Button
                            variant="bare"
                            type="button"
                            onClick={() => actualizar(i, { tallesAbierto: !f.tallesAbierto })}
                            className="text-xs text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink"
                          >
                            {f.tallesAbierto ? 'Listo' : conTalles ? 'Editar' : 'Cargar talles'}
                          </Button>
                          {f.tallesAbierto && (
                            <div className="mt-1 w-full">
                              <StockTalleLoader
                                talles={talles}
                                value={f.talles}
                                max={cantNum}
                                onChange={(v) => actualizar(i, { talles: v })}
                                disabled={pending}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          {advertencias.length > 0 && (
            <div className="rounded-md border border-border bg-card-2 p-3 text-xs text-muted">
              <div className="mb-1 font-medium text-text">Renglones que no pude interpretar ({advertencias.length}):</div>
              <ul className="list-disc space-y-0.5 pl-4">
                {advertencias.map((a, i) => (
                  <li key={i} className="font-mono">{a}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="text-xs text-muted">
              {moneda === 'USD' ? (
                <>
                  Total comprobante: <b>USD {totalMonto.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</b>
                  {totalEstimadoArs != null && (
                    <> (estimado <b>$ {totalEstimadoArs.toLocaleString('es-AR')} ARS</b>)</>
                  )}
                </>
              ) : (
                <>
                  Total comprobante: <b>$ {totalMonto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</b>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setFilas([])
                  setAdvertencias([])
                  setAbierto(false)
                }}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={importar} disabled={pending || filas.length === 0}>
                {pending ? 'Importando…' : `Importar ${filas.length} línea(s)`}
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
