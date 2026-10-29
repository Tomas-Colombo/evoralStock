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
const mockCreateUser = vi.fn()
const mockDeleteUser = vi.fn()
vi.mock('@/lib/dal/supabase', () => ({
  createServiceClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      admin: {
        createUser: mockCreateUser,
        deleteUser: mockDeleteUser,
      },
    },
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

  describe('listarTenantsPaginado() - Design for N (máximo 2 queries, range y count)', () => {
    it('calcula el range correcto por página y tamaño', async () => {
      let rangeArgs: [number, number] | null = null

      mockFrom.mockImplementation((table: string) => {
        if (table === 'tenant_listado') {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                range: vi.fn().mockImplementation((from: number, to: number) => {
                  rangeArgs = [from, to]
                  return Promise.resolve({ data: [], count: 0, error: null })
                }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const { listarTenantsPaginado } = await import('./index')

      // Página 1, 25 items -> 0..24
      await listarTenantsPaginado({ page: 1, pageSize: 25 })
      expect(rangeArgs).toEqual([0, 24])

      // Página 2, 25 items -> 25..49
      await listarTenantsPaginado({ page: 2, pageSize: 25 })
      expect(rangeArgs).toEqual([25, 49])

      // Página 3, 10 items -> 20..29
      await listarTenantsPaginado({ page: 3, pageSize: 10 })
      expect(rangeArgs).toEqual([20, 29])
    })

    it('devuelve total desde count: exact y mapea filas con módulos en máximo 2 queries', async () => {
      let queryCount = 0

      const mockRows = [
        {
          id_tenant: 't-1',
          nombre_comercial: 'Tenant 1',
          subdominio: 'tenant1',
          estado_tenant: 'activo',
          created_at: '2026-01-01T00:00:00Z',
          saldo: 1500,
          total_cargos: 2000,
          total_pagos: 500,
        },
      ]

      const mockModulos = [
        {
          id_tenant: 't-1',
          habilitado: true,
          modulo: { codigo: 'revendedoras' },
        },
      ]

      mockFrom.mockImplementation((table: string) => {
        queryCount++
        if (table === 'tenant_listado') {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                range: vi.fn().mockResolvedValue({
                  data: mockRows,
                  count: 42,
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'tenant_modulo') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: mockModulos,
                error: null,
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const { listarTenantsPaginado } = await import('./index')
      const res = await listarTenantsPaginado({ page: 1, pageSize: 25 })

      expect(queryCount).toBe(2)
      expect(res.total).toBe(42)
      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].idTenant).toBe('t-1')
      expect(res.rows[0].saldo).toBe(1500)
      expect(res.rows[0].paquetesHabilitados).toContain('revendedoras')
    })

    it('aplica filtros de estado, deuda, búsqueda escapada y ordenamiento', async () => {
      const eqMock = vi.fn()
      const gtMock = vi.fn()
      const lteMock = vi.fn()
      const orMock = vi.fn()
      const orderMock = vi.fn()

      const queryBuilder: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: eqMock.mockReturnThis(),
        gt: gtMock.mockReturnThis(),
        lte: lteMock.mockReturnThis(),
        or: orMock.mockReturnThis(),
        order: orderMock.mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
      }

      mockFrom.mockImplementation((table: string) => {
        if (table === 'tenant_listado') return queryBuilder
        throw new Error(`Unexpected table ${table}`)
      })

      const { listarTenantsPaginado } = await import('./index')

      // Filtro activo + con-deuda + q con caracteres especiales a escapar + saldo_desc
      await listarTenantsPaginado({
        page: 1,
        estado: 'activo',
        deuda: 'con-deuda',
        q: '100%_algodón',
        orden: 'saldo_desc',
      })

      expect(eqMock).toHaveBeenCalledWith('estado_tenant', 'activo')
      expect(gtMock).toHaveBeenCalledWith('saldo', 0)
      expect(orMock).toHaveBeenCalledWith('nombre_comercial.ilike.%100\\%\\_algodón%,subdominio.ilike.%100\\%\\_algodón%')
      expect(orderMock).toHaveBeenCalledWith('saldo', { ascending: false })

      // Filtro suspendido + al-dia + alta_desc
      vi.clearAllMocks()
      await listarTenantsPaginado({
        page: 1,
        estado: 'suspendido',
        deuda: 'al-dia',
        orden: 'alta_desc',
      })

      expect(eqMock).toHaveBeenCalledWith('estado_tenant', 'suspendido')
      expect(lteMock).toHaveBeenCalledWith('saldo', 0)
      expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false })
    })

    it('ejecuta 1 sola query si la página no tiene tenants (evita query vacía a tenant_modulo)', async () => {
      let queryCount = 0

      mockFrom.mockImplementation((table: string) => {
        queryCount++
        if (table === 'tenant_listado') {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      })

      const { listarTenantsPaginado } = await import('./index')
      const res = await listarTenantsPaginado({ page: 1 })

      expect(queryCount).toBe(1)
      expect(res.rows).toEqual([])
      expect(res.total).toBe(0)
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
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
                }),
              }),
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
        if (table === 'tenant_movimiento') {
          const mockMovs = [
            {
              id: 'cargo-1',
              id_tenant: TENANT_ID_1,
              tipo: 'cargo',
              fecha: '2026-11-01',
              monto: 20000,
              concepto: 'Abono Noviembre',
              medio: null,
              nota: null,
              created_at: '2026-10-25T10:00:00Z',
              anulado_at: null,
              anulado_por: null,
            },
            {
              id: 'pago-1',
              id_tenant: TENANT_ID_1,
              tipo: 'pago',
              fecha: '2026-10-28',
              monto: 15000,
              concepto: null,
              medio: 'transferencia',
              nota: 'Comprobante 123',
              created_at: '2026-10-28T14:00:00Z',
              anulado_at: null,
              anulado_por: null,
            },
          ]
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    range: vi.fn().mockResolvedValue({ data: mockMovs, count: 2, error: null }),
                  }),
                }),
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
      expect(detalle.totalHistorial).toBe(2)
      expect(detalle.hpage).toBe(1)
      expect(detalle.hpageSize).toBe(25)
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

    describe('altaTenant() - Provisión y compensación (REQ-SA-09 / DR-SA-06)', () => {
      it('createUser con code email_exists o mensaje already registered -> devuelve email-en-uso', async () => {
        const { altaTenant } = await import('./index')

        // 1. Por code === 'email_exists'
        mockCreateUser.mockResolvedValueOnce({
          data: null,
          error: { code: 'email_exists', message: 'User already exists' },
        })
        const res1 = await altaTenant({
          nombre: 'Comercio Test',
          subdominio: 'comercio-test',
          emailAdmin: 'duplicado@test.com',
          nombreAdmin: 'Admin Test',
          paquetes: [],
        })
        expect(res1).toEqual({ ok: false, reason: 'email-en-uso' })

        // 2. Por fallback mensaje 'already registered'
        mockCreateUser.mockResolvedValueOnce({
          data: null,
          error: { message: 'A user with this email has already registered' },
        })
        const res2 = await altaTenant({
          nombre: 'Comercio Test',
          subdominio: 'comercio-test',
          emailAdmin: 'duplicado@test.com',
          nombreAdmin: 'Admin Test',
          paquetes: [],
        })
        expect(res2).toEqual({ ok: false, reason: 'email-en-uso' })

        // 3. Error 422 genérico sin code ni already registered -> no devuelve email-en-uso
        mockCreateUser.mockResolvedValueOnce({
          data: null,
          error: { status: 422, message: 'some other 422 error' },
        })
        const res3 = await altaTenant({
          nombre: 'Comercio Test',
          subdominio: 'comercio-test',
          emailAdmin: 'duplicado@test.com',
          nombreAdmin: 'Admin Test',
          paquetes: [],
        })
        expect(res3.ok).toBe(false)
        if (!res3.ok) {
          expect(res3.reason).not.toBe('email-en-uso')
        }

        expect(mockRpc).not.toHaveBeenCalled()
        expect(mockDeleteUser).not.toHaveBeenCalled()
      })

      it('compensación del DAL: sp_alta_tenant rpc falla -> deleteUser llamado y devuelve el slug', async () => {
        mockCreateUser.mockResolvedValue({
          data: { user: { id: 'created-auth-user-id', email: 'nuevo@test.com' } },
          error: null,
        })
        mockDeleteUser.mockResolvedValue({ data: null, error: null })
        mockRpc.mockResolvedValue({
          data: null,
          error: { message: 'sp_alta_tenant: subdominio-en-uso' },
        })

        const { altaTenant } = await import('./index')
        const res = await altaTenant({
          nombre: 'Comercio Test',
          subdominio: 'comercio-test',
          emailAdmin: 'nuevo@test.com',
          nombreAdmin: 'Admin Test',
          paquetes: ['revendedoras'],
        })

        expect(res).toEqual({ ok: false, reason: 'subdominio-en-uso' })
        expect(mockDeleteUser).toHaveBeenCalledWith('created-auth-user-id')
      })

      it('compensación con fallo en deleteUser: registra console.error sin email ni clave', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        mockCreateUser.mockResolvedValue({
          data: { user: { id: 'orphan-auth-user-id', email: 'sensible@test.com' } },
          error: null,
        })
        mockDeleteUser.mockResolvedValue({ data: null, error: { message: 'Network error deleting user' } })
        mockRpc.mockResolvedValue({
          data: null,
          error: { message: 'subdominio-en-uso' },
        })

        const { altaTenant } = await import('./index')
        const res = await altaTenant({
          nombre: 'Comercio Test',
          subdominio: 'comercio-test',
          emailAdmin: 'sensible@test.com',
          nombreAdmin: 'Admin Test',
          paquetes: [],
        })

        expect(res).toEqual({ ok: false, reason: 'subdominio-en-uso' })
        expect(consoleErrorSpy).toHaveBeenCalledWith('altaTenant: auth user huérfano', 'orphan-auth-user-id')
        // Verificar que no se imprimió el email ni clave en los logs
        for (const call of consoleErrorSpy.mock.calls) {
          const joined = call.join(' ')
          expect(joined).not.toContain('sensible@test.com')
        }
        consoleErrorSpy.mockRestore()
      })

      it('caso feliz: crea usuario, invoca sp_alta_tenant con actor y devuelve idTenant y passwordTemporal', async () => {
        mockCreateUser.mockResolvedValue({
          data: { user: { id: 'auth-user-999', email: 'exito@boutique.com' } },
          error: null,
        })
        mockDeleteUser.mockResolvedValue({ data: null, error: null })
        mockRpc.mockResolvedValue({
          data: 'new-tenant-uuid-123',
          error: null,
        })

        const { altaTenant } = await import('./index')
        const res = await altaTenant({
          nombre: 'Boutique Éxito',
          subdominio: 'boutique-exito',
          emailAdmin: 'exito@boutique.com',
          nombreAdmin: 'Ana Éxito',
          paquetes: ['revendedoras'],
        })

        expect(mockDeleteUser).not.toHaveBeenCalled()
        expect(mockRpc).toHaveBeenCalledWith(
          'sp_alta_tenant',
          expect.objectContaining({
            p_nombre: 'Boutique Éxito',
            p_subdominio: 'boutique-exito',
            p_paquetes: ['revendedoras'],
            p_id_auth_user: 'auth-user-999',
            p_email: 'exito@boutique.com',
            p_nombre_admin: 'Ana Éxito',
            p_actor: SUPER_ADMIN.id,
          }),
        )
        expect(res.ok).toBe(true)
        if (res.ok) {
          expect(res.data.idTenant).toBe('new-tenant-uuid-123')
          expect(typeof res.data.passwordTemporal).toBe('string')
          expect(res.data.passwordTemporal.length).toBeGreaterThanOrEqual(16)
        }
      })
    })

    describe('cambiarEstadoTenant() (REQ-SA-10 / D1, D4)', () => {
      it('invoca sp_cambiar_estado_tenant con actor e idTenant', async () => {
        mockRpc.mockResolvedValue({ data: null, error: null })
        const { cambiarEstadoTenant } = await import('./index')
        const res = await cambiarEstadoTenant({
          idTenant: TENANT_ID_1,
          estado: 'suspendido',
        })

        expect(mockRpc).toHaveBeenCalledWith('sp_cambiar_estado_tenant', {
          p_id_tenant: TENANT_ID_1,
          p_estado: 'suspendido',
          p_actor: SUPER_ADMIN.id,
        })
        expect(res).toEqual({ ok: true })
      })

      it('traduce error de sp_cambiar_estado_tenant', async () => {
        mockRpc.mockResolvedValue({
          data: null,
          error: { message: 'sp_cambiar_estado_tenant: tenant-inexistente' },
        })
        const { cambiarEstadoTenant } = await import('./index')
        const res = await cambiarEstadoTenant({
          idTenant: TENANT_ID_1,
          estado: 'suspendido',
        })
        expect(res).toEqual({ ok: false, reason: 'tenant-inexistente' })
      })
    })

    describe('extraerSlugError()', () => {
      it('reconoce usuario-invalido, nombre-invalido y permisos-no-objeto', async () => {
        const { extraerSlugError } = await import('./index')

        expect(extraerSlugError({ message: 'sp_alta_tenant: usuario-invalido' })).toBe('usuario-invalido')
        expect(extraerSlugError({ message: 'sp_alta_tenant: nombre-invalido' })).toBe('nombre-invalido')
        expect(extraerSlugError({ message: 'sp_alta_tenant: permisos-no-objeto' })).toBe('permisos-no-objeto')
      })
    })
  })
})
