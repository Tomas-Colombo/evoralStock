'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { useToast } from '@/components/ui/Toast'
import {
  ALCANCE_LABEL,
  TIPO_REGLA_LABEL,
  type AlcanceRegla,
  type TipoRegla,
  type TipoValorRegla,
} from '@/lib/types/precios'
import { createReglaAction } from '@/app/(app)/precios/actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { Checkbox } from '@/components/ui/Checkbox'
import { Select } from '@/components/ui/Select'

export interface Ref { id: string; nombre: string; sku?: string | null }

export function NuevaReglaForm({
  categorias,
  proveedores,
  productos,
  onSuccess,
  onCancel,
}: {
  categorias: Ref[]
  proveedores: Ref[]
  productos: Ref[]
  /** Set when the form runs inside a modal: closes it instead of navigating. */
  onSuccess?: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [nombre, setNombre] = useState('')
  const [tipoRegla, setTipoRegla] = useState<TipoRegla>('descuento')
  const [tipoValor, setTipoValor] = useState<TipoValorRegla>('porcentaje')
  const [valorPct, setValorPct] = useState('')      // input en %, ej 15 → 0.15
  const [valorMonto, setValorMonto] = useState('')  // input directo en $
  const [alcance, setAlcance] = useState<AlcanceRegla>('global')
  const [idProducto, setIdProducto] = useState('')
  const [idCategoria, setIdCategoria] = useState('')
  const [idProveedor, setIdProveedor] = useState('')
  const [acumulable, setAcumulable] = useState(false)
  const [prioridad, setPrioridad] = useState('0')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [error, setError] = useState<string | null>(null)


  function handleTipoRegla(t: TipoRegla) {
    setTipoRegla(t)
    if (t !== 'descuento') setAcumulable(false)
  }
  function handleAlcance(a: AlcanceRegla) {
    setAlcance(a)
    // Limpia refs que dejan de aplicar
    if (a !== 'producto') setIdProducto('')
    if (a !== 'categoria') setIdCategoria('')
    if (a !== 'proveedor') setIdProveedor('')
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (nombre.trim().length < 2) return setError('Ponele un nombre descriptivo (min 2 chars)')

    // Validar valor
    const valorNum =
      tipoValor === 'porcentaje'
        ? Number(valorPct || 0) / 100
        : Number(valorMonto || 0)
    if (!isFinite(valorNum) || valorNum <= 0) {
      return setError('El valor tiene que ser mayor a 0')
    }
    if (tipoValor === 'porcentaje' && valorNum > 5) {
      // > 500% suele ser typo
      return setError('El porcentaje parece muy alto — verificalo')
    }

    // Validar referencia según alcance
    if (alcance === 'producto' && !idProducto) return setError('Elegí un producto')
    if (alcance === 'categoria' && !idCategoria) return setError('Elegí una categoría')
    if (alcance === 'proveedor' && !idProveedor) return setError('Elegí un proveedor')

    start(async () => {
      const res = await createReglaAction({
        nombre: nombre.trim(),
        tipo_regla: tipoRegla,
        tipo_valor: tipoValor,
        valor: valorNum,
        alcance,
        id_producto: alcance === 'producto' ? idProducto : null,
        id_categoria: alcance === 'categoria' ? idCategoria : null,
        id_proveedor: alcance === 'proveedor' ? idProveedor : null,
        // Margen y descuento nunca dependieron de la forma de pago.
        forma_pago: null,
        prioridad: Number(prioridad || 0),
        acumulable: tipoRegla === 'descuento' ? acumulable : false,
        fecha_inicio: fechaInicio || null,
        fecha_hasta: fechaHasta || null,
      })
      if (!res.ok) return toast.error('No se pudo crear', mensajeDeError(res.reason))
      toast.success('Regla creada')
      if (onSuccess) onSuccess()
      else router.push('/precios/reglas')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field htmlFor="r-nombre" label="Nombre" required>
        <Input
          id="r-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder='Ej. "Recargo 3 cuotas 25%"'
          autoFocus
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="r-tipo" label="Tipo de regla" required>
          <Select
            id="r-tipo"
            value={tipoRegla}
            onChange={(e) => handleTipoRegla(e.target.value as TipoRegla)}
          >
            {/* 'recargo' ya no se ofrece: desde 00063 el recargo por cuotas vive en
        `recargo_cuotas`, en Precios y Cuentas, donde se lo puede enfrentar
        con el arancel que pretende cubrir. El valor del enum sigue en la DB
        para que las reglas viejas se puedan seguir leyendo. */}
    {(['margen', 'descuento'] as TipoRegla[]).map((t) => (
              <option key={t} value={t}>
                {TIPO_REGLA_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>

        <Field htmlFor="r-alcance" label="Alcance" required>
          <Select
            id="r-alcance"
            value={alcance}
            onChange={(e) => handleAlcance(e.target.value as AlcanceRegla)}
          >
            {(['producto', 'categoria', 'proveedor', 'global'] as AlcanceRegla[]).map((a) => (
              <option key={a} value={a}>
                {ALCANCE_LABEL[a]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {alcance === 'producto' && (
        <Field htmlFor="r-prod" label="Producto" required>
          <Select
            id="r-prod"
            value={idProducto}
            onChange={(e) => setIdProducto(e.target.value)}
          >
            <option value="">— Elegí un producto —</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}{p.sku ? ` · ${p.sku}` : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {alcance === 'categoria' && (
        <Field htmlFor="r-cat" label="Categoría" required>
          <Select
            id="r-cat"
            value={idCategoria}
            onChange={(e) => setIdCategoria(e.target.value)}
          >
            <option value="">— Elegí una categoría —</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {alcance === 'proveedor' && (
        <Field htmlFor="r-prov" label="Proveedor" required>
          <Select
            id="r-prov"
            value={idProveedor}
            onChange={(e) => setIdProveedor(e.target.value)}
          >
            <option value="">— Elegí un proveedor —</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {tipoRegla === 'descuento' && (
        <div className="rounded-md border border-border bg-card-2 p-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={acumulable}
              onChange={(e) => setAcumulable(e.target.checked)}
            />
            Acumulable con otros descuentos
          </label>
          <p className="mt-1 text-xs text-muted">
            Ningún descuento se aplica solo: el vendedor los elige en la venta.
            Este flag no bloquea nada — si se combinan descuentos no acumulables,
            el sistema sólo avisa.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="r-tv" label="Tipo de valor" required>
          <Select
            id="r-tv"
            value={tipoValor}
            onChange={(e) => setTipoValor(e.target.value as TipoValorRegla)}
          >
            <option value="porcentaje">Porcentaje</option>
            <option value="monto_fijo">Monto fijo</option>
          </Select>
        </Field>

        {tipoValor === 'porcentaje' ? (
          <Field htmlFor="r-vpct" label="Porcentaje" required hint="Ej. 15 → 15%">
            <div className="flex items-center gap-2">
              <NumberInput
                id="r-vpct"
                min={0}
                max={500}
                step="0.01"
                value={valorPct}
                onChange={(e) => setValorPct(e.target.value)}
              />
              <span className="text-muted">%</span>
            </div>
          </Field>
        ) : (
          <Field htmlFor="r-vm" label="Monto (ARS)" required>
            <NumberInput
              id="r-vm"
              thousands
              value={valorMonto}
              onChange={(e) => setValorMonto(e.target.value)}
            />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field htmlFor="r-prio" label="Prioridad" hint="Mayor = gana">
          <NumberInput
            id="r-prio"
            value={prioridad}
            onChange={(e) => setPrioridad(e.target.value)}
          />
        </Field>
        <Field htmlFor="r-fi" label="Vigente desde">
          <Input
            id="r-fi"
            type="datetime-local"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
          />
        </Field>
        <Field htmlFor="r-fh" label="Vigente hasta">
          <Input
            id="r-fh"
            type="datetime-local"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
          />
        </Field>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-alerta-ink bg-alerta-bg px-3 py-2 text-sm text-alerta-ink"
        >
          {error}
        </div>
      )}

      <div className="rounded-md border border-border bg-card-2 p-3 text-xs text-muted">
        Recordatorio: los <b>valores</b> de una regla no se editan después
        (solo nombre / extender vigencia / dar de baja). Si necesitás
        cambiar un %, dá de baja esta y creá una nueva.
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="secondary"
          onClick={() => (onCancel ? onCancel() : router.back())}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Creando…' : 'Crear regla'}
        </Button>
      </div>
    </form>
  )
}
