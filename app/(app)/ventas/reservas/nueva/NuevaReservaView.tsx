'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { QrScanner } from '@/components/inventario/QrScanner'
import { CameraIcon } from '@/components/ui/CameraIcon'
import {
  SIN_TALLE_KEY,
  SelectorTalleMulti,
  type SelectorTalle,
  type TalleOpcion,
} from '@/components/ventas/SelectorTalleMulti'
import {
  buscarMatchNombre,
  indexarPorNombre,
  normalizar,
} from '@/lib/inventario/producto-match'
import type { ProductoConDetalle } from '@/lib/types/inventario'
import type { LineaCarrito } from '@/lib/types/ventas'
import { crearReservaAction } from '../../actions'
import { ClienteQuickCreate, type ClienteCreado } from '../../ClienteQuickCreate'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { TableFrame, DataTable, THead, TBody, Tr, Th, Td } from '@/components/ui/TableParts'
import { Select } from '@/components/ui/Select'
import { Card } from '@/components/ui/Card'

interface Cliente { id: string; nombre: string; telefono: string | null }

/**
 * Alta de reserva: carrito de items (sin precio final, porque el precio
 * se recalcula al vender) + cliente + fecha vencimiento.
 *
 * El buscador de ítems es el MISMO que el de la venta: un solo input que
 * acepta QR, SKU o nombre, con sugerencias, cámara y selector de talle. La
 * alta de reserva no puede ser más pobre que la venta — es el mismo operador
 * eligiendo las mismas unidades. Reutiliza /api/ventas/lookup-item.
 */
export function NuevaReservaView({
  clientes: clientesIniciales,
  productos,
}: {
  clientes: Cliente[]
  productos: ProductoConDetalle[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [clientes, setClientes] = useState<Cliente[]>(clientesIniciales)
  const [idCliente, setIdCliente] = useState('')

  // Alta rápida de cliente en línea
  const [creandoCliente, setCreandoCliente] = useState(false)
  const [fechaVenc, setFechaVenc] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 3) // default: +3 días
    return d.toISOString().slice(0, 16)
  })
  const [observaciones, setObservaciones] = useState('')

  const [qrInput, setQrInput] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  const [camaraOpen, setCamaraOpen] = useState(false)
  const [items, setItems] = useState<LineaCarrito[]>([])

  // Buscador unificado: el mismo input acepta QR, SKU o nombre. Reusamos el
  // índice de nombres normalizado del inventario para sugerir y resolver el
  // producto cuando lo que se tipeó no es un código.
  const [sugerenciasOpen, setSugerenciasOpen] = useState(false)
  const [resaltado, setResaltado] = useState(0)
  // Selector de talle: el server nunca elige una unidad por nosotros cuando la
  // categoría maneja talles (responde 'elegir-talle' con el stock libre).
  const [selectorTalle, setSelectorTalle] = useState<SelectorTalle | null>(null)
  const indexNombres = useMemo(() => indexarPorNombre(productos), [productos])
  const sugerencias = useMemo(() => {
    const q = normalizar(qrInput)
    if (!q) return []
    return productos.filter((p) => normalizar(p.nombre).includes(q)).slice(0, 8)
  }, [productos, qrInput])

  /**
   * URL del lookup. `excluir` son los ítems ya cargados: sin eso el server
   * devuelve siempre la misma unidad (FIFO) y la segunda rebota como duplicada.
   * No se manda forma_pago ni descuentos: en la reserva el precio es sólo
   * referencia y se recalcula al vender.
   */
  function lookupUrl(
    query: Record<string, string | null | undefined>,
    excluirExtra: string[] = [],
  ): string {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v) qs.set(k, v)
    const excluir = [...items.map((i) => i.id_item), ...excluirExtra]
    if (excluir.length > 0) qs.set('excluir', excluir.join(','))
    return `/api/ventas/lookup-item?${qs.toString()}`
  }

  // Agrega evitando duplicados por QR. Devuelve las líneas agregadas.
  function pushItems(nuevas: LineaCarrito[]): LineaCarrito[] {
    const agregadas: LineaCarrito[] = []
    setItems((xs) => {
      const qrs = new Set(xs.map((x) => x.qr_code))
      const resultado = [...xs]
      for (const n of nuevas) {
        if (!qrs.has(n.qr_code)) {
          qrs.add(n.qr_code)
          resultado.push(n)
          agregadas.push(n)
        }
      }
      return resultado
    })
    return agregadas
  }

  function pushItem(nueva: LineaCarrito): LineaCarrito | null {
    const [primera] = pushItems([nueva])
    return primera ?? null
  }

  // Submit del buscador. Con sugerencias de nombre abiertas, elegimos la
  // resaltada — NUNCA caemos al path de código, para no agregar por SKU un
  // ítem equivocado. Sin sugerencias, tratamos el texto como código o nombre
  // exacto.
  function agregar(e?: React.FormEvent) {
    e?.preventDefault()
    if (sugerenciasOpen && sugerencias.length > 0) {
      elegirSugerencia(sugerencias[Math.min(resaltado, sugerencias.length - 1)])
      return
    }
    const texto = qrInput.trim()
    if (!texto) return
    const match = buscarMatchNombre(indexNombres, texto)
    if (match) void agregarPorProducto(match.id_producto)
    else void agregarPorCodigo(texto)
  }

  // Navegación por teclado del desplegable de nombres.
  function onBuscadorKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!sugerenciasOpen || sugerencias.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setResaltado((i) => Math.min(sugerencias.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setResaltado((i) => Math.max(0, i - 1))
    } else if (e.key === 'Escape') {
      setSugerenciasOpen(false)
    }
  }

  function elegirSugerencia(p: ProductoConDetalle) {
    setSugerenciasOpen(false)
    setQrInput(p.nombre)
    void agregarPorProducto(p.id_producto)
  }

  // Carga un ítem a partir de un código (QR exacto o SKU con talle). Lo usan
  // tanto el input manual como el escaneo por cámara.
  function abrirSelectorDesdeRespuesta(
    data: Record<string, unknown>,
    fallbackIdProducto?: string,
  ) {
    const idProd = (data.id_producto as string | undefined) ?? fallbackIdProducto ?? ''
    setSelectorTalle({
      idProducto: idProd,
      productoNombre:
        (data.producto_nombre as string | undefined) ??
        productos.find((p) => p.id_producto === idProd)?.nombre ??
        'Producto',
      grupoKey: null,
      opciones: data.talles as TalleOpcion[],
      sinTalle: Number(data.sin_talle ?? 0),
      cantidades: {},
    })
  }

  async function agregarPorCodigo(rawCode: string) {
    const codigo = rawCode.trim()
    if (!codigo || buscando) return
    setBuscando(true)
    setErrorBusqueda(null)
    try {
      const r = await fetch(lookupUrl({ code: codigo }))
      const data = await r.json()
      if (!data.ok) {
        if (data.reason === 'elegir-talle') {
          abrirSelectorDesdeRespuesta(data)
          return
        }
        setErrorBusqueda(mensajeDeError(data.reason, { extra: data }))
        return
      }
      if (pushItem(data.linea as LineaCarrito)) setQrInput('')
      else setErrorBusqueda('Ese ítem ya está en la lista')
    } catch (e) {
      setErrorBusqueda((e as Error).message)
    } finally {
      setBuscando(false)
    }
  }

  // Agrega por producto (búsqueda por nombre). Si el producto usa talles y no
  // se pasó uno, el server responde 'elegir-talle' con el stock de cada talle
  // y abrimos el selector.
  // `talle`: valor del talle (ej. "M"), o `null` para pedir explícitamente una
  // unidad SIN talle. `extraExcluidos`: ids a saltear ADEMÁS de los ya
  // cargados. `cantidad`: cantidad pedida (hasta 50) en un solo pedido HTTP.
  async function agregarPorProducto(
    idProducto: string,
    talle?: string | null,
    extraExcluidos: string[] = [],
    cantidad = 1,
  ): Promise<LineaCarrito[] | null> {
    if (!idProducto || buscando) return null
    setBuscando(true)
    setErrorBusqueda(null)
    try {
      const r = await fetch(
        lookupUrl(
          {
            id_producto: idProducto,
            talle: talle ?? undefined,
            sin_talle: talle === null ? '1' : undefined,
            cantidad: cantidad > 1 ? String(cantidad) : undefined,
          },
          extraExcluidos,
        ),
      )
      const data = await r.json()
      if (!data.ok) {
        if (data.reason === 'elegir-talle') {
          abrirSelectorDesdeRespuesta(data, idProducto)
          return null
        }
        setErrorBusqueda(mensajeDeError(data.reason, { extra: data }))
        return null
      }
      const recibidas: LineaCarrito[] =
        Array.isArray(data.lineas) && data.lineas.length > 0
          ? (data.lineas as LineaCarrito[])
          : data.linea
            ? [data.linea as LineaCarrito]
            : []

      if (recibidas.length === 0) {
        setErrorBusqueda('Ese ítem ya está en la lista')
        return null
      }
      const agregadas = pushItems(recibidas)
      if (agregadas.length === 0) {
        setErrorBusqueda('Ese ítem ya está en la lista')
        return null
      }
      if (data.aviso) {
        setErrorBusqueda(mensajeDeError(data.aviso))
      }
      setQrInput('')
      setSelectorTalle(null)
      return agregadas
    } catch (e) {
      setErrorBusqueda((e as Error).message)
      return null
    } finally {
      setBuscando(false)
    }
  }

  // Ajusta la cantidad de UN talle dentro del selector (sin llamar al server).
  function setCantidadTalle(key: string, nueva: number, max: number) {
    setSelectorTalle((s) => {
      if (!s) return s
      const n = Math.max(0, Math.min(max, Math.floor(nueva || 0)))
      return { ...s, cantidades: { ...s.cantidades, [key]: n } }
    })
  }

  // Confirma la distribución elegida: pide N unidades por cada talle > 0
  // en un solo pedido por talle, encadenando exclusiones.
  async function confirmarSelectorTalle() {
    if (!selectorTalle) return
    const pedidos: Array<{ talle: string | null; cant: number }> = []
    for (const [k, v] of Object.entries(selectorTalle.cantidades)) {
      if (v > 0) pedidos.push({ talle: k === SIN_TALLE_KEY ? null : k, cant: v })
    }
    const idProducto = selectorTalle.idProducto
    setSelectorTalle(null)
    if (pedidos.length === 0) return
    const running: string[] = []
    for (const p of pedidos) {
      const agregadas = await agregarPorProducto(idProducto, p.talle, running, p.cant)
      if (!agregadas || agregadas.length === 0) return
      running.push(...agregadas.map((l) => l.id_item))
    }
  }

  function quitar(qr: string) {
    setItems((xs) => xs.filter((x) => x.qr_code !== qr))
  }

  function clienteCreado(nuevo: ClienteCreado) {
    setClientes((xs) => [...xs, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    setIdCliente(nuevo.id)
    setCreandoCliente(false)
  }

  function submit() {
    if (items.length === 0) return toast.error('Sin ítems', 'Agregá al menos uno')
    if (!fechaVenc) return toast.error('Falta vencimiento')
    start(async () => {
      const res = await crearReservaAction({
        idCliente: idCliente || null,
        items: items.map((i) => i.id_item),
        fechaVencimiento: new Date(fechaVenc).toISOString(),
        observaciones: observaciones || null,
      })
      if (!res.ok) return toast.error('No se pudo crear', mensajeDeError(res.reason))
      toast.success('Reserva creada')
      router.push(`/ventas/reservas/${res.data!.id}`)
      router.refresh()
    })
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-4">
        <Card className="space-y-3">
          <form onSubmit={agregar}>
            <Field
              htmlFor="qr-r"
              label="Escanear, tipear código o buscar por nombre"
              error={errorBusqueda ?? undefined}
              hint="QR, SKU (ej: REM-0007-M) o nombre del producto. Enter para agregar."
            >
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="qr-r"
                    autoFocus
                    value={qrInput}
                    onChange={(e) => {
                      setQrInput(e.target.value)
                      setSugerenciasOpen(true)
                      setResaltado(0)
                      setSelectorTalle(null)
                    }}
                    onFocus={() => setSugerenciasOpen(true)}
                    onBlur={() => setTimeout(() => setSugerenciasOpen(false), 120)}
                    onKeyDown={onBuscadorKeyDown}
                    placeholder="QR, SKU o nombre"
                    invalid={!!errorBusqueda}
                    disabled={buscando}
                    role="combobox"
                    aria-expanded={sugerenciasOpen && sugerencias.length > 0}
                    aria-autocomplete="list"
                  />
                  {sugerenciasOpen && sugerencias.length > 0 && (
                    <ul
                      role="listbox"
                      className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card-2 shadow"
                    >
                      {sugerencias.map((p, i) => {
                        const activo = i === Math.min(resaltado, sugerencias.length - 1)
                        return (
                          <li
                            key={p.id_producto}
                            role="option"
                            aria-selected={activo}
                            // onMouseDown para seleccionar antes del blur del input.
                            onMouseDown={(e) => {
                              e.preventDefault()
                              elegirSugerencia(p)
                            }}
                            onMouseEnter={() => setResaltado(i)}
                            className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${
                              activo ? 'bg-line text-text' : 'text-text'
                            }`}
                          >
                            <span>{p.nombre}</span>
                            <span className="shrink-0 font-mono text-xs text-muted">
                              {p.stock_disponible} u.
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
                <Button type="submit" disabled={buscando || !qrInput.trim()}>
                  {buscando ? 'Buscando…' : 'Agregar'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCamaraOpen((v) => !v)}
                >
                  {camaraOpen ? 'Cerrar' : <><CameraIcon /> Cámara</>}
                </Button>
              </div>
            </Field>
          </form>

          {selectorTalle && (
            <SelectorTalleMulti
              selector={selectorTalle}
              disabled={buscando}
              onChangeCantidad={setCantidadTalle}
              onConfirm={() => void confirmarSelectorTalle()}
              onCancel={() => setSelectorTalle(null)}
            />
          )}

          {camaraOpen && (
            <div className="mx-auto max-w-xs">
              <QrScanner
                onDetected={(text) => void agregarPorCodigo(text)}
                onClose={() => setCamaraOpen(false)}
              />
            </div>
          )}
        </Card>

        <TableFrame>
          <DataTable>
            <THead>
              <Th>Producto</Th>
              <Th>QR</Th>
              <Th align="right">Precio referencia</Th>
              <Th></Th>
            </THead>
            <TBody>
              {items.length === 0 ? (
                <Tr>
                  <Td align="center" colSpan={4} className="px-4 py-8 text-muted">
                    Buscá o escaneá los ítems a reservar.
                  </Td>
                </Tr>
              ) : (
                items.map((l) => (
                  <Tr key={l.qr_code}>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{l.producto_nombre}</span>
                        <span className="rounded-full border border-border bg-card-2 px-2 py-0.5 text-xs font-medium">
                          {l.talle ? `Talle ${l.talle}` : 'Sin talle'}
                        </span>
                      </div>
                      <div className="text-xs text-muted">{l.sku ?? '—'}</div>
                    </Td>
                    <Td className="font-mono text-xs">{l.qr_code}</Td>
                    <Td align="right" className="font-mono">
                      {l.precio_final != null
                        ? `$ ${l.precio_final.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
                        : '—'}
                    </Td>
                    <Td align="right">
                      <Button variant="ghost" size="sm" onClick={() => quitar(l.qr_code)}>
                        Quitar
                      </Button>
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </DataTable>
        </TableFrame>

        <div className="rounded-md border border-border bg-card-2 p-3 text-xs text-muted">
          El precio final se recalcula al momento de vender. Este listado es
          solo referencia para el cliente.
        </div>
      </section>

      <aside className="space-y-4">
        <Card className="space-y-4">
          <Field htmlFor="r-cli" label="Cliente (opcional)">
            <div className="flex gap-2">
              <Select
                id="r-cli"
                value={idCliente}
                onChange={(e) => setIdCliente(e.target.value)}
              >
                <option value="">— Mostrador —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                    {c.telefono ? ` · ${c.telefono}` : ''}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCreandoCliente((v) => !v)}
                aria-expanded={creandoCliente}
              >
                {creandoCliente ? 'Cerrar' : '+ Nuevo'}
              </Button>
            </div>
          </Field>

          {creandoCliente && <ClienteQuickCreate botonAnchoCompleto onCreated={clienteCreado} />}
          <Field htmlFor="r-fv" label="Vence" required>
            <Input
              id="r-fv"
              type="datetime-local"
              value={fechaVenc}
              onChange={(e) => setFechaVenc(e.target.value)}
            />
          </Field>
          <Field htmlFor="r-obs" label="Observaciones">
            <Textarea
              id="r-obs"
              rows={2}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
            />
          </Field>
        </Card>
        <Button
          className="w-full"
          size="lg"
          onClick={submit}
          disabled={pending || items.length === 0}
        >
          {pending ? 'Creando…' : `Crear reserva (${items.length} ítems)`}
        </Button>
      </aside>
    </div>
  )
}
