'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { QrScanner } from '@/components/inventario/QrScanner'
import { Button } from '@/components/ui/Button'
import { CameraIcon } from '@/components/ui/CameraIcon'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { agregarSinDuplicados, calcularTotalCarrito } from '@/components/ventas/carrito'
import { mensajeDeError } from '@/lib/errores/mensajes'
import type { RvpItemStockResuelto } from '@/lib/types/revendedoras'
import { formatearMoneda } from '@/lib/utils/moneda'
import {
  buscarItemStockRevendedoraAction,
  registrarVentaRevendedoraAction,
} from './actions'

export interface ItemCarritoPortal {
  id_item: string
  descripcion: string
  sku: string
  talle: string | null
  precio_venta: number
}

interface VenderModalProps {
  open: boolean
  onClose: () => void
  itemsIniciales?: ItemCarritoPortal[]
}

export function VenderModal({ open, onClose, itemsIniciales }: VenderModalProps) {
  if (!open) return null
  return <VenderModalContenido onClose={onClose} itemsIniciales={itemsIniciales} />
}

function VenderModalContenido({
  onClose,
  itemsIniciales,
}: {
  onClose: () => void
  itemsIniciales?: ItemCarritoPortal[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [buscando, setBuscando] = useState(false)

  const [carrito, setCarrito] = useState<ItemCarritoPortal[]>(() => itemsIniciales ?? [])
  const [codigo, setCodigo] = useState('')
  const [camaraOpen, setCamaraOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [opciones, setOpciones] = useState<RvpItemStockResuelto[]>([])
  const [contactoAbierto, setContactoAbierto] = useState(false)
  const [contactoNombre, setContactoNombre] = useState('')
  const [contactoTelefono, setContactoTelefono] = useState('')

  const total = useMemo(
    () => calcularTotalCarrito(carrito, (item) => item.precio_venta),
    [carrito],
  )

  function agregarItem(fila: RvpItemStockResuelto) {
    if (fila.precio_venta === null) {
      setErrorMsg(mensajeDeError('precio-no-resoluble'))
      return
    }
    const nuevo: ItemCarritoPortal = {
      id_item: fila.id_item,
      descripcion: fila.descripcion,
      sku: fila.sku,
      talle: fila.talle,
      precio_venta: fila.precio_venta,
    }
    setCarrito((prev) => agregarSinDuplicados(prev, [nuevo], (i) => i.id_item).siguientes)
    setCodigo('')
    setOpciones([])
    setErrorMsg(null)
  }

  async function buscarCodigo(textoRaw: string) {
    const limpio = textoRaw.trim()
    if (!limpio || buscando || isPending) return

    setBuscando(true)
    setErrorMsg(null)
    try {
      const res = await buscarItemStockRevendedoraAction({
        codigo: limpio,
        excluir: carrito.map((i) => i.id_item),
      })

      if (!res.ok) {
        setErrorMsg(mensajeDeError(res.reason))
        setOpciones([])
        return
      }

      if (res.data.length === 0) {
        setErrorMsg('No encontramos ese artículo en tu stock.')
        setOpciones([])
        return
      }

      if (res.data.length === 1) {
        agregarItem(res.data[0])
        return
      }

      setOpciones(res.data)
    } finally {
      setBuscando(false)
    }
  }

  // QrScanner fija `onDetected` al montar; sin este ref leería el carrito
  // inicial y no excluiría los ítems agregados en lecturas anteriores.
  const buscarRef = useRef(buscarCodigo)
  useEffect(() => {
    buscarRef.current = buscarCodigo
  })

  function handleSubmitBusqueda(e: React.FormEvent) {
    e.preventDefault()
    void buscarCodigo(codigo)
  }

  function quitarItem(idItem: string) {
    setCarrito((prev) => prev.filter((i) => i.id_item !== idItem))
  }

  function handleCerrar() {
    if (isPending) return
    setCamaraOpen(false)
    onClose()
  }

  function handleConfirmar() {
    if (carrito.length === 0 || isPending) return
    startTransition(async () => {
      const res = await registrarVentaRevendedoraAction({
        id_items: carrito.map((i) => i.id_item),
        contacto_nombre: contactoNombre,
        contacto_telefono: contactoTelefono,
      })
      if (res.ok) {
        toast.success(
          'Venta registrada',
          carrito.length === 1
            ? 'El artículo ya figura en tus ventas.'
            : `Se registraron ${carrito.length} artículos en tus ventas.`,
        )
        setCarrito([])
        setContactoNombre('')
        setContactoTelefono('')
        setContactoAbierto(false)
        setCamaraOpen(false)
        onClose()
        router.refresh()
      } else {
        toast.error('No se pudo registrar la venta', mensajeDeError(res.reason))
      }
    })
  }

  return (
    <Modal
      open={true}
      onClose={handleCerrar}
      title="Registrar venta"
      size="md"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={handleCerrar}
            disabled={isPending}
            className="min-h-[44px]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmar}
            disabled={carrito.length === 0 || isPending}
            className="min-h-[44px] flex-1 sm:flex-none"
          >
            {isPending
              ? 'Registrando...'
              : `Confirmar venta · ${formatearMoneda(total)}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <form onSubmit={handleSubmitBusqueda} className="flex gap-2">
          <div className="flex-1">
            <Input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Escaneá o buscá por SKU o código..."
              aria-label="Código o SKU del artículo"
              disabled={isPending}
              className="min-h-[44px]"
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={!codigo.trim() || buscando || isPending}
            className="min-h-[44px] shrink-0"
          >
            {buscando ? 'Buscando...' : 'Buscar'}
          </Button>
        </form>

        {!camaraOpen ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCamaraOpen(true)}
            disabled={isPending}
            className="w-full min-h-[44px] flex items-center justify-center gap-2"
          >
            <CameraIcon className="h-4 w-4" />
            Usar cámara
          </Button>
        ) : (
          <div className="w-full">
            <QrScanner
              onDetected={(text) => {
                void buscarRef.current(text)
              }}
              onClose={() => setCamaraOpen(false)}
            />
          </div>
        )}

        {errorMsg && (
          <p
            role="alert"
            className="rounded-md border border-alerta-line bg-alerta-bg px-3 py-2 text-sm text-alerta-ink"
          >
            {errorMsg}
          </p>
        )}

        {opciones.length > 1 && (
          <div className="space-y-2 rounded-lg border border-border bg-panel-2 p-3">
            <p className="text-xs font-medium text-muted">
              Elegí cuál querés agregar:
            </p>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {opciones.map((op) => {
                const sinPrecio = op.precio_venta === null
                return (
                  <button
                    key={op.id_item}
                    type="button"
                    onClick={() => agregarItem(op)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{op.descripcion}</p>
                      <p className="text-xs text-muted">
                        Talle: {op.talle ?? 'Único'} · SKU: {op.sku}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold">
                      {sinPrecio ? 'Sin precio' : formatearMoneda(op.precio_venta!)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              Carrito ({carrito.length}{' '}
              {carrito.length === 1 ? 'artículo' : 'artículos'})
            </span>
            <span className="font-semibold text-ink">
              Total: {formatearMoneda(total)}
            </span>
          </div>

          {carrito.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted">
              Todavía no agregaste artículos.
            </div>
          ) : (
            <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card">
              {carrito.map((item) => (
                <li
                  key={item.id_item}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.descripcion}</p>
                    <p className="text-xs text-muted">
                      {item.talle ? `Talle: ${item.talle} · ` : ''}
                      {formatearMoneda(item.precio_venta)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => quitarItem(item.id_item)}
                    disabled={isPending}
                    aria-label={`Quitar ${item.descripcion}`}
                    className="min-h-[44px] min-w-[44px] shrink-0 text-muted hover:text-alerta-ink"
                  >
                    Quitar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card">
          <button
            type="button"
            onClick={() => setContactoAbierto((v) => !v)}
            aria-expanded={contactoAbierto}
            className="flex min-h-[44px] w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-muted hover:text-ink"
          >
            <span>Datos del cliente (opcional)</span>
            <span>{contactoAbierto ? 'Ocultar' : 'Agregar'}</span>
          </button>
          {contactoAbierto && (
            <div className="grid grid-cols-1 gap-3 border-t border-border p-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="vender-contacto-nombre" className="text-xs text-muted">
                  Nombre
                </label>
                <Input
                  id="vender-contacto-nombre"
                  value={contactoNombre}
                  onChange={(e) => setContactoNombre(e.target.value)}
                  maxLength={120}
                  placeholder="Nombre del cliente"
                  disabled={isPending}
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="vender-contacto-telefono" className="text-xs text-muted">
                  Teléfono
                </label>
                <Input
                  id="vender-contacto-telefono"
                  value={contactoTelefono}
                  onChange={(e) => setContactoTelefono(e.target.value)}
                  inputMode="tel"
                  maxLength={30}
                  placeholder="Ej. 11 5555-5555"
                  disabled={isPending}
                  className="min-h-[44px]"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
