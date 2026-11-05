'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import {
  clampUnidades,
  MAX_UNIDADES_LINEA,
  StockTalleLoader,
  type LineaTalle,
} from '@/components/inventario/StockTalleLoader'
import type {
  CategoriaRow,
  ProductoConDetalle,
  ProveedorRow,
  TipoIngreso,
  TipoProveedor,
} from '@/lib/types/inventario'
import { buscarMatchNombre, indexarPorNombre } from '@/lib/inventario/producto-match'
import { sugerirCategoria } from '@/lib/inventario/categoria-match'
import { MAX_PDF_BYTES } from '@/lib/inventario/limites'
import { crearIngresoCompletoAction, parseRemitoPdfAction } from '../../actions'
import { NuevoProveedorModal } from '@/components/inventario/NuevoProveedorModal'
import { NuevaCategoriaModal } from './NuevaCategoriaModal'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { IconButton } from '@/components/ui/IconButton'
import { Select } from '@/components/ui/Select'
import { Card } from '@/components/ui/Card'

const TIPOS: { value: TipoIngreso; label: string }[] = [
  { value: 'compra', label: 'Compra (paga al ingresar)' },
  { value: 'consignacion', label: 'Consignación (paga al vender)' },
]

/** Valor sentinela del select de categoría: abre el alta rápida de categoría. */
const NUEVA_CATEGORIA = '__nueva__'

/** Línea en edición: producto (nuevo o vinculado) + cantidad + costo + talles. */
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

/**
 * Alta de ingreso en UNA sola pantalla: cabecera (proveedor/tipo/remito/obs) +
 * carga de productos (por PDF o a mano) juntas. Las líneas viven en estado
 * hasta «Guardar»; ahí, tras confirmar la advertencia, se crea + importa +
 * confirma en un solo flujo (no quedan borradores).
 */
export function NuevoIngresoView({
  proveedores: proveedoresIniciales,
  productos,
  categorias: categoriasIniciales,
  prefill,
  tiposIngreso,
  tiposProveedor,
  cotizacion,
}: {
  proveedores: ProveedorRow[]
  productos: ProductoConDetalle[]
  categorias: CategoriaRow[]
  /** Modo restock: llega desde /inventario/ingresos/nuevo?producto=<id> y
   *  bloquea el proveedor + agrega una línea vinculada al producto. */
  prefill?: {
    idProducto: string
    idProveedor: string | null
    /** Tipo del último ingreso — default del select, editable. */
    tipoIngreso: TipoIngreso
    /** Costo del último ingreso — default del input, editable. */
    costoUnitario: number | null
  } | null
  tiposIngreso: readonly TipoIngreso[]
  tiposProveedor: readonly TipoProveedor[]
  cotizacion?: { valor: number; fechaValor?: string | null; desactualizada?: boolean } | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  // ─── Cabecera ──────────────────────────────────────────────────────
  const [moneda, setMoneda] = useState<'ARS' | 'USD'>('ARS')
  const [proveedores, setProveedores] = useState(proveedoresIniciales)
  // Arranca SIEMPRE en "sin proveedor" para evitar cargar a un proveedor por
  // descuido; el usuario lo elige explícitamente. Vacío = sin proveedor.
  // En modo restock, arranca con el proveedor habitual del producto y queda
  // bloqueado (regla de negocio: cada producto es mono-proveedor).
  const [idProveedor, setIdProveedor] = useState(prefill?.idProveedor ?? '')
  const proveedorBloqueado = !!prefill?.idProveedor
  const soloCompra = tiposIngreso.length === 1 && tiposIngreso[0] === 'compra'
  // Sin valor por defecto en alta normal — «compra» y «consignación» pagan
  // en momentos distintos, así que el usuario tiene que elegirlo. Si solo
  // hay 'compra', queda fijo en 'compra' y no se muestra el selector.
  // En modo restock arranca con el tipo del último ingreso del producto (editable).
  const [tipoIngreso, setTipoIngreso] = useState<TipoIngreso | ''>(() => {
    if (soloCompra) return 'compra'
    if (prefill?.tipoIngreso && tiposIngreso.includes(prefill.tipoIngreso)) {
      return prefill.tipoIngreso
    }
    return ''
  })
  const [numeroRemito, setNumeroRemito] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  // Categorías en estado: el alta rápida (modal) agrega una sin recargar.
  const [categorias, setCategorias] = useState(categoriasIniciales)

  // ─── Líneas ────────────────────────────────────────────────────────
  const [filas, setFilas] = useState<Fila[]>(() => {
    if (!prefill?.idProducto) return []
    const prod = productos.find((p) => p.id_producto === prefill.idProducto)
    if (!prod) return []
    return [
      {
        nombre: prod.nombre,
        cantidad: '1',
        // Prefill del costo: el del último ingreso si viene en el prefill del
        // restock; si no, el costo vigente del producto. Editable siempre.
        costoUnitario:
          prefill.costoUnitario != null
            ? String(prefill.costoUnitario)
            : prod.costo_vigente != null
              ? String(prod.costo_vigente)
              : '',
        esNuevo: false,
        idProducto: prod.id_producto,
        idCategoria: '',
        talles: [],
        tallesAbierto: false,
      },
    ]
  })
  const [advertencias, setAdvertencias] = useState<string[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Índice de la fila que disparó el alta de categoría (null = modal cerrado).
  const [nuevaCatParaFila, setNuevaCatParaFila] = useState<number | null>(null)

  // Índice nombre-normalizado → producto existente, para auto-match.
  const porNombre = useMemo(() => indexarPorNombre(productos), [productos])
  /** Producto existente con el mismo nombre que la fila (match vivo). */
  const matchDe = (f: Fila) => buscarMatchNombre(porNombre, f.nombre)

  const tallesDeCategoria = (idCat?: string | null) =>
    categorias.find((c) => c.id_categoria === idCat)?.talles ?? []

  /** Talles disponibles para una fila según su categoría (nueva o vinculada). */
  function tallesDisponibles(f: Fila): string[] {
    if (f.esNuevo) return tallesDeCategoria(f.idCategoria)
    const cat = productos.find((p) => p.id_producto === f.idProducto)?.categoria?.id_categoria
    return tallesDeCategoria(cat)
  }

  const totalUnidades = filas.reduce((a, f) => a + Number(f.cantidad || 0), 0)
  const totalCosto = filas.reduce(
    (a, f) => a + Number(f.cantidad || 0) * Number(f.costoUnitario || 0),
    0,
  )

  function onProveedorCreado(nuevo: ProveedorRow) {
    setProveedores((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    setIdProveedor(nuevo.id_proveedor)
    setModalOpen(false)
  }

  function agregarFila() {
    setFilas((fs) => [
      ...fs,
      {
        nombre: '',
        cantidad: '1',
        costoUnitario: '',
        esNuevo: true,
        idProducto: '',
        idCategoria: '', // sin sugerencia hasta que haya nombre
        talles: [],
        tallesAbierto: false,
      },
    ])
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Se corta acá para no subir al pedo: por encima del límite de Server
    // Actions el request muere en el framework con un error ilegible.
    if (file.size > MAX_PDF_BYTES) {
      if (fileRef.current) fileRef.current.value = ''
      return toast.error(
        'El PDF es muy grande',
        `Pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es ${MAX_PDF_BYTES / 1024 / 1024} MB.`,
      )
    }
    const fd = new FormData()
    fd.append('file', file)
    start(async () => {
      const res = await parseRemitoPdfAction(fd)
      if (fileRef.current) fileRef.current.value = ''
      if (!res.ok) return toast.error('No se pudo leer el PDF', mensajeDeError(res.reason))
      const parsed = res.data!
      if (parsed.lineas.length === 0) {
        toast.error('No se detectaron productos', parsed.advertencias[0] ?? 'Revisá el formato del PDF')
        return
      }
      // Cada renglón del PDF se suma a lo que ya haya cargado. Si el nombre
      // matchea un producto existente, arranca en «Vincular»; si no, es nuevo.
      setFilas((fs) => [
        ...fs,
        ...parsed.lineas.map((l) => {
          const match = buscarMatchNombre(porNombre, l.nombre)
          return {
            nombre: l.nombre,
            cantidad: String(l.cantidad),
            costoUnitario: String(l.costoUnitario),
            esNuevo: !match,
            idProducto: match?.id_producto ?? '',
            // Producto nuevo: sugerimos categoría por el nombre; vinculado: da igual.
            idCategoria: sugerirCategoria(l.nombre, categorias) ?? '',
            talles: [] as LineaTalle[],
            tallesAbierto: false,
          }
        }),
      ])
      setAdvertencias(parsed.advertencias)
    })
  }

  function actualizar(i: number, patch: Partial<Fila>) {
    setFilas((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  // Al editar el nombre: si pasa a coincidir con un producto existente,
  // destildamos "es nuevo" y lo vinculamos automáticamente. Si es nuevo,
  // resugerimos la categoría según el nombre (anillo → anillos, etc.); sin
  // coincidencia se conserva la que eligió el usuario. Solo reseteamos talles
  // si la categoría efectivamente cambió.
  function cambiarNombre(i: number, nombre: string) {
    setFilas((fs) =>
      fs.map((f, idx) => {
        if (idx !== i) return f
        const match = buscarMatchNombre(porNombre, nombre)
        if (match) return { ...f, nombre, esNuevo: false, idProducto: match.id_producto }
        if (!f.esNuevo) return { ...f, nombre }
        const idCategoria = sugerirCategoria(nombre, categorias) ?? f.idCategoria
        return idCategoria === f.idCategoria
          ? { ...f, nombre }
          : { ...f, nombre, idCategoria, talles: [], tallesAbierto: false }
      }),
    )
  }

  // En modo «Vincular» el producto elegido manda: el nombre lo aporta el
  // producto (no hay input de texto) y el costo arranca en el costo vigente
  // —el de la última compra— como valor por defecto editable.
  function vincularProducto(i: number, idProducto: string) {
    const prod = productos.find((p) => p.id_producto === idProducto)
    setFilas((fs) =>
      fs.map((f, idx) =>
        idx === i
          ? {
              ...f,
              esNuevo: false,
              idProducto,
              nombre: prod?.nombre ?? '',
              costoUnitario:
                prod?.costo_vigente != null ? String(prod.costo_vigente) : f.costoUnitario,
              talles: [],
              tallesAbierto: false,
            }
          : f,
      ),
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

  /** Valida las líneas; devuelve false y muestra el toast si algo falla. */
  function lineasValidas(): boolean {
    if (filas.length === 0) {
      toast.error('Agregá al menos un producto')
      return false
    }
    for (const f of filas) {
      // En «Vincular» el nombre viene del producto elegido: el error útil es
      // «falta elegir el producto», no «falta el nombre».
      if (!f.esNuevo && !f.idProducto) {
        toast.error('Elegí un producto en todas las líneas')
        return false
      }
      if (!f.nombre.trim()) {
        toast.error('Hay una línea sin nombre')
        return false
      }
      if (Number(f.cantidad || 0) <= 0) {
        toast.error('Cantidad inválida', f.nombre)
        return false
      }
      // Invariante: es nuevo → nombre único. Si el nombre ya existe, hay que
      // cambiarlo o vincularlo, no crear un duplicado.
      if (f.esNuevo && matchDe(f)) {
        toast.error('Ese nombre ya existe', `Cambiá el nombre de "${f.nombre}" o usá «Vincular»`)
        return false
      }
      if (f.esNuevo && !f.idCategoria) {
        toast.error('Elegí la categoría', f.nombre)
        return false
      }
    }
    return true
  }

  function onGuardar() {
    if (!tipoIngreso) {
      toast.error('Elegí el tipo de ingreso', 'Compra o consignación')
      return
    }
    if (!lineasValidas()) return
    setConfirmOpen(true)
  }

  function guardar() {
    if (!tipoIngreso) return
    setConfirmOpen(false)
    start(async () => {
      const res = await crearIngresoCompletoAction({
        idProveedor: idProveedor || null,
        tipoIngreso,
        numeroRemito: numeroRemito || null,
        observaciones: observaciones || null,
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
      if (!res.ok) return toast.error('No se pudo crear el ingreso', mensajeDeError(res.reason))
      toast.success('Ingreso confirmado', `Se generaron ${res.data!.itemsGenerados} ítems con QR único`)
      if (res.data?.cotizacionDesactualizada) {
        toast.info(
          'Cotización desactualizada',
          'La cotización oficial del BCRA no se encuentra al día; se utilizó el último valor disponible.',
        )
      }
      router.push(`/inventario/ingresos/${res.data!.id}`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* ─── Cabecera ─────────────────────────────────────────────── */}
      <Card padding="none" className="p-6 space-y-4">
        <h2 className="text-sm font-semibold">Datos del ingreso</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            htmlFor="i-prov"
            label="Proveedor"
            hint={
              proveedorBloqueado
                ? 'Proveedor del producto — no se puede cambiar en un restock (regla mono-proveedor).'
                : 'Opcional: dejá «Sin proveedor» para producción propia, ofertas o ajustes.'
            }
          >
            <div className="flex gap-2">
              <Select
                id="i-prov"
                value={idProveedor}
                onChange={(e) => setIdProveedor(e.target.value)}
                disabled={proveedorBloqueado || pending}
                className="min-w-0 flex-1"
              >
                <option value="">— Sin proveedor —</option>
                {proveedores.map((p) => (
                  <option key={p.id_proveedor} value={p.id_proveedor}>
                    {p.nombre} · {p.tipo}
                  </option>
                ))}
              </Select>
              {!proveedorBloqueado && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setModalOpen(true)}
                  disabled={pending}
                >
                  + Nuevo
                </Button>
              )}
            </div>
          </Field>

          <Field htmlFor="i-remito" label="Número de remito/factura" hint="Opcional. Único por proveedor.">
            <Input
              id="i-remito"
              value={numeroRemito}
              onChange={(e) => setNumeroRemito(e.target.value)}
            />
          </Field>

          {!soloCompra && (
            <Field htmlFor="i-tipo" label="Tipo de ingreso" required>
              <Select
                id="i-tipo"
                value={tipoIngreso}
                onChange={(e) => setTipoIngreso(e.target.value as TipoIngreso)}
              >
                <option value="" disabled>
                  — Elegí el tipo —
                </option>
                {TIPOS.filter((t) => tiposIngreso.includes(t.value)).map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            htmlFor="i-moneda"
            label="Moneda del comprobante"
            hint={
              moneda === 'USD'
                ? cotizacion?.valor
                  ? `Cotización oficial: $ ${cotizacion.valor.toLocaleString('es-AR', {
                      minimumFractionDigits: 2,
                    })}. Los valores en pesos se calculan como referencia.`
                  : 'Cotización del dólar no disponible.'
                : 'Comprobante en pesos argentinos (una moneda por comprobante).'
            }
          >
            <Select
              id="i-moneda"
              value={moneda}
              onChange={(e) => setMoneda(e.target.value as 'ARS' | 'USD')}
              disabled={pending}
            >
              <option value="ARS">ARS (Pesos)</option>
              <option value="USD">USD (Dólares)</option>
            </Select>
          </Field>

          <Field htmlFor="i-obs" label="Observaciones">
            <Textarea
              id="i-obs"
              rows={1}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      {/* ─── Productos ────────────────────────────────────────────── */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Productos</h2>
            <p className="text-xs text-muted">
              Cargá las líneas desde el remito en PDF o a mano. Podés combinar ambas.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                onChange={handleFile}
                disabled={pending}
                className="hidden"
              />
              <span className="inline-flex cursor-pointer items-center rounded-md border border-border bg-card-2 px-4 py-2 text-sm hover:bg-card">
                {pending ? 'Leyendo…' : 'Importar PDF'}
              </span>
            </label>
            <Button variant="secondary" size="sm" onClick={agregarFila} disabled={pending}>
              + Agregar producto
            </Button>
          </div>
        </div>

        {filas.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card-2 px-4 py-8 text-center text-sm text-muted">
            Todavía no cargaste productos. Importá un PDF o agregá uno a mano.
          </div>
        ) : (
          <div className="space-y-2">
            {filas.map((f, i) => {
              const talles = tallesDisponibles(f)
              const conTalles = f.talles.length > 0
              const cantNum = Number(f.cantidad || 0)
              const match = matchDe(f)
              return (
                <div key={i} className="rounded-lg border border-border bg-card-2 px-3 py-2.5">
                  {/* Fila única: nombre · nuevo/vincular · categoría/producto · cantidad · precio · quitar */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {/* En «Vincular» el nombre lo define el select de abajo: no
                        duplicamos el dato con un input de texto. */}
                    {f.esNuevo && (
                      <Input
                        value={f.nombre}
                        onChange={(e) => cambiarNombre(i, e.target.value)}
                        placeholder="Producto"
                        className="min-w-[9rem] flex-[2]"
                      />
                    )}

                    <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border text-xs">
                      <button
                        type="button"
                        onClick={() =>
                          actualizar(i, {
                            esNuevo: true,
                            idCategoria: sugerirCategoria(f.nombre, categorias) ?? '',
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
                        onClick={() => vincularProducto(i, match?.id_producto ?? f.idProducto)}
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
                        onChange={(e) => {
                          // Última opción: abre el alta rápida para esta fila y
                          // deja el select en su valor previo (no en el sentinela).
                          if (e.target.value === NUEVA_CATEGORIA) {
                            setNuevaCatParaFila(i)
                            return
                          }
                          actualizar(i, { idCategoria: e.target.value, talles: [], tallesAbierto: false })
                        }}
                        aria-label="Categoría del producto nuevo"
                        className="min-w-[8rem] flex-1"
                      >
                        {/* Sin esta opción el select mostraba la primera categoría
                            mientras el estado seguía en '' y el submit la rechazaba. */}
                        <option value="" disabled>
                          Elegí una categoría
                        </option>
                        {categorias.map((c) => (
                          <option key={c.id_categoria} value={c.id_categoria}>
                            {c.nombre}
                          </option>
                        ))}
                        <option value={NUEVA_CATEGORIA}>+ Nueva categoría…</option>
                      </Select>
                    ) : (
                      <Select
                        value={f.idProducto}
                        onChange={(e) => vincularProducto(i, e.target.value)}
                        aria-label="Producto existente"
                        className="min-w-[12rem] flex-[3]"
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
                      {moneda === 'USD' && cotizacion?.valor && Number(f.costoUnitario || 0) > 0 && (
                        <span className="text-xs text-muted shrink-0">
                          ≈ ${Math.round(Number(f.costoUnitario) * cotizacion.valor).toLocaleString('es-AR')} ARS
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
        )}

        {advertencias.length > 0 && (
          <div className="rounded-md border border-border bg-card-2 p-3 text-xs text-muted">
            <div className="mb-1 font-medium text-text">
              Renglones del PDF que no pude interpretar ({advertencias.length}):
            </div>
            <ul className="list-disc space-y-0.5 pl-4">
              {advertencias.map((a, i) => (
                <li key={i} className="font-mono">{a}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ─── Guardar ──────────────────────────────────────────────── */}
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted">
          {filas.length > 0 ? (
            <>
              <b>{totalUnidades}</b> ítem(s) · total{' '}
              {moneda === 'USD' ? (
                <>
                  <b>USD {totalCosto.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</b>
                  {cotizacion?.valor ? (
                    <>
                      {' '}(estimado{' '}
                      <b>
                        $ {Math.round(totalCosto * cotizacion.valor).toLocaleString('es-AR')} ARS
                      </b>
                      )
                    </>
                  ) : null}
                </>
              ) : (
                <b>$ {totalCosto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</b>
              )}
              . Al guardar se generan los ítems físicos con QR único.
            </>
          ) : (
            'Cargá al menos un producto para poder guardar.'
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={onGuardar} disabled={pending || filas.length === 0}>
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </Card>

      <NuevoProveedorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={onProveedorCreado}
        tiposPermitidos={tiposProveedor}
      />

      <NuevaCategoriaModal
        open={nuevaCatParaFila !== null}
        onClose={() => setNuevaCatParaFila(null)}
        onCreated={(cat) => {
          setCategorias((prev) =>
            [...prev, cat].sort((a, b) => a.nombre.localeCompare(b.nombre)),
          )
          // La asignamos a la fila que disparó el alta.
          if (nuevaCatParaFila !== null) {
            actualizar(nuevaCatParaFila, {
              idCategoria: cat.id_categoria,
              talles: [],
              tallesAbierto: false,
            })
          }
          setNuevaCatParaFila(null)
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar ingreso"
        description={`Se van a generar ${totalUnidades} ítem(s) físicos con QR único y estado disponible. Esta acción no se puede deshacer.`}
        confirmLabel="Confirmar"
        cancelLabel="Cancelar"
        onConfirm={guardar}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
