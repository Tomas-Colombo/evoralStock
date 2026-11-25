import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cambiarItemVentaAction, registrarVentaAction } from './actions'
import * as dalVentas from '@/lib/dal/ventas/venta'
import * as guard from '@/lib/dal/guard'
import * as sessionModule from '@/lib/dal/session'
import { AuthorizationError } from '@/lib/dal/errors'
import { revalidatePath } from 'next/cache'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn(),
}))

vi.mock('@/lib/dal/guard', () => ({
  requireModuleRole: vi.fn(),
}))

vi.mock('@/lib/dal/ventas/venta', () => ({
  spRegistrarVenta: vi.fn(),
  spAnularVenta: vi.fn(),
  spRegistrarDevolucionCliente: vi.fn(),
  spRegistrarCambio: vi.fn(),
}))

const UUID_ITEM = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const UUID_REV = '8a7b6c5d-4e3f-4a1b-8c9d-8e7f6a5b4c3d'

describe('registrarVentaAction — 3 gates and permission matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue({
      tenantId: 'tenant-123',
      user: { id: 'user-456' },
    } as unknown as sessionModule.Session)
  })

  // ── Gate 1: Autorización Ventas ──────────────────────────────────────────
  it('falla en Gate 1 si no tiene permiso ventas:crear', async () => {
    vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
      new AuthorizationError('no-permission'),
    )

    const res = await registrarVentaAction({
      lineas: [{ id_item: UUID_ITEM }],
      formaPago: 'efectivo',
    })

    expect(guard.requireModuleRole).toHaveBeenCalledWith(
      expect.anything(),
      'ventas',
      'crear',
    )
    expect(dalVentas.spRegistrarVenta).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'no-permission' })
  })

  // ── Gate 2: Validación Zod ──────────────────────────────────────────────
  it('falla en Gate 2 con lineas-vacias si la lista de ítems está vacía', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)

    const res = await registrarVentaAction({
      lineas: [],
      formaPago: 'efectivo',
    })

    expect(dalVentas.spRegistrarVenta).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toMatch(/^lineas-vacias/)
    }
  })

  it('falla en Gate 2 con campo-desconocido si envían canal (strictObject)', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)

    const res = await registrarVentaAction({
      lineas: [{ id_item: UUID_ITEM }],
      formaPago: 'efectivo',
      canal: 'revendedora',
    })

    expect(dalVentas.spRegistrarVenta).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'campo-desconocido' })
  })

  it('falla en Gate 2 con campo-desconocido si envían claves extra (strictObject)', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)

    const res = await registrarVentaAction({
      lineas: [{ id_item: UUID_ITEM }],
      formaPago: 'efectivo',
      claveInesperada: 'ataque',
    })

    expect(dalVentas.spRegistrarVenta).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'campo-desconocido' })
  })

  it('falla si hay financiación sin cliente', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)

    const res = await registrarVentaAction({
      lineas: [{ id_item: UUID_ITEM }],
      formaPago: 'efectivo',
      financiacion: { cuotas: 3, primer_vencimiento: '2026-11-01' },
    })

    expect(dalVentas.spRegistrarVenta).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'financiacion-sin-cliente' })
  })

  // ── Gate 3: Llamada a DAL ───────────────────────────────────────────────
  it('registra venta local válida llamando al DAL y revalidando rutas', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)
    vi.mocked(dalVentas.spRegistrarVenta).mockResolvedValue('venta-uuid-123')

    const res = await registrarVentaAction({
      lineas: [{ id_item: UUID_ITEM }],
      formaPago: 'efectivo',
    })

    expect(dalVentas.spRegistrarVenta).toHaveBeenCalledWith({
      lineas: [{ id_item: UUID_ITEM }],
      forma_pago: 'efectivo',
      id_cliente: null,
      id_reserva: null,
      observaciones: null,
      pagos: undefined,
      financiacion: null,
      financiador: null,
      canal: 'local',
      id_revendedora: null,
    })
    expect(revalidatePath).toHaveBeenCalledWith('/ventas')
    expect(revalidatePath).toHaveBeenCalledWith('/inventario/productos')
    expect(revalidatePath).toHaveBeenCalledWith('/inventario')
    expect(res).toEqual({ ok: true, data: { id: 'venta-uuid-123' } })
  })

  it('propaga error del DAL como reason', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)
    vi.mocked(dalVentas.spRegistrarVenta).mockRejectedValue(
      new Error('item-no-disponible'),
    )

    const res = await registrarVentaAction({
      lineas: [{ id_item: UUID_ITEM }],
      formaPago: 'efectivo',
    })

    expect(res).toEqual({ ok: false, reason: 'item-no-disponible' })
  })
})

describe('cambiarItemVentaAction — 3 gates and permission matrix', () => {
  const UUID_DET = '11111111-1111-4111-8111-111111111111'
  const UUID_VENTA = '22222222-2222-4222-8222-222222222222'
  const UUID_ITEM_NEW = '33333333-3333-4333-8333-333333333333'
  const UUID_CUENTA = '44444444-4444-4444-8444-444444444444'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue({
      tenantId: 'tenant-123',
      user: { id: 'user-456' },
    } as unknown as sessionModule.Session)
  })

  it('falla en Gate 1 si el usuario no tiene permiso ventas:crear', async () => {
    vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
      new AuthorizationError('no-permission'),
    )

    const res = await cambiarItemVentaAction({
      idDetalleOriginal: UUID_DET,
      idItemEntregado: UUID_ITEM_NEW,
      idVenta: UUID_VENTA,
    })

    expect(guard.requireModuleRole).toHaveBeenCalledWith(
      expect.anything(),
      'ventas',
      'crear',
    )
    expect(dalVentas.spRegistrarCambio).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'no-permission' })
  })

  it('falla en Gate 2 con payload-invalido si falta idDetalleOriginal', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)

    const res = await cambiarItemVentaAction({
      idItemEntregado: UUID_ITEM_NEW,
      idVenta: UUID_VENTA,
    })

    expect(dalVentas.spRegistrarCambio).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toMatch(/payload-invalido|id-detalle-invalido/)
    }
  })

  it('falla en Gate 2 con campo-desconocido si envían claves extra', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)

    const res = await cambiarItemVentaAction({
      idDetalleOriginal: UUID_DET,
      idItemEntregado: UUID_ITEM_NEW,
      idVenta: UUID_VENTA,
      campoExtraInvalido: 'hack',
    })

    expect(dalVentas.spRegistrarCambio).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'campo-desconocido' })
  })

  it('falla en Gate 1 si canal es revendedora y no tiene revendedoras:crear', async () => {
    vi.mocked(guard.requireModuleRole)
      .mockResolvedValueOnce(undefined) // ventas:crear OK
      .mockRejectedValueOnce(new AuthorizationError('no-permission')) // revendedoras:crear DENIED

    const res = await cambiarItemVentaAction({
      idDetalleOriginal: UUID_DET,
      idItemEntregado: UUID_ITEM_NEW,
      idVenta: UUID_VENTA,
      canal: 'revendedora',
      idRevendedora: UUID_REV,
    })

    expect(guard.requireModuleRole).toHaveBeenCalledWith(
      expect.anything(),
      'revendedoras',
      'crear',
    )
    expect(dalVentas.spRegistrarCambio).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'no-permission' })
  })

  it('cambio local exitoso: llama al DAL y revalida rutas de venta e inventario', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)
    vi.mocked(dalVentas.spRegistrarCambio).mockResolvedValue({
      id_cambio: 'cambio-123',
      diferencia: 500,
      id_detalle_nuevo: 'det-new-123',
    })

    const res = await cambiarItemVentaAction({
      idDetalleOriginal: UUID_DET,
      idItemEntregado: UUID_ITEM_NEW,
      idVenta: UUID_VENTA,
      motivo: 'Cambio de talle',
      medioCobro: 'efectivo',
      idCuentaDestino: UUID_CUENTA,
    })

    expect(dalVentas.spRegistrarCambio).toHaveBeenCalledWith(
      UUID_DET,
      UUID_ITEM_NEW,
      'Cambio de talle',
      'efectivo',
      UUID_CUENTA,
    )
    expect(revalidatePath).toHaveBeenCalledWith('/ventas')
    expect(revalidatePath).toHaveBeenCalledWith(`/ventas/${UUID_VENTA}`)
    expect(revalidatePath).toHaveBeenCalledWith('/inventario/productos')
    expect(res).toEqual({
      ok: true,
      data: {
        id_cambio: 'cambio-123',
        diferencia: 500,
        id_detalle_nuevo: 'det-new-123',
      },
    })
  })

  it('propaga error del DAL como reason', async () => {
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)
    vi.mocked(dalVentas.spRegistrarCambio).mockRejectedValue(
      new Error('venta-liquidada'),
    )

    const res = await cambiarItemVentaAction({
      idDetalleOriginal: UUID_DET,
      idItemEntregado: UUID_ITEM_NEW,
      idVenta: UUID_VENTA,
    })

    expect(res).toEqual({ ok: false, reason: 'venta-liquidada' })
  })
})

