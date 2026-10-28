'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { Table, type Column } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import {
  MEDIO_PAGO_LABEL,
  TIPO_CUENTA_DESTINO_LABEL,
  type ArancelCobroRow,
  type CuentaDestinoRow,
  type MedioPago,
  type TipoCuentaDestino,
} from '@/lib/types/ventas'
import type { PlanCuotasRow, RecargoCuotasRow } from '@/lib/types/precios'
import {
  actualizarCuentaDestinoAction,
  crearCuentaDestinoAction,
} from '../actions'
import { Modal } from '@/components/ui/Modal'
import { ArancelesPanel } from './ArancelesPanel'
import { RecargosPanel } from './RecargosPanel'
import {
  RetencionesFields,
  retencionesANumeros,
  type RetencionesBorrador,
} from './RetencionesFields'
import { MEDIOS_CON_COSTO } from '@/lib/cobros/medios'
import { parsearDecimal } from '@/lib/utils/numero'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { Checkbox } from '@/components/ui/Checkbox'
import { Card } from '@/components/ui/Card'
import { TableFrame } from '@/components/ui/TableParts'

const TIPOS: TipoCuentaDestino[] = ['efectivo', 'banco', 'billetera_virtual']

/** Una fila del arancel rápido del alta. Texto, porque puede quedar vacía. */
interface ArancelBorrador {
  arancelPct: string
  ivaArancelPct: string
  diasAcreditacion: string
}

const ARANCEL_VACIO: ArancelBorrador = {
  arancelPct: '',
  ivaArancelPct: '21',
  diasAcreditacion: '0',
}

const RETENCIONES_VACIAS: RetencionesBorrador = {
  ret_iva_pct: '0',
  ret_ganancias_pct: '0',
  ret_iibb_pct: '0',
  imp_deb_cred_pct: '0',
}

/**
 * ABM de cuentas de cobro. La cuenta predeterminada es la que usa el server
 * cuando una venta no detalla su cobranza, así que siempre tiene que haber
 * una: por eso se puede cambiar cuál es, pero no dejar el tenant sin ninguna.
 *
 * El alta incluye el costo de cobro (00057) en el mismo formulario. Cargarlo
 * después obligaba a crear la cuenta, buscarla y volver a entrar — y dejaba
 * cuentas a medio configurar que registran cobros con costo cero sin que
 * nadie se entere.
 */
export function CuentasView({
  cuentas,
  aranceles,
  planesCuotas,
  recargos,
  page,
  pageSize,
  total,
}: {
  cuentas: CuentaDestinoRow[]
  aranceles: ArancelCobroRow[]
  planesCuotas: PlanCuotasRow[]
  recargos: RecargoCuotasRow[]
  page: number
  pageSize: number
  total: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoCuentaDestino>('banco')
  const [titular, setTitular] = useState('')
  const [identificador, setIdentificador] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Costo de cobro del alta: un arancel comodín por medio (el tarifario por
  // plan de cuotas se afina después, desde el panel de la cuenta).
  const [arancelesNuevos, setArancelesNuevos] = useState<Record<string, ArancelBorrador>>({
    transferencia: { ...ARANCEL_VACIO },
    tarjeta_debito: { ...ARANCEL_VACIO },
    tarjeta_credito: { ...ARANCEL_VACIO },
  })
  const [retenciones, setRetenciones] = useState({ ...RETENCIONES_VACIAS })

  // El costo de cobro arranca CERRADO y por medio. Una billetera que sólo
  // recibe transferencias no tiene por qué mirar tres bloques de tarjeta: el
  // formulario tiene que pedir lo que esta cuenta cobra, no todo lo que
  // alguna cuenta podría cobrar. Y sigue siendo opcional — se completa
  // después desde el tarifario de la cuenta.
  const [costoAbierto, setCostoAbierto] = useState(false)
  const [mediosActivos, setMediosActivos] = useState<MedioPago[]>([])

  // Cuenta cuyo tarifario detallado está abierto. Vive abajo de la tabla y no
  // dentro de una fila: `Table` renderiza filas planas, y meterle una fila
  // expandible rompería el markup que le da el rol ARIA correcto.
  const [detalle, setDetalle] = useState<string | null>(null)

  // La caja física no paga arancel: ofrecer el bloque ahí sería invitar a
  // cargar un costo que no existe.
  const cobraArancel = tipo !== 'efectivo'

  function resetForm() {
    setNombre('')
    setTitular('')
    setIdentificador('')
    setArancelesNuevos({
      transferencia: { ...ARANCEL_VACIO },
      tarjeta_debito: { ...ARANCEL_VACIO },
      tarjeta_credito: { ...ARANCEL_VACIO },
    })
    setRetenciones({ ...RETENCIONES_VACIAS })
    setCostoAbierto(false)
    setMediosActivos([])
  }

  function crear() {
    if (nombre.trim().length < 2) return setError('Nombre muy corto')
    setError(null)

    // Sólo viajan los medios con arancel cargado: una fila en blanco no es
    // "0%", es "todavía no lo sé".
    const filas = cobraArancel && costoAbierto
      ? mediosActivos.flatMap((m) => {
          const b = arancelesNuevos[m]
          const pct = parsearDecimal(b.arancelPct)
          if (pct === null) return []
          return [
            {
              medio: m,
              arancelPct: pct,
              ivaArancelPct: parsearDecimal(b.ivaArancelPct) ?? 21,
              diasAcreditacion: parsearDecimal(b.diasAcreditacion) ?? 0,
            },
          ]
        })
      : []

    start(async () => {
      const res = await crearCuentaDestinoAction({
        nombre,
        tipo,
        titular: titular || null,
        identificador: identificador || null,
        retenciones: cobraArancel && costoAbierto
          ? retencionesANumeros(retenciones)
          : undefined,
        aranceles: filas,
      })
      if (!res.ok) return setError(mensajeDeError(res.reason))
      resetForm()
      setCreando(false)
      const fallidos = res.data?.arancelesFallidos ?? 0
      if (fallidos > 0) {
        toast.error(
          'Cuenta creada, aranceles incompletos',
          `${fallidos} arancel(es) no se pudieron cargar. Revisalos en Costo de cobro.`,
        )
      } else {
        toast.success('Cuenta creada')
      }
      router.refresh()
    })
  }

  function toggleActivo(row: CuentaDestinoRow) {
    start(async () => {
      const res = await actualizarCuentaDestinoAction({
        id: row.id_cuenta_destino,
        patch: { activo: !row.activo },
      })
      if (!res.ok) return toast.error('No se pudo actualizar', mensajeDeError(res.reason))
      router.refresh()
    })
  }

  function goToPage(nextPage: number) {
    const params = new URLSearchParams()
    if (nextPage > 1) params.set('page', String(nextPage))
    const qs = params.toString()
    // Cambiar de página deja el panel de detalle apuntando a una cuenta que
    // ya no está en pantalla.
    setDetalle(null)
    start(() => router.push(qs ? `/precios/cuentas?${qs}` : '/precios/cuentas'))
  }

  const columns: Column<CuentaDestinoRow>[] = [
    {
      key: 'nombre',
      label: 'Cuenta',
      render: (c) => {
        const puedeTenerCosto = c.tipo !== 'efectivo'
        const conArancel = aranceles.some(
          (a) => a.id_cuenta_destino === c.id_cuenta_destino && a.arancel_pct > 0,
        )
        return (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.nombre}</span>
              {c.es_predeterminada && <Badge variant="success">Predeterminada</Badge>}
              {puedeTenerCosto && !conArancel && <Badge variant="warning">Sin arancel</Badge>}
            </div>
            {c.titular && <div className="text-xs text-muted">{c.titular}</div>}
          </div>
        )
      },
    },
    { key: 'tipo', label: 'Tipo', render: (c) => TIPO_CUENTA_DESTINO_LABEL[c.tipo] },
    {
      key: 'identificador',
      label: 'Identificador',
      render: (c) =>
        c.identificador ? (
          <span className="font-mono text-xs">{c.identificador}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'estado',
      label: 'Estado',
      render: (c) =>
        c.activo ? (
          <span className="text-xs uppercase font-mono text-success">Activa</span>
        ) : (
          <span className="text-xs uppercase font-mono text-muted">Inactiva</span>
        ),
    },
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (c) => (
        <div className="flex justify-end whitespace-nowrap">
          {c.tipo !== 'efectivo' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDetalle(c.id_cuenta_destino)}
              disabled={pending}
            >
              Costo de cobro
            </Button>
          )}
          {/* La predeterminada no se elige a mano. Es la caja del local desde
              el alta del tenant (00047) y sólo se usa como red: una venta que
              no detalla su cobranza. El flujo de venta ya exige destino en
              cada pago, así que el botón era una decisión sin consecuencia
              que igual se podía apretar por error. */}
          {!c.es_predeterminada && (
            <Button variant="ghost" size="sm" onClick={() => toggleActivo(c)} disabled={pending}>
              {c.activo ? 'Desactivar' : 'Activar'}
            </Button>
          )}
        </div>
      ),
    },
  ]

  const cuentaDetalle = cuentas.find((c) => c.id_cuenta_destino === detalle) ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Los lugares donde entra la plata de las ventas. La caja del local es
          la predeterminada: la red para una venta que no detalle su cobranza.
        </p>
        <Button
          type="button"
          onClick={() => {
            setCreando((v) => !v)
            setError(null)
          }}
          aria-expanded={creando}
        >
          {creando ? 'Cerrar' : 'Nueva cuenta'}
        </Button>
      </div>

      {creando && (
        <Card className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field htmlFor="c-nombre" label="Nombre" required error={error ?? undefined}>
              <Input
                id="c-nombre"
                autoFocus
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Caja, Santander, Mercado Pago…"
                invalid={!!error}
              />
            </Field>
            <Field htmlFor="c-tipo" label="Tipo" required>
              <Select
                id="c-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoCuentaDestino)}
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_CUENTA_DESTINO_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field htmlFor="c-titular" label="Titular">
              <Input
                id="c-titular"
                value={titular}
                onChange={(e) => setTitular(e.target.value)}
                placeholder="A nombre de"
              />
            </Field>
            <Field
              htmlFor="c-ident"
              label="Identificador"
              hint="CBU, alias, o últimos 4 dígitos de la tarjeta"
            >
              <Input
                id="c-ident"
                value={identificador}
                onChange={(e) => setIdentificador(e.target.value)}
              />
            </Field>
          </div>

          {cobraArancel && !costoAbierto && (
            <button
              type="button"
              onClick={() => setCostoAbierto(true)}
              className="w-full rounded-md border border-dashed border-border bg-card-2 p-3 text-left text-xs text-muted hover:border-muted-2 hover:text-text"
            >
              <span className="font-medium">+ Cargar costo de cobro</span> — comisiones,
              retenciones y días de acreditación. Opcional: se puede completar
              después desde el tarifario de la cuenta.
            </button>
          )}

          {cobraArancel && costoAbierto && (
            <div className="space-y-4 rounded-md border border-border bg-card-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-text">Costo de cobro</h3>
                  <p className="mt-1 text-xs text-muted">
                    Tildá sólo los medios que esta cuenta cobra. Los porcentajes
                    tienen que salir de tu liquidación real; un medio sin
                    arancel registra sus cobros con costo cero.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCostoAbierto(false)
                    setMediosActivos([])
                  }}
                >
                  Quitar
                </Button>
              </div>

              <div className="space-y-3">
                <span className="text-xs uppercase font-mono text-muted">Aranceles</span>
                {/* El medio se tilda primero. Sin esto, dar de alta una
                    billetera obligaba a pasar por delante de débito y crédito
                    para llegar a la única fila que importaba. */}
                <div className="flex flex-wrap gap-3">
                  {MEDIOS_CON_COSTO.map((m) => (
                    <label key={m} className="flex items-center gap-2 text-sm text-text">
                      <Checkbox
                        checked={mediosActivos.includes(m)}
                        onChange={(e) =>
                          setMediosActivos((xs) =>
                            e.target.checked ? [...xs, m] : xs.filter((x) => x !== m),
                          )
                        }
                      />
                      {MEDIO_PAGO_LABEL[m]}
                    </label>
                  ))}
                </div>
                {MEDIOS_CON_COSTO.filter((m) => mediosActivos.includes(m)).map((m) => (
                  <div key={m} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-4">
                    <span className="text-sm text-text sm:pb-2">{MEDIO_PAGO_LABEL[m]}</span>
                    <Field htmlFor={`na-${m}-pct`} label="Arancel %">
                      <NumberInput
                        id={`na-${m}-pct`}
                        min={0}
                        max={100}
                        value={arancelesNuevos[m].arancelPct}
                        onChange={(e) =>
                          setArancelesNuevos((s) => ({
                            ...s,
                            [m]: { ...s[m], arancelPct: e.target.value },
                          }))
                        }
                        placeholder="Sin cargar"
                        className="text-right"
                      />
                    </Field>
                    <Field htmlFor={`na-${m}-iva`} label="IVA s/arancel %">
                      <NumberInput
                        id={`na-${m}-iva`}
                        min={0}
                        max={100}
                        value={arancelesNuevos[m].ivaArancelPct}
                        onChange={(e) =>
                          setArancelesNuevos((s) => ({
                            ...s,
                            [m]: { ...s[m], ivaArancelPct: e.target.value },
                          }))
                        }
                        className="text-right"
                      />
                    </Field>
                    <Field htmlFor={`na-${m}-dias`} label="Días">
                      <NumberInput
                        id={`na-${m}-dias`}
                        min={0}
                        value={arancelesNuevos[m].diasAcreditacion}
                        onChange={(e) =>
                          setArancelesNuevos((s) => ({
                            ...s,
                            [m]: { ...s[m], diasAcreditacion: e.target.value },
                          }))
                        }
                        className="text-right"
                      />
                    </Field>
                  </div>
                ))}
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <span className="text-xs uppercase font-mono text-muted">Retenciones</span>
                <RetencionesFields
                  idPrefix="nr"
                  values={retenciones}
                  onChange={(campo, valor) => setRetenciones((r) => ({ ...r, [campo]: valor }))}
                />
              </div>
            </div>
          )}

          <Button type="button" onClick={crear} disabled={pending || nombre.trim().length < 2}>
            {pending ? 'Creando…' : 'Crear cuenta'}
          </Button>
        </Card>
      )}

      <TableFrame>
        <Table
          columns={columns}
          data={cuentas}
          loading={pending}
          getRowId={(c) => c.id_cuenta_destino}
          emptyState="No hay cuentas cargadas."
        />
      </TableFrame>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={goToPage}
        disabled={pending}
      />

      <RecargosPanel
        cuentas={cuentas}
        recargos={recargos}
        aranceles={aranceles}
        planesCuotas={planesCuotas}
      />

      {/* El tarifario va en modal y no debajo de la tabla: la lista pagina, y
          un panel anclado abajo obligaba a scrollear hasta el final para ver
          de qué cuenta hablaba. */}
      <Modal
        open={cuentaDetalle !== null}
        title={`Costo de cobro · ${cuentaDetalle?.nombre ?? ''}`}
        onClose={() => setDetalle(null)}
        size="xl"
      >
        {cuentaDetalle && (
          <ArancelesPanel
            cuenta={cuentaDetalle}
            aranceles={aranceles}
            recargos={recargos}
            planesCuotas={planesCuotas}
          />
        )}
      </Modal>
    </div>
  )
}
