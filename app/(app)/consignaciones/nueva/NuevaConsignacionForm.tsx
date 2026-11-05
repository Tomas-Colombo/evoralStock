'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import {
  SelectorTalleMulti,
  SIN_TALLE_KEY,
  type SelectorTalle,
  type TalleOpcion,
} from '@/components/ventas/SelectorTalleMulti'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { BuscadorProductos, type SugerenciaProducto } from '@/components/inventario/BuscadorProductos'
import { normalizar } from '@/lib/inventario/producto-match'
import type { ItemElegibleConsignacion } from '@/lib/dal/consignaciones/consignacion'
import { crearConsignacionAction } from '../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'

interface Prov { id: string; nombre: string; tipo: string }

/** Unidades libres de un mismo producto, agrupadas para el buscador. */
interface GrupoProducto {
  id_producto: string
  nombre: string
  sku: string | null
  unidades: ItemElegibleConsignacion[]
}

/** Línea del carrito: N unidades del mismo producto + talle. */
interface GrupoCarrito {
  key: string
  nombre: string
  sku: string | null
  talle: string | null
  unidades: ItemElegibleConsignacion[]
}

function claveGrupo(it: ItemElegibleConsignacion): string {
  return `${it.id_producto}|${it.talle ?? SIN_TALLE_KEY}`
}

/** Talles distintos disponibles en el grupo. `null` = unidad sin talle. */
function tallesDe(g: GrupoProducto): Array<string | null> {
  const vistos = new Set<string>()
  const out: Array<string | null> = []
  for (const u of g.unidades) {
    const clave = u.talle ?? '__sin_talle__'
    if (vistos.has(clave)) continue
    vistos.add(clave)
    out.push(u.talle)
  }
  return out
}

/**
 * Alta de un lote de devolución: proveedor + ítems + notas, todo junto.
 *
 * El lote NO se crea hasta que hay al menos un ítem en el carrito — antes el
 * alta creaba una cabecera vacía y te llevaba a llenarla, y abandonar esa
 * pantalla dejaba lotes fantasma en el listado y en las métricas. Ahora el
 * carrito vive en el cliente y se manda entero a `sp_crear_consignacion_con_items`,
 * que inserta todo en una transacción o no inserta nada.
 *
 * Los ítems elegibles se recargan cuando cambia el proveedor: sólo se pueden
 * devolver unidades que ENTRARON por consignación de ESE proveedor y que
 * siguen disponibles. El server revalida ítem por ítem igual.
 */
export function NuevaConsignacionForm({
  proveedores,
  soloConsignatarios,
}: {
  proveedores: Prov[]
  soloConsignatarios: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [idProv, setIdProv] = useState(proveedores[0]?.id ?? '')
  const [obs, setObs] = useState('')
  const [motivo, setMotivo] = useState('')

  const [elegibles, setElegibles] = useState<ItemElegibleConsignacion[]>([])
  // Arranca en true cuando ya hay un proveedor preseleccionado: el efecto de
  // abajo va a buscar sus ítems en el primer render, y así el estado inicial
  // no se corrige con un setState sincrónico dentro del efecto.
  const [cargando, setCargando] = useState(Boolean(proveedores[0]?.id))
  const [errorCarga, setErrorCarga] = useState<string | null>(null)

  const [carrito, setCarrito] = useState<ItemElegibleConsignacion[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [errorItem, setErrorItem] = useState<string | null>(null)
  const [selectorGrupo, setSelectorGrupo] = useState<GrupoProducto | null>(null)
  const [cantidades, setCantidades] = useState<Record<string, number>>({})

  // Sincroniza los elegibles con el proveedor elegido. El efecto sólo dispara
  // el fetch: todo el setState ocurre en los callbacks asíncronos. El reseteo
  // del carrito vive en `cambiarProveedor`, que es donde nace el cambio.
  useEffect(() => {
    if (!idProv) return
    let vigente = true
    fetch(`/api/consignaciones/items-elegibles?id_proveedor=${idProv}`)
      .then((r) => r.json())
      .then((data: { ok: boolean; items?: ItemElegibleConsignacion[]; reason?: string }) => {
        if (!vigente) return
        if (!data.ok) {
          return setErrorCarga(
            data.reason ? mensajeDeError(data.reason) : 'No se pudieron cargar los ítems.',
          )
        }
        setElegibles(data.items ?? [])
      })
      .catch((e: Error) => vigente && setErrorCarga(e.message))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [idProv])

  /** Cambiar de proveedor invalida el carrito: los ítems son de otro. */
  function cambiarProveedor(id: string) {
    setIdProv(id)
    setCargando(true)
    setErrorCarga(null)
    setElegibles([])
    setCarrito([])
    setBusqueda('')
    setErrorItem(null)
  }

  const enCarrito = useMemo(() => new Set(carrito.map((c) => c.id_item)), [carrito])

  /** Unidades libres (elegibles menos las que ya están en el carrito). */
  const libres = useMemo(
    () => elegibles.filter((it) => !enCarrito.has(it.id_item)),
    [elegibles, enCarrito],
  )

  /**
   * El buscador trabaja a nivel PRODUCTO, igual que el de venta: una fila por
   * producto y recién después se elige el talle. Listar unidad por unidad
   * repetía el mismo producto tantas veces como stock hubiera.
   */
  const productos = useMemo<GrupoProducto[]>(() => {
    const mapa = new Map<string, GrupoProducto>()
    for (const it of libres) {
      const g = mapa.get(it.id_producto)
      if (g) g.unidades.push(it)
      else
        mapa.set(it.id_producto, {
          id_producto: it.id_producto,
          nombre: it.producto_nombre,
          sku: it.sku,
          unidades: [it],
        })
    }
    return [...mapa.values()]
  }, [libres])

  const sugerencias = useMemo<SugerenciaProducto[]>(() => {
    const term = normalizar(busqueda)
    if (!term) return []
    return productos
      .filter(
        (p) =>
          normalizar(p.nombre).includes(term) ||
          (p.sku ? normalizar(p.sku).includes(term) : false) ||
          p.unidades.some((u) => normalizar(u.qr_code).includes(term)),
      )
      .slice(0, 8)
      .map((p) => ({
        id: p.id_producto,
        nombre: p.nombre,
        sku: p.sku,
        detalle: `${p.unidades.length} disp.${tallesDe(p).length > 1 ? ' · varios talles' : ''}`,
      }))
  }, [productos, busqueda])

  function agregar(item: ItemElegibleConsignacion) {
    setErrorItem(null)
    setCarrito((prev) => (prev.some((c) => c.id_item === item.id_item) ? prev : [...prev, item]))
    setBusqueda('')
  }

  /**
   * Selector de talle + cantidad, el MISMO componente que usa el carrito de
   * venta. Se arma desde las unidades libres del producto: cada talle con su
   * stock, y las unidades sin talle como fila aparte. Acá no existe la noción
   * de reserva adoptable, así que `reservados` va en cero.
   */
  const selector = useMemo<SelectorTalle | null>(() => {
    if (!selectorGrupo) return null
    const porTalle = new Map<string, number>()
    let sinTalle = 0
    for (const u of selectorGrupo.unidades) {
      if (u.talle == null) sinTalle += 1
      else porTalle.set(u.talle, (porTalle.get(u.talle) ?? 0) + 1)
    }
    const opciones: TalleOpcion[] = [...porTalle.entries()].map(([talle, disponibles]) => ({
      talle,
      disponibles,
    }))
    return {
      idProducto: selectorGrupo.id_producto,
      productoNombre: selectorGrupo.nombre,
      grupoKey: null,
      opciones,
      sinTalle,
      cantidades,
    }
  }, [selectorGrupo, cantidades])

  /** Elegir un producto abre el selector para definir cuántas devolver. */
  function elegirProducto(idProducto: string) {
    const grupo = productos.find((p) => p.id_producto === idProducto)
    if (!grupo) return
    setErrorItem(null)
    setBusqueda('')
    setCantidades({})
    setSelectorGrupo(grupo)
  }

  function cerrarSelector() {
    setSelectorGrupo(null)
    setCantidades({})
  }

  function cambiarCantidad(key: string, nueva: number, max: number) {
    const n = Number.isFinite(nueva) ? Math.max(0, Math.min(max, Math.floor(nueva))) : 0
    setCantidades((prev) => ({ ...prev, [key]: n }))
  }

  /** Aparta N unidades por talle según lo elegido en el selector. */
  function confirmarSelector() {
    if (!selectorGrupo) return
    const elegidas: ItemElegibleConsignacion[] = []
    for (const [key, cant] of Object.entries(cantidades)) {
      if (cant <= 0) continue
      const talle = key === SIN_TALLE_KEY ? null : key
      elegidas.push(...selectorGrupo.unidades.filter((u) => u.talle === talle).slice(0, cant))
    }
    if (elegidas.length === 0) return
    setErrorItem(null)
    setCarrito((prev) => [
      ...prev,
      ...elegidas.filter((e) => !prev.some((p) => p.id_item === e.id_item)),
    ])
    cerrarSelector()
  }

  /** Alta por QR tipeado/escaneado: match exacto sobre la unidad. */
  function agregarPorTexto(texto: string) {
    const term = normalizar(texto)
    if (!term) return
    const exacto = libres.find((it) => normalizar(it.qr_code) === term)
    if (exacto) return agregar(exacto)
    if (elegibles.some((it) => normalizar(it.qr_code) === term)) {
      return setErrorItem('Ese ítem ya está en el lote.')
    }
    if (sugerencias.length === 1) return elegirProducto(sugerencias[0].id)
    setErrorItem(
      'No hay ítem disponible de este proveedor con ese código. Solo se pueden devolver unidades ingresadas por consignación.',
    )
  }

  function quitar(idItem: string) {
    setCarrito((prev) => prev.filter((c) => c.id_item !== idItem))
  }

  function quitarGrupo(key: string) {
    setCarrito((prev) => prev.filter((c) => claveGrupo(c) !== key))
  }

  /**
   * El carrito se muestra agrupado por producto + talle con un contador, no
   * una fila por unidad: devolver 8 unidades del mismo producto y variante no tiene que ocupar 8 renglones.
   */
  const grupos = useMemo<GrupoCarrito[]>(() => {
    const mapa = new Map<string, GrupoCarrito>()
    for (const it of carrito) {
      const key = claveGrupo(it)
      const g = mapa.get(key)
      if (g) g.unidades.push(it)
      else
        mapa.set(key, {
          key,
          nombre: it.producto_nombre,
          sku: it.sku,
          talle: it.talle,
          unidades: [it],
        })
    }
    return [...mapa.values()]
  }, [carrito])

  function submit() {
    if (!idProv) return toast.error('Elegí un proveedor')
    if (carrito.length === 0) return toast.error('Agregá al menos un ítem al lote')
    start(async () => {
      const res = await crearConsignacionAction({
        idProveedor: idProv,
        observaciones: obs || null,
        items: carrito.map((c) => c.id_item),
        motivo: motivo || null,
      })
      if (!res.ok) {
        return toast.error(
          'No se pudo crear',
          mensajeDeError(res.reason, { accion: 'crear consignaciones' }),
        )
      }
      toast.success(`Consignación creada con ${carrito.length} ítem(s)`)
      router.push(`/consignaciones/${res.data!.id}`)
      router.refresh()
    })
  }

  const sinElegibles = !cargando && !errorCarga && elegibles.length === 0

  // Contenedor `div`, NO `form`: `BuscadorProductos` monta su propio <form>
  // para el Enter-a-agregar, y HTML no permite formularios anidados (rompe la
  // hidratación). El alta se dispara desde el botón, no desde un submit.
  return (
    <div className="space-y-4">
      <Field
        htmlFor="c-prov"
        label="Proveedor"
        required
        hint={
          soloConsignatarios
            ? 'Solo se listan proveedores con tipo "consignatario".'
            : 'Ningún proveedor está marcado como "consignatario" — se listan todos, pero solo se pueden devolver unidades ingresadas por consignación.'
        }
      >
        <Select id="c-prov" value={idProv} onChange={(e) => cambiarProveedor(e.target.value)}>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre} · {p.tipo}
            </option>
          ))}
        </Select>
      </Field>

      <div className="rounded-lg border border-border bg-card-2 p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-lg">Ítems a devolver</h3>
          <span className="font-mono text-xs text-muted">
            {cargando
            ? 'Cargando…'
            : `${productos.length} producto(s) · ${libres.length} unidad(es)`}
          </span>
        </div>

        <BuscadorProductos
          id="c-item"
          label="Buscar ítem"
          error={errorItem ?? errorCarga ?? undefined}
          hint="Nombre, SKU o QR. Solo unidades de consignación disponibles de este proveedor."
          placeholder="Escaneá, tipeá el QR o buscá por nombre"
          value={busqueda}
          onChange={setBusqueda}
          sugerencias={sugerencias}
          onElegir={(s) => elegirProducto(s.id)}
          onSubmit={agregarPorTexto}
          disabled={cargando || pending || sinElegibles || !!selector}
          autoFocus
        />

        {selector && (
          <SelectorTalleMulti
            selector={selector}
            disabled={pending}
            onChangeCantidad={cambiarCantidad}
            onConfirm={confirmarSelector}
            onCancel={cerrarSelector}
          />
        )}

        {sinElegibles && (
          <p className="text-sm text-muted">
            Este proveedor no tiene unidades disponibles ingresadas por consignación.
          </p>
        )}

        {grupos.length > 0 && (
          <ul className="divide-y divide-border-2 rounded-md border border-border bg-card">
            {grupos.map((g) => (
              <li key={g.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {g.nombre}
                    {g.talle && <span className="ml-2 text-xs text-muted">Talle {g.talle}</span>}
                  </div>
                  <div className="font-mono text-xs text-muted">
                    {g.unidades.length} unidad{g.unidades.length === 1 ? '' : 'es'}
                    {g.sku && ` · ${g.sku}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => quitar(g.unidades[g.unidades.length - 1].id_item)}
                    disabled={pending}
                    aria-label={`Quitar una unidad de ${g.nombre}`}
                  >
                    −
                  </Button>
                  <span className="w-8 text-center font-mono text-sm">{g.unidades.length}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => quitarGrupo(g.key)}
                    disabled={pending}
                  >
                    Quitar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Field htmlFor="c-motivo" label="Motivo" hint="Opcional; se guarda en cada línea del lote">
        <Input
          id="c-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej: sin rotación, defecto de fábrica"
        />
      </Field>

      <Field htmlFor="c-obs" label="Observaciones">
        <Textarea
          id="c-obs"
          rows={3}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Motivo general del lote (baja rotación, fin de exhibición, defectos, etc.)"
        />
      </Field>

      <div className="rounded-md border border-border bg-card-2 p-3 text-xs text-muted">
        El lote se crea en estado <b>activa</b> con los ítems ya apartados. Los ítems
        siguen físicamente en el local hasta que confirmes la salida — ítem por ítem
        o el lote entero — cuando el proveedor viene a buscar la mercadería.
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="button" onClick={submit} disabled={pending || carrito.length === 0}>
          {pending ? 'Devolviendo…' : `Devolver productos (${carrito.length})`}
        </Button>
      </div>
    </div>
  )
}

