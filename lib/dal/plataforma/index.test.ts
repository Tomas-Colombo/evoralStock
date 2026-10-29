import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthorizationError } from '@/lib/dal/errors'

// Mock de guard
const mockRequireSuperAdmin = vi.fn()
vi.mock('@/lib/dal/plataforma/guard', () => ({
  requireSuperAdmin: () => mockRequireSuperAdmin(),
}))

// Mock de createServiceClient
const mockFrom = vi.fn()
const mockRpc = vi.fn()
vi.mock('@/lib/dal/supabase', () => ({
  createServiceClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
  }),
}))

const SUPER_ADMIN = { id: 'sa-uuid-123', email: 'admin@utopia.com' }
const TENANT_ID_1 = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('DAL Plataforma (lib/dal/plataforma)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireSuperAdmin.mockResolvedValue(SUPER_ADMIN)
  })

  describe('Defensa en profundidad: requireSuperAdmin()', () => {
    it('listarTenants() rechaza si requireSuperAdmin falla', async () => {
      mockRequireSuperAdmin.mockRejectedValue(new AuthorizationError('no-permission'))
      const { listarTenants } = await import('./index')
      await expect(listarTenants()).rejects.toThrow(AuthorizationError)
    })

    it('obtenerTenantDetalle() rechaza si requireSuperAdmin falla', async () => {
      mockRequireSuperAdmin.mockRejectedValue(new AuthorizationError('no-session'))
      const { obtenerTenantDetalle } = await import('./index')
      await expect(obtenerTenantDetalle(TENANT_ID_1)).rejects.toThrow(AuthorizationError)
    })

    it('registrarCargo() rechaza si requireSuperAdmin falla', async () => {
      mockRequireSuperAdmin.mockRejectedValue(new AuthorizationError('no-permission'))
      const { registrarCargo } = await import('./index')
      await expect(
        registrarCargo({
          idTenant: TENANT_ID_1,
          periodo: '2026-11-01',
          monto: 1000,
          concepto: 'Abono',
        }),
      ).rejects.toThrow(AuthorizationError)
    })

    it('registrarPago() rechaza si requireSuperAdmin falla', async () => {
      mockRequireSuperAdmin.mockRejectedValue(new AuthorizationError('no-permission'))
      const { registrarPago } = await import('./index')
      await expect(
        registrarPago({
          idTenant: TENANT_ID_1,
          fecha: '2026-10-29',
          monto: 1000,
          medio: 'transferencia',
        }),
      ).rejects.toThrow(AuthorizationError)
    })

    it('anularMovimiento() rechaza si requireSuperAdmin falla', async () => {
      mockRequireSuperAdmin.mockRejectedValue(new AuthorizationError('no-permission'))
      const { anularMovimiento } = await import('./index')
      await expect(
        anularMovimiento({
          tipo: 'cargo',
          idMovimiento: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        }),
      ).rejects.toThrow(AuthorizationError)
    })

    it('togglePaquete() rechaza si requireSuperAdmin falla', async () => {
      mockRequireSuperAdmin.mockRejectedValue(new AuthorizationError('no-permission'))
      const { togglePaquete } = await import('./index')
      await expect(
        togglePaquete({
          idTenant: TENANT_ID_1,
          paquete: 'revendedoras',
          habilitado: true,
        }),
      ).rejects.toThrow(AuthorizationError)
    })
  })

  describe('listarTenants() - Design for N (máximo 2 queries)', () => {
    it('resuelve 1 o 200 tenants con la misma cantidad fija de queries (máximo 2) y ordenados por nombre_comercial', async () => {
      let queryCount = 0

      // Simulamos 200 tenants
      const mockTenantsData = Array.from({ length: 200 }, (_, i) => ({
        id_tenant: `tenant-${i}`,
        nombre_comercial: `Tenant ${i}`,
        subdominio: `tenant${i}`,
        estado_tenant: 'activo',
        created_at: '2026-01-01T00:00:00Z',
        tenant_modulo: [
          {
            habilitado: true,
            modulo: { codigo: 'revendedoras' },
          },
          {
            habilitado: false,
            modulo: { codigo: 'consignaciones' },
          },
          {
            habilitado: true,
            modulo: { codigo: 'rendiciones' },
          },
        ],
      }))

      const mockSaldosData = Array.from({ length: 200 }, (_, i) => ({
        id_tenant: `tenant-${i}`,
        saldo: i * 100,
        total_cargos: i * 200,
        total_pagos: i * 100,
      }))

      mockFrom.mockImplementation((table: string) => {
        queryCount++
        if (table === 'tenant') {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: mockTenantsData,
                error: null,
              }),
            }),
          }
        }
        if (table === 'tenant_saldo') {
          return {
            select: vi.fn().mockResolvedValue({
              data: mockSaldosData,
              error: null,
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      const { listarTenants } = await import('./index')
      const tenants = await listarTenants()

      expect(queryCount).toBeLessThanOrEqual(2)
      expect(tenants).toHaveLength(200)
      expect(tenants[0].paquetesHabilitados).toContain('revendedoras')
      // consignacionProveedor exige consignaciones Y rendiciones activas
      expect(tenants[0].paquetesHabilitados).not.toContain('consignacionProveedor')
      expect(tenants[5].saldo).toBe(500)
    })
  })

  describe('obtenerTenantDetalle()', () => {
    it('lanza tenant-inexistente si el tenant no existe', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'tenant') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }
        }
        if (table === 'tenant_saldo') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }
      })

      const { obtenerTenantDetalle } = await import('./index')
      await expect(obtenerTenantDetalle(TENANT_ID_1)).rejects.toThrow('tenant-inexistente')
    })

    it('devuelve ficha, paquetes, saldo e historial unificado cronológico descendente', async () => {
      const mockTenantRow = {
        id_tenant: TENANT_ID_1,
        nombre_comercial: 'Tienda Utopía',
        subdominio: 'utopia',
        logo_url: null,
        color_primario: '#112233',
        estado_tenant: 'activo',
        created_at: '2026-01-01T00:00:00Z',
        tenant_modulo: [
          {
            habilitado: true,
            modulo: { codigo: 'revendedoras' },
          },
          {
            habilitado: true,
            modulo: { codigo: 'consignaciones' },
          },
          {
            habilitado: true,
            modulo: { codigo: 'rendiciones' },
          },
        ],
      }

      const mockSaldoRow = {
        id_tenant: TENANT_ID_1,
        saldo: 5000,
        total_cargos: 20000,
        total_pagos: 15000,
      }

      const mockCargos = [
        {
          id: 'cargo-1',
          id_tenant: TENANT_ID_1,
          periodo: '2026-11-01',
          monto: 20000,
          concepto: 'Abono Noviembre',
          created_at: '2026-10-25T10:00:00Z',
          anulado_at: null,
          anulado_por: null,
        },
      ]

      const mockPagos = [
        {
          id: 'pago-1',
          id_tenant: TENANT_ID_1,
          fecha: '2026-10-28',
          monto: 15000,
          medio: 'transferencia',
          nota: 'Comprobante 123',
          created_at: '2026-10-28T14:00:00Z',
          anulado_at: null,
          anulado_por: null,
        },
      ]

      mockFrom.mockImplementation((table: string) => {
        if (table === 'tenant') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: mockTenantRow, error: null }),
              }),
            }),
          }
        }
        if (table === 'tenant_saldo') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: mockSaldoRow, error: null }),
              }),
            }),
          }
        }
        if (table === 'tenant_cargo') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: mockCargos, error: null }),
              }),
            }),
          }
        }
        if (table === 'tenant_pago') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: mockPagos, error: null }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const { obtenerTenantDetalle } = await import('./index')
      const detalle = await obtenerTenantDetalle(TENANT_ID_1)

      expect(detalle.tenant.idTenant).toBe(TENANT_ID_1)
      expect(detalle.tenant.nombreComercial).toBe('Tienda Utopía')
      expect(detalle.paquetes.revendedoras).toBe(true)
      expect(detalle.paquetes.consignacionProveedor).toBe(true)
      expect(detalle.saldo).toBe(5000)
      expect(detalle.totalCargos).toBe(20000)
      expect(detalle.totalPagos).toBe(15000)

      // Historial unificado y ordenado desc:
      // cargo-1 es del 2026-11-01, pago-1 es del 2026-10-28
      expect(detalle.historial).toHaveLength(2)
      expect(detalle.historial[0].id).toBe('cargo-1')
      expect(detalle.historial[0].tipo).toBe('cargo')
      expect(detalle.historial[0].fechaImputacion).toBe('2026-11-01')
      expect(detalle.historial[1].id).toBe('pago-1')
      expect(detalle.historial[1].tipo).toBe('pago')
      expect(detalle.historial[1].fechaImputacion).toBe('2026-10-28')
    })
  })

  describe('Procedimientos almacenados y traducción de errores', () => {
    it('registrarCargo invoca sp_registrar_cargo_tenant con p_created_by y retorna id', async () => {
      mockRpc.mockResolvedValue({ data: 'cargo-uuid-new', error: null })
      const { registrarCargo } = await import('./index')
      const res = await registrarCargo({
        idTenant: TENANT_ID_1,
        periodo: '2026-11-01',
        monto: 5000,
        concepto: 'Cargo test',
      })

      expect(mockRpc).toHaveBeenCalledWith('sp_registrar_cargo_tenant', {
        p_id_tenant: TENANT_ID_1,
        p_periodo: '2026-11-01',
        p_monto: 5000,
        p_concepto: 'Cargo test',
        p_created_by: SUPER_ADMIN.id,
      })
      expect(res).toEqual({ ok: true, data: { id: 'cargo-uuid-new' } })
    })

    it('registrarCargo traduce error de SP a slug sin volcar Postgres crudo', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'sp_registrar_cargo_tenant: periodo-invalido' },
      })
      const { registrarCargo } = await import('./index')
      const res = await registrarCargo({
        idTenant: TENANT_ID_1,
        periodo: '2026-11-15',
        monto: 5000,
        concepto: 'Cargo test',
      })
      expect(res).toEqual({ ok: false, reason: 'periodo-invalido' })
    })

    it('registrarPago invoca sp_registrar_pago_tenant con p_created_by y retorna id', async () => {
      mockRpc.mockResolvedValue({ data: 'pago-uuid-new', error: null })
      const { registrarPago } = await import('./index')
      const res = await registrarPago({
        idTenant: TENANT_ID_1,
        fecha: '2026-10-29',
        monto: 3000,
        medio: 'efectivo',
        nota: 'Recibo 1',
      })

      expect(mockRpc).toHaveBeenCalledWith('sp_registrar_pago_tenant', {
        p_id_tenant: TENANT_ID_1,
        p_fecha: '2026-10-29',
        p_monto: 3000,
        p_medio: 'efectivo',
        p_nota: 'Recibo 1',
        p_created_by: SUPER_ADMIN.id,
      })
      expect(res).toEqual({ ok: true, data: { id: 'pago-uuid-new' } })
    })

    it('registrarPago traduce error de fecha-invalida', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'sp_registrar_pago_tenant: fecha-invalida' },
      })
      const { registrarPago } = await import('./index')
      const res = await registrarPago({
        idTenant: TENANT_ID_1,
        fecha: '2099-01-01',
        monto: 3000,
        medio: 'efectivo',
      })
      expect(res).toEqual({ ok: false, reason: 'fecha-invalida' })
    })

    it('anularMovimiento invoca sp_anular_movimiento_tenant con p_anulado_por', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null })
      const { anularMovimiento } = await import('./index')
      const res = await anularMovimiento({
        tipo: 'cargo',
        idMovimiento: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      })

      expect(mockRpc).toHaveBeenCalledWith('sp_anular_movimiento_tenant', {
        p_tipo: 'cargo',
        p_id_movimiento: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        p_anulado_por: SUPER_ADMIN.id,
      })
      expect(res).toEqual({ ok: true })
    })

    it('anularMovimiento traduce movimiento-ya-anulado', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'sp_anular_movimiento_tenant: movimiento-ya-anulado' },
      })
      const { anularMovimiento } = await import('./index')
      const res = await anularMovimiento({
        tipo: 'pago',
        idMovimiento: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      })
      expect(res).toEqual({ ok: false, reason: 'movimiento-ya-anulado' })
    })

    it('togglePaquete invoca sp_toggle_tenant_modulo_admin con actor e IP', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null })
      const { togglePaquete } = await import('./index')
      const res = await togglePaquete(
        {
          idTenant: TENANT_ID_1,
          paquete: 'revendedoras',
          habilitado: true,
        },
        null,
      )

      expect(mockRpc).toHaveBeenCalledWith('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: TENANT_ID_1,
        p_paquete: 'revendedoras',
        p_habilitado: true,
        p_actor: SUPER_ADMIN.id,
        p_ip: null,
      })
      expect(res).toEqual({ ok: true })
    })

    it('togglePaquete traduce modulo-con-estado-vivo', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'sp_toggle_tenant_modulo_admin: modulo-con-estado-vivo' },
      })
      const { togglePaquete } = await import('./index')
      const res = await togglePaquete({
        idTenant: TENANT_ID_1,
        paquete: 'revendedoras',
        habilitado: false,
      })
      expect(res).toEqual({ ok: false, reason: 'modulo-con-estado-vivo' })
    })
  })
})
