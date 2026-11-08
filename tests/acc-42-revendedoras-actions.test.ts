import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as sessionModule from '@/lib/dal/session'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn(),
}))

// Mock de DALs para asegurar que nunca se llamen si la autorización frena la acción
vi.mock('@/lib/dal/revendedoras', () => ({
  crearRevendedora: vi.fn(),
  editarRevendedora: vi.fn(),
  bajaRevendedora: vi.fn(),
  inviteRevendedora: vi.fn(),
  desvincularRevendedora: vi.fn(),
  desactivarUsuarioRevendedora: vi.fn(),
  reactivarUsuarioRevendedora: vi.fn(),
  guardarComisionPropia: vi.fn(),
  crearConsignacionRevendedora: vi.fn(),
  editarConsignacionRevendedora: vi.fn(),
  confirmarConsignacionRevendedora: vi.fn(),
  registrarDevolucionRevendedora: vi.fn(),
  cerrarConsignacionRevendedora: vi.fn(),
  eliminarConsignacionRevendedora: vi.fn(),
  previewLiquidacion: vi.fn(),
  generarLiquidacion: vi.fn(),
  excluirDetalleLiquidacion: vi.fn(),
  reincluirDetalleLiquidacion: vi.fn(),
  marcarLiquidacionPagada: vi.fn(),
}))

vi.mock('@/lib/dal/revendedoras/comisiones', () => ({
  crearReglaGeneral: vi.fn(),
  guardarComisionPropia: vi.fn(),
  terminarRegla: vi.fn(),
}))

vi.mock('@/lib/dal/declaraciones-revendedora', () => ({
  confirmarDeclaracionVenta: vi.fn(),
  rechazarDeclaracionVenta: vi.fn(),
}))

vi.mock('@/lib/dal/ventas/venta', () => ({
  spRegistrarCambio: vi.fn(),
  spRegistrarVenta: vi.fn(),
  spAnularVenta: vi.fn(),
  spRegistrarDevolucionCliente: vi.fn(),
}))

// Importar todas las acciones administrativas
import {
  crearRevendedoraAction,
  crearRevendedoraUnificadaAction,
  editarRevendedoraAction,
  bajaRevendedoraAction,
  revocarAccesoRevendedoraAction,
} from '@/app/(app)/revendedoras/actions'
import { darAccesoRevendedoraAction } from '@/lib/revendedoras/actions'

import {
  crearReglaGeneralAction,
  guardarComisionPropiaAction,
  terminarReglaAction,
} from '@/app/(app)/revendedoras/comisiones/actions'

import {
  crearConsignacionRevendedoraAction,
  editarConsignacionRevendedoraAction,
  confirmarConsignacionRevendedoraAction,
  registrarDevolucionRevendedoraAction,
  cerrarConsignacionRevendedoraAction,
  eliminarConsignacionRevendedoraAction,
} from '@/app/(app)/revendedoras/[id]/consignaciones/actions'

import {
  previewLiquidacionAction,
  generarLiquidacionAction,
  excluirDetalleLiquidacionAction,
  reincluirDetalleLiquidacionAction,
  marcarLiquidacionPagadaAction,
} from '@/app/(app)/revendedoras/[id]/liquidaciones/actions'

import {
  confirmarDeclaracionAction,
  rechazarDeclaracionAction,
} from '@/app/(app)/revendedoras/declaraciones/actions'

import { cambiarItemVentaAction, registrarVentaAction } from '@/app/(app)/ventas/actions'

describe('ACC-42: Cada Server Action administrativa invocada con sesión de revendedora retorna no-permission', () => {
  const revendedoraSession: sessionModule.Session = {
    user: { id: 'user-revendedora-1', email: 'rev@test.com' },
    tenantId: 'tenant-1',
    rolId: 'rol-revendedora-1',
    rolNombre: 'Revendedora',
    idRevendedora: '00000000-0000-0000-0000-000000000001',
    modulosHabilitados: ['revendedoras', 'ventas', 'inventario', 'administracion'],
    permisos: {
      revendedoras: ['ver_propio', 'declarar'],
    },
    subdominioOk: true,
    marca: { nombre: 'Tenant 1', logoUrl: null },
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue(revendedoraSession)
  })

  describe('Acciones de revendedoras/ (gestión, CRUD y acceso)', () => {
    it('crearRevendedoraAction -> no-permission', async () => {
      const res = await crearRevendedoraAction({ nombre: 'X', apellido: 'Y' })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('crearRevendedoraUnificadaAction -> no-permission', async () => {
      const res = await crearRevendedoraUnificadaAction({ nombre: 'X', apellido: 'Y' })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('editarRevendedoraAction -> no-permission', async () => {
      const res = await editarRevendedoraAction('00000000-0000-0000-0000-000000000001', { nombre: 'X', apellido: 'Y' })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('bajaRevendedoraAction -> no-permission', async () => {
      const res = await bajaRevendedoraAction('00000000-0000-0000-0000-000000000001')
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('darAccesoRevendedoraAction -> no-permission', async () => {
      const res = await darAccesoRevendedoraAction({
        idRevendedora: '00000000-0000-0000-0000-000000000001',
        email: 'x@test.com',
        nombreCompleto: 'X Y',
        password: 'Password123!',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('revocarAccesoRevendedoraAction -> no-permission', async () => {
      const res = await revocarAccesoRevendedoraAction('00000000-0000-0000-0000-000000000001')
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })
  })

  describe('Acciones de comisiones/', () => {
    it('crearReglaGeneralAction -> no-permission', async () => {
      const res = await crearReglaGeneralAction({
        nombre: 'Comision X',
        porcentaje: 10,
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('guardarComisionPropiaAction -> no-permission', async () => {
      const res = await guardarComisionPropiaAction({
        id_revendedora: '00000000-0000-0000-0000-000000000001',
        porcentaje: 15,
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('terminarReglaAction -> no-permission', async () => {
      const res = await terminarReglaAction({ id_regla: '00000000-0000-0000-0000-000000000001' })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })
  })

  describe('Acciones de consignaciones/', () => {
    it('crearConsignacionRevendedoraAction -> no-permission', async () => {
      const res = await crearConsignacionRevendedoraAction({
        id_revendedora: '00000000-0000-0000-0000-000000000001',
        items: ['00000000-0000-0000-0000-000000000002'],
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('editarConsignacionRevendedoraAction -> no-permission', async () => {
      const res = await editarConsignacionRevendedoraAction('00000000-0000-0000-0000-000000000001', {
        id_consignacion_revendedora: '00000000-0000-0000-0000-000000000002',
        notas: 'editada',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('confirmarConsignacionRevendedoraAction -> no-permission', async () => {
      const res = await confirmarConsignacionRevendedoraAction('00000000-0000-0000-0000-000000000001', {
        id_consignacion_revendedora: '00000000-0000-0000-0000-000000000002',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('registrarDevolucionRevendedoraAction -> no-permission', async () => {
      const res = await registrarDevolucionRevendedoraAction('00000000-0000-0000-0000-000000000001', {
        id_consignacion_revendedora: '00000000-0000-0000-0000-000000000002',
        id_item: '00000000-0000-0000-0000-000000000003',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('cerrarConsignacionRevendedoraAction -> no-permission', async () => {
      const res = await cerrarConsignacionRevendedoraAction('00000000-0000-0000-0000-000000000001', {
        id_consignacion_revendedora: '00000000-0000-0000-0000-000000000002',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('eliminarConsignacionRevendedoraAction -> no-permission', async () => {
      const res = await eliminarConsignacionRevendedoraAction('00000000-0000-0000-0000-000000000001', {
        id_consignacion_revendedora: '00000000-0000-0000-0000-000000000002',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })
  })

  describe('Acciones de liquidaciones/', () => {
    it('previewLiquidacionAction -> no-permission', async () => {
      const res = await previewLiquidacionAction({
        id_revendedora: '00000000-0000-0000-0000-000000000001',
        periodo_hasta: '2026-01-31',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('generarLiquidacionAction -> no-permission', async () => {
      const res = await generarLiquidacionAction({
        id_revendedora: '00000000-0000-0000-0000-000000000001',
        periodo_hasta: '2026-01-31',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('excluirDetalleLiquidacionAction -> no-permission', async () => {
      const res = await excluirDetalleLiquidacionAction({
        id_detalle_venta: '00000000-0000-0000-0000-000000000001',
        id_revendedora: '00000000-0000-0000-0000-000000000002',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('reincluirDetalleLiquidacionAction -> no-permission', async () => {
      const res = await reincluirDetalleLiquidacionAction({
        id_detalle_venta: '00000000-0000-0000-0000-000000000001',
        id_revendedora: '00000000-0000-0000-0000-000000000002',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('marcarLiquidacionPagadaAction -> no-permission', async () => {
      const res = await marcarLiquidacionPagadaAction({
        id_liquidacion: '00000000-0000-0000-0000-000000000001',
        monto: 1000,
        medio: 'efectivo',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })
  })

  describe('Acciones de declaraciones/ (bandeja del local)', () => {
    it('confirmarDeclaracionAction -> no-permission', async () => {
      const res = await confirmarDeclaracionAction({
        id_declaracion: '00000000-0000-0000-0000-000000000001',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('rechazarDeclaracionAction -> no-permission', async () => {
      const res = await rechazarDeclaracionAction({
        id_declaracion: '00000000-0000-0000-0000-000000000001',
        motivo: 'Item no correspondía',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })
  })

  describe('Acciones de ventas (cambios y ventas canal revendedora)', () => {
    it('cambiarItemVentaAction -> no-permission', async () => {
      const res = await cambiarItemVentaAction({
        idVenta: '00000000-0000-0000-0000-000000000001',
        idDetalleOriginal: '00000000-0000-0000-0000-000000000002',
        idItemEntregado: '00000000-0000-0000-0000-000000000003',
        canal: 'revendedora',
        idRevendedora: '00000000-0000-0000-0000-000000000004',
        motivo: 'Talle incorrecto',
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })

    it('registrarVentaAction canal revendedora -> no-permission', async () => {
      const res = await registrarVentaAction({
        lineas: [{ id_item: '00000000-0000-0000-0000-000000000002', precio_venta: 1000 }],
        formaPago: 'contado',
        canal: 'revendedora',
        idRevendedora: '00000000-0000-0000-0000-000000000001',
        pagos: [],
      })
      expect(res).toEqual({ ok: false, reason: 'no-permission' })
    })
  })
})
