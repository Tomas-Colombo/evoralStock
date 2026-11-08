'use server'

import { revalidatePath } from 'next/cache'
import { AuthorizationError } from '@/lib/dal/errors'
import { requireModuleRole } from '@/lib/dal/guard'
import { verifySession } from '@/lib/dal/session'
import {
  spAnularVenta,
  spRegistrarCambio,
  spRegistrarDevolucionCliente,
  spRegistrarVenta,
} from '@/lib/dal/ventas/venta'
import { spEmitirComprobante } from '@/lib/dal/ventas/comprobante'
import {
  spCancelarReserva,
  spCrearReserva,
  spVencerReservas,
} from '@/lib/dal/reservas/reserva'
import { primerReason } from '@/lib/validation/administracion'
import {
  anularVentaSchema,
  cambiarItemVentaSchema,
  devolverItemVentaSchema,
  registrarVentaSchema,
} from '@/lib/validation/ventas'
import type { FormaPago } from '@/lib/types/precios'
import type {
  MedioPago,
  TipoComprobante,
} from '@/lib/types/ventas'

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string }
type Guarded =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; error: string }

async function guarded(modulo: string, accion: string): Promise<Guarded> {
  try {
    const session = await verifySession()
    await requireModuleRole(session, modulo, accion)
    return { ok: true, tenantId: session.tenantId, userId: session.user.id }
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, error: e.reason }
    throw e
  }
}

// ─── Ventas ──────────────────────────────────────────────────────────

export async function registrarVentaAction(
  rawInput: unknown,
): Promise<ActionResult<{ id: string }>> {
  const gVentas = await guarded('ventas', 'crear')
  if (!gVentas.ok) return { ok: false, reason: gVentas.error }

  const parsed = registrarVentaSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, reason: primerReason(parsed.error) }
  }
  const input = parsed.data

  if (input.canal && input.canal !== 'local') {
    const gRev = await guarded('revendedoras', 'crear')
    if (!gRev.ok) return { ok: false, reason: gRev.error }
  }

  const idRevendedora = input.idRevendedora ?? null
  if (input.canal === 'revendedora' && !idRevendedora) {
    return { ok: false, reason: 'revendedora-invalida' }
  }

  // Se chequea acá además de en el SP: el error del RPC llega después de
  // haber empezado la transacción, y este es un dato que la UI ya tiene.
  if (input.financiacion && !input.idCliente) {
    return { ok: false, reason: 'financiacion-sin-cliente' }
  }

  try {
    const id = await spRegistrarVenta({
      lineas: input.lineas,
      forma_pago: input.formaPago as FormaPago,
      id_cliente: input.idCliente ?? null,
      id_reserva: input.idReserva ?? null,
      observaciones: input.observaciones ?? null,
      pagos: input.pagos,
      financiacion: input.financiacion ?? null,
      financiador: input.financiador ?? null,
      canal: input.canal,
      id_revendedora: idRevendedora,
    })
    revalidatePath('/ventas')
    revalidatePath('/inventario/productos')
    revalidatePath('/inventario')
    if (input.canal === 'revendedora') {
      revalidatePath('/revendedoras')
      if (idRevendedora) revalidatePath(`/revendedoras/${idRevendedora}`)
    }
    if (input.financiacion) revalidatePath('/cuotas')
    if (input.idReserva) revalidatePath(`/ventas/reservas/${input.idReserva}`)
    return { ok: true, data: { id } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function anularVentaAction(input: {
  idVenta: string
  motivo?: string
}): Promise<ActionResult<{ total_reintegrado: number }>> {
  const g = await guarded('ventas', 'editar')
  if (!g.ok) return { ok: false, reason: g.error }

  const parsed = anularVentaSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: primerReason(parsed.error) }

  try {
    const res = await spAnularVenta(
      parsed.data.idVenta,
      parsed.data.motivo
    )
    revalidatePath('/ventas')
    revalidatePath(`/ventas/${parsed.data.idVenta}`)
    revalidatePath('/inventario/productos')
    return { ok: true, data: res }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function devolverItemVentaAction(input: {
  idDetalleVenta: string
  idVenta: string
  motivo?: string
  idCuentaReintegro?: string | null
  medioReintegro?: MedioPago | null
}): Promise<ActionResult<{ reintegro: number }>> {
  const g = await guarded('ventas', 'editar')
  if (!g.ok) return { ok: false, reason: g.error }

  const parsed = devolverItemVentaSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: primerReason(parsed.error) }

  try {
    const res = await spRegistrarDevolucionCliente(
      parsed.data.idDetalleVenta,
      parsed.data.motivo,
      parsed.data.idCuentaReintegro,
      parsed.data.medioReintegro
    )
    revalidatePath(`/ventas/${parsed.data.idVenta}`)
    return { ok: true, data: res }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function cambiarItemVentaAction(
  rawInput: unknown,
): Promise<ActionResult<{ id_cambio: string; diferencia: number; id_detalle_nuevo: string }>> {
  const gVentas = await guarded('ventas', 'crear')
  if (!gVentas.ok) return { ok: false, reason: gVentas.error }

  const parsed = cambiarItemVentaSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, reason: primerReason(parsed.error) }

  if (parsed.data.canal === 'revendedora') {
    const gRev = await guarded('revendedoras', 'crear')
    if (!gRev.ok) return { ok: false, reason: gRev.error }
  }

  try {
    const res = await spRegistrarCambio(
      parsed.data.idDetalleOriginal,
      parsed.data.idItemEntregado,
      parsed.data.motivo,
      parsed.data.medioCobro,
      parsed.data.idCuentaDestino,
    )
    revalidatePath('/ventas')
    revalidatePath(`/ventas/${parsed.data.idVenta}`)
    revalidatePath('/inventario/productos')
    revalidatePath('/inventario')
    if (parsed.data.canal === 'revendedora') {
      revalidatePath('/revendedoras')
      if (parsed.data.idRevendedora) {
        revalidatePath(`/revendedoras/${parsed.data.idRevendedora}`)
      }
    }
    return { ok: true, data: res }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function emitirComprobanteAction(input: {
  idVenta: string
  tipo: TipoComprobante
  numero: string
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('ventas', 'crear')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    const id = await spEmitirComprobante({
      idVenta: input.idVenta,
      tipo: input.tipo,
      numero: input.numero.trim(),
    })
    revalidatePath(`/ventas/${input.idVenta}`)
    return { ok: true, data: { id } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

// ─── Reservas ────────────────────────────────────────────────────────

export async function crearReservaAction(input: {
  idCliente: string | null
  items: string[]
  fechaVencimiento: string
  observaciones?: string | null
}): Promise<ActionResult<{ id: string }>> {
  const g = await guarded('ventas', 'crear')
  if (!g.ok) return { ok: false, reason: g.error }
  if (input.items.length === 0) return { ok: false, reason: 'items-vacios' }
  try {
    const id = await spCrearReserva({
      idCliente: input.idCliente,
      items: input.items,
      fechaVencimiento: input.fechaVencimiento,
      observaciones: input.observaciones ?? null,
    })
    revalidatePath('/ventas/reservas')
    return { ok: true, data: { id } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function cancelarReservaAction(input: {
  idReserva: string
  motivo?: string
}): Promise<ActionResult> {
  const g = await guarded('ventas', 'editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    await spCancelarReserva(input.idReserva, input.motivo)
    revalidatePath('/ventas/reservas')
    revalidatePath(`/ventas/reservas/${input.idReserva}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function vencerReservasAction(): Promise<ActionResult<{ vencidas: number }>> {
  const g = await guarded('ventas', 'editar')
  if (!g.ok) return { ok: false, reason: g.error }
  try {
    const vencidas = await spVencerReservas()
    revalidatePath('/ventas/reservas')
    return { ok: true, data: { vencidas } }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}
