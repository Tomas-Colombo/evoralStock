'use client'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'
import {
  MEDIO_PAGO_LABEL,
  type ArancelCobroRow,
  type CuentaDestinoRow,
  type DesgloseCosto,
  type MedioPago,
} from '@/lib/types/ventas'
import type { PlanCuotasRow, RecargoCuotasRow } from '@/lib/types/precios'
import { calcularCostoCobro, resolverArancel } from '@/lib/cobros/calcular-costo'
import { Select } from '@/components/ui/Select'
import { Card } from '@/components/ui/Card'

/** Un pago mientras se edita. `recibido` es texto porque puede quedar vacío. */
/** Opción del selector de medio que no es un medio: quita el pago y deja deuda. */
const NO_PAGA_AHORA = '__no_paga_ahora__'

export interface PagoBorrador {
  key: string
  medio: MedioPago
  idCuenta: string
  monto: number
  /**
   * Sólo en `tarjeta_credito`. El vendedor lo elige acá, sobre la cuenta que
   * ya seleccionó, y de acá salen las dos cosas que dependen del plan: el
   * arancel que paga el comercio (00057) y el recargo que paga el cliente
   * (00063). Antes se elegía en un selector aparte, arriba, y nada impedía
   * que ese plan y este medio de pago se contradijeran.
   */
  cuotas: number | null
  /**
   * `true` en cuanto el vendedor edita el monto a mano. Mientras sea `false`
   * y haya un solo pago, el monto sigue al total automáticamente — que es el
   * 95% de las ventas. Sin este flag no se puede distinguir "todavía no lo
   * tocó" de "lo bajó a propósito para dejar saldo", y esa diferencia ES la
   * que decide si hay deuda.
   */
  tocado: boolean
  recibido: string
  referencia: string
}

/**
 * Los medios que necesitan un procesador para existir. Cobrar con tarjeta
 * exige un contrato con alguien que la procese; el efectivo y la
 * transferencia sólo necesitan dónde meter la plata.
 */
const TARJETAS: MedioPago[] = ['tarjeta_debito', 'tarjeta_credito']

/** Tolerancia de centavo para comparar contra el total. */
const EPSILON = 0.005

// Contador en vez de randomUUID: la key termina en el `id` del input de
// vuelto, así que tiene que dar lo mismo en el render del server y en la
// hidratación o React tira mismatch.
let secuencia = 0

/** Las cuentas que declararon ESE medio en su tarifario y siguen vigentes. */
function cuentasQueDeclaran(aranceles: ArancelCobroRow[], medio: MedioPago): Set<string> {
  const ids = new Set<string>()
  for (const a of aranceles) {
    if (a.vigente_hasta === null && a.medio === medio) ids.add(a.id_cuenta_destino)
  }
  return ids
}

/**
 * Los medios que el local puede cobrar de verdad.
 *
 * El efectivo va siempre. La transferencia pide una cuenta que no sea la
 * caja. Las TARJETAS piden además que alguna cuenta activa las haya
 * declarado en su tarifario, porque sin procesador no hay forma de cobrarlas.
 *
 * Con la lista fija de antes se podía elegir "tarjeta de crédito" en un local
 * sin posnet, o mandar una transferencia al cajón del mostrador. El error
 * recién aparecía al confirmar, después de haber armado toda la venta.
 */
export function mediosDisponibles(
  cuentas: CuentaDestinoRow[],
  aranceles: ArancelCobroRow[],
): MedioPago[] {
  const activas = new Set(cuentas.map((c) => c.id_cuenta_destino))
  const medios: MedioPago[] = ['efectivo']
  // Una transferencia no entra a un cajón: necesita un banco o una billetera.
  // No hace falta tarifario — recibir una transferencia no se contrata.
  if (cuentas.some((c) => c.tipo !== 'efectivo')) medios.push('transferencia')
  for (const m of TARJETAS) {
    const declarantes = cuentasQueDeclaran(aranceles, m)
    if ([...declarantes].some((id) => activas.has(id))) medios.push(m)
  }
  return medios
}

/**
 * Cuentas que tienen sentido para un medio: el efectivo entra a una caja, y
 * todo lo demás a un banco o billetera. Si no hay ninguna del tipo que
 * corresponde, se ofrecen todas antes que dejar al vendedor sin opción.
 *
 * Con tarjeta el filtro es más fino: entre los bancos y billeteras, sólo las
 * que declararon ese medio. Si tenés el crédito por Mercado Pago y el débito
 * por Santander, elegir crédito no puede seguir ofreciendo el Santander.
 */
export function cuentasPara(
  cuentas: CuentaDestinoRow[],
  medio: MedioPago,
  aranceles: ArancelCobroRow[] = [],
): CuentaDestinoRow[] {
  const buscoEfectivo = medio === 'efectivo'
  const filtradas = cuentas.filter((c) => (c.tipo === 'efectivo') === buscoEfectivo)
  const base = filtradas.length > 0 ? filtradas : cuentas
  if (!TARJETAS.includes(medio)) return base

  const declarantes = cuentasQueDeclaran(aranceles, medio)
  const conTarifario = base.filter((c) => declarantes.has(c.id_cuenta_destino))
  // Sin ninguna declarante el medio ni siquiera se ofrece (`mediosDisponibles`),
  // así que este fallback sólo cubre el caso de un pago viejo en pantalla.
  return conTarifario.length > 0 ? conTarifario : base
}

export function nuevoPago(
  cuentas: CuentaDestinoRow[],
  monto: number,
  medio: MedioPago = 'efectivo',
  aranceles: ArancelCobroRow[] = [],
): PagoBorrador {
  return {
    key: `pago-${secuencia++}`,
    medio,
    idCuenta: cuentasPara(cuentas, medio, aranceles)[0]?.id_cuenta_destino ?? '',
    monto,
    cuotas: null,
    tocado: false,
    recibido: '',
    referencia: '',
  }
}

/**
 * Planes de cuotas que ESA cuenta tiene configurados para ESE medio.
 *
 * Se cruzan las dos tablas donde un plan deja rastro: el tarifario
 * (`arancel_cobro`, lo que cobra el procesador) y los recargos
 * (`recargo_cuotas`, lo que se le suma al cliente). Un plan que no aparece en
 * ninguna de las dos no está configurado para esa cuenta y no se ofrece — que
 * es justamente lo que evita marcar "6 cuotas Galicia" contra una cuenta que
 * no trabaja en 6.
 *
 * Si la cuenta no tiene NADA cargado se ofrecen todos los planes activos del
 * tenant. Una fila que falta en otra pantalla no puede dejar al vendedor sin
 * poder cerrar una venta en cuotas: se vende a precio de lista y con costo
 * cero, y el aviso de "sin arancel configurado" ya lo dice.
 */
export function planesDeCuenta(
  planes: PlanCuotasRow[],
  aranceles: ArancelCobroRow[],
  recargos: RecargoCuotasRow[],
  idCuenta: string,
  medio: MedioPago,
): number[] {
  const activos = planes.filter((p) => p.activo).map((p) => p.cuotas)
  const configurados = new Set<number>()
  for (const a of aranceles) {
    if (a.vigente_hasta !== null) continue
    if (a.id_cuenta_destino !== idCuenta || a.medio !== medio) continue
    if (a.cuotas != null && a.cuotas > 1) configurados.add(a.cuotas)
  }
  for (const r of recargos) {
    // El recargo del local no pasa por ninguna cuenta: no ofrece planes acá.
    if (r.vigente_hasta !== null || r.propia) continue
    // `null` en el recargo es comodín: alcanza a esta cuenta o a este medio.
    if (r.id_cuenta_destino !== null && r.id_cuenta_destino !== idCuenta) continue
    if (r.medio !== null && r.medio !== medio) continue
    configurados.add(r.cuotas)
  }
  const propios = activos.filter((c) => configurados.has(c))
  return (propios.length > 0 ? propios : activos).sort((a, b) => a - b)
}

/**
 * Normaliza en render (no en un efecto) para que no exista un frame con la
 * cobranza mintiendo. Tres reglas:
 *
 *   - Un solo pago SIN TOCAR sigue al total. En cuanto el vendedor edita el
 *     monto deja de seguirlo, y lo que falte pasa a ser deuda del cliente.
 *     Antes el monto se forzaba siempre, y para dejar saldo había que prender
 *     un checkbox aparte; ahora bajar el número ES la forma de fiar.
 *   - La cuenta sigue al medio: si el pago pasó a efectivo, su cuenta pasa a
 *     ser la caja sola, sin que nadie tenga que tocar el selector. Y si la
 *     cuenta cambió sola, el plan de cuotas vuelve a 1: los planes son de la
 *     cuenta, y arrastrar "6" a un procesador que no trabaja en 6 es
 *     exactamente el dato inconsistente que este panel vino a eliminar.
 *   - Las cuotas sólo existen en crédito. El SP rechaza un pago de crédito
 *     sin cuotas y uno de otro medio CON cuotas, así que normalizarlo acá es
 *     lo que evita un error después de tocar stock.
 */
export function normalizarPagos(
  pagos: PagoBorrador[],
  total: number,
  cuentas: CuentaDestinoRow[],
  aranceles: ArancelCobroRow[] = [],
): PagoBorrador[] {
  const conMonto =
    pagos.length === 1 && !pagos[0].tocado ? [{ ...pagos[0], monto: total }] : pagos
  return conMonto.map((p) => {
    const opciones = cuentasPara(cuentas, p.medio, aranceles)
    const cuentaOk = opciones.some((c) => c.id_cuenta_destino === p.idCuenta)
    const conCuenta = cuentaOk
      ? p
      : { ...p, idCuenta: opciones[0]?.id_cuenta_destino ?? '', cuotas: null }

    if (conCuenta.medio === 'tarjeta_credito') {
      // 1 pago es el default honesto: la mayoría de las ventas con tarjeta no
      // son en cuotas, y el SP exige el dato igual.
      return conCuenta.cuotas == null ? { ...conCuenta, cuotas: 1 } : conCuenta
    }
    return conCuenta.cuotas == null ? conCuenta : { ...conCuenta, cuotas: null }
  })
}

/**
 * Costo de cobro de un pago, resuelto contra el tarifario vigente. Espeja lo
 * que va a hacer `sp_registrar_venta`; sirve para mostrarlo ANTES de
 * confirmar. El SP recalcula y es el que manda.
 */
export function costoDePago(
  pago: PagoBorrador,
  cuentas: CuentaDestinoRow[],
  aranceles: ArancelCobroRow[],
): DesgloseCosto {
  const cuenta = cuentas.find((c) => c.id_cuenta_destino === pago.idCuenta) ?? null
  return calcularCostoCobro({
    monto: pago.monto,
    arancel: resolverArancel(aranceles, pago.idCuenta, pago.medio, pago.cuotas),
    retenciones: cuenta,
  })
}

export function sumaPagos(pagos: PagoBorrador[]): number {
  return pagos.reduce((a, p) => a + (Number.isFinite(p.monto) ? p.monto : 0), 0)
}

export function cobranzaCuadra(pagos: PagoBorrador[], total: number): boolean {
  return Math.abs(sumaPagos(pagos) - total) < EPSILON
}

/**
 * Panel de cobranza: por dónde ingresa el dinero de esta venta.
 *
 * Acá se registra el reparto (cuánto en efectivo, cuánto por transferencia,
 * contra qué cuenta, el vuelto) Y, desde 00064, el plan de cuotas de cada
 * pago con tarjeta. Eso último SÍ toca el precio: el recargo por cuotas
 * depende del plan y de quién lo financia, y las dos cosas se deciden en la
 * misma fila donde se elige la cuenta. El total de arriba se actualiza solo.
 */
export function CobranzaPanel({
  cuentas,
  pagos,
  total,
  disabled,
  aranceles,
  recargos,
  planesCuotas,
  onChange,
  canal = 'local',
  comisionEstimada,
}: {
  cuentas: CuentaDestinoRow[]
  pagos: PagoBorrador[]
  /** Lo que hay que cubrir. Con financiación es el anticipo, no la venta. */
  total: number
  disabled: boolean
  aranceles: ArancelCobroRow[]
  /** Recargos vigentes: definen qué planes ofrece cada cuenta. */
  recargos: RecargoCuotasRow[]
  planesCuotas: PlanCuotasRow[]
  onChange: (pagos: PagoBorrador[]) => void
  canal?: 'local' | 'revendedora'
  comisionEstimada?: { porcentaje: number; montoEstimado: number } | null
}) {
  if (canal === 'revendedora') {
    return (
      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Cobranza</h4>
            <Badge variant="info">Pago automático</Badge>
          </div>
          <p className="text-xs text-muted">
            La venta por canal revendedora se imputa automáticamente a la cuenta corriente de la
            revendedora. No requiere registrar medios de cobro manuales.
          </p>
          {comisionEstimada && (
            <div className="mt-3 rounded-md border border-border bg-card-2 p-3 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted">Comisión aplicable</span>
                <span className="font-mono font-semibold text-warn-ink">
                  {comisionEstimada.porcentaje}% ({money(comisionEstimada.montoEstimado)})
                </span>
              </div>
              <p className="text-[11px] text-muted italic">
                * Estimación informativa sobre la venta actual. La comisión definitiva se liquida en el cierre de ciclo.
              </p>
            </div>
          )}
        </Card>
      </div>
    )
  }

  // Los medios que este local puede cobrar, según lo que haya cargado en
  // Precios y Cuentas. No es una lista fija: sin tarifario de tarjeta, la
  // tarjeta no se ofrece.
  const medios = mediosDisponibles(cuentas, aranceles)
  const faltanTarjetas = TARJETAS.filter((m) => !medios.includes(m))

  // El pago único deja de "seguir al total" en cuanto se lo edita: ahí el
  // monto pasa a ser del vendedor y el resto es deuda.
  const unico = pagos.length === 1 && !pagos[0].tocado
  const asignado = sumaPagos(pagos)
  const restante = total - asignado
  const cuadra = Math.abs(restante) < EPSILON

  // Costo por pago, resuelto contra el tarifario vigente. El SP recalcula al
  // persistir; esto es para que el vendedor vea el neto ANTES de confirmar.
  const costos = pagos.map((p) => costoDePago(p, cuentas, aranceles))
  const costoTotal = costos.reduce((a, d) => a + d.costo_total, 0)
  const diasMax = Math.max(0, ...costos.map((d) => d.dias_acreditacion))
  // Sólo se avisa por los medios que DEBERÍAN tener arancel: que el efectivo
  // no tenga tarifario no es un problema a resolver.
  const faltaTarifario = pagos.some(
    (p, i) => p.medio !== 'efectivo' && costos[i].sin_tarifario,
  )

  function actualizar(key: string, patch: Partial<PagoBorrador>) {
    onChange(pagos.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  }

  function agregar() {
    // El pago nuevo arranca con lo que falta asignar. Si el efectivo ya dice
    // con cuánto paga el cliente y es menos que su monto, ese es el efectivo
    // real: antes seguía cubriendo el total y la transferencia quedaba en 0
    // sin botón "Resto".
    const ajustados = pagos.map(ajustarAlRecibido)
    const falta = total - sumaPagos(ajustados)
    // Un segundo pago casi nunca es del mismo medio que el primero: arranca
    // en el siguiente medio disponible que todavía no se usó.
    const usados = new Set(pagos.map((p) => p.medio))
    const medio = medios.find((m) => !usados.has(m)) ?? medios[0] ?? 'efectivo'
    onChange([
      ...ajustados,
      nuevoPago(cuentas, Math.max(0, redondear(falta)), medio, aranceles),
    ])
  }

  function quitar(key: string) {
    onChange(pagos.filter((p) => p.key !== key))
  }

  /**
   * "No paga ahora": ese pago deja de existir y su monto pasa a deuda, que
   * abre el plan de cuotas del local abajo. Los pagos que quedan se fijan
   * (`tocado`): si sobrevive uno solo sin tocar, `normalizarPagos` lo
   * estiraría al total y la deuda desaparecería.
   */
  function noPagaAhora(key: string) {
    onChange(pagos.filter((p) => p.key !== key).map((p) => ({ ...p, tocado: true })))
  }

  /** Este pago absorbe lo que falta asignar. */
  function absorberResto(key: string) {
    const ajustados = pagos.map((p) => (p.key === key ? p : ajustarAlRecibido(p)))
    const otros = ajustados.filter((p) => p.key !== key)
    onChange(
      ajustados.map((p) =>
        p.key === key
          ? { ...p, monto: Math.max(0, redondear(total - sumaPagos(otros))), tocado: true }
          : p,
      ),
    )
  }

  /** Hay algo que absorber: falta plata o otro efectivo recibió menos que su monto. */
  function puedeAbsorber(key: string) {
    return !cuadra || pagos.some((p) => p.key !== key && ajustarAlRecibido(p) !== p)
  }

  if (cuentas.length === 0) {
    return (
      <div className="rounded-md border border-warn bg-card-2 p-3 text-xs text-warn-ink">
        No hay cuentas activas donde registrar el cobro. Creá una en Ventas →
        Cuentas antes de vender.
      </div>
    )
  }

  // Segmentos de la barra: un tramo por pago y el faltante en cobre. La escala
  // es lo mayor entre el total y lo asignado, así un exceso no desborda.
  const escala = Math.max(total, asignado, 1)
  const deuda = Math.max(0, restante)
  const excedido = restante < -EPSILON

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-petrol">Paso 2 · Medios de cobro</span>
          <h3 className="font-display text-xl text-ink">Pagos</h3>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={agregar}
          disabled={disabled}
          className="border-ink! font-semibold text-ink!"
        >
          + Pago
        </Button>
      </div>

      {/* Resumen del cobro sobre la franja oscura: cuánto es, cuánto entra hoy
          y cuánto queda en cuenta. La barra muestra lo mismo de un vistazo. */}
      <div className="band-scope rounded-lg bg-band p-4 text-band-ink sm:p-5">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-0">
          <div className="flex flex-col gap-1.5 sm:pr-5">
            <dt className="eyebrow text-band-label">Total de la venta</dt>
            <dd className="font-figure whitespace-nowrap text-2xl font-bold leading-none sm:text-[26px]">
              {money(total)}
            </dd>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-band-line pt-3 sm:border-l sm:border-t-0 sm:px-5 sm:pt-0">
            <dt className="eyebrow text-band-label">Paga hoy</dt>
            <dd className="font-figure whitespace-nowrap text-2xl font-bold leading-none sm:text-[26px]">
              {money(asignado)}
            </dd>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-band-line pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <dt className={`eyebrow ${excedido ? 'text-alerta' : 'text-copper'}`}>
              {excedido ? 'Te pasaste por' : 'Queda debiendo'}
            </dt>
            <dd
              className={`font-figure whitespace-nowrap text-2xl font-bold leading-none sm:text-[26px] ${
                excedido ? 'text-alerta' : deuda > EPSILON ? 'text-copper' : ''
              }`}
            >
              {money(cuadra ? 0 : Math.abs(restante))}
            </dd>
          </div>
        </dl>
        <div aria-hidden className="mt-4 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-band-line">
          {pagos.map((p, i) =>
            p.monto > 0 ? (
              <span
                key={p.key}
                className={i % 2 === 0 ? 'bg-band-muted' : 'bg-band-label'}
                style={{ width: `${(p.monto / escala) * 100}%` }}
              />
            ) : null,
          )}
          {deuda > EPSILON && (
            <span className="bg-copper" style={{ width: `${(deuda / escala) * 100}%` }} />
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-line-2 bg-card">
        <div
          aria-hidden
          className="eyebrow hidden grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_96px_64px] items-center gap-3 border-b border-line bg-panel-2 px-4 py-2.5 text-dim lg:grid"
        >
          <span>#</span>
          <span>Medio</span>
          <span className="text-right">Monto</span>
          <span className="text-right">Recibí</span>
          <span />
          <span />
        </div>

        {pagos.length === 0 && (
          <p className="px-4 py-4 text-xs text-muted">
            No paga ahora: todo el total queda como deuda en cuotas del local. Si deja
            una seña, tocá «+ Pago».
          </p>
        )}

        {pagos.map((p, i) => {
          const esEfectivo = p.medio === 'efectivo'
          const costo = costos[i]
          // El selector de cuenta sólo aparece cuando hay algo que elegir.
          // Con efectivo la plata va a la caja, y con una sola cuenta cargada
          // no hay decisión que tomar: preguntar sería ruido.
          const opcionesCuenta = cuentasPara(cuentas, p.medio, aranceles)
          const recibido = Number(p.recibido.replace(',', '.'))
          const vuelto =
            esEfectivo && p.recibido.trim() !== '' && Number.isFinite(recibido)
              ? recibido - p.monto
              : null
          const conComision = !costo.sin_tarifario && costo.costo_total > 0
          const sinArancel = !esEfectivo && costo.sin_tarifario
          const hayDetalle =
            opcionesCuenta.length > 1 ||
            p.medio === 'tarjeta_credito' ||
            p.medio === 'transferencia' ||
            (vuelto != null && vuelto !== 0) ||
            conComision ||
            sinArancel

          return (
            <div
              key={p.key}
              className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 border-b border-line px-4 py-3 last:border-b-0 lg:grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_96px_64px]"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-petrol/10 font-mono text-[11px] text-petrol">
                {i + 1}
              </span>

              <Select
                value={p.medio}
                onChange={(e) => {
                  if (e.target.value === NO_PAGA_AHORA) {
                    noPagaAhora(p.key)
                    return
                  }
                  const medio = e.target.value as MedioPago
                  // El vuelto sólo existe en efectivo (lo enforcea un check
                  // en la DB); al cambiar de medio se descarta. La cuenta la
                  // reacomoda `normalizarPagos`.
                  actualizar(p.key, { medio, recibido: medio === 'efectivo' ? p.recibido : '' })
                }}
                disabled={disabled}
                aria-label="Medio de pago"
                className="w-full"
              >
                {medios.map((m) => (
                  <option key={m} value={m}>
                    {MEDIO_PAGO_LABEL[m]}
                  </option>
                ))}
                <option value={NO_PAGA_AHORA}>No paga ahora (cuotas del local)</option>
              </Select>

              <div className="flex justify-end lg:col-start-6 lg:row-start-1">
                {!unico && (
                  <Button
                    type="button"
                    variant="bare"
                    onClick={() => quitar(p.key)}
                    disabled={disabled}
                    aria-label="Quitar pago"
                    className="px-1 py-1 text-[13px] text-alerta-ink hover:underline"
                  >
                    Quitar
                  </Button>
                )}
              </div>

              {/* Monto + Resto: juntos en mobile, celdas propias en escritorio. */}
              <div className="col-span-3 flex items-center gap-2 lg:contents">
                <div className="relative flex-1 lg:col-start-3 lg:row-start-1">
                  <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-dim">
                    $
                  </span>
                  <NumberInput
                    thousands
                    value={p.monto}
                    disabled={disabled}
                    // Editar el monto lo desengancha del total para siempre. Es
                    // la única forma de dejar saldo, y por eso no se puede
                    // deshacer solo: si volviera a engancharse al bajar y subir,
                    // el vendedor no podría cobrar justo el total a mano.
                    onChange={(e) =>
                      actualizar(p.key, {
                        monto: Number(e.target.value || 0),
                        tocado: true,
                      })
                    }
                    aria-label="Monto del pago"
                    className="pl-7 text-right font-mono"
                  />
                </div>
                {!unico && puedeAbsorber(p.key) && (
                  <div className="w-24 shrink-0 lg:col-start-5 lg:row-start-1 lg:w-auto">
                    <Button
                      type="button"
                      variant="bare"
                      onClick={() => absorberResto(p.key)}
                      disabled={disabled}
                      className="w-full rounded-md border border-petrol/25 bg-petrol/10 px-3 py-2 text-xs font-semibold text-petrol hover:bg-petrol/15"
                    >
                      Resto
                    </Button>
                  </div>
                )}
              </div>

              {esEfectivo && (
                <div className="relative col-span-3 lg:col-span-1 lg:col-start-4 lg:row-start-1">
                  <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-dim">
                    $
                  </span>
                  {/* Opcional: si el vendedor no lo carga, la venta se registra
                      igual y el pago queda sin vuelto. */}
                  <NumberInput
                    id={`recibido-${p.key}`}
                    thousands
                    value={p.recibido}
                    onChange={(e) => actualizar(p.key, { recibido: e.target.value })}
                    disabled={disabled}
                    placeholder="Opcional — con cuánto paga"
                    aria-label="Recibí"
                    className="border-dashed bg-transparent! pl-7 text-right font-mono"
                  />
                </div>
              )}

              {hayDetalle && (
                <div className="col-span-3 flex flex-col gap-2 lg:col-span-5 lg:col-start-2 lg:flex-row lg:flex-wrap lg:items-center">
                  {opcionesCuenta.length > 1 && (
                    <Select
                      value={p.idCuenta}
                      onChange={(e) =>
                        // El plan vuelve a 1 al cambiar de cuenta: los planes los
                        // configura cada cuenta, y el que estaba elegido puede no
                        // existir en la nueva.
                        actualizar(p.key, { idCuenta: e.target.value, cuotas: null })
                      }
                      disabled={disabled}
                      aria-label="Cuenta destino"
                      className="w-full lg:w-56"
                    >
                      {opcionesCuenta.map((c) => (
                        <option key={c.id_cuenta_destino} value={c.id_cuenta_destino}>
                          {c.nombre}
                        </option>
                      ))}
                    </Select>
                  )}

                  {/* El plan de cuotas se elige acá, sobre la cuenta que ya está
                      seleccionada, y sólo ofrece los planes que esa cuenta tiene
                      configurados. Cambiarlo mueve el precio de la venta
                      (recargo) y el costo de este pago (arancel). */}
                  {p.medio === 'tarjeta_credito' && (
                    <SelectorCuotas
                      cuotas={p.cuotas ?? 1}
                      planes={planesDeCuenta(planesCuotas, aranceles, recargos, p.idCuenta, p.medio)}
                      disabled={disabled}
                      onChange={(cuotas) => actualizar(p.key, { cuotas })}
                    />
                  )}

                  {p.medio === 'transferencia' && (
                    <Input
                      value={p.referencia}
                      onChange={(e) => actualizar(p.key, { referencia: e.target.value })}
                      disabled={disabled}
                      placeholder="Nro. de operación (opcional)"
                      aria-label="Referencia"
                      className="lg:w-64"
                    />
                  )}

                  {vuelto != null && vuelto > 0 && (
                    <span className="inline-flex items-center justify-between gap-3 rounded-md bg-petrol/10 px-3 py-1.5 text-sm lg:justify-start">
                      <span className="text-muted">Vuelto</span>
                      <span className="font-mono font-semibold text-petrol">{money(vuelto)}</span>
                    </span>
                  )}
                  {vuelto != null && vuelto < 0 && (
                    <span className="text-xs text-warn-ink">Recibiste menos que el monto del pago.</span>
                  )}

                  {/* Lo que retiene el procesador de ESTE pago. Se muestra sólo
                      cuando hay algo que descontar: un "comisión $0" en cada
                      cobro en efectivo es ruido. */}
                  {conComision && (
                    <span className="flex items-center justify-between gap-3 text-xs lg:ml-auto">
                      <span className="text-muted">
                        Comisión {costo.arancel_pct}%
                        {costo.dias_acreditacion > 0 && ` · acredita en ${costo.dias_acreditacion} días`}
                      </span>
                      <span className="font-mono text-warn-ink">−{money(costo.costo_total)}</span>
                    </span>
                  )}
                  {sinArancel && <Badge variant="warning">Sin arancel configurado</Badge>}
                </div>
              )}
            </div>
          )
        })}

        {/* Lo que falta NO es un error: es lo que el cliente queda debiendo, y
            el bloque de crédito de abajo lo explica con su plan y su
            vencimiento. Sólo se marca en rojo el exceso, que sí es un error:
            nadie paga de más sin que sea un tipeo. */}
        {!unico && (
          <div className="flex items-center justify-between gap-3 border-t border-line bg-panel-2 px-4 py-3 text-sm">
            <span className={excedido ? 'text-alerta-ink' : 'text-muted'}>
              {cuadra ? 'Cobranza completa' : restante > 0 ? 'Queda debiendo' : 'Te pasaste por'}
            </span>
            <span
              className={`font-mono font-semibold ${
                excedido ? 'text-alerta-ink' : cuadra ? 'text-petrol' : 'text-copper'
              }`}
            >
              {cuadra ? money(total) : money(Math.abs(restante))}
            </span>
          </div>
        )}
      </div>

      {/* Neto: lo que realmente vas a cobrar. Aparece sólo si hay algo que
          descontar; sin costo, el total ya está arriba y repetirlo no
          agrega nada. */}
      {costoTotal > 0 && (
        <div className="space-y-1.5 rounded-lg border border-line-2 bg-card px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-3 text-muted">
            <span>Total de la venta</span>
            <span className="font-mono">{money(total)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-warn-ink">
            <span>Costo de cobro</span>
            <span className="font-mono">−{money(costoTotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-1.5 font-semibold">
            <span>Neto que vas a cobrar</span>
            <span className="font-mono text-petrol">{money(total - costoTotal)}</span>
          </div>
          {diasMax > 0 && (
            <p className="pt-1 text-xs text-muted">
              Acredita en {diasMax} día{diasMax === 1 ? '' : 's'}.
            </p>
          )}
        </div>
      )}

      {/* Por qué no está la tarjeta. Sin este aviso el vendedor busca una
          opción que no existe y no tiene forma de saber que el problema está
          en otra pantalla. */}
      {faltanTarjetas.length > 0 && (
        <p className="rounded-lg border border-line-2 bg-panel-2 px-4 py-2.5 text-xs text-muted">
          No figura{faltanTarjetas.length === 1 ? '' : 'n'}{' '}
          {faltanTarjetas.map((m) => MEDIO_PAGO_LABEL[m].toLowerCase()).join(' ni ')}:
          ninguna cuenta tiene ese tarifario cargado. Se habilita solo al
          cargarlo en Precios y Cuentas → Costo de cobro.
        </p>
      )}

      {faltaTarifario && (
        <p className="rounded-lg border border-line-2 bg-panel-2 px-4 py-2.5 text-xs text-muted">
          Hay pagos sin arancel cargado: se registran con costo cero. Cargalos
          en Precios y Cuentas para que el neto sea real.
        </p>
      )}
    </div>
  )
}

/**
 * Plan de cuotas de un pago con tarjeta.
 *
 * Sólo lista los planes que la cuenta elegida tiene configurados: no hay
 * forma de marcar un plan que ese procesador no ofrece. Con un solo plan
 * posible el selector igual aparece — "1 pago" contra "3 cuotas" es una
 * decisión real, no una formalidad.
 */
function SelectorCuotas({
  cuotas,
  planes,
  disabled,
  onChange,
}: {
  cuotas: number
  planes: number[]
  disabled: boolean
  onChange: (cuotas: number) => void
}) {
  // Un plan que ya no está en la lista (la cuenta cambió y todavía no se
  // normalizó el pago) se muestra igual: un select con `value` fuera de sus
  // opciones queda en blanco y el vendedor no sabe qué va a cobrar.
  const opciones = planes.includes(cuotas) || cuotas === 1 ? planes : [...planes, cuotas]

  return (
    <div className="flex items-center gap-2">
      <label className="shrink-0 text-xs text-muted">Plan</label>
      <Select
        value={cuotas}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label="Cuotas"
        className="w-auto flex-1 lg:w-40 lg:flex-none"
      >
        <option value={1}>1 pago</option>
        {opciones.map((c) => (
          <option key={c} value={c}>
            {c} cuotas
          </option>
        ))}
      </Select>
    </div>
  )
}

/**
 * Un efectivo cuyo "Recibí" es menor que su monto pasa a valer lo recibido.
 * Devuelve el mismo objeto si no hay nada que ajustar.
 */
function ajustarAlRecibido(p: PagoBorrador): PagoBorrador {
  if (p.medio !== 'efectivo' || p.recibido.trim() === '') return p
  const recibido = Number(p.recibido.replace(',', '.'))
  if (!Number.isFinite(recibido) || recibido <= 0 || recibido >= p.monto) return p
  return { ...p, monto: redondear(recibido), tocado: true }
}

/** Redondeo a centavos: evita que el "resto" arrastre basura de punto flotante. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

function money(n: number): string {
  return `$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}
