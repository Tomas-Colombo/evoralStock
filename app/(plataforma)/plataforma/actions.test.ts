import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthorizationError } from '@/lib/dal/errors'

// Mock de revalidatePath
const mockRevalidatePath = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}))

// Mock de requireSuperAdmin
const mockRequireSuperAdmin = vi.fn()
vi.mock('@/lib/dal/plataforma/guard', () => ({
  requireSuperAdmin: () => mockRequireSuperAdmin(),
}))

// Mock del DAL de plataforma
const mockRegistrarCargo = vi.fn()
const mockRegistrarPago = vi.fn()
const mockAnularMovimiento = vi.fn()
const mockTogglePaquete = vi.fn()
vi.mock('@/lib/dal/plataforma', () => ({
  registrarCargo: (input: unknown) => mockRegistrarCargo(input),
  registrarPago: (input: unknown) => mockRegistrarPago(input),
  anularMovimiento: (input: unknown) => mockAnularMovimiento(input),
  togglePaquete: (input: unknown, ip: unknown) => mockTogglePaquete(input, ip),
}))

const SUPER_ADMIN = { id: 'sa-actor-uuid', email: 'admin@utopia.com' }
const TENANT_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const MOVIMIENTO_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

describe('Server Actions Plataforma (app/(plataforma)/plataforma/actions)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireSuperAdmin.mockResolvedValue(SUPER_ADMIN)
  })

  describe('Compuerta 1: Autorización (requireSuperAdmin)', () => {
    it('no super admin -> rechazo no-permission y el DAL NO se llama', async () => {
      mockRequireSuperAdmin.mockRejectedValue(new AuthorizationError('no-permission'))
      const { registrarCargoTenantAction } = await import('./actions')

      const res = await registrarCargoTenantAction({
        idTenant: TENANT_ID,
        periodo: '2026-11',
        monto: 1000,
        concepto: 'Cargo',
      })

      expect(res).toEqual({ ok: false, reason: 'no-permission' })
      expect(mockRegistrarCargo).not.toHaveBeenCalled()
    })

    it('sin sesión -> rechazo no-session y el DAL NO se llama', async () => {
      mockRequireSuperAdmin.mockRejectedValue(new AuthorizationError('no-session'))
      const { registrarPagoTenantAction } = await import('./actions')

      const res = await registrarPagoTenantAction({
        idTenant: TENANT_ID,
        fecha: '2026-10-29',
        monto: 500,
        medio: 'efectivo',
      })

      expect(res).toEqual({ ok: false, reason: 'no-session' })
      expect(mockRegistrarPago).not.toHaveBeenCalled()
    })
  })

  describe('Compuerta 2: Validación Zod (safeParse y strictObject)', () => {
    it('input inválido -> retorna el slug y el DAL NO se llama', async () => {
      const { registrarCargoTenantAction } = await import('./actions')

      const res = await registrarCargoTenantAction({
        idTenant: TENANT_ID,
        periodo: 'fecha-invalida',
        monto: 1000,
        concepto: 'Cargo',
      })

      expect(res).toEqual({ ok: false, reason: 'periodo-invalido' })
      expect(mockRegistrarCargo).not.toHaveBeenCalled()
    })

    it('intento de inyectar actor o created_by -> rechazo campo-desconocido y DAL NO se llama', async () => {
      const { registrarCargoTenantAction, anularMovimientoTenantAction } = await import('./actions')

      const resCargo = await registrarCargoTenantAction({
        idTenant: TENANT_ID,
        periodo: '2026-11',
        monto: 1000,
        concepto: 'Cargo',
        created_by: 'hacked-uuid',
      })
      expect(resCargo).toEqual({ ok: false, reason: 'campo-desconocido' })
      expect(mockRegistrarCargo).not.toHaveBeenCalled()

      const resAnular = await anularMovimientoTenantAction({
        tipo: 'cargo',
        idMovimiento: MOVIMIENTO_ID,
        anulado_por: 'hacked-uuid',
      })
      expect(resAnular).toEqual({ ok: false, reason: 'campo-desconocido' })
      expect(mockAnularMovimiento).not.toHaveBeenCalled()
    })
  })

  describe('Compuerta 3: Invocación al DAL y revalidación', () => {
    it('registrarCargoTenantAction pasa parsed.data, revalida rutas y devuelve { ok: true }', async () => {
      mockRegistrarCargo.mockResolvedValue({ ok: true, data: { id: 'new-cargo-id' } })
      const { registrarCargoTenantAction } = await import('./actions')

      const res = await registrarCargoTenantAction({
        idTenant: TENANT_ID,
        periodo: '2026-11',
        monto: 25000,
        concepto: '  Abono mensual  ',
      })

      expect(res).toEqual({ ok: true, data: { id: 'new-cargo-id' } })
      expect(mockRegistrarCargo).toHaveBeenCalledWith({
        idTenant: TENANT_ID,
        periodo: '2026-11-01',
        monto: 25000,
        concepto: 'Abono mensual',
      })
      expect(mockRevalidatePath).toHaveBeenCalledWith('/plataforma')
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/plataforma/${TENANT_ID}`)
    })

    it('registrarPagoTenantAction pasa parsed.data, revalida rutas y devuelve { ok: true }', async () => {
      mockRegistrarPago.mockResolvedValue({ ok: true, data: { id: 'new-pago-id' } })
      const { registrarPagoTenantAction } = await import('./actions')

      const res = await registrarPagoTenantAction({
        idTenant: TENANT_ID,
        fecha: '2026-10-29',
        monto: 15000,
        medio: 'transferencia',
        nota: '  Pago parcial  ',
      })

      expect(res).toEqual({ ok: true, data: { id: 'new-pago-id' } })
      expect(mockRegistrarPago).toHaveBeenCalledWith({
        idTenant: TENANT_ID,
        fecha: '2026-10-29',
        monto: 15000,
        medio: 'transferencia',
        nota: 'Pago parcial',
      })
      expect(mockRevalidatePath).toHaveBeenCalledWith('/plataforma')
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/plataforma/${TENANT_ID}`)
    })

    it('anularMovimientoTenantAction pasa parsed.data y revalida rutas', async () => {
      mockAnularMovimiento.mockResolvedValue({ ok: true })
      const { anularMovimientoTenantAction } = await import('./actions')

      const res = await anularMovimientoTenantAction({
        tipo: 'cargo',
        idMovimiento: MOVIMIENTO_ID,
      })

      expect(res).toEqual({ ok: true })
      expect(mockAnularMovimiento).toHaveBeenCalledWith({
        tipo: 'cargo',
        idMovimiento: MOVIMIENTO_ID,
      })
      expect(mockRevalidatePath).toHaveBeenCalledWith('/plataforma')
      expect(mockRevalidatePath).toHaveBeenCalledWith('/plataforma/[id]', 'page')
    })

    it('togglePaqueteTenantAction pasa parsed.data con IP null y revalida rutas', async () => {
      mockTogglePaquete.mockResolvedValue({ ok: true })
      const { togglePaqueteTenantAction } = await import('./actions')

      const res = await togglePaqueteTenantAction({
        idTenant: TENANT_ID,
        paquete: 'revendedoras',
        habilitado: true,
      })

      expect(res).toEqual({ ok: true })
      expect(mockTogglePaquete).toHaveBeenCalledWith(
        {
          idTenant: TENANT_ID,
          paquete: 'revendedoras',
          habilitado: true,
        },
        null,
      )
      expect(mockRevalidatePath).toHaveBeenCalledWith('/plataforma')
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/plataforma/${TENANT_ID}`)
    })

    it('retorna error del DAL sin revalidar rutas cuando la operación falla', async () => {
      mockTogglePaquete.mockResolvedValue({ ok: false, reason: 'modulo-con-estado-vivo' })
      const { togglePaqueteTenantAction } = await import('./actions')

      const res = await togglePaqueteTenantAction({
        idTenant: TENANT_ID,
        paquete: 'revendedoras',
        habilitado: false,
      })

      expect(res).toEqual({ ok: false, reason: 'modulo-con-estado-vivo' })
      expect(mockRevalidatePath).not.toHaveBeenCalled()
    })
  })
})
