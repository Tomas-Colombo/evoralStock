'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Select } from '@/components/ui/Select'
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
  rankearProductos,
} from '@/lib/inventario/producto-match'
import {
  formaPagoDeCuotas,
  type DescuentoDisponible,
  type DesgloseVenta,
  type FormaPago,
  type MedioPagoRecargo,
  type PlanCuotasRow,
  type RecargoCuotasRow,
} from '@/lib/types/precios'
import type { ProductoConDetalle } from '@/lib/types/inventario'
import type {
  ArancelCobroRow,
  CuentaDestinoRow,
  LineaCarrito,
  ReservaDeProducto,
} from '@/lib/types/ventas'
import {
  CobranzaPanel,
  normalizarPagos,
  nuevoPago,
  sumaPagos,
  type PagoBorrador,
} from './CobranzaPanel'
import { generarPlanCuotas } from '@/lib/cuotas/generar-plan'
import { registrarVentaAction } from '../actions'
import { ClienteQuickCreate, type ClienteCreado } from '@/components/ventas/ClienteQuickCreate'
import { mensajeDeError } from '@/lib/errores/mensajes'
import type { ReglaComisionConEscalas } from '@/lib/types/comisiones'
import { estimarComision, resolverComision } from '@/lib/comisiones/resolver-comision'
import { hoyISO } from '@/lib/utils/hoy'
import { TableFrame, DataTable, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/TableParts'
import { IconButton } from '@/components/ui/IconButton'
import { Card } from '@/components/ui/Card'

interface ClienteOption { id: string; nombre: string; telefono: string | null }
export interface RevendedoraOption { id: string; nombre: string }
/** Grupo del carrito: N unidades del mismo producto+talle en una sola fila. */
interface Grupo {
  key: string
  id_producto: string
  talle: string | null
  producto_nombre: string
  sku: string | null
  categoria_nombre: string | null
  precio_lista: number | null
  precio_final: number | null
  desactualizado: boolean
  advertencia: string | null
  /** Desglose del prototipo del grupo (todas las unidades comparten precio). */
  desglose: DesgloseVenta
  qrs: string[]
  cantidad: number
  subtotal: number
}
/** Set vacío estable — evita recrear uno por render en las filas sin selección. */
const EMPTY_SET: Set<string> = new Set()
/**
 * Valores vacíos estables para los dos lookups del carrito. Con el carrito
 * vacío se devuelven ESTOS, no literales nuevos: `descuentosDisponibles` es
 * dependencia de dos `useMemo`, y un `[]` fresco por render los recalcularía
 * siempre.
 */
const SIN_DESCUENTOS: DescuentoDisponible[] = []
const SIN_STOCK: Record<string, number> = {}
interface ReservaOption {
  id: string
  fecha: string
  fecha_vencimiento: string
  cliente_nombre: string | null
  items_count: number
}

/**
 * Venta que arranca desde una reserva (acceso directo desde /ventas/reservas).
 * Los ítems viajan como QR: el precio se resuelve con el lookup normal, no con
 * el snapshot de la reserva, que puede haber quedado viejo.
 */
export interface PrecargaReserva {
  idReserva: string
  idCliente: string | null
  clienteNombre: string | null
  observaciones: string | null
  qrs: string[]
}

/**
 * Carrito de venta con escaneo QR + búsqueda manual.
 *
 * IMPORTANTE: el precio final ES calculado en el server (endpoint
 * /api/ventas/lookup-item que llama sp_calcular_precio_venta_snapshot).
 * La UI solo muestra — el operador NO puede editar precio arbitrariamente.
 *
 * La confirmación de venta llama sp_registrar_venta que reevalúa TODO
 * (precio, reserva, estado de item) en la misma tx atómica. Si algo
 * cambió entre "agregar al carrito" y "confirmar" (ej. otro operador
 * vendió el mismo item), la tx falla y el usuario ve el error.
 */
export function NuevaVentaView({
  clientes: clientesIniciales,
  reservasActivas,
  productos,
  reservasPorProducto,
  cuentas,
  planesCuotas,
  aranceles,
  recargos,
  precargaReserva,
  puedeRevendedoras = false,
  revendedoras = [],
  reglasComision = [],
}: {
  clientes: ClienteOption[]
  reservasActivas: ReservaOption[]
  productos: ProductoConDetalle[]
  /** Reservas activas que bloquean unidades, indexadas por id_producto. */
  reservasPorProducto: Record<string, ReservaDeProducto[]>
  cuentas: CuentaDestinoRow[]
  /** Planes que el tenant configuró en Precios. Sólo los activos se ofrecen. */
  planesCuotas: PlanCuotasRow[]
  /** Tarifario vigente (00057): con qué se calcula el neto en el preview. */
  aranceles: ArancelCobroRow[]
  /**
   * Recargos vigentes (00063). Acá NO se usan para precificar — eso lo hace
   * el server en cada lookup — sino para saber qué planes ofrece cada cuenta.
   */
  recargos: RecargoCuotasRow[]
  precargaReserva: PrecargaReserva | null
  puedeRevendedoras?: boolean
  revendedoras?: RevendedoraOption[]
  reglasComision?: ReglaComisionConEscalas[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [clientes, setClientes] = useState<ClienteOption[]>(clientesIniciales)
  const [idCliente, setIdCliente] = useState<string>(precargaReserva?.idCliente ?? '')

  const [canal, setCanal] = useState<'local' | 'revendedora'>('local')
  const [idRevendedora, setIdRevendedora] = useState<string>('')

  /**
   * Mete el financiador en una query de lookup. Desde 00063 el recargo depende
   * de por dónde entra la plata, así que el precio de CADA línea cambia con
   * esto — no alcanza con mandar forma_pago.
   */
  function aplicarFinanciador(qs: URLSearchParams): void {
    if (finPropia) qs.set('fin_propia', '1')
    else if (finCuenta) {
      qs.set('fin_cuenta', finCuenta)
      if (finMedio) qs.set('fin_medio', finMedio)
    }
  }

  // Arma la URL del lookup con el contexto común (forma de pago, reserva) y las
  // unidades a saltear. `excluir` es lo que permite cargar dos unidades del
  // mismo producto y talle: sin eso el server devuelve siempre la misma (FIFO)
  // y la segunda rebota como duplicada.
  // `reservaOverride` existe porque `setIdReserva` no impacta hasta el próximo
  // render: cuando la venta adopta una reserva en el mismo tick en que carga
  // el ítem, hay que mandarla explícita o el server la rebota por reservada.
  function lookupUrl(
    query: Record<string, string | null | undefined>,
    excluir: string[] = [],
    reservaOverride?: string | null,
  ): string {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v) qs.set(k, v)
    if (canal === 'revendedora') {
      qs.set('modo', 'venta')
      if (idRevendedora) qs.set('id_revendedora', idRevendedora)
      if (excluir.length > 0) qs.set('excluir', excluir.join(','))
      return `/api/revendedoras/lookup-item?${qs.toString()}`
    }
    qs.set('forma_pago', formaPago)
    aplicarFinanciador(qs)
    const rid = reservaOverride ?? idReserva
    if (rid) qs.set('id_reserva', rid)
    if (excluir.length > 0) qs.set('excluir', excluir.join(','))
    // Descuentos elegidos: se mandan todos; el server filtra por producto.
    if (descuentosKey) qs.set('descuentos', descuentosKey)
    return `/api/ventas/lookup-item?${qs.toString()}`
  }

  // Alta rápida de cliente en línea
  const [creandoCliente, setCreandoCliente] = useState(false)
  // La venta se ata a UNA reserva. Vacío = venta suelta, y en ese caso el
  // campo ni se muestra: aparece recién cuando se carga un ítem reservado.
  const [idReserva, setIdReserva] = useState<string>(precargaReserva?.idReserva ?? '')
  const [observaciones, setObservaciones] = useState(precargaReserva?.observaciones ?? '')
  // La nota arranca colapsada salvo que la reserva ya haya traído uno: si hay
  // texto, esconderlo detrás de un botón lo haría invisible.
  const [notaAbierta, setNotaAbierta] = useState(false)

  const [qrInput, setQrInput] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  const [camaraOpen, setCamaraOpen] = useState(false)

  // Buscador unificado: el mismo input acepta QR, SKU o nombre. Reusamos el
  // índice de nombres normalizado del inventario para sugerir y resolver el
  // producto cuando lo que se tipeó no es un código.
  const [sugerenciasOpen, setSugerenciasOpen] = useState(false)
  const [resaltado, setResaltado] = useState(0)
  // Selector de talle. Sirve para dos cosas con el mismo estado:
  //   grupoKey === null  → estoy agregando un producto y falta elegir talle
  //   grupoKey === '<qr>' → estoy cambiando el talle de esa línea del carrito
  const [selectorTalle, setSelectorTalle] = useState<SelectorTalle | null>(null)
  const indexNombres = useMemo(() => indexarPorNombre(productos), [productos])
  /**
   * Sugerencias por nombre Y por SKU, rankeadas: primero el SKU exacto, después
   * lo que empieza con lo tipeado, y al final las coincidencias en el medio.
   * Así tipear un SKU deja el producto correcto arriba de todo.
   *
   * No hay riesgo de que un QR escaneado matchee acá: el QR son 24 chars hex
   * (`gen_random_bytes(12)`), más largo que cualquier SKU, y el test es
   * "el SKU/nombre contiene lo tipeado" — nunca al revés.
   */
  const sugerencias = useMemo(() => rankearProductos(productos, qrInput), [productos, qrInput])

  // Combobox de cliente: mismo patrón que el buscador de productos. `cliInput`
  // guarda lo tipeado (o el nombre del cliente seleccionado en modo readonly).
  // Mostrador = idCliente vacío. Buscamos por nombre y por teléfono normalizados.
  const [cliInput, setCliInput] = useState(precargaReserva?.clienteNombre ?? '')
  const [cliOpen, setCliOpen] = useState(false)
  const [cliResaltado, setCliResaltado] = useState(0)

  const [lineas, setLineas] = useState<LineaCarrito[]>([])

  // El SET de productos del carrito (no las unidades): agregar otra unidad del
  // mismo producto no cambia esta clave. Declarado acá arriba porque de él
  // dependen los dos lookups del carrito, más abajo.
  const productosEnCarrito = useMemo(
    () => [...new Set(lineas.map((l) => l.id_producto))].sort().join(','),
    [lineas],
  )
  const productosEnCarritoCount = productosEnCarrito ? productosEnCarrito.split(',').length : 0

  // Paso 2 del flujo: el cobro se despliega debajo del carrito. Recién ahí
  // aparece el botón de confirmar la venta.
  const [cobranzaOpen, setCobranzaOpen] = useState(false)
  const cobroRef = useRef<HTMLElement>(null)

  const [finPrimerVenc, setFinPrimerVenc] = useState(() => enUnMes())

  // Cobranza: cómo se reparte el cobro entre cuentas. Arranca con un pago
  // único, que siempre vale el total (ver normalizarPagos).
  const [pagos, setPagos] = useState<PagoBorrador[]>(() => [nuevoPago(cuentas, 0)])

  // Plan del local para lo que el cliente quede debiendo. 1 = un solo pago al
  // vencimiento, el fiado de toda la vida.
  const [cuotasLocal, setCuotasLocal] = useState<number>(1)

  /**
   * Qué campo quedó marcado al intentar confirmar. `null` = todavía no lo
   * intentó, y en ese caso NADA se pinta de rojo: marcar en rojo un campo que
   * el vendedor todavía no llegó a llenar es regañarlo por ir en orden.
   */
  const [faltante, setFaltante] = useState<'cliente' | 'vencimiento' | null>(null)

  const total = useMemo(
    () => lineas.reduce((a, l) => a + (l.precio_final ?? 0), 0),
    [lineas],
  )

  // ─── Deuda: consecuencia, no decisión ───
  // No hay checkbox de "financiar". Lo que el cliente no paga hoy, lo debe.
  // Antes había que declararlo ANTES de cargar los pagos, lo que permitía las
  // dos incoherencias obvias: prender el toggle y cobrar todo igual, o
  // cobrar de menos con el toggle apagado y perder el rastro de la deuda.
  const pagosNormalizados = normalizarPagos(pagos, total, cuentas, aranceles)
  const anticipo = sumaPagos(pagosNormalizados)
  const aFinanciar = redondear2(total - anticipo)
  const hayDeuda = lineas.length > 0 && aFinanciar > 0.005

  // ─── Quién financia, DERIVADO de la cobranza ───
  // Ya no hay un selector de cuotas aparte. El plan sale de donde entra la
  // plata, que es la única fuente que no puede contradecirse con ella misma:
  //
  //   - un pago con tarjeta de crédito en N cuotas → financia esa cuenta;
  //   - si no, y el cliente se va debiendo en N     → financia el local.
  //
  // Nada de esto es estado: si lo fuera habría que sincronizarlo, y
  // desincronizado es exactamente el bug que este rediseño vino a matar.
  //
  // Con DOS pagos con tarjeta en cuotas distintas precifica el primero: el
  // recargo es uno por venta (`venta.forma_pago`), mientras que el arancel sí
  // se cobra por pago y cada uno paga el suyo.
  const pagoEnCuotas =
    pagosNormalizados.find(
      (p) => p.medio === 'tarjeta_credito' && (p.cuotas ?? 1) > 1,
    ) ?? null
  // Sin deuda no hay plan del local aunque haya quedado marcado: el recargo
  // del local sólo existe si el local efectivamente presta la plata.
  const cuotasDeuda = hayDeuda ? cuotasLocal : 1
  const finPropia = pagoEnCuotas === null && cuotasDeuda > 1
  const finCuenta = pagoEnCuotas?.idCuenta ?? null
  const finMedio: MedioPagoRecargo | null = pagoEnCuotas ? 'tarjeta_credito' : null
  const finCuotas = pagoEnCuotas?.cuotas ?? (finPropia ? cuotasDeuda : null)
  // La forma de pago sigue siendo la que precifica en la DB. Se DERIVA de las
  // cuotas en vez de elegirse aparte.
  const formaPago: FormaPago = finCuotas ? formaPagoDeCuotas(finCuotas) : 'efectivo'
  // Clave de refetch: cambia cuando cambia CUALQUIERA de las tres cosas que
  // mueven el precio de una línea (plan, financiador, medio).
  const finKey = finCuotas
    ? `${finPropia ? 'propia' : finCuenta}:${finCuotas}`
    : ''

  // Tope físico de unidades por grupo (producto+talle). Evita que el vendedor
  // suba la cantidad de una fila más allá del stock real. Clave = grupo.key.
  //
  // Con el carrito vacío el valor se DERIVA vacío en vez de resetearse desde
  // el efecto. Es lo mismo que se veía en pantalla, pero sin el estado
  // intermedio: con un reset dentro del efecto, vaciar el carrito dejaba por
  // un frame el tope del carrito anterior.
  const [stockFetched, setStockPorGrupo] = useState<Record<string, number>>({})
  const stockPorGrupo = productosEnCarrito ? stockFetched : SIN_STOCK

  // Descuentos. Ninguno se aplica solo: el vendedor los elige.
  //   - `descuentosDisponibles`: catálogo aplicable a los productos del carrito
  //     (una fila por producto+descuento), refrescado cuando cambia el carrito.
  //   - `descuentosPanel`: ids de descuentos global/categoría/proveedor tildados
  //     en el panel lateral (aplican a toda la venta según su alcance).
  //   - `descuentosProducto`: ids de descuentos de alcance=producto tildados en
  //     la fila, indexado por id_producto.
  // Derivado vacío con el carrito vacío, por el mismo motivo que `stockPorGrupo`.
  const [descuentosFetched, setDescuentosDisponibles] = useState<DescuentoDisponible[]>([])
  const descuentosDisponibles = productosEnCarrito ? descuentosFetched : SIN_DESCUENTOS
  const [descuentosPanel, setDescuentosPanel] = useState<Set<string>>(new Set())
  const [descuentosProducto, setDescuentosProducto] = useState<Record<string, Set<string>>>({})

  // La unión de TODO lo elegido. Se manda entera a cada lookup y al registrar:
  // el server valida cada id contra el producto e ignora los que no aplican.
  const descuentosUnion = useMemo(() => {
    const s = new Set<string>(descuentosPanel)
    for (const set of Object.values(descuentosProducto)) for (const id of set) s.add(id)
    return [...s].sort()
  }, [descuentosPanel, descuentosProducto])
  const descuentosKey = descuentosUnion.join(',')

  // Descuentos de alcance=producto, agrupados por producto (para la fila).
  const descProducto = useMemo(() => {
    const m = new Map<string, DescuentoDisponible[]>()
    for (const d of descuentosDisponibles) {
      if (d.alcance !== 'producto') continue
      const arr = m.get(d.id_producto) ?? []
      arr.push(d)
      m.set(d.id_producto, arr)
    }
    return m
  }, [descuentosDisponibles])

  // Descuentos global/categoría/proveedor, distintos por regla (para el panel).
  // `productos` = qué productos del carrito cubre cada uno (para visualizar).
  const descPanel = useMemo(() => {
    const m = new Map<string, { d: DescuentoDisponible; productos: Set<string> }>()
    for (const d of descuentosDisponibles) {
      if (d.alcance === 'producto') continue
      const e = m.get(d.id_regla)
      if (e) e.productos.add(d.id_producto)
      else m.set(d.id_regla, { d, productos: new Set([d.id_producto]) })
    }
    return [...m.values()]
  }, [descuentosDisponibles])

  // Cuando cambia forma_pago, reserva o la selección de descuentos ⇒
  // recalculo precios de cada línea. Se manda la unión de descuentos; el
  // server decide cuáles aplican a cada producto.
  useEffect(() => {
    if (lineas.length === 0) return
    let cancelled = false
    ;(async () => {
      const porQr = new Map<string, LineaCarrito>()
      for (const l of lineas) {
        try {
          const qs = new URLSearchParams({ qr: l.qr_code, forma_pago: formaPago })
          aplicarFinanciador(qs)
          if (idReserva) qs.set('id_reserva', idReserva)
          if (descuentosKey) qs.set('descuentos', descuentosKey)
          const r = await fetch(`/api/ventas/lookup-item?${qs.toString()}`)
          const data = await r.json()
          if (data.ok) porQr.set(l.qr_code, data.linea as LineaCarrito)
        } catch {
          /* si falla el lookup, se preserva la línea existente */
        }
      }
      if (!cancelled) setLineas(ls => ls.map(l => porQr.get(l.qr_code) ?? l))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finKey, idReserva, descuentosKey])

  // Descuentos disponibles para los productos del carrito. Se refresca cuando
  // cambia el SET de productos (no en cada unidad): agregar otra unidad del
  // mismo producto no toca la lista.
  useEffect(() => {
    if (!productosEnCarrito) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(
          `/api/ventas/descuentos-disponibles?productos=${encodeURIComponent(productosEnCarrito)}`,
        )
        const data = await r.json()
        if (!cancelled && data.ok) {
          setDescuentosDisponibles(data.descuentos as DescuentoDisponible[])
        }
      } catch {
        /* si falla, no ofrecemos descuentos — la venta sigue a precio de lista */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [productosEnCarrito])

  // Tope de unidades por producto+talle. Se refresca con el SET de productos
  // y con la reserva (cambia qué unidades reservadas cuentan como libres). No
  // depende de la cantidad del carrito: el tope es el stock físico, que no
  // cambia por cargar/descargar (los ítems del carrito siguen 'disponible').
  useEffect(() => {
    if (!productosEnCarrito) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(
          `/api/ventas/stock-disponible?productos=${encodeURIComponent(productosEnCarrito)}${
            idReserva ? `&id_reserva=${encodeURIComponent(idReserva)}` : ''
          }`,
        )
        const data = await r.json()
        if (!cancelled && data.ok) {
          const m: Record<string, number> = {}
          for (const s of data.stock as Array<{
            id_producto: string
            talle: string | null
            disponibles: number
          }>) {
            m[`${s.id_producto}|${s.talle ?? '__nula__'}`] = s.disponibles
          }
          setStockPorGrupo(m)
        }
      } catch {
        /* si falla, no topeamos — el server igual rebota si falta stock */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [productosEnCarrito, idReserva])

  // ── Reservas ───────────────────────────────────────────────────────
  // Reservar NO cambia el estado del ítem: la unidad sigue 'disponible' y por
  // eso aparece en el catálogo. El bloqueo vive en `detalle_reserva`, así que
  // acá se cruza a mano para poder mostrarlo y para saber a qué reserva
  // engancharse si el vendedor carga ese producto igual.

  /** Unidades del producto tomadas por reservas ajenas a la venta actual. */
  function reservadasDe(idProducto: string): number {
    return (reservasPorProducto[idProducto] ?? [])
      .filter((r) => r.id_reserva !== idReserva)
      .reduce((a, r) => a + r.unidades, 0)
  }

  /**
   * Reserva que esta venta puede adoptar por ese producto. Sólo cuando hay UNA:
   * con dos reservas en juego no se puede adivinar cuál viene a buscar el
   * cliente, y una venta se ata a una sola reserva.
   */
  function reservaAdoptableDe(idProducto: string): ReservaDeProducto | null {
    const rs = (reservasPorProducto[idProducto] ?? []).filter(
      (r) => r.id_reserva !== idReserva,
    )
    return rs.length === 1 ? rs[0] : null
  }

  /**
   * Sugerencias con el motivo por el que NO se pueden cargar, si lo hay. Antes
   * el desplegable las ofrecía todas por igual y el vendedor se enteraba de que
   * no había stock recién al confirmar, cuando el server rebotaba.
   *
   * Dos motivos distintos, y el segundo tiene una excepción importante:
   *  - `stock_disponible <= 0` → no hay unidades, punto.
   *  - sin unidades libres y SIN reserva adoptable → están todas tomadas por
   *    reservas ajenas que esta venta no puede absorber. Si queda UNA reserva
   *    adoptable es el caso "vengo a buscar lo que reservé": `agregarPorProducto`
   *    la adopta, así que eso NO se bloquea.
   *
   * `libres` se calcula a mano porque el stock del catálogo cuenta las unidades
   * reservadas como libres (reservar no cambia el estado del ítem): acá se
   * separan para que el vendedor vea la verdad.
   *
   * Se calcula en el render y no en un `useMemo`: son ocho ítems como máximo, y
   * las dos funciones de las que depende se recrean en cada render igual.
   */
  const sugerenciasVista = sugerencias.map((p) => {
    const reservadas = reservadasDe(p.id_producto)
    const libres = Math.max(0, p.stock_disponible - reservadas)
    const adoptable = reservaAdoptableDe(p.id_producto)
    const bloqueo =
      p.stock_disponible <= 0
        ? 'sin stock'
        : libres === 0 && !adoptable
          ? 'todo reservado'
          : null
    return { p, reservadas, libres, adoptable, bloqueo }
  })

  const indicesHabilitados = sugerenciasVista
    .map((s, i) => (s.bloqueo ? -1 : i))
    .filter((i) => i >= 0)

  /**
   * Índice realmente resaltado: el primer habilitado desde `resaltado` hacia
   * abajo, o el último habilitado si ya pasó de largo. `-1` = todas bloqueadas,
   * y entonces Enter no selecciona nada del desplegable.
   */
  const resaltadoEfectivo =
    indicesHabilitados.find((i) => i >= resaltado) ??
    indicesHabilitados[indicesHabilitados.length - 1] ??
    -1

  /** Etiqueta corta de una reserva por id (para carteles). */
  function labelReserva(rid: string): string {
    const r = reservasActivas.find((x) => x.id === rid)
    if (!r) return 'reserva'
    const vence = new Date(r.fecha_vencimiento).toLocaleDateString('es-AR')
    return `${r.cliente_nombre ?? 'Mostrador'} · vence ${vence}`
  }

  const reservaActual = idReserva
    ? reservasActivas.find((r) => r.id === idReserva) ?? null
    : null

  /**
   * Suelta la reserva y vacía el carrito. Los ítems cargados podían estar ahí
   * SÓLO gracias a esa reserva; dejarlos daría un carrito que el server rebota
   * recién al confirmar.
   */
  function desvincularReserva() {
    setIdReserva('')
    setLineas([])
    setErrorBusqueda(null)
  }

  // Precarga desde una reserva (acceso directo desde /ventas/reservas). Corre
  // una sola vez y resuelve el precio con el lookup normal: el snapshot que
  // guardó la reserva puede haber quedado viejo.
  const precargaHecha = useRef(false)
  useEffect(() => {
    const p = precargaReserva
    if (!p || precargaHecha.current) return
    precargaHecha.current = true
    if (p.qrs.length === 0) return
    ;(async () => {
      setBuscando(true)
      const cargadas: LineaCarrito[] = []
      let fallos = 0
      for (const qr of p.qrs) {
        try {
          const r = await fetch(
            lookupUrl({ code: qr }, cargadas.map((l) => l.id_item), p.idReserva),
          )
          const data = await r.json()
          if (data.ok) cargadas.push(data.linea as LineaCarrito)
          else fallos++
        } catch {
          fallos++
        }
      }
      setLineas(cargadas)
      setBuscando(false)
      if (fallos > 0) {
        setErrorBusqueda(
          `${fallos} ítem(s) de la reserva no se pudieron cargar (vendidos, dados de baja o sin precio de venta).`,
        )
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Agrupa por producto+talle preservando el orden de entrada al carrito. Se
  // usa una unidad como "prototipo" (nombre, precio, sku); el precio final se
  // asume igual en todas las unidades del grupo — es lo que devuelve el
  // recálculo del server, no una simplificación de la UI.
  const grupos = useMemo<Grupo[]>(() => {
    const map = new Map<string, Grupo>()
    for (const l of lineas) {
      const key = `${l.id_producto}|${l.talle ?? '__nula__'}`
      const g = map.get(key)
      if (g) {
        g.qrs.push(l.qr_code)
        g.cantidad++
        g.subtotal += l.precio_final ?? 0
      } else {
        map.set(key, {
          key,
          id_producto: l.id_producto,
          talle: l.talle,
          producto_nombre: l.producto_nombre,
          sku: l.sku,
          categoria_nombre: l.categoria_nombre,
          precio_lista: l.precio_lista,
          precio_final: l.precio_final,
          desactualizado: l.desactualizado,
          advertencia: l.advertencia,
          desglose: l.desglose,
          qrs: [l.qr_code],
          cantidad: 1,
          subtotal: l.precio_final ?? 0,
        })
      }
    }
    return [...map.values()]
  }, [lineas])

  // Descuentos aplicados en TODO el carrito, agregados por regla (nombre +
  // impacto total = monto por unidad × cantidad del grupo). Alimenta el
  // resumen arriba del Total.
  const resumenDescuentos = useMemo(() => {
    const m = new Map<string, { nombre: string; alcance: string; total: number }>()
    for (const g of grupos) {
      for (const d of g.desglose.descuentos) {
        const add = d.monto * g.cantidad
        const e = m.get(d.id_regla)
        if (e) e.total += add
        else m.set(d.id_regla, { nombre: d.nombre, alcance: d.alcance, total: add })
      }
    }
    return [...m.values()]
  }, [grupos])
  const totalDescuentos = useMemo(
    () => resumenDescuentos.reduce((a, r) => a + r.total, 0),
    [resumenDescuentos],
  )

  // Subtotal a precio de lista (antes de descuentos y recargo) y recargo total
  // por forma de pago. El recargo ya está dentro de precio_final; acá lo
  // extraemos del desglose sólo para mostrarlo desagregado en el resumen.
  const subtotalLista = useMemo(
    () => grupos.reduce((a, g) => a + (g.precio_lista ?? 0) * g.cantidad, 0),
    [grupos],
  )
  const totalRecargo = useMemo(
    () =>
      grupos.reduce(
        (a, g) => a + (g.desglose.recargo_forma_pago?.monto ?? 0) * g.cantidad,
        0,
      ),
    [grupos],
  )

  // Submit del buscador (botón Agregar). Con sugerencias de nombre abiertas,
  // elegimos la resaltada — NUNCA caemos al path de código, para no agregar por
  // SKU un ítem equivocado. Sin sugerencias, tratamos el texto como código
  // (QR/SKU) o nombre exacto.
  function agregarLinea(e?: React.FormEvent) {
    e?.preventDefault()
    // Sólo las sugerencias cargables cuentan. Si están todas bloqueadas, el
    // Enter cae al camino de texto, que termina rebotando contra el server con
    // el motivo exacto en vez de cargar algo que no se puede vender.
    if (sugerenciasOpen && resaltadoEfectivo >= 0) {
      elegirSugerencia(sugerenciasVista[resaltadoEfectivo].p)
      return
    }
    const texto = qrInput.trim()
    if (!texto) return
    const match = buscarMatchNombre(indexNombres, texto)
    if (match) void agregarPorProducto(match.id_producto)
    else void agregarPorCodigo(texto)
  }

  // Navegación por teclado del desplegable de nombres. Salta las sugerencias
  // bloqueadas: si no se pueden elegir, tampoco tiene sentido pararse en ellas.
  function onBuscadorKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!sugerenciasOpen || sugerencias.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const sig = indicesHabilitados.find((i) => i > resaltadoEfectivo)
      if (sig !== undefined) setResaltado(sig)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = [...indicesHabilitados].reverse().find((i) => i < resaltadoEfectivo)
      if (prev !== undefined) setResaltado(prev)
    } else if (e.key === 'Escape') {
      setSugerenciasOpen(false)
    }
  }

  // Selección directa desde el desplegable de sugerencias.
  function elegirSugerencia(p: ProductoConDetalle) {
    setSugerenciasOpen(false)
    setQrInput(p.nombre)
    void agregarPorProducto(p.id_producto)
  }

  /** Ítems ya cargados, opcionalmente sin el de `exceptoQr` (el que se edita). */
  function itemsEnCarrito(exceptoQr?: string): string[] {
    return lineas.filter((l) => l.qr_code !== exceptoQr).map((l) => l.id_item)
  }

  function abrirSelectorDesdeRespuesta(
    data: Record<string, unknown>,
    puedeAdoptar: boolean,
    fallbackIdProducto?: string,
  ) {
    const idProd = (data.id_producto as string | undefined) ?? fallbackIdProducto ?? ''
    // Las unidades reservadas se ofrecen sólo si hay UNA reserva en
    // juego y la venta todavía puede adoptarla.
    const adoptable = puedeAdoptar ? ((data.id_reserva as string | null) ?? null) : null
    setSelectorTalle({
      idProducto: idProd,
      productoNombre:
        (data.producto_nombre as string | undefined) ?? nombreDeProducto(idProd),
      grupoKey: null,
      opciones: data.talles as TalleOpcion[],
      sinTalle: Number(data.sin_talle ?? 0),
      sinTalleReservados: Number(data.sin_talle_reservados ?? 0),
      idReservaAdoptable: adoptable,
      reservaLabel: adoptable ? labelReserva(adoptable) : null,
      cantidades: {},
    })
  }

  // Carga una línea a partir de un código (QR exacto o SKU con talle). Lo usan
  // tanto el input manual como el escaneo por cámara.
  async function agregarPorCodigo(rawCode: string) {
    const codigo = rawCode.trim()
    if (!codigo || buscando) return
    if (canal === 'revendedora' && !idRevendedora) {
      setErrorBusqueda('Elegí una revendedora para continuar.')
      return
    }
    setBuscando(true)
    setErrorBusqueda(null)
    try {
      let data = await (await fetch(lookupUrl({ code: codigo }, itemsEnCarrito()))).json()

      // El ítem escaneado está reservado y la venta todavía no está atada a
      // ninguna reserva: es el caso "vengo a buscar lo que reservé". Se adopta
      // esa reserva y se reintenta, en vez de mandarlo a buscarla a mano.
      const rid: string | null = !idReserva ? data.id_reserva ?? null : null
      if (!data.ok && rid && esReasonDeReserva(data.reason)) {
        setIdReserva(rid)
        data = await (await fetch(lookupUrl({ code: codigo }, itemsEnCarrito(), rid))).json()
      }

      if (!data.ok) {
        if (data.reason === 'elegir-talle') {
          abrirSelectorDesdeRespuesta(data, !idReserva)
          return
        }
        setErrorBusqueda(mensajeDeError(data.reason, { extra: data }))
        return
      }
      const nueva = data.linea as LineaCarrito
      if (pushLinea(nueva)) setQrInput('')
      else setErrorBusqueda('Ese ítem ya está en el carrito')
    } catch (e) {
      setErrorBusqueda((e as Error).message)
    } finally {
      setBuscando(false)
    }
  }

  // Agrega una línea al carrito evitando duplicados por QR. Devuelve la línea
  // Agrega evitando duplicados por QR. Devuelve las líneas efectivamente agregadas.
  function pushLineas(nuevas: LineaCarrito[]): LineaCarrito[] {
    const agregadas: LineaCarrito[] = []
    setLineas((ls) => {
      const qrs = new Set(ls.map((l) => l.qr_code))
      const resultado = [...ls]
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

  function pushLinea(nueva: LineaCarrito): LineaCarrito | null {
    const [primera] = pushLineas([nueva])
    return primera ?? null
  }

  // Agrega por producto (búsqueda por nombre). Si el producto usa talles y no
  // se pasó uno, el server responde 'elegir-talle' con el stock de cada talle
  // y abrimos el selector — nunca elige una unidad por nosotros.
  // `talle`: valor del talle (ej. "M"), o `null` para pedir explícitamente
  // una unidad SIN talle (categorías con talles pero unidades sin cargar).
  // `extraExcluidos`: ids a saltear ADEMÁS del carrito.
  // `cantidad`: cantidad pedida (hasta 50); se resuelve en un solo pedido HTTP.
  async function agregarPorProducto(
    idProducto: string,
    talle?: string | null,
    extraExcluidos: string[] = [],
    excluirBase?: string[],
    reservaOverride?: string | null,
    cantidad = 1,
  ): Promise<LineaCarrito[] | null> {
    if (!idProducto || buscando) return null
    if (canal === 'revendedora' && !idRevendedora) {
      setErrorBusqueda('Elegí una revendedora para continuar.')
      return null
    }
    setBuscando(true)
    setErrorBusqueda(null)
    try {
      const base = excluirBase ?? itemsEnCarrito()
      const query = {
        id_producto: idProducto,
        talle: talle ?? undefined,
        sin_talle: talle === null ? '1' : undefined,
        cantidad: cantidad > 1 ? String(cantidad) : undefined,
      }
      const excluir = [...base, ...extraExcluidos]
      let data = await (
        await fetch(lookupUrl(query, excluir, reservaOverride))
      ).json()

      // Todas las unidades están tomadas por una reserva y la venta todavía no
      // está atada a ninguna: la adopta y reintenta. Es el flujo "el cliente
      // vino a buscar lo que había reservado".
      const puedeAdoptar = !reservaOverride && !idReserva
      if (!data.ok && puedeAdoptar && data.id_reserva && esReasonDeReserva(data.reason)) {
        const rid = data.id_reserva as string
        setIdReserva(rid)
        data = await (await fetch(lookupUrl(query, excluir, rid))).json()
      }

      if (!data.ok) {
        if (data.reason === 'elegir-talle') {
          abrirSelectorDesdeRespuesta(data, puedeAdoptar, idProducto)
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
        setErrorBusqueda('Ese ítem ya está en el carrito')
        return null
      }

      const agregadas = pushLineas(recibidas)
      if (agregadas.length === 0) {
        setErrorBusqueda('Ese ítem ya está en el carrito')
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

  function nombreDeProducto(idProducto: string): string {
    return productos.find((p) => p.id_producto === idProducto)?.nombre ?? 'Producto'
  }

  // Abre el selector para un grupo ya cargado. Se excluyen los ítems del
  // resto del carrito y también los del propio grupo (van a ser devueltos
  // apenas el vendedor confirme la nueva distribución). Sumamos la cantidad
  // actual del grupo a la disponibilidad de su talle, así el vendedor puede
  // "reusarla" en la nueva mezcla. Si el producto no maneja talles no hay
  // nada que elegir.
  async function abrirCambioTalle(g: Grupo) {
    if (buscando) return
    setBuscando(true)
    setErrorBusqueda(null)
    try {
      // Excluyo el resto del carrito pero NO las unidades del propio grupo:
      // así el disponible que vuelve el server ya incluye lo que el vendedor
      // tenía cargado y puede reasignarlo libremente en la nueva mezcla.
      const excluir = lineas
        .filter((l) => !g.qrs.includes(l.qr_code))
        .map((l) => l.id_item)
      const r = await fetch(lookupUrl({ id_producto: g.id_producto }, excluir))
      const data = await r.json()
      if (data.reason !== 'elegir-talle') {
        setErrorBusqueda(
          data.ok
            ? 'Este producto no maneja talles.'
            : mensajeDeError(data.reason, { extra: data }),
        )
        return
      }
      const adoptable = idReserva ? null : (data.id_reserva as string | null)
      setSelectorTalle({
        idProducto: g.id_producto,
        productoNombre: g.producto_nombre,
        grupoKey: g.key,
        opciones: data.talles as TalleOpcion[],
        sinTalle: Number(data.sin_talle ?? 0),
        sinTalleReservados: Number(data.sin_talle_reservados ?? 0),
        idReservaAdoptable: adoptable,
        reservaLabel: adoptable ? labelReserva(adoptable) : null,
        cantidades: {
          [g.talle ?? SIN_TALLE_KEY]: g.cantidad,
        },
      })
    } catch (e) {
      setErrorBusqueda((e as Error).message)
    } finally {
      setBuscando(false)
    }
  }

  // Confirma la distribución de talles elegida en el selector. En "agregar"
  // pide N unidades por cada talle > 0 encadenando exclusiones. En "cambiar"
  // primero quita el grupo actual y después dispara el mismo flujo.
  async function confirmarSelectorTalle() {
    if (!selectorTalle) return
    const pedidos: Array<{ talle: string | null; cant: number }> = []
    for (const [k, v] of Object.entries(selectorTalle.cantidades)) {
      if (v > 0) pedidos.push({ talle: k === SIN_TALLE_KEY ? null : k, cant: v })
    }
    if (pedidos.length === 0) {
      setSelectorTalle(null)
      return
    }
    const grupoDeCambio = selectorTalle.grupoKey
      ? grupos.find((x) => x.key === selectorTalle.grupoKey) ?? null
      : null
    // Base de exclusión "pura" (sin los ítems del grupo que se está
    // reestructurando) — no depende del state async de React.
    const qrsGrupo = new Set(grupoDeCambio?.qrs ?? [])
    const excluirBase = lineas
      .filter((l) => !qrsGrupo.has(l.qr_code))
      .map((l) => l.id_item)
    if (grupoDeCambio) {
      setLineas((ls) => ls.filter((l) => !qrsGrupo.has(l.qr_code)))
    }
    const idProducto = selectorTalle.idProducto
    // Si el vendedor pidió más unidades de las libres en algún talle, está
    // tomando unidades reservadas: la venta adopta esa reserva ANTES de pedir
    // nada, o el server rebota cada unidad por reservada.
    const libresDe = (talle: string | null): number =>
      talle === null
        ? selectorTalle.sinTalle
        : selectorTalle.opciones.find((o) => o.talle === talle)?.disponibles ?? 0
    const tomaReservadas = pedidos.some((p) => p.cant > libresDe(p.talle))
    const reservaAdoptada =
      tomaReservadas && selectorTalle.idReservaAdoptable
        ? selectorTalle.idReservaAdoptable
        : null
    if (reservaAdoptada) setIdReserva(reservaAdoptada)

    setSelectorTalle(null)
    // Se REASIGNA en vez de mutar con push. Es lo mismo funcionalmente —son
    // unos pocos ids—, pero el `push` sobre una lista que cruza varios `await`
    // le impide al compilador de React descartar que se esté mutando algo del
    // render, y lo rechaza. Reasignar no deja esa duda.
    let running: string[] = []
    for (const p of pedidos) {
      const agregadas = await agregarPorProducto(
        idProducto,
        p.talle,
        running,
        excluirBase,
        reservaAdoptada,
        p.cant,
      )
      if (!agregadas || agregadas.length === 0) return
      running = [...running, ...agregadas.map((l) => l.id_item)]
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

  // Ajusta la cantidad de un grupo (producto+talle) a `nueva`. Si sube, pide N
  // unidades al server encadenando y excluyendo lo que se va agregando; si
  // baja, saca del carrito las últimas unidades del grupo (FIFO reverso).
  async function setCantidadGrupo(g: Grupo, nueva: number) {
    const n = Math.max(0, Math.floor(nueva))
    if (n === g.cantidad) return
    if (n < g.cantidad) {
      const aQuitar = new Set(g.qrs.slice(n))
      setLineas((ls) => ls.filter((l) => !aQuitar.has(l.qr_code)))
      return
    }
    const aAgregar = n - g.cantidad
    if (aAgregar > 0) {
      await agregarPorProducto(g.id_producto, g.talle, [], undefined, undefined, aAgregar)
    }
  }

  function quitarGrupo(g: Grupo) {
    const set = new Set(g.qrs)
    setLineas((ls) => ls.filter((l) => !set.has(l.qr_code)))
    setSelectorTalle((s) => (s?.grupoKey === g.key ? null : s))
  }

  // Toggle de un descuento del panel (global/categoría/proveedor).
  function togglePanel(idRegla: string) {
    setDescuentosPanel((s) => {
      const n = new Set(s)
      if (n.has(idRegla)) n.delete(idRegla)
      else n.add(idRegla)
      return n
    })
  }

  // Toggle de un descuento de alcance=producto para ESE producto.
  function toggleProducto(idProducto: string, idRegla: string) {
    setDescuentosProducto((m) => {
      const cur = new Set(m[idProducto] ?? [])
      if (cur.has(idRegla)) cur.delete(idRegla)
      else cur.add(idRegla)
      return { ...m, [idProducto]: cur }
    })
  }

  function clienteCreado(nuevo: ClienteCreado) {
    setClientes((xs) => [...xs, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    setIdCliente(nuevo.id)
    setCliInput(nuevo.nombre)
    setCreandoCliente(false)
  }

  /**
   * Abre el cobro y lo trae a la vista. Sin el scroll, en una pantalla con el
   * carrito largo el panel se despliega fuera de cuadro y el botón parece no
   * haber hecho nada.
   */
  const planPreview = hayDeuda
    ? generarPlanCuotas({
        montoAFinanciar: aFinanciar,
        cuotas: cuotasDeuda,
        primerVencimiento: finPrimerVenc,
      })
    : []

  /**
   * Planes que el local puede ofrecer sobre la deuda. Son los mismos que
   * configuró el tenant; el 1 (un pago al vencimiento) no vive en
   * `plan_cuotas` porque no es un plan, es la ausencia de plan.
   */
  const planesLocal = useMemo(
    () =>
      planesCuotas
        .filter((p) => p.activo)
        .map((p) => p.cuotas)
        .sort((a, b) => a - b),
    [planesCuotas],
  )

  /**
   * Sube al campo que falta y lo enfoca. La deuda se descubre abajo pero el
   * cliente se pide arriba: sin este salto, el vendedor tiene que buscarlo a
   * mano después de leer el aviso.
   */
  function enfocarCampo(id: string): void {
    const el = document.getElementById(id)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    ;(el as HTMLInputElement | null)?.focus()
  }

  function abrirCobro() {
    setCobranzaOpen(true)
    requestAnimationFrame(() => {
      cobroRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function confirmar() {
    if (canal === 'revendedora') {
      if (!idRevendedora) {
        toast.error('Revendedora requerida', 'Elegí una revendedora para continuar.')
        return
      }
    } else {
      // Lo que falta se MARCA, no se explica en un toast que se va solo. El
      // vendedor tiene que poder ver el campo en rojo y arreglarlo ahí mismo.
      if (hayDeuda && !idCliente) {
        setFaltante('cliente')
        enfocarCampo('v-cli')
        return
      }
      if (hayDeuda && !finPrimerVenc) {
        setFaltante('vencimiento')
        enfocarCampo('v-fin-venc')
        return
      }
      if (seExcedio) {
        // Sin campo que marcar: el exceso ya está en rojo dentro del panel y el
        // arreglo es bajar un monto, no llenar algo que falta.
        toast.error(
          'La cobranza no cierra',
          `Estás cobrando ${money(anticipo - total)} de más.`,
        )
        return
      }
    }
    setFaltante(null)

    // El panel NO se cierra acá. Con el modal, cerrarlo era descartar el
    // diálogo; en línea sólo esconde el botón que dice "Registrando…" y, si
    // el server rechaza la venta, deja al vendedor sin la cobranza que acaba
    // de armar. Si sale bien, igual navegamos al detalle.
    start(async () => {
      const res = await registrarVentaAction({
        // Se manda la unión de descuentos por línea; el server valida cada
        // uno contra el producto de esa línea y descarta los que no aplican.
        lineas: lineas.map((l) => ({ id_item: l.id_item, descuentos: descuentosUnion })),
        formaPago,
        idCliente: idCliente || null,
        idReserva: idReserva || null,
        observaciones: observaciones || null,
        // Deuda derivada: si no se cobró todo, lo que falta se parte en las
        // MISMAS cuotas con las que se vendió.
        financiacion: hayDeuda && canal !== 'revendedora'
          ? { cuotas: cuotasDeuda, primer_vencimiento: finPrimerVenc }
          : null,
        // Quién financia (00064). Define qué recargo se aplicó al precificar
        // y a qué cuenta va el pago cuando la cobranza no se detalla.
        financiador: finCuotas && canal !== 'revendedora'
          ? {
              id_cuenta_destino: finCuenta,
              medio: finMedio,
              propia: finPropia,
            }
          : null,
        // Sin anticipo el panel deja un pago en $0: el SP lo rechaza con
        // `pago-monto-invalido`. Se descartan acá — un pago de cero no es una
        // forma de cobrar, es la ausencia de cobro.
        pagos: canal === 'revendedora'
          ? []
          : pagosNormalizados
              .filter((p) => p.monto > 0)
              .map((p) => {
                const recibido = Number(p.recibido.replace(',', '.'))
                return {
                  medio: p.medio,
                  id_cuenta_destino: p.idCuenta,
                  monto: p.monto,
                  // El SP lo exige en credito y lo rechaza en el resto; ya viene
                  // normalizado por `normalizarPagos`.
                  cuotas: p.cuotas,
                  // El vuelto lo calcula la DB a partir de esto; solo se manda si
                  // el vendedor lo cargo y es coherente.
                  monto_recibido:
                    p.medio === 'efectivo' && Number.isFinite(recibido) && recibido >= p.monto
                      ? recibido
                      : null,
                  referencia: p.referencia.trim() || null,
                }
              }),
        canal,
        idRevendedora: canal === 'revendedora' ? idRevendedora : null,
      })
      if (!res.ok) return toast.error('No se pudo registrar la venta', mensajeDeError(res.reason))
      toast.success('Venta registrada', `Total $ ${total.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`)
      router.push(`/ventas/${res.data!.id}`)
      router.refresh()
    })
  }

  const clientesFiltrados = idReserva
    ? clientes.filter((c) => {
        if (c.id === idCliente) return true // no ocultar al cliente ya seleccionado
        const r = reservasActivas.find((x) => x.id === idReserva)
        return !r?.cliente_nombre || r.cliente_nombre === c.nombre
      })
    : clientes

  // Sugerencias visibles: filtro por nombre/teléfono normalizado; sin query,
  // arrancamos con los primeros N (default cuando el combobox se abre).
  const cliSugerencias = useMemo(() => {
    const q = normalizar(cliInput)
    if (!q) return clientesFiltrados.slice(0, 8)
    const digitos = cliInput.replace(/\D/g, '')
    return clientesFiltrados
      .filter((c) => {
        if (normalizar(c.nombre).includes(q)) return true
        // El match por teléfono sólo corre si lo tipeado TIENE dígitos: con un
        // nombre, `digitos` queda vacío y `tel.includes('')` daba true siempre,
        // devolviendo todos los clientes con teléfono cargado.
        if (!digitos) return false
        return (c.telefono ?? '').replace(/\D/g, '').includes(digitos)
      })
      .slice(0, 8)
  }, [cliInput, clientesFiltrados])

  function seleccionarCliente(id: string, nombre: string) {
    setIdCliente(id)
    setCliInput(id ? nombre : '')
    setCliOpen(false)
    // Mostrador (id vacío) NO despinta el campo: sigue sin haber a quién
    // cobrarle la deuda, que es justo lo que la marca está señalando.
    if (id) setFaltante((f) => (f === 'cliente' ? null : f))
  }

  function onCliKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!cliOpen) return
    // Total de opciones = mostrador + sugerencias.
    const totalOpts = 1 + cliSugerencias.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCliResaltado((i) => Math.min(totalOpts - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCliResaltado((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (cliResaltado === 0) seleccionarCliente('', '')
      else {
        const c = cliSugerencias[cliResaltado - 1]
        if (c) seleccionarCliente(c.id, c.nombre)
      }
    } else if (e.key === 'Escape') {
      setCliOpen(false)
    }
  }

  // La cobranza se valida ANTES de mandar: el SP la rechaza igual, pero
  // avisar acá es más barato que un error después de haber tocado stock.
  const cuentasOk =
    canal === 'revendedora'
      ? Boolean(idRevendedora)
      : cuentas.length > 0 && pagosNormalizados.every((p) => p.idCuenta)

  const comisionResolucion = useMemo(() => {
    if (canal !== 'revendedora' || !idRevendedora) return null
    return resolverComision(reglasComision, {
      idRevendedora,
      fecha: hoyISO(),
      montoPeriodo: total,
    })
  }, [canal, idRevendedora, reglasComision, total])

  const comisionEstimada = useMemo(() => {
    if (!comisionResolucion) return null
    return estimarComision(total, comisionResolucion.porcentaje)
  }, [comisionResolucion, total])
  // Cobrar de más nunca es válido; cobrar de menos sí, y es deuda. Lo que la
  // deuda exige es cliente (si no, no se sabe quién debe) y vencimiento.
  const seExcedio = anticipo - total > 0.005
  // El botón NO se deshabilita por lo que el vendedor puede arreglar. Un
  // botón gris no dice QUÉ falta: hay que salir a buscarlo por la pantalla, y
  // en el caso del cliente el campo está arriba de todo, fuera de cuadro.
  // Apretar y que se marque el campo que falta es la forma de enterarse.
  //
  // Lo único que sigue bloqueando es lo que el vendedor no puede resolver
  // desde acá: un carrito vacío o un tenant sin cuentas cargadas.
  const puedeConfirmar = lineas.length > 0 && !pending && cuentasOk

  return (
    <div className="space-y-5">
      {/* Paso 1 — carrito: buscador + tabla de ítems */}
      <section className="space-y-4">
        {puedeRevendedoras && (
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <div className="w-48">
                <label
                  htmlFor="canal-venta"
                  className="block text-xs font-medium text-muted mb-1"
                >
                  Canal de venta
                </label>
                <Select
                  id="canal-venta"
                  aria-label="Canal de venta"
                  value={canal}
                  onChange={(e) => {
                    const nuevoCanal = e.target.value as 'local' | 'revendedora'
                    setCanal(nuevoCanal)
                    if (nuevoCanal === 'local') {
                      setIdRevendedora('')
                    }
                    if (lineas.length > 0) {
                      setLineas([])
                    }
                  }}
                  className="px-3 py-1.5 text-sm"
                >
                  <option value="local">Local</option>
                  <option value="revendedora">Revendedora</option>
                </Select>
              </div>

              {canal === 'revendedora' && (
                <div className="flex-1 min-w-[220px]">
                  <label
                    htmlFor="select-revendedora"
                    className="block text-xs font-medium text-muted mb-1"
                  >
                    Revendedora
                  </label>
                  <Select
                    id="select-revendedora"
                    aria-label="Revendedora"
                    value={idRevendedora}
                    onChange={(e) => {
                      setIdRevendedora(e.target.value)
                      if (lineas.length > 0) {
                        setLineas([])
                      }
                    }}
                    className="px-3 py-1.5 text-sm"
                  >
                    <option value="">-- Elegí una revendedora activa --</option>
                    {revendedoras.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nombre}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          </Card>
        )}

        <Card className="space-y-3">
          <form onSubmit={agregarLinea}>
            <Field
              htmlFor="qr-input"
              label="Escanear, tipear código o buscar por nombre"
              error={errorBusqueda ?? undefined}
              hint="QR, SKU (ej: REM-0007-M) o nombre del producto. Enter para agregar."
            >
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="qr-input"
                    autoFocus
                    value={qrInput}
                    onChange={(e) => {
                      setQrInput(e.target.value)
                      setSugerenciasOpen(true)
                      setResaltado(0)
                      // Un selector abierto para "agregar" ya no aplica si
                      // cambió lo tipeado; el de cambio de talle sí sobrevive.
                      setSelectorTalle((s) => (s?.grupoKey ? s : null))
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
                      {sugerenciasVista.map(({ p, reservadas, libres, adoptable, bloqueo }, i) => {
                        const activo = i === resaltadoEfectivo
                        const quien = adoptable?.cliente_nombre
                        return (
                          <li
                            key={p.id_producto}
                            role="option"
                            aria-selected={activo}
                            aria-disabled={bloqueo ? true : undefined}
                            // onMouseDown para seleccionar antes del blur del input.
                            // Bloqueada no lleva handler: no hay nada que elegir.
                            onMouseDown={
                              bloqueo
                                ? (e) => e.preventDefault()
                                : (e) => {
                                    e.preventDefault()
                                    elegirSugerencia(p)
                                  }
                            }
                            onMouseEnter={bloqueo ? undefined : () => setResaltado(i)}
                            className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${
                              bloqueo
                                ? 'cursor-not-allowed text-muted'
                                : `cursor-pointer ${activo ? 'bg-line text-text' : 'text-text'}`
                            }`}
                          >
                            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="truncate">{p.nombre}</span>
                              {p.sku && (
                                <span className="shrink-0 font-mono text-[11px] text-muted">
                                  {p.sku}
                                </span>
                              )}
                              {reservadas > 0 && (
                                <span className="shrink-0 rounded-full border border-warn/50 bg-card px-1.5 py-0.5 text-[10px] font-medium text-warn-ink">
                                  {reservadas} reservada{reservadas === 1 ? '' : 's'}
                                  {quien ? ` · ${quien}` : ''}
                                </span>
                              )}
                            </span>
                            {/* El motivo reemplaza al contador de libres: con el
                                bloqueo puesto, "0 libres" no agrega nada. */}
                            <span className="shrink-0 font-mono text-xs text-muted">
                              {bloqueo ?? `${libres} libre${libres === 1 ? '' : 's'}`}
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
              <Th align="right">Precio</Th>
              <Th align="right">Cant.</Th>
              <Th align="right">Subtotal</Th>
              <Th></Th>
            </THead>
            <TBody>
              {grupos.length === 0 ? (
                <Tr>
                  <Td align="center" colSpan={5} className="px-4 py-8 text-muted">
                    Escaneá el primer ítem para empezar la venta.
                  </Td>
                </Tr>
              ) : (
                grupos.map((g) => (
                  <Tr key={g.key} data-testid="linea-carrito">
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{g.producto_nombre}</span>
                        <span className="rounded-full border border-border bg-card-2 px-2 py-0.5 text-xs font-medium">
                          {g.talle ? `Talle ${g.talle}` : 'Sin talle'}
                        </span>
                        <Button
                          variant="bare"
                          type="button"
                          onClick={() => void abrirCambioTalle(g)}
                          disabled={buscando}
                          className="text-xs text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink"
                        >
                          Cambiar
                        </Button>
                      </div>
                      <div className="text-xs text-muted">
                        {g.sku ?? '—'} · {g.categoria_nombre ?? '—'}
                      </div>
                      {g.advertencia && (
                        <div className="mt-1 text-xs text-warn-ink">{g.advertencia}</div>
                      )}
                      {g.desactualizado && (
                        <Badge variant="warning">Precio desactualizado</Badge>
                      )}
                      <LineaDescuentos
                        grupo={g}
                        disponibles={descProducto.get(g.id_producto) ?? []}
                        seleccionados={descuentosProducto[g.id_producto] ?? EMPTY_SET}
                        onToggle={(idRegla) => toggleProducto(g.id_producto, idRegla)}
                        disabled={buscando}
                      />
                    </Td>
                    <Td align="right" className="font-mono">
                      {g.precio_final != null ? (
                        <div className="flex flex-col items-end leading-tight">
                          {g.desglose.descuentos.length > 0 && g.precio_lista != null && (
                            <span className="text-xs text-muted line-through">
                              {money(g.precio_lista)}
                            </span>
                          )}
                          <span>{money(g.precio_final)}</span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td align="right">
                      <CantidadGrupo
                        grupo={g}
                        max={stockPorGrupo[g.key]}
                        onCommit={(n) => void setCantidadGrupo(g, n)}
                        disabled={buscando}
                      />
                    </Td>
                    <Td align="right" className="font-mono font-semibold">
                      $ {g.subtotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    </Td>
                    <Td align="right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => quitarGrupo(g)}
                      >
                        Quitar
                      </Button>
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
            <TFoot>
              {(totalDescuentos > 0 || totalRecargo > 0) && (
                <>
                  <Tr className="border-t">
                    <Td align="right" colSpan={3} className="px-4 pt-3 pb-1 text-sm text-muted">
                      Subtotal (precio de lista)
                    </Td>
                    <Td align="right" className="px-4 pt-3 pb-1 font-mono text-sm text-muted">
                      {money(subtotalLista)}
                    </Td>
                    <Td></Td>
                  </Tr>
                  {resumenDescuentos.map((r) => (
                    <Tr key={r.nombre + r.alcance}>
                      <Td align="right" colSpan={3} className="px-4 py-0.5 text-sm text-muted">
                        <span className="rounded bg-card-2 px-1 py-0.5 text-[10px] uppercase tracking-wide">
                          {ALCANCE_CORTO[r.alcance]}
                        </span>{' '}
                        {r.nombre}
                      </Td>
                      <Td align="right" className="px-4 py-0.5 font-mono text-sm text-ink">
                        −{money(r.total)}
                      </Td>
                      <Td></Td>
                    </Tr>
                  ))}
                  {totalDescuentos > 0 && (
                    <Tr>
                      <Td align="right" colSpan={3} className="px-4 py-0.5 text-sm font-medium text-ink">
                        Total descuentos
                      </Td>
                      <Td align="right" className="px-4 py-0.5 font-mono text-sm font-semibold text-ink">
                        −{money(totalDescuentos)}
                      </Td>
                      <Td></Td>
                    </Tr>
                  )}
                  {totalRecargo > 0 && (
                    <Tr>
                      <Td align="right" colSpan={3} className="px-4 py-0.5 pb-2 text-sm font-medium text-warn-ink">
                        Recargo · {finCuotas} cuotas
                      </Td>
                      <Td align="right" className="px-4 py-0.5 pb-2 font-mono text-sm font-semibold text-warn-ink">
                        +{money(totalRecargo)}
                      </Td>
                      <Td></Td>
                    </Tr>
                  )}
                </>
              )}
              <Tr className="border-t bg-card-2">
                <Td colSpan={3} className="font-semibold">
                  Total ({lineas.length} ítem{lineas.length === 1 ? '' : 's'})
                </Td>
                <Td align="right" className="font-mono font-semibold">
                  {money(total)}
                </Td>
                <Td></Td>
              </Tr>
            </TFoot>
          </DataTable>
        </TableFrame>
      </section>

      {/* Paso 1 (cont.) — lo que aplica a la venta completa y NO decide cómo
          se cobra. Las cuotas y el cliente viven en el paso de cobro: son
          decisiones del cierre, no de la carga del carrito, y acá sólo
          competían por atención con el buscador de productos. */}
      {/* Sin caja propia: con las cuotas y el cliente mudados al cobro, acá
          quedan un chip condicional, los descuentos y un enlace. Un panel con
          borde alrededor de eso es marco sin cuadro. */}
      <section>
        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          {/* El campo Reserva NO se elige a mano: aparece solo cuando la venta
              se enganchó a una reserva (por precarga o por cargar un ítem
              reservado). Sin eso sería una decisión más para tomar en el
              mostrador sin ningún motivo. */}
          {idReserva && (
            // `self-end` lo alinea con los inputs de los Field vecinos en vez
            // de estirarse a lo alto de la fila.
            <div className="flex items-center justify-between gap-2 self-end rounded-md border border-line-2 bg-line px-2.5 py-1.5">
              <span className="min-w-0 truncate text-xs">
                <span className="font-medium text-ink">Reserva</span>
                <span className="text-text">
                  {' '}· {reservaActual?.cliente_nombre ?? 'Mostrador'}
                </span>
                {reservaActual && (
                  <span className="text-muted">
                    {' '}· vence{' '}
                    {new Date(reservaActual.fecha_vencimiento).toLocaleDateString('es-AR')}
                  </span>
                )}
              </span>
              <Button
                variant="bare"
                type="button"
                onClick={desvincularReserva}
                disabled={pending}
                title="Quita la reserva de esta venta y vacía el carrito"
                className="shrink-0 text-xs text-muted underline-offset-2 hover:text-alerta-ink hover:underline"
              >
                Quitar
              </Button>
            </div>
          )}

          {lineas.length > 0 && (
            <DescuentosPanelSelect
              opciones={descPanel}
              seleccionados={descuentosPanel}
              onToggle={togglePanel}
              productosTotal={productosEnCarritoCount}
            />
          )}

          {/* Nota de la venta. Colapsada por defecto: se usa en una venta de
              cada veinte, y como campo fijo ocupaba una fila entera del
              bloque para quedar vacía casi siempre. */}
          <div className="sm:col-span-2 xl:col-span-4">
            {notaAbierta || observaciones ? (
              <Field htmlFor="v-obs" label="Nota">
                <Textarea
                  id="v-obs"
                  rows={2}
                  autoFocus={notaAbierta && !observaciones}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  onBlur={() => {
                    if (!observaciones.trim()) setNotaAbierta(false)
                  }}
                  placeholder="Queda guardada en la venta"
                />
              </Field>
            ) : (
              <Button
                variant="bare"
                type="button"
                onClick={() => setNotaAbierta(true)}
                className="text-xs text-muted underline-offset-2 hover:text-text hover:underline"
              >
                + Agregar nota
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Paso 2 — cobro. Desplegable en línea, no modal: acá adentro se
          eligen cuotas y cliente, y ambos re-cotizan el carrito. Un diálogo
          que tapa la tabla mientras cambian los precios de las líneas que
          está tapando obliga a cerrarlo para verificar qué pasó. */}
      {cobranzaOpen && (
        <section
          ref={cobroRef}
          className="rounded-lg border border-line-2 bg-card p-4 space-y-4"
          aria-label="Cobro"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg text-text">Cobro</h2>
            <Button
              variant="bare"
              type="button"
              onClick={() => setCobranzaOpen(false)}
              disabled={pending}
              className="text-xs text-muted underline-offset-2 hover:text-text hover:underline"
            >
              Volver al carrito
            </Button>
          </div>

          {/* ─── Paso 2 · Cliente ──────────────────────────────────────
              Va arriba de la cobranza, no al final. Antes vivía después de
              los pagos, con el argumento de que el medio de cobro decide si
              hace falta. Ya no aplica: con la deuda derivada del faltante, el
              cliente puede volverse obligatorio recién abajo, y tenerlo al
              fondo obligaba a bajar, descubrirlo y volver a subir. */}
          <div className="space-y-3 border-t border-border pt-4">
            <h3 className="text-sm font-medium text-text">Cliente</h3>
            <div className="max-w-xl">
              <div>
              <Field
                htmlFor="v-cli"
                label="Cliente"
                required={hayDeuda}
                hint="Buscá por nombre o teléfono. Vacío = Mostrador."
                error={
                  faltante === 'cliente'
                    ? 'Elegí el cliente: queda debiendo y sin esto no se sabe quién.'
                    : undefined
                }
              >
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="v-cli"
                      invalid={faltante === 'cliente'}
                      value={cliInput}
                      placeholder="— Mostrador —"
                      onChange={(e) => {
                        setCliInput(e.target.value)
                        setCliOpen(true)
                        setCliResaltado(0)
                        // Cambiar el texto invalida la selección anterior; se
                        // vuelve a Mostrador hasta que se elija de la lista.
                        if (idCliente) setIdCliente('')
                      }}
                      onFocus={() => {
                        setCliOpen(true)
                        setCliResaltado(0)
                      }}
                      onBlur={() => setTimeout(() => setCliOpen(false), 120)}
                      onKeyDown={onCliKeyDown}
                      role="combobox"
                      aria-expanded={cliOpen}
                      aria-autocomplete="list"
                      autoComplete="off"
                      disabled={pending}
                    />
                    {cliOpen && (
                      <ul
                        role="listbox"
                        className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card-2 shadow"
                      >
                        <li
                          role="option"
                          aria-selected={cliResaltado === 0}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            seleccionarCliente('', '')
                          }}
                          onMouseEnter={() => setCliResaltado(0)}
                          className={`cursor-pointer px-3 py-2 text-sm italic ${
                            cliResaltado === 0 ? 'bg-line text-text' : 'text-muted'
                          }`}
                        >
                          — Mostrador —
                        </li>
                        {cliSugerencias.length === 0 ? (
                          <li className="px-3 py-2 text-xs text-muted">Sin coincidencias</li>
                        ) : (
                          cliSugerencias.map((c, i) => {
                            const idx = i + 1 // +1 por el Mostrador
                            const activo = idx === cliResaltado
                            return (
                              <li
                                key={c.id}
                                role="option"
                                aria-selected={activo}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  seleccionarCliente(c.id, c.nombre)
                                }}
                                onMouseEnter={() => setCliResaltado(idx)}
                                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${
                                  activo ? 'bg-line text-text' : 'text-text'
                                }`}
                              >
                                <span>{c.nombre}</span>
                                {c.telefono && (
                                  <span className="shrink-0 font-mono text-xs text-muted">
                                    {c.telefono}
                                  </span>
                                )}
                              </li>
                            )
                          })
                        )}
                      </ul>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCreandoCliente((v) => !v)}
                    aria-expanded={creandoCliente}
                    disabled={pending}
                  >
                    {creandoCliente ? 'Cerrar' : '+ Nuevo'}
                  </Button>
                </div>
              </Field>

              {creandoCliente && (
                <ClienteQuickCreate className="mt-3" onCreated={clienteCreado} />
              )}
              </div>
            </div>
          </div>

          {/* ─── Paso 3 · Medios de cobro ──────────────────────────────
              Acá se decide TODO lo que depende de por dónde entra el dinero,
              incluido el plan de cuotas de cada tarjeta. El recargo del plan
              elegido ya viene dentro del total: por eso se lo desagrega
              debajo del panel, y no arriba junto a un selector que ya no
              existe. */}
          <div className="space-y-3 border-t border-border pt-4">
            <h3 className="text-sm font-medium text-text">
              {canal === 'revendedora' ? 'Cobranza' : 'Medios de cobro'}
            </h3>
            <CobranzaPanel
              cuentas={cuentas}
              pagos={pagosNormalizados}
              total={total}
              disabled={pending}
              aranceles={aranceles}
              recargos={recargos}
              planesCuotas={planesCuotas}
              onChange={setPagos}
              canal={canal}
              comisionEstimada={comisionEstimada}
            />
            {canal !== 'revendedora' && totalRecargo > 0 && (
              <p className="text-xs text-warn-ink">
                Recargo por {finCuotas} cuotas: +{money(totalRecargo)} — ya
                incluido en el total.
              </p>
            )}
            {canal !== 'revendedora' && finCuotas !== null && totalRecargo === 0 && lineas.length > 0 && (
              <p className="text-xs text-muted">
                Sin recargo configurado para este plan: se vende al precio de
                lista. Se carga en Precios y Cuentas.
              </p>
            )}
          </div>

          {/* ─── Deuda ─────────────────────────────────────────────────────
              No hay checkbox que prender: aparece SOLA cuando lo cobrado no
              llega al total. Antes era una decisión previa que se podía
              olvidar (y la deuda quedaba sin registrar) o dejar prendida por
              error (y se fiaba una venta ya cobrada). */}
          {hayDeuda && canal !== 'revendedora' && (
            <div className="space-y-3 rounded-md border border-warn/40 bg-card-2 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-text">
                  Crédito del local
                </h3>
                <span className="font-mono font-semibold text-warn-ink">
                  {money(aFinanciar)}
                </span>
              </div>

              <p className="text-xs text-muted">
                {anticipo > 0
                  ? `Paga hoy ${money(anticipo)} de ${money(total)}. El resto queda en cuenta del local.`
                  : 'Se lleva la compra sin pagar nada hoy: queda en cuenta del local.'}
              </p>

              {/* En cuántas partes lo cobra el local. Es el único lugar
                  donde se elige un plan que no pasa por ningún procesador:
                  acá el riesgo de crédito lo toma el comercio, y por eso el
                  recargo sale de su propia fila del tarifario. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  htmlFor="v-fin-cuotas"
                  label="Plan"
                  hint={
                    // Con una tarjeta en cuotas la venta YA se cotizó con el
                    // recargo de esa tarjeta: el plan del local sólo parte la
                    // deuda, no vuelve a mover el precio.
                    pagoEnCuotas
                      ? 'La venta ya se cotizó con el plan de la tarjeta. Este sólo divide la deuda.'
                      : 'El recargo del plan se suma al precio de la venta.'
                  }
                >
                  <Select
                    id="v-fin-cuotas"
                    value={cuotasLocal}
                    onChange={(e) => setCuotasLocal(Number(e.target.value))}
                    disabled={pending}
                  >
                    <option value={1}>Un pago al vencimiento</option>
                    {planesLocal.map((c) => (
                      <option key={c} value={c}>
                        {c} cuotas
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  htmlFor="v-fin-venc"
                  label="Primer vencimiento"
                  required
                  hint="Las siguientes van mes a mes desde esta fecha."
                  error={
                    faltante === 'vencimiento'
                      ? 'Poné la fecha de la primera cuota.'
                      : undefined
                  }
                >
                  <Input
                    id="v-fin-venc"
                    type="date"
                    invalid={faltante === 'vencimiento'}
                    value={finPrimerVenc}
                    onChange={(e) => {
                      setFinPrimerVenc(e.target.value)
                      if (e.target.value) {
                        setFaltante((f) => (f === 'vencimiento' ? null : f))
                      }
                    }}
                    disabled={pending}
                  />
                </Field>
              </div>

              {planPreview.length > 0 && (
                <p className="text-xs text-muted">
                  {planPreview.length}{' '}
                  {planPreview.length === 1 ? 'cuota' : 'cuotas'} de{' '}
                  <span className="font-mono">{money(planPreview[0].monto)}</span>
                  {planPreview.length > 1 &&
                    planPreview[planPreview.length - 1].monto !== planPreview[0].monto && (
                      <>
                        {' '}(la última,{' '}
                        <span className="font-mono">
                          {money(planPreview[planPreview.length - 1].monto)}
                        </span>
                        )
                      </>
                    )}{' '}
                  · del {fechaCorta(planPreview[0].vencimiento)} al{' '}
                  {fechaCorta(planPreview[planPreview.length - 1].vencimiento)}
                </p>
              )}

              {!idCliente && (
                <p className="rounded-md border border-alerta-ink bg-alerta-bg px-3 py-2 text-xs text-alerta-ink">
                  Falta el cliente: sin eso perdés el rastro de quién te debe.{' '}
                  <Button
                    variant="bare"
                    type="button"
                    onClick={() => {
                      setFaltante('cliente')
                      enfocarCampo('v-cli')
                    }}
                    className="font-medium underline underline-offset-2"
                  >
                    Elegirlo arriba
                  </Button>
                </p>
              )}
            </div>
          )}

        </section>
      )}

      {/* Barra de acción: queda pegada abajo mientras se carga el carrito, así
          el total y el paso siguiente están siempre a un toque de distancia.
          Con el cobro abierto pasa a ser el botón de confirmar: el panel es
          largo y obligar a scrollear hasta el final para cerrar la venta es
          exactamente lo que el modal hacía bien. */}
      <Card className="sticky bottom-4 z-10 flex flex-col gap-3 shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs text-muted">
            Total · {lineas.length} ítem{lineas.length === 1 ? '' : 's'}
            {finCuotas !== null ? ` · ${finCuotas} cuotas` : ''}
          </div>
          {hayDeuda && (
            <div className="text-xs text-warn-ink">
              Queda debiendo {money(aFinanciar)}
            </div>
          )}
          <div data-testid="venta-total" className="font-mono text-xl font-semibold text-text">
            {money(total)}
          </div>
        </div>
        {cobranzaOpen ? (
          <Button
            className="w-full sm:w-auto"
            size="lg"
            type="button"
            onClick={confirmar}
            disabled={!puedeConfirmar}
          >
            {pending ? 'Registrando…' : `Confirmar venta · ${money(total)}`}
          </Button>
        ) : (
          <Button
            className="w-full sm:w-auto"
            size="lg"
            onClick={abrirCobro}
            disabled={lineas.length === 0 || pending}
          >
            Continuar al cobro
          </Button>
        )}
      </Card>
    </div>
  )
}

/**
 * NumberInput con commit debounced. Sirve para dos casos con un mismo control:
 *   - Flechas: N clicks rápidos = un solo cambio efectivo (evita N round-trips
 *     encolados y la race entre state y refetches).
 *   - Tipeo: el commit espera a que el usuario deje de tipear.
 * El blur o Enter fuerzan el commit inmediato.
 */
function CantidadGrupo({
  grupo,
  max,
  onCommit,
  disabled,
}: {
  grupo: Grupo
  /** Tope físico de unidades (producto+talle). undefined = sin dato aún. */
  max?: number
  onCommit: (nueva: number) => void
  disabled: boolean
}) {
  const [val, setVal] = useState<number>(grupo.cantidad)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // El carrito es la fuente de verdad: si la cantidad real cambió (commit
  // aplicado, o el server no pudo dar todas las unidades pedidas), el input
  // se realinea. Patrón "ajustar estado durante el render", no un efecto.
  const [cantidadVista, setCantidadVista] = useState(grupo.cantidad)
  if (cantidadVista !== grupo.cantidad) {
    setCantidadVista(grupo.cantidad)
    setVal(grupo.cantidad)
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Clamp al tope: nunca dejamos elegir más unidades de las que hay en stock.
  // Si aún no llegó el dato de stock, no topeamos (el server igual valida).
  function clamp(n: number): number {
    const piso = Math.max(0, Math.floor(n || 0))
    return max != null ? Math.min(piso, max) : piso
  }

  function schedule(nueva: number) {
    const n = clamp(nueva)
    setVal(n)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onCommit(n), 250)
  }

  function commitNow(nueva: number) {
    if (timer.current) clearTimeout(timer.current)
    const n = clamp(nueva)
    if (n !== val) setVal(n)
    if (n !== grupo.cantidad) onCommit(n)
  }

  const enTope = max != null && grupo.cantidad >= max

  return (
    <div className="flex flex-col items-end gap-0.5">
      <NumberInput
        min={0}
        max={max}
        value={val}
        disabled={disabled}
        onChange={(e) => schedule(Number(e.target.value || 0))}
        onBlur={() => commitNow(val)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitNow(val)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        aria-label="Cantidad"
        className="w-16 text-right"
      />
      {enTope && (
        <span className="text-[10px] text-muted">
          {max === 1 ? 'Única unidad' : `Máx. ${max}`}
        </span>
      )}
    </div>
  )
}

/** $ con 2 decimales, formato es-AR. */
function money(n: number): string {
  return `$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

/** Etiqueta corta del valor de un descuento: "15%" o "$ 500,00". */
function descValorLabel(d: { tipo_valor: string; valor: number }): string {
  return d.tipo_valor === 'porcentaje'
    ? `${(d.valor * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`
    : money(d.valor)
}

const ALCANCE_CORTO: Record<string, string> = {
  global: 'Global',
  categoria: 'Categoría',
  proveedor: 'Proveedor',
  producto: 'Producto',
}

/**
 * Descuentos de una fila del carrito. Muestra:
 *   - chips seleccionables de los descuentos de alcance=producto disponibles,
 *   - el listado de TODOS los descuentos aplicados a la línea con su impacto,
 *   - un aviso si se combinan dos o más descuentos NO acumulables (modelo
 *     "avisar, no bloquear": el vendedor decide igual).
 */
function LineaDescuentos({
  grupo,
  disponibles,
  seleccionados,
  onToggle,
  disabled,
}: {
  grupo: Grupo
  disponibles: DescuentoDisponible[]
  seleccionados: Set<string>
  onToggle: (idRegla: string) => void
  disabled: boolean
}) {
  const aplicados = grupo.desglose.descuentos
  const noAcumulables = aplicados.filter((d) => !d.acumulable).length
  if (disponibles.length === 0 && aplicados.length === 0) return null

  return (
    <div className="mt-2 space-y-1.5">
      {disponibles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Descuento de producto:</span>
          {disponibles.map((d) => {
            const activo = seleccionados.has(d.id_regla)
            return (
              <button
                key={d.id_regla}
                type="button"
                disabled={disabled}
                onClick={() => onToggle(d.id_regla)}
                aria-pressed={activo}
                className={`rounded-full border px-2 py-0.5 text-xs transition disabled:opacity-50 ${
                  activo
                    ? 'border-ink bg-hover text-ink'
                    : 'border-border bg-card text-text hover:border-ink'
                }`}
                title={activo ? 'Quitar descuento' : 'Aplicar descuento'}
              >
                {activo ? '✓ ' : ''}
                {d.nombre} · −{descValorLabel(d)}
              </button>
            )
          })}
        </div>
      )}

      {aplicados.length > 0 && (
        <ul className="space-y-0.5">
          {aplicados.map((d) => (
            <li
              key={d.id_regla}
              className="flex items-center justify-between gap-2 text-xs text-muted"
            >
              <span>
                <span className="rounded bg-card-2 px-1 py-0.5 text-[10px] uppercase tracking-wide">
                  {ALCANCE_CORTO[d.alcance]}
                </span>{' '}
                {d.nombre}
                {!d.acumulable && ' · no acumulable'}
              </span>
              <span className="font-mono text-ink">−{money(d.monto)}</span>
            </li>
          ))}
        </ul>
      )}

      {noAcumulables >= 2 && (
        <div className="text-xs text-warn-ink">
          Estás combinando {noAcumulables} descuentos marcados como no
          acumulables. Se aplican igual — revisá que sea lo que querés.
        </div>
      )}
    </div>
  )
}

/**
 * Selector de descuentos global/categoría/proveedor como desplegable
 * multi-select (acumulable: se pueden tildar varios). Muestra chips de los
 * activos debajo del botón, visibles aunque el desplegable esté cerrado.
 */
function DescuentosPanelSelect({
  opciones,
  seleccionados,
  onToggle,
  productosTotal,
}: {
  opciones: Array<{ d: DescuentoDisponible; productos: Set<string> }>
  seleccionados: Set<string>
  onToggle: (idRegla: string) => void
  productosTotal: number
}) {
  const [open, setOpen] = useState(false)
  const activos = opciones.filter((o) => seleccionados.has(o.d.id_regla))

  return (
    <div>
      <div className="mb-1 text-sm font-medium">Descuentos de la venta</div>
      {opciones.length === 0 ? (
        <p className="text-xs text-muted">
          No hay descuentos globales, de categoría o de proveedor para estos
          productos. Los de producto se eligen en cada fila.
        </p>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <span className={activos.length ? 'text-text' : 'text-muted'}>
              {activos.length === 0
                ? 'Elegí descuentos…'
                : `${activos.length} descuento${activos.length === 1 ? '' : 's'} aplicado${activos.length === 1 ? '' : 's'}`}
            </span>
            <span className="text-muted">▾</span>
          </button>

          {open && (
            <>
              {/* Backdrop para cerrar al clickear afuera (queda detrás de la lista). */}
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <ul
                role="listbox"
                aria-multiselectable="true"
                className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card-2 shadow"
              >
                {opciones.map(({ d, productos }) => {
                  const activo = seleccionados.has(d.id_regla)
                  return (
                    <li
                      key={d.id_regla}
                      role="option"
                      aria-selected={activo}
                      onClick={() => onToggle(d.id_regla)}
                      className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm ${
                        activo ? 'bg-line' : 'hover:bg-card'
                      }`}
                    >
                      <span className="mt-0.5 w-4 shrink-0 text-ink">
                        {activo ? '✓' : ''}
                      </span>
                      <span className="flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{d.nombre}</span>
                          <span className="font-mono text-xs text-ink">
                            −{descValorLabel(d)}
                          </span>
                        </span>
                        <span className="text-xs text-muted">
                          {ALCANCE_CORTO[d.alcance]}
                          {productos.size < productosTotal
                            ? ` · ${productos.size} de ${productosTotal} productos`
                            : ' · todo el carrito'}
                          {!d.acumulable ? ' · no acumulable' : ''}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {activos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activos.map(({ d }) => (
                <span
                  key={d.id_regla}
                  className="inline-flex items-center gap-1 rounded-full border border-ink bg-line px-2 py-0.5 text-xs text-ink"
                >
                  {d.nombre} · −{descValorLabel(d)}
                  <IconButton
                    size="sm"
                    type="button"
                    onClick={() => onToggle(d.id_regla)}
                    aria-label={`Quitar ${d.nombre}`}
                  >
                    ×
                  </IconButton>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Motivos de rechazo del lookup que se destraban enganchando la venta a la
 * reserva que está bloqueando las unidades.
 */
function esReasonDeReserva(reason: string): boolean {
  return (
    reason === 'item-en-reserva' ||
    reason === 'item-ya-reservado' ||
    reason === 'sku-sin-stock-libre'
  )
}


/** Hoy + 1 mes, en ISO local. Default razonable del primer vencimiento. */
function enUnMes(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toLocaleDateString('en-CA')
}

function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** `2026-09-10` → `10/09`. Para el resumen del plan, donde el año es ruido. */
function fechaCorta(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}
