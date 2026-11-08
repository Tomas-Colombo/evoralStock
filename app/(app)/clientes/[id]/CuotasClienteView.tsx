'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { NumberInput } from '@/components/ui/NumberInput'
import { Select } from '@/components/ui/Select'
import { Table, type Column } from '@/components/ui/Table'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { cuotasArrastradas, saldoCuota, saldoTotal } from '@/lib/cuotas/generar-plan'
import { agruparPorCompra, agruparPorMes } from '@/lib/cuotas/agrupar'
import {
  ESTADO_CUOTA_LABEL,
  FILTRO_ESTADO_CUOTAS_LABEL,
  MEDIO_PAGO_LABEL,
  type CuentaDestinoRow,
  type CuotaListada,
  type EstadoCuota,
  type FiltroEstadoCuotas,
  type MedioPago,
} from '@/lib/types/ventas'
import { cobrarCuotaAction, marcarCuotaIncobrableAction } from '../actions'
import { mensajeDeError } from '@/lib/errores/mensajes'
import { Card } from '@/components/ui/Card'
import { TableFrame } from '@/components/ui/TableParts'

const VARIANT: Record<EstadoCuota, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  pendiente: 'info',
  parcial: 'warning',
  pagada: 'success',
  incobrable: 'danger',
  anulada: 'neutral',
}

/** Medios con los que se puede cobrar una cuota financiada por la casa. */
const MEDIOS: MedioPago[] = ['efectivo', 'transferencia', 'tarjeta_debito']

/**
 * Estado de cuenta de un cliente: sus cuotas, con los mismos filtros que el
 * panel y las acciones de cobro.
 *
 * El filtrado es en el CLIENTE y no por URL: un cliente tiene decenas de
 * cuotas, no miles, y hacer un round-trip al server para esconder cuatro
 * filas es peor experiencia que recalcularlas en el momento.
 */
export function CuotasClienteView({
  cuotas,
  cuentas,
  hoy,
  puedeMarcarIncobrable,
}: {
  cuotas: CuotaListada[]
  cuentas: CuentaDestinoRow[]
  /** `YYYY-MM-DD` del server: la misma con la que se calculó el resumen. */
  hoy: string
  puedeMarcarIncobrable: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const [estado, setEstado] = useState<FiltroEstadoCuotas>('todas')
  // Dos lecturas de las mismas filas: por vencimiento se planifica la
  // cobranza; por compra se revisa el historial. Ninguna sustituye a la otra.
  const [porCompra, setPorCompra] = useState(false)

  const [cobrando, setCobrando] = useState<CuotaListada | null>(null)
  const [montoCobro, setMontoCobro] = useState('')
  const [medio, setMedio] = useState<MedioPago>('efectivo')
  const [idCuenta, setIdCuenta] = useState('')
  const [referencia, setReferencia] = useState('')
  const [errCobro, setErrCobro] = useState<string | null>(null)

  const [incobrable, setIncobrable] = useState<CuotaListada | null>(null)
  const [motivo, setMotivo] = useState('')
  const [errMotivo, setErrMotivo] = useState<string | null>(null)

  const visibles = useMemo(
    () => cuotas.filter((c) => coincide(c, estado, hoy)),
    [cuotas, estado, hoy],
  )

  /**
   * Total a cobrar por mes de vencimiento. Responde la pregunta real cuando
   * alguien compró dos veces en cuotas con una semana de diferencia: los dos
   * planes caen en los mismos meses, y lo que importa no es de qué compra
   * viene cada cuota sino cuánto entra en septiembre.
   */
  const porMes = useMemo(() => agruparPorMes(cuotas), [cuotas])

  /** El mismo conjunto separado por compra, de la más nueva a la más vieja. */
  const grupos = useMemo(() => agruparPorCompra(visibles), [visibles])

  /**
   * Las que se van a dar por perdidas junto con la elegida: ella y todas las
   * POSTERIORES del mismo plan que sigan abiertas. Espeja lo que hace
   * `sp_marcar_cuota_incobrable` (00060) — el SP es el que manda, esto es
   * para que el operador vea el alcance ANTES de confirmar.
   */
  const arrastre = useMemo(
    () => (incobrable ? cuotasArrastradas(cuotas, incobrable) : []),
    [cuotas, incobrable],
  )

  const totalArrastre = saldoTotal(arrastre)

  function cuentasPara(m: MedioPago): CuentaDestinoRow[] {
    const buscoEfectivo = m === 'efectivo'
    const filtradas = cuentas.filter((c) => (c.tipo === 'efectivo') === buscoEfectivo)
    return filtradas.length > 0 ? filtradas : cuentas
  }

  function abrirCobro(c: CuotaListada) {
    setCobrando(c)
    // Precargado al saldo pero editable: el cliente que trae la mitad es un
    // caso real, y con un monto fijo no habría dónde anotarlo.
    setMontoCobro(String(saldoCuota(c)))
    setMedio('efectivo')
    setIdCuenta(cuentasPara('efectivo')[0]?.id_cuenta_destino ?? '')
    setReferencia('')
    setErrCobro(null)
  }

  function confirmarCobro() {
    if (!cobrando) return
    const monto = Number(montoCobro.replace(',', '.'))
    const saldo = saldoCuota(cobrando)
    if (!Number.isFinite(monto) || monto <= 0) return setErrCobro('Monto inválido')
    if (monto > saldo) return setErrCobro(`No puede superar el saldo (${money(saldo)})`)
    if (!idCuenta) return setErrCobro('Elegí una cuenta destino')
    setErrCobro(null)

    const cuota = cobrando
    start(async () => {
      const res = await cobrarCuotaAction({
        idCuota: cuota.id_cuota_financiada,
        monto,
        medio,
        idCuentaDestino: idCuenta,
        referencia: referencia.trim() || null,
      })
      if (!res.ok) return setErrCobro(mensajeDeError(res.reason))
      setCobrando(null)
      toast.success(
        monto >= saldo ? 'Cuota cobrada' : 'Cobro parcial registrado',
        `Cuota #${cuota.numero} · ${money(monto)}`,
      )
      router.refresh()
    })
  }

  function confirmarIncobrable() {
    if (!incobrable) return
    if (motivo.trim().length < 3) return setErrMotivo('Escribí el motivo')
    setErrMotivo(null)
    const cuota = incobrable
    start(async () => {
      const res = await marcarCuotaIncobrableAction({
        idCuota: cuota.id_cuota_financiada,
        motivo,
      })
      if (!res.ok) return setErrMotivo(mensajeDeError(res.reason))
      setIncobrable(null)
      setMotivo('')
      // El conteo sale del SP, no del preview: si alguien cobró una cuota
      // mientras el modal estaba abierto, el número real es el suyo.
      const n = res.data?.cuotas_afectadas ?? 1
      toast.success(
        n === 1 ? 'Cuota dada por perdida' : `${n} cuotas dadas por perdidas`,
        `Se registró un gasto por ${money(res.data?.monto_total ?? saldoCuota(cuota))}`,
      )
      router.refresh()
    })
  }

  const columns: Column<CuotaListada>[] = [
    {
      key: 'cuota',
      label: 'Cuota',
      render: (c) => (
        <Link href={`/ventas/${c.id_venta}`} className="font-mono text-xs hover:underline">
          #{c.numero}
        </Link>
      ),
    },
    {
      key: 'vence',
      label: 'Vence',
      render: (c) => {
        const vencida = esDeuda(c.estado) && c.fecha_vencimiento < hoy
        return (
          <div className={vencida ? 'text-alerta-ink' : ''}>
            <div>{fecha(c.fecha_vencimiento)}</div>
            <div className="text-xs text-muted capitalize">{mesLargo(c.fecha_vencimiento)}</div>
          </div>
        )
      },
    },
    {
      key: 'monto',
      label: 'Monto',
      align: 'right',
      render: (c) => <span className="font-mono">{money(Number(c.monto))}</span>,
    },
    {
      key: 'saldo',
      label: 'Saldo',
      align: 'right',
      render: (c) => {
        if (!esDeuda(c.estado)) return <span className="text-muted">—</span>
        return (
          <div>
            <span className="font-mono font-semibold">{money(saldoCuota(c))}</span>
            {Number(c.monto_pagado) > 0 && (
              <div className="font-mono text-xs text-muted">
                pagó {money(Number(c.monto_pagado))}
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: 'estado',
      label: 'Estado',
      render: (c) => {
        const vencida = esDeuda(c.estado) && c.fecha_vencimiento < hoy
        // Vencer HOY no es estar vencida — el cliente tiene el día entero —
        // pero tampoco es "pendiente" a secas: es la única que hay que cobrar
        // antes de que cierre el local.
        const venceHoy = esDeuda(c.estado) && c.fecha_vencimiento === hoy
        return (
          <div>
            <Badge
              variant={vencida ? 'danger' : venceHoy ? 'warning' : VARIANT[c.estado]}
            >
              {vencida ? 'Vencida' : venceHoy ? 'Vence hoy' : ESTADO_CUOTA_LABEL[c.estado]}
            </Badge>
            {c.estado === 'incobrable' && c.motivo_incobrable && (
              <div className="mt-1 text-xs text-muted">{c.motivo_incobrable}</div>
            )}
          </div>
        )
      },
    },
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (c) =>
        esDeuda(c.estado) ? (
          <div className="flex justify-end whitespace-nowrap">
            <Button size="sm" onClick={() => abrirCobro(c)} disabled={pending}>
              Cobrar
            </Button>
            {puedeMarcarIncobrable && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIncobrable(c)
                  setMotivo('')
                  setErrMotivo(null)
                }}
                disabled={pending}
                title="Da por perdida ésta y las siguientes de la misma compra"
              >
                Incobrable
              </Button>
            )}
          </div>
        ) : null,
    },
  ]

  const saldoActual = cobrando ? saldoCuota(cobrando) : 0
  const opcionesCuenta = cuentasPara(medio)

  return (
    <div className="space-y-3">
      {/* Resumen por mes de cobro. Dos compras financiadas distintas caen en
          los mismos meses: acá se ve cuánto entra en cada uno, sin importar
          de qué plan viene cada cuota. */}
      {porMes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {porMes.map((g) => {
            const vencido = g.mes < hoy.slice(0, 7)
            const esteMes = g.mes === hoy.slice(0, 7)
            return (
              <div
                key={g.mes}
                className={`rounded-md border px-3 py-2 ${
                  vencido
                    ? 'border-alerta-ink bg-alerta-bg'
                    : esteMes
                      ? 'border-line-2 bg-line'
                      : 'border-border bg-card-2'
                }`}
              >
                <div className="font-mono text-xs uppercase text-muted">
                  {nombreMes(g.mes)}
                  {vencido && ' · vencido'}
                </div>
                <div className="font-mono font-semibold">{money(g.monto)}</div>
                <div className="text-xs text-muted">
                  {g.cuotas} cuota{g.cuotas === 1 ? '' : 's'}
                  {g.planes > 1 && ` · ${g.planes} compras`}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Filtro compacto: es un solo cliente, no hace falta la barra entera. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant={porCompra ? 'secondary' : 'ghost'}
          onClick={() => setPorCompra((v) => !v)}
          aria-pressed={porCompra}
        >
          {porCompra ? 'Por vencimiento' : 'Agrupar por compra'}
        </Button>
        <label htmlFor="cc-estado" className="text-xs text-muted">
          Mostrar
        </label>
        <div className="w-44">
          <Select
            id="cc-estado"
            value={estado}
            onChange={(e) => setEstado(e.target.value as FiltroEstadoCuotas)}
          >
            {(Object.keys(FILTRO_ESTADO_CUOTAS_LABEL) as FiltroEstadoCuotas[]).map((k) => (
              <option key={k} value={k}>
                {FILTRO_ESTADO_CUOTAS_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {porCompra ? (
        /* Una tabla por compra, de la más nueva a la más vieja. Se usa el
           mismo `Table` con las mismas columnas: lo único que cambia es cómo
           se parten las filas, así que fabricar una tabla distinta acá haría
           que las dos vistas se desincronicen la primera vez que se toque una
           columna. */
        grupos.length === 0 ? (
          <Card padding="none" className="p-6 text-center text-sm text-muted">
            Sin cuotas que coincidan con el filtro.
          </Card>
        ) : (
          <div className="space-y-4">
            {grupos.map((g) => (
              <Card
                padding="none"
                key={g.id_venta}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
                  <div>
                    <Link
                      href={`/ventas/${g.id_venta}`}
                      className="font-medium hover:underline"
                    >
                      Compra del{' '}
                      {g.fecha
                        ? new Date(g.fecha).toLocaleDateString('es-AR')
                        : 'fecha desconocida'}
                    </Link>
                    <span className="ml-2 text-xs text-muted">
                      {g.cantidad} cuota{g.cantidad === 1 ? '' : 's'}
                      {g.total !== null && ` · total ${money(g.total)}`}
                    </span>
                  </div>
                  <div className="text-sm">
                    {g.pendientes > 0 ? (
                      <>
                        <span className="text-muted">Resta </span>
                        <span className="font-mono font-semibold">{money(g.adeudado)}</span>
                        <span className="text-muted">
                          {' '}
                          en {g.pendientes} cuota{g.pendientes === 1 ? '' : 's'}
                        </span>
                      </>
                    ) : (
                      <Badge variant="success">Saldada</Badge>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table
                    columns={columns}
                    data={g.cuotas}
                    loading={pending}
                    getRowId={(c) => c.id_cuota_financiada}
                    emptyState="Sin cuotas."
                  />
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        <TableFrame>
          <Table
            columns={columns}
            data={visibles}
            loading={pending}
            getRowId={(c) => c.id_cuota_financiada}
            emptyState="Sin cuotas que coincidan con el filtro."
          />
        </TableFrame>
      )}

      {/* ─── Cobrar ─────────────────────────────────────────────────── */}
      <Modal
        open={!!cobrando}
        title="Cobrar cuota"
        onClose={() => setCobrando(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCobrando(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={confirmarCobro} disabled={pending}>
              {pending ? 'Registrando…' : 'Registrar cobro'}
            </Button>
          </>
        }
      >
        {cobrando && (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-card-2 px-3 py-2 text-sm text-muted">
              Cuota #{cobrando.numero} · vence {fecha(cobrando.fecha_vencimiento)} · saldo{' '}
              <span className="font-mono text-text">{money(saldoActual)}</span>
            </div>

            <Field htmlFor="cq-monto" label="Monto" required error={errCobro ?? undefined}>
              <NumberInput
                id="cq-monto"
                thousands
                autoFocus
                value={montoCobro}
                onChange={(e) => setMontoCobro(e.target.value)}
                invalid={!!errCobro}
                className="text-right"
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field htmlFor="cq-medio" label="Medio">
                <Select
                  id="cq-medio"
                  value={medio}
                  onChange={(e) => {
                    const m = e.target.value as MedioPago
                    setMedio(m)
                    // La cuenta sigue al medio, igual que en la cobranza de la
                    // venta: el efectivo entra a la caja.
                    const op = cuentasPara(m)
                    if (!op.some((c) => c.id_cuenta_destino === idCuenta)) {
                      setIdCuenta(op[0]?.id_cuenta_destino ?? '')
                    }
                  }}
                >
                  {MEDIOS.map((m) => (
                    <option key={m} value={m}>
                      {MEDIO_PAGO_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field htmlFor="cq-cuenta" label="Cuenta destino">
                <Select
                  id="cq-cuenta"
                  value={idCuenta}
                  onChange={(e) => setIdCuenta(e.target.value)}
                >
                  {opcionesCuenta.map((c) => (
                    <option key={c.id_cuenta_destino} value={c.id_cuenta_destino}>
                      {c.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {medio !== 'efectivo' && (
              <Field htmlFor="cq-ref" label="Referencia">
                <Input
                  id="cq-ref"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="Nro. de operación (opcional)"
                />
              </Field>
            )}

            <p className="text-xs text-muted">
              Si cobrás menos que el saldo, la cuota queda en <strong>parcial</strong>{' '}
              con lo que falta.
            </p>
          </div>
        )}
      </Modal>

      {/* ─── Incobrable ─────────────────────────────────────────────── */}
      <Modal
        open={!!incobrable}
        title="Marcar como incobrable"
        onClose={() => setIncobrable(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIncobrable(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmarIncobrable} disabled={pending}>
              {pending
                ? 'Registrando…'
                : arrastre.length > 1
                  ? `Dar por perdidas ${arrastre.length} cuotas`
                  : 'Dar por perdida'}
            </Button>
          </>
        }
      >
        {incobrable && (
          <div className="space-y-3">
            {arrastre.length > 1 ? (
              <div className="rounded-md border border-alerta-ink bg-alerta-bg p-3">
                <p className="text-sm font-medium text-alerta-ink">
                  Esto también da por perdidas las {arrastre.length - 1} cuotas
                  siguientes de esta compra.
                </p>
                <p className="mt-1 text-sm text-muted">
                  Si no pagó la #{incobrable.numero}, las que vienen después no se
                  van a cobrar solas. Las anteriores no se tocan.
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {arrastre.map((c) => (
                    <li
                      key={c.id_cuota_financiada}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className={c.numero === incobrable.numero ? 'font-medium' : ''}>
                        Cuota #{c.numero} · vence {fecha(c.fecha_vencimiento)}
                      </span>
                      <span className="font-mono">{money(saldoCuota(c))}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-alerta-ink/30 pt-2 text-sm font-semibold">
                  <span>Total a dar por perdido</span>
                  <span className="font-mono">{money(totalArrastre)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">
                La cuota #{incobrable.numero} por{' '}
                <span className="font-mono">{money(saldoCuota(incobrable))}</span> deja de
                figurar como deuda.
              </p>
            )}

            <p className="text-sm text-muted">
              Se registra <strong>un solo gasto</strong> por el total en la categoría{' '}
              <strong>Incobrables</strong>. No se puede deshacer desde acá; el detalle
              de cuánto del costo de la mercadería quedó sin cubrir está en la venta.
            </p>
            <Field htmlFor="ci-motivo" label="Motivo" required error={errMotivo ?? undefined}>
              <Textarea
                id="ci-motivo"
                rows={2}
                autoFocus
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: no responde hace 4 meses"
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

/** Espeja el filtro del panel (`aplicarFiltro` en el DAL). */
function coincide(c: CuotaListada, f: FiltroEstadoCuotas, hoy: string): boolean {
  switch (f) {
    case 'todas':
      return true
    case 'con_deuda':
      return esDeuda(c.estado)
    case 'vencidas':
      return esDeuda(c.estado) && c.fecha_vencimiento < hoy
    case 'vence_este_mes':
      return esDeuda(c.estado) && c.fecha_vencimiento.slice(0, 7) === hoy.slice(0, 7)
    case 'parciales':
      return c.estado === 'parcial'
    case 'pagadas':
      return c.estado === 'pagada'
    case 'incobrables':
      return c.estado === 'incobrable'
  }
}

function esDeuda(e: EstadoCuota): boolean {
  return e === 'pendiente' || e === 'parcial'
}

function fecha(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-AR')
}

/** `2026-09-10` → `septiembre`. */
function mesLargo(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-AR', { month: 'long' })
}

/** `2026-09` → `Septiembre 2026`. */
function nombreMes(mes: string): string {
  const d = new Date(`${mes}-01T00:00:00`)
  const s = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function money(n: number): string {
  return `$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}
