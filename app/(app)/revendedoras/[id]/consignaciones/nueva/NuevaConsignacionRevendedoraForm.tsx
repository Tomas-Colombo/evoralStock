'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BuscadorProductos, type SugerenciaProducto } from '@/components/inventario/BuscadorProductos'
import { QrScanner } from '@/components/inventario/QrScanner'
import { Button } from '@/components/ui/Button'
import { CameraIcon } from '@/components/ui/CameraIcon'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { Table, type Column } from '@/components/ui/Table'
import {
  SelectorTalleMulti,
  SIN_TALLE_KEY,
  type SelectorTalle,
  type TalleOpcion,
} from '@/components/ventas/SelectorTalleMulti'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { rankearProductos } from '@/lib/inventario/producto-match'
import { crearConsignacionRevendedoraAction } from '../actions'

interface ItemSeleccionado {
  id_item: string
  id_producto: string
  nombre_producto: string
  codigo_barra: string | null
  sku: string
  talle: string | null
  precio_actual: number
}

export interface ProductoEnStock {
  id_producto: string
  nombre: string
  sku: string | null
  stock_disponible: number
}

export function NuevaConsignacionRevendedoraForm({
  idRevendedora,
  nombreRevendedora,
  catalogo,
}: {
  idRevendedora: string
  nombreRevendedora: string
  /** Productos con stock en el local; alimenta las sugerencias en vivo. */
  catalogo: ProductoEnStock[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()

  const [periodoDesde, setPeriodoDesde] = useState('')
  const [periodoHasta, setPeriodoHasta] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [motivo, setMotivo] = useState('')

  const [codigoInput, setCodigoInput] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [errorItem, setErrorItem] = useState<string | null>(null)
  const [items, setItems] = useState<ItemSeleccionado[]>([])
  const [camaraOpen, setCamaraOpen] = useState(false)
  const [selectorTalle, setSelectorTalle] = useState<SelectorTalle | null>(null)
  const [confirmarOpen, setConfirmarOpen] = useState(false)

  const volver = `/revendedoras/${idRevendedora}/consignaciones`
  const totalEstimado = items.reduce((acc, curr) => acc + curr.precio_actual, 0)

  // Mismo ranking que el carrito de venta. El stock mostrado descuenta las
  // unidades que ya están en este lote.
  const sugerencias = useMemo<SugerenciaProducto[]>(
    () =>
      rankearProductos(catalogo, codigoInput).map((p) => {
        const libres = p.stock_disponible - items.filter((i) => i.id_producto === p.id_producto).length
        return {
          id: p.id_producto,
          nombre: p.nombre,
          sku: p.sku,
          detalle: `${libres} disponible${libres === 1 ? '' : 's'}`,
        }
      }),
    [catalogo, codigoInput, items],
  )

  async function handleBuscarItem(codigoLeido: string = codigoInput) {
    const codigo = codigoLeido.trim()
    if (!codigo) {
      setErrorItem('Escaneá o escribí un código.')
      return
    }

    // Solo bloqueamos en cliente si es el QR físico exacto de una unidad ya cargada.
    // Un SKU o nombre puede repetirse para agregar la segunda/tercera unidad FIFO.
    if (items.some((i) => i.codigo_barra === codigo)) {
      setErrorItem('Ese ítem ya está agregado al lote.')
      return
    }

    setBuscando(true)
    setErrorItem(null)

    try {
      const qs = new URLSearchParams({
        qr: codigo,
        id_revendedora: idRevendedora,
      })
      const excluir = items.map((i) => i.id_item)
      if (excluir.length > 0) {
        qs.set('excluir', excluir.join(','))
      }

      const res = await fetch(`/api/revendedoras/lookup-item?${qs.toString()}`)
      const data = await res.json()

      if (!res.ok || !data.ok) {
        if (data.reason === 'elegir-talle') {
          const idProd = (data.id_producto as string) ?? ''
          setSelectorTalle({
            idProducto: idProd,
            productoNombre:
              (data.producto_nombre as string) ??
              catalogo.find((p) => p.id_producto === idProd)?.nombre ??
              'Producto',
            grupoKey: null,
            opciones: data.talles as TalleOpcion[],
            sinTalle: Number(data.sin_talle ?? 0),
            cantidades: {},
          })
          return
        }
        setErrorItem(mensajeDeError(data.reason || 'item-not-found'))
        return
      }

      if (items.some((i) => i.id_item === data.item.id_item)) {
        setErrorItem('Ese ítem ya está agregado al lote.')
        return
      }

      // La cámara relee el mismo QR: el chequeo de arriba puede llegar tarde.
      setItems((prev) =>
        prev.some((i) => i.id_item === data.item.id_item) ? prev : [...prev, data.item],
      )
      setSelectorTalle(null)
      setCodigoInput('')
    } catch {
      setErrorItem('Error de conexión al buscar el ítem.')
    } finally {
      setBuscando(false)
    }
  }

  function setCantidadTalle(key: string, nueva: number, max: number) {
    setSelectorTalle((s) => {
      if (!s) return s
      const n = Math.max(0, Math.min(max, Math.floor(nueva || 0)))
      return { ...s, cantidades: { ...s.cantidades, [key]: n } }
    })
  }

  async function agregarPorProductoYTalle(
    idProducto: string,
    talle: string | null,
    extraExcluidos: string[],
  ): Promise<ItemSeleccionado | null> {
    const qs = new URLSearchParams({
      id_producto: idProducto,
      id_revendedora: idRevendedora,
    })
    if (talle === null) qs.set('sin_talle', '1')
    else qs.set('talle', talle)
    const excluir = [...items.map((i) => i.id_item), ...extraExcluidos]
    if (excluir.length > 0) qs.set('excluir', excluir.join(','))

    const res = await fetch(`/api/revendedoras/lookup-item?${qs.toString()}`)
    const data = await res.json()
    if (!res.ok || !data.ok) {
      setErrorItem(mensajeDeError(data.reason || 'item-not-found'))
      return null
    }
    const nuevo = data.item as ItemSeleccionado
    setItems((prev) => (prev.some((i) => i.id_item === nuevo.id_item) ? prev : [...prev, nuevo]))
    return nuevo
  }

  async function confirmarSelectorTalle() {
    if (!selectorTalle || buscando) return
    const pedidos: Array<{ talle: string | null; cant: number }> = []
    for (const [k, v] of Object.entries(selectorTalle.cantidades)) {
      if (v > 0) pedidos.push({ talle: k === SIN_TALLE_KEY ? null : k, cant: v })
    }
    const idProducto = selectorTalle.idProducto
    setSelectorTalle(null)
    if (pedidos.length === 0) return

    setBuscando(true)
    setErrorItem(null)
    try {
      let running: string[] = []
      for (const p of pedidos) {
        for (let i = 0; i < p.cant; i++) {
          const nuevo = await agregarPorProductoYTalle(idProducto, p.talle, running)
          if (!nuevo) return
          running = [...running, nuevo.id_item]
        }
      }
      setCodigoInput('')
    } catch {
      setErrorItem('Error de conexión al buscar el ítem.')
    } finally {
      setBuscando(false)
    }
  }

  // QrScanner fija `onDetected` al montar; sin este ref leería la lista de
  // ítems de ese momento y no detectaría los repetidos.
  const buscarRef = useRef(handleBuscarItem)
  useEffect(() => {
    buscarRef.current = handleBuscarItem
  })

  function handleQuitarItem(idItem: string) {
    setItems((prev) => prev.filter((i) => i.id_item !== idItem))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (items.length === 0) {
      toast.error('Agregá al menos un ítem al lote de consignación.')
      return
    }
    setConfirmarOpen(true)
  }

  function handleConfirmar() {
    startTransition(async () => {
      const res = await crearConsignacionRevendedoraAction({
        id_revendedora: idRevendedora,
        items: items.map((i) => i.id_item),
        periodo_desde: periodoDesde || null,
        periodo_hasta: periodoHasta || null,
        observaciones: observaciones || null,
        motivo: motivo || null,
      })

      if (!res.ok) {
        setConfirmarOpen(false)
        toast.error(mensajeDeError(res.reason))
        return
      }

      toast.success('Consignación guardada.')
      router.push(volver)
    })
  }

  const columns: Column<ItemSeleccionado>[] = [
    {
      key: 'sku',
      label: 'Código / SKU',
      render: (r) => (
        <div>
          <div className="font-mono text-sm">{r.sku}</div>
          {r.codigo_barra && <div className="font-mono text-xs text-muted">{r.codigo_barra}</div>}
        </div>
      ),
    },
    {
      key: 'nombre',
      label: 'Producto',
      render: (r) => <span className="font-medium text-sm">{r.nombre_producto}</span>,
    },
    {
      key: 'talle',
      label: 'Talle',
      render: (r) => <span className="text-sm">{r.talle || '—'}</span>,
    },
    {
      key: 'precio',
      label: 'Precio venta',
      align: 'right',
      render: (r) => (
        <span className="font-mono text-sm">
          $ {r.precio_actual.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
        </span>
      ),
    },
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (r) => (
        <Button
          variant="bare"
          type="button"
          onClick={() => handleQuitarItem(r.id_item)}
          className="text-warn-ink hover:underline text-sm font-medium"
        >
          Quitar
        </Button>
      ),
    },
  ]

  // El buscador trae su propio <form> (Enter agrega un ítem), así que el form
  // de la consignación no puede envolverlo: el botón Guardar se asocia por id.
  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-4">
        <h2 className="font-display text-xl">Nueva consignación de salida</h2>
        <p className="text-sm text-muted">Revendedora: {nombreRevendedora}</p>
      </div>

      <form id="nueva-consignacion" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field htmlFor="periodo-desde" label="Período desde (opcional)">
            <Input
              id="periodo-desde"
              type="date"
              value={periodoDesde}
              onChange={(e) => setPeriodoDesde(e.target.value)}
            />
          </Field>
          <Field htmlFor="periodo-hasta" label="Período hasta (opcional)">
            <Input
              id="periodo-hasta"
              type="date"
              value={periodoHasta}
              onChange={(e) => setPeriodoHasta(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field htmlFor="observaciones" label="Observaciones (opcional)">
            <Textarea
              id="observaciones"
              rows={2}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Notas sobre el acuerdo o entrega..."
            />
          </Field>
          <Field htmlFor="motivo" label="Motivo inicial (opcional)">
            <Input
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: Muestrario temporada primavera"
            />
          </Field>
        </div>

      </form>

      <div className="rounded-lg border border-border bg-card-2 p-4 space-y-4">
        <BuscadorProductos
          id="codigo-input"
          label="Escanear o ingresar código / SKU"
          hint="QR, código de barras o SKU del ítem disponible. Enter para agregar."
          error={errorItem ?? undefined}
          placeholder="QR, código de barras o SKU"
          value={codigoInput}
          onChange={(v) => {
            setCodigoInput(v)
            setErrorItem(null)
          }}
          sugerencias={sugerencias}
          onElegir={(s) => void handleBuscarItem(s.sku || s.nombre)}
          onSubmit={(texto) => void handleBuscarItem(texto)}
          disabled={buscando}
          actions={
            <>
              <Button type="submit" disabled={buscando || !codigoInput.trim()}>
                {buscando ? 'Buscando...' : 'Agregar ítem'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setCamaraOpen((v) => !v)}>
                {camaraOpen ? 'Cerrar' : <><CameraIcon /> Cámara</>}
              </Button>
            </>
          }
        />

        {camaraOpen && (
          <div className="mx-auto max-w-xs">
            <QrScanner
              onDetected={(text) => void buscarRef.current(text)}
              onClose={() => setCamaraOpen(false)}
            />
          </div>
        )}

        {selectorTalle && (
          <SelectorTalleMulti
            selector={selectorTalle}
            disabled={buscando}
            onChangeCantidad={setCantidadTalle}
            onConfirm={() => void confirmarSelectorTalle()}
            onCancel={() => setSelectorTalle(null)}
          />
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">Ítems a consignar ({items.length})</h3>
            {items.length > 0 && (
              <span className="text-xs text-muted">
                Total estimado: ${' '}
                {totalEstimado.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </span>
            )}
          </div>

          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted rounded border border-dashed border-border bg-card">
              No hay ítems agregados aún. Escaneá o ingresá códigos arriba.
            </div>
          ) : (
            <div className="overflow-x-auto rounded border border-border bg-card">
              <Table data={items} columns={columns} getRowId={(r) => r.id_item} />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(volver)}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" form="nueva-consignacion" disabled={pending || items.length === 0}>
          Guardar
        </Button>
      </div>

      {/* Esc, clic afuera y la × no cierran mientras se guarda: cerrar a mitad
          del envío escondería si la entrega quedó registrada. */}
      <Modal
        open={confirmarOpen}
        onClose={() => {
          if (!pending) setConfirmarOpen(false)
        }}
        title="Confirmar consignación"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => router.push(volver)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleConfirmar} disabled={pending}>
              {pending ? 'Guardando...' : 'Confirmar'}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Se entregan <strong>{items.length}</strong> ítem{items.length === 1 ? '' : 's'} a{' '}
          {nombreRevendedora} por ${' '}
          {totalEstimado.toLocaleString('es-AR', { maximumFractionDigits: 0 })}.
        </p>
        <p className="mt-2 text-sm text-muted">
          Dejan de estar disponibles en el local y pasan a estar en poder de la revendedora.
        </p>
      </Modal>
    </div>
  )
}
