import type { DeudorRow, ResumenCuotas } from '@/lib/dal/cuotas/cuota'
import { finDeMes, inicioDeMes, sumarDias } from '@/lib/dal/cuotas/cuota'
import type { CuotaListada, EstadoCuota } from '@/lib/types/ventas'

export type FilaCuotaOraculo = {
  id_cliente: string
  id_venta: string
  estado: EstadoCuota
  monto: number | string
  monto_pagado: number | string
  fecha_vencimiento: string
  cliente: CuotaListada['cliente']
}

function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Agregación TS pura de deudores y KPIs (cuota.ts:370-465).
 * Desempate canónico: vencido desc, adeudado desc, min(fecha_vencimiento) asc, id_cliente asc.
 */
export function oraculoDeudores(
  filas: FilaCuotaOraculo[],
  hoy: string,
): { rows: DeudorRow[]; resumen: ResumenCuotas } {
  const inicio = inicioDeMes(hoy)
  const fin = finDeMes(hoy)
  const manana = sumarDias(hoy, 1)
  const porCliente = new Map<string, DeudorRow & { _planes: Set<string>; _min_fecha: string }>()

  let aCobrar = 0
  let venceHoy = 0
  let venceManana = 0
  let venceEsteMes = 0
  let vencido = 0
  let incobrable = 0
  let clientesVencidos = 0

  for (const c of filas) {
    const saldo = Number(c.monto) - Number(c.monto_pagado)

    if (c.estado === 'incobrable') {
      incobrable += saldo
      continue
    }
    if (c.estado !== 'pendiente' && c.estado !== 'parcial') continue

    aCobrar += saldo
    const estaVencida = c.fecha_vencimiento < hoy
    if (estaVencida) vencido += saldo
    else {
      if (c.fecha_vencimiento === hoy) venceHoy += saldo
      else if (c.fecha_vencimiento === manana) venceManana += saldo
      if (c.fecha_vencimiento >= inicio && c.fecha_vencimiento <= fin) {
        venceEsteMes += saldo
      }
    }

    let d = porCliente.get(c.id_cliente)
    if (!d) {
      d = {
        id_cliente: c.id_cliente,
        cliente: c.cliente,
        pendientes: 0,
        vencidas: 0,
        adeudado: 0,
        vencido: 0,
        proximo_vencimiento: null,
        vencida_desde: null,
        planes: 0,
        _planes: new Set<string>(),
        _min_fecha: c.fecha_vencimiento,
      }
      porCliente.set(c.id_cliente, d)
    }
    d.pendientes++
    d.adeudado = redondear2(d.adeudado + saldo)
    d._planes.add(c.id_venta)
    if (c.fecha_vencimiento < d._min_fecha) {
      d._min_fecha = c.fecha_vencimiento
    }
    if (estaVencida) {
      d.vencidas++
      d.vencido = redondear2(d.vencido + saldo)
      if (d.vencida_desde === null || c.fecha_vencimiento < d.vencida_desde) {
        d.vencida_desde = c.fecha_vencimiento
      }
    } else if (
      d.proximo_vencimiento === null ||
      c.fecha_vencimiento < d.proximo_vencimiento
    ) {
      d.proximo_vencimiento = c.fecha_vencimiento
    }
  }

  for (const d of porCliente.values()) if (d.vencidas > 0) clientesVencidos++

  const rows = [...porCliente.values()].map(({ _planes, _min_fecha: _m, ...d }) => ({
    ...d,
    planes: _planes.size,
  }))

  rows.sort((a, b) => {
    if (a.vencido !== b.vencido) return b.vencido - a.vencido
    if (a.adeudado !== b.adeudado) return b.adeudado - a.adeudado
    const minA = porCliente.get(a.id_cliente)!._min_fecha
    const minB = porCliente.get(b.id_cliente)!._min_fecha
    if (minA !== minB) return minA < minB ? -1 : 1
    if (a.id_cliente !== b.id_cliente) return a.id_cliente < b.id_cliente ? -1 : 1
    return 0
  })

  return {
    rows,
    resumen: {
      aCobrar: redondear2(aCobrar),
      venceHoy: redondear2(venceHoy),
      venceManana: redondear2(venceManana),
      venceEsteMes: redondear2(venceEsteMes),
      vencido: redondear2(vencido),
      incobrable: redondear2(incobrable),
      clientesConDeuda: porCliente.size,
      clientesVencidos,
      filas: filas.length,
    },
  }
}
