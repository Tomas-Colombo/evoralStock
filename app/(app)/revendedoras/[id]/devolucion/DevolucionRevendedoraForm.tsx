'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BuscadorProductos, type SugerenciaProducto } from '@/components/inventario/BuscadorProductos'
import { QrScanner } from '@/components/inventario/QrScanner'
import { Button } from '@/components/ui/Button'
import { CameraIcon } from '@/components/ui/CameraIcon'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Table, type Column } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { rankearProductos } from '@/lib/inventario/producto-match'
import type { ItemEnPoderRevendedoraRow } from '@/lib/dal/revendedoras/panel'
import { buscarEnPoder } from './buscarEnPoder'
import { devolverItemsRevendedoraAction } from './actions'

type EstadoDestino = 'disponible' | 'devuelto' | 'baja'

const DESTINOS: Record<EstadoDestino, string> = {
  disponible: 'En buen estado: vuelve al stock del local',
  devuelto: 'Para devolver al proveedor',
  baja: 'Baja definitiva: rota o inutilizable',
}

function pesos(n: number) {
  return `$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function DevolucionRevendedoraForm({
  idRevendedora,
  nombreRevendedora,
  items,
}: {
  idRevendedora: string
  nombreRevendedora: string
  items: ItemEnPoderRevendedoraRow[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()

  const [elegidos, setElegidos] = useState<Set<string>>(new Set())
  const [codigo, setCodigo] = useState('')
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null)
  const [camaraOpen, setCamaraOpen] = useState(false)
  const [estadoDestino, setEstadoDestino] = useState<EstadoDestino>('disponible')
  const [motivo, setMotivo] = useState('')
  const [confirmarOpen, setConfirmarOpen] = useState(false)

  const volver = `/revendedoras/${idRevendedora}/en-poder`

  // Una sugerencia por producto, con las unidades que quedan sin marcar.
  const sugerencias = useMemo<SugerenciaProducto[]>(() => {
    const porProducto = new Map<string, { nombre: string; sku: string; libres: number }>()
    for (const it of items) {
      const p = porProducto.get(it.id_producto) ?? { nombre: it.nombre_producto, sku: it.sku, libres: 0 }
      if (!elegidos.has(it.id_item)) p.libres += 1
      porProducto.set(it.id_producto, p)
    }
    const productos = [...porProducto.entries()].map(([id, p]) => ({ id, ...p }))
    return rankearProductos(productos, codigo).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      sku: p.sku,
      detalle: `${p.libres} sin marcar`,
    }))
  }, [items, elegidos, codigo])

  function marcar(texto: string) {
    const res = buscarEnPoder(items, texto, elegidos)
    if (!res.ok) {
      setErrorCodigo(mensajeDeError(res.reason))
      return
    }
    setElegidos((prev) => new Set(prev).add(res.idItem))
    setErrorCodigo(null)
    setCodigo('')
  }

  // QrScanner fija `onDetected` al montar; sin este ref vería los elegidos
  // de ese momento y marcaría dos veces la misma pieza.
  const marcarRef = useRef(marcar)
  useEffect(() => {
    marcarRef.current = marcar
  })

  function alternar(idItem: string) {
    setElegidos((prev) => {
      const next = new Set(prev)
      if (next.has(idItem)) next.delete(idItem)
      else next.add(idItem)
      return next
    })
  }

  const todos = items.length > 0 && elegidos.size === items.length
  const seleccion = items.filter((i) => elegidos.has(i.id_item))
  const totalSeleccion = seleccion.reduce((acc, i) => acc + Number(i.precio_venta || 0), 0)

  function handleConfirmar() {
    startTransition(async () => {
      const res = await devolverItemsRevendedoraAction({
        id_revendedora: idRevendedora,
        items: seleccion.map((i) => i.id_item),
        estado_destino: estadoDestino,
        motivo: motivo || null,
      })

      if (!res.ok) {
        setConfirmarOpen(false)
        toast.error(mensajeDeError(res.reason))
        return
      }

      toast.success(
        `${res.itemsDevueltos} pieza${res.itemsDevueltos === 1 ? '' : 's'} de vuelta en el local.`,
      )
      router.push(volver)
    })
  }

  const columns: Column<ItemEnPoderRevendedoraRow>[] = [
    {
      key: 'elegido',
      label: '',
      render: (r) => (
        <Checkbox
          aria-label={`Marcar ${r.nombre_producto}`}
          checked={elegidos.has(r.id_item)}
          onChange={() => alternar(r.id_item)}
        />
      ),
    },
    {
      key: 'producto',
      label: 'Producto',
      render: (r) => (
        <div>
          <div className="font-medium text-sm">{r.nombre_producto}</div>
          <div className="font-mono text-xs text-muted">{r.qr_code ?? r.sku}</div>
        </div>
      ),
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
      render: (r) => <span className="font-mono text-sm">{pesos(Number(r.precio_venta))}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-4">
        <h2 className="font-display text-xl">Devolución al local</h2>
        <p className="text-sm text-muted">Revendedora: {nombreRevendedora}</p>
      </div>

      <div className="rounded-lg border border-border bg-card-2 p-4 space-y-4">
        <BuscadorProductos
          id="codigo-devolucion"
          label="Escanear lo que vuelve"
          hint="QR, código de barras, SKU o nombre. Enter para marcar."
          error={errorCodigo ?? undefined}
          placeholder="QR, código de barras o SKU"
          value={codigo}
          onChange={(v) => {
            setCodigo(v)
            setErrorCodigo(null)
          }}
          sugerencias={sugerencias}
          onElegir={(s) => marcar(s.sku || s.nombre)}
          onSubmit={marcar}
          autoFocus
          actions={
            <>
              <Button type="submit" disabled={!codigo.trim()}>
                Marcar
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
              onDetected={(text) => marcarRef.current(text)}
              onClose={() => setCamaraOpen(false)}
            />
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">
              En su poder ({elegidos.size} de {items.length} marcadas)
            </h3>
            <div className="flex items-center gap-3">
              {elegidos.size > 0 && (
                <span className="text-xs text-muted">Total marcado: {pesos(totalSeleccion)}</span>
              )}
              <Button
                type="button"
                variant="bare"
                className="text-sm font-medium underline underline-offset-2"
                onClick={() => setElegidos(todos ? new Set() : new Set(items.map((i) => i.id_item)))}
              >
                {todos ? 'Desmarcar todas' : 'Marcar todas'}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto rounded border border-border bg-card">
            <Table data={items} columns={columns} getRowId={(r) => r.id_item} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field htmlFor="estado-destino" label="¿Cómo vuelve la mercadería?">
          <Select
            id="estado-destino"
            value={estadoDestino}
            onChange={(e) => setEstadoDestino(e.target.value as EstadoDestino)}
          >
            {(Object.keys(DESTINOS) as EstadoDestino[]).map((k) => (
              <option key={k} value={k}>
                {DESTINOS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="motivo-devolucion" label="Motivo (opcional)">
          <Input
            id="motivo-devolucion"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: Fin de exhibición"
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.push(volver)} disabled={pending}>
          Cancelar
        </Button>
        <Button type="button" onClick={() => setConfirmarOpen(true)} disabled={pending || elegidos.size === 0}>
          Guardar
        </Button>
      </div>

      {/* Esc, clic afuera y la × no cierran mientras se guarda: cerrar a mitad
          del envío escondería el resultado de la devolución. */}
      <Modal
        open={confirmarOpen}
        onClose={() => {
          if (!pending) setConfirmarOpen(false)
        }}
        title="Confirmar devolución"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setConfirmarOpen(false)} disabled={pending}>
              Volver
            </Button>
            <Button type="button" onClick={handleConfirmar} disabled={pending}>
              {pending ? 'Guardando...' : 'Confirmar'}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Vuelven <strong>{seleccion.length}</strong> pieza{seleccion.length === 1 ? '' : 's'} de{' '}
          {nombreRevendedora} por {pesos(totalSeleccion)}.
        </p>
        <p className="mt-2 text-sm text-muted">{DESTINOS[estadoDestino]}.</p>
      </Modal>
    </div>
  )
}
