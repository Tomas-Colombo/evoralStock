'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
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
import type { CategoriaRow, ProveedorRow } from '@/lib/types/inventario'
import { buscarMatchNombre, indexarPorNombre } from '@/lib/inventario/producto-match'
import { createProductoAction } from '../../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { Select } from '@/components/ui/Select'

export function NuevoProductoForm({
  categorias,
  productos,
  proveedores,
  cotizacion,
  onSuccess,
  onCancel,
}: {
  categorias: CategoriaRow[]
  productos: Array<{ nombre: string }>
  proveedores: ProveedorRow[]
  cotizacion?: { valor: number; fechaValor?: string | null; desactualizada?: boolean } | null
  onSuccess?: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [nombre, setNombre] = useState('')
  const [idCategoria, setIdCategoria] = useState(categorias[0]?.id_categoria ?? '')
  const [idProveedor, setIdProveedor] = useState('')
  const [stockMinimo, setStockMinimo] = useState('0')
  const [descripcion, setDescripcion] = useState('')
  const [costoInicial, setCostoInicial] = useState('')
  const [moneda, setMoneda] = useState('ARS')
  const [stock, setStock] = useState<LineaTalle[]>([])
  const [stockTotalDeclarado, setStockTotalDeclarado] = useState('')

  const stockCargado = stock.reduce((a, l) => a + l.cantidad, 0)
  const totalDeclaradoNum = stockTotalDeclarado === '' ? null : Number(stockTotalDeclarado)
  const excesoStock = totalDeclaradoNum != null && totalDeclaradoNum > 0 && stockCargado > totalDeclaradoNum
  const faltanTalles =
    totalDeclaradoNum != null && totalDeclaradoNum > 0 && stockCargado > 0 && stockCargado < totalDeclaradoNum

  const [errors, setErrors] = useState<{ nombre?: string; categoria?: string }>({})

  // Talles disponibles según la categoría elegida.
  const tallesCategoria = categorias.find((c) => c.id_categoria === idCategoria)?.talles ?? []

  // Índice nombre-normalizado → producto existente, para bloquear duplicados.
  const indexNombres = useMemo(() => indexarPorNombre(productos), [productos])
  const nombreDuplicado = buscarMatchNombre(indexNombres, nombre)

  const costoNum = Number(costoInicial || 0)
  const estimadoArs =
    moneda === 'USD' && cotizacion?.valor && costoNum > 0
      ? Math.round(costoNum * cotizacion.valor * 100) / 100
      : null

  const hintCosto =
    moneda === 'USD'
      ? cotizacion?.valor
        ? `Cotización oficial: $ ${cotizacion.valor.toLocaleString('es-AR', {
            minimumFractionDigits: 2,
          })}.${
            estimadoArs != null
              ? ` Estimado: $ ${estimadoArs.toLocaleString('es-AR', {
                  minimumFractionDigits: 2,
                })} ARS.`
              : ''
          }`
        : 'Cotización del dólar no disponible.'
      : 'Se historiza; se puede cambiar luego'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (nombre.trim().length < 2) errs.nombre = 'Mínimo 2 caracteres'
    else if (nombreDuplicado) errs.nombre = 'Ya existe un producto con ese nombre'
    if (!idCategoria) errs.categoria = 'Elegí una categoría'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    if (excesoStock) return

    // Si declararon un total mayor a la suma de talles, el resto se registra sin talle.
    const stockFinal: LineaTalle[] =
      totalDeclaradoNum != null && totalDeclaradoNum > stockCargado
        ? (() => {
            const diff = totalDeclaradoNum - stockCargado
            const idx = stock.findIndex((l) => l.talle === null)
            if (idx >= 0) return stock.map((l, i) => (i === idx ? { ...l, cantidad: l.cantidad + diff } : l))
            return [...stock, { talle: null, cantidad: diff }]
          })()
        : stock

    start(async () => {
      const res = await createProductoAction({
        idCategoria,
        nombre,
        sku: null, // el SKU se autogenera en la DB (sp_gen_sku)
        stockMinimo: Number(stockMinimo || 0),
        descripcion: descripcion || null,
        costoInicial: costoInicial ? Number(costoInicial) : null,
        moneda,
        idProveedor: idProveedor || null,
        stock: stockFinal,
      })
      if (!res.ok) return toast.error('No se pudo crear', mensajeDeError(res.reason))
      const items = res.data?.itemsCreados ?? 0
      toast.success('Producto creado', items > 0 ? `${items} ítem(s) de stock generados` : undefined)
      if (res.data?.cotizacionDesactualizada) {
        toast.info(
          'Cotización desactualizada',
          'La cotización oficial del BCRA no se encuentra al día; se utilizó el último valor disponible.',
        )
      }
      if (onSuccess) {
        onSuccess()
      } else {
        router.push('/inventario')
      }
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field
        htmlFor="prod-nombre"
        label="Nombre"
        required
        error={errors.nombre ?? (nombreDuplicado ? 'Ya existe un producto con ese nombre' : undefined)}
      >
        <Input
          id="prod-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoFocus
          invalid={!!errors.nombre || !!nombreDuplicado}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="prod-cat" label="Categoría" required error={errors.categoria}>
          <Select
            id="prod-cat"
            value={idCategoria}
            onChange={(e) => {
              setIdCategoria(e.target.value)
              setStock([]) // los talles son propios de cada categoría
            }}
            aria-invalid={!!errors.categoria || undefined}
          >
            {categorias.map((c) => (
              <option key={c.id_categoria} value={c.id_categoria}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <p className="rounded-md border border-border bg-card-2 p-3 text-xs text-muted">
            El <b>SKU</b> se genera automáticamente al crear (ej: <span className="font-mono">REM-0007</span>).
            No hace falta cargarlo a mano.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="prod-stock" label="Stock mínimo">
          <NumberInput
            id="prod-stock"
            min={0}
            value={stockMinimo}
            onChange={(e) => setStockMinimo(e.target.value)}
          />
        </Field>
        <Field htmlFor="prod-costo" label="Costo inicial" hint={hintCosto}>
          <div className="flex gap-2">
            <NumberInput
              id="prod-costo"
              thousands
              value={costoInicial}
              onChange={(e) => setCostoInicial(e.target.value)}
              className="flex-1"
            />
            <Select
              value={moneda}
              onChange={(e) => setMoneda(e.target.value)}
              aria-label="Moneda"
              className="w-auto"
            >
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </Select>
          </div>
        </Field>
      </div>

      {proveedores.length > 0 && (
        <Field
          htmlFor="prod-proveedor"
          label="Proveedor (opcional)"
          hint="Si elegís uno, el stock inicial se registra como un ingreso de compra a ese proveedor."
        >
          <Select
            id="prod-proveedor"
            value={idProveedor}
            onChange={(e) => setIdProveedor(e.target.value)}
          >
            <option value="">Sin proveedor (alta directa)</option>
            {proveedores.map((p) => (
              <option key={p.id_proveedor} value={p.id_proveedor}>
                {p.nombre} · {p.tipo}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field
        htmlFor="prod-stock-total"
        label="Stock total inicial (opcional)"
        hint="Si lo cargás, se usa como referencia y avisa si no coincide con la suma de talles. Si lo dejás vacío, se calcula automáticamente."
      >
        <NumberInput
          id="prod-stock-total"
          min={0}
          max={MAX_UNIDADES_LINEA}
          step={1}
          value={stockTotalDeclarado}
          onChange={(e) => setStockTotalDeclarado(clampUnidades(e.target.value))}
          placeholder={stockCargado > 0 ? `${stockCargado} (auto)` : '0'}
        />
      </Field>

      <Field
        htmlFor="prod-stock-inicial"
        label="Stock por talle (opcional)"
        hint={
          tallesCategoria.length > 0
            ? faltanTalles
              ? `Cargaste ${stockCargado} de ${totalDeclaradoNum}. Las ${
                  (totalDeclaradoNum ?? 0) - stockCargado
                } unidades restantes se registran sin talle.`
              : 'Cargá cuántas unidades de cada talle tenés (ej: 2 S, 2 XL). El resto se registra sin talle.'
            : 'Esta categoría no tiene talles. Podés cargar unidades sin talle, o definí talles en la categoría.'
        }
        error={
          excesoStock
            ? `La suma de talles (${stockCargado}) supera el stock total declarado (${totalDeclaradoNum}). Quitá unidades o subí el total.`
            : undefined
        }
      >
        <StockTalleLoader talles={tallesCategoria} value={stock} onChange={setStock} disabled={pending} />
      </Field>

      <Field htmlFor="prod-desc" label="Descripción">
        <Textarea
          id="prod-desc"
          rows={3}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel ?? (() => router.back())} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || !!nombreDuplicado || excesoStock}>
          {pending ? 'Guardando…' : 'Crear producto'}
        </Button>
      </div>
    </form>
  )
}
