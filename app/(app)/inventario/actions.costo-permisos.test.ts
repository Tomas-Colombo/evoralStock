import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProductoAction,
  crearIngresoCompletoAction,
  importarRemitoAction,
  confirmarIngresoAction,
  completarCostoIngresoAction,
} from './actions'
import * as dalProducto from '@/lib/dal/inventario/producto'
import * as dalIngreso from '@/lib/dal/inventario/ingreso'
import * as sessionModule from '@/lib/dal/session'
import * as guardModule from '@/lib/dal/guard'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn(),
}))

vi.mock('@/lib/dal/guard', () => ({
  requireModuleRole: vi.fn(),
  hasModuleAccess: vi.fn(),
}))

vi.mock('@/lib/dal/precios/cotizacion', () => ({
  getCotizacionVigente: vi.fn(),
}))

vi.mock('@/lib/dal/inventario/producto', () => ({
  spCreateProducto: vi.fn(),
  spSetCostoProducto: vi.fn(),
  spCrearStockDirecto: vi.fn(),
  updateProducto: vi.fn(),
}))

vi.mock('@/lib/dal/inventario/ingreso', () => ({
  createIngresoBorrador: vi.fn(),
  addIngresoDetalle: vi.fn(),
  spConfirmarIngreso: vi.fn(),
  spImportarRemito: vi.fn(),
  spCancelarIngreso: vi.fn(),
  spCompletarCostoIngreso: vi.fn(),
  remitoDuplicado: vi.fn(),
}))

const VALID_UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const VALID_UUID_2 = '4f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('Server Actions — Permiso inventario.cargar_costos y costo opcional', () => {
  const fakeSession = {
    tenantId: 'tenant-123',
    user: { id: 'user-456' },
    rol: {
      permisos: {
        inventario: ['ver', 'crear', 'editar'],
      },
    },
    modulosHabilitados: ['inventario'],
  } as unknown as sessionModule.Session

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue(fakeSession)
    vi.mocked(guardModule.requireModuleRole).mockResolvedValue(undefined)
  })

  describe('createProductoAction', () => {
    it('rechaza con sin-permiso-cargar-costos si viene costoInicial y no tiene cargar_costos', async () => {
      vi.mocked(guardModule.hasModuleAccess).mockReturnValue(false)

      const res = await createProductoAction({
        nombre: 'Remera Test',
        idCategoria: VALID_UUID,
        costoInicial: 1000,
      })

      expect(res).toEqual({ ok: false, reason: 'sin-permiso-cargar-costos' })
      expect(dalProducto.spCreateProducto).not.toHaveBeenCalled()
    })

    it('permite alta sin costo cuando no tiene cargar_costos', async () => {
      vi.mocked(guardModule.hasModuleAccess).mockReturnValue(false)
      vi.mocked(dalProducto.spCreateProducto).mockResolvedValue(VALID_UUID)

      const res = await createProductoAction({
        nombre: 'Remera Test',
        idCategoria: VALID_UUID,
        costoInicial: null,
      })

      expect(res.ok).toBe(true)
      expect(dalProducto.spCreateProducto).toHaveBeenCalledWith({
        nombre: 'Remera Test',
        idCategoria: VALID_UUID,
        sku: null,
        stockMinimo: 0,
        descripcion: null,
      })
      expect(dalProducto.spSetCostoProducto).not.toHaveBeenCalled()
    })
  })

  describe('importarRemitoAction', () => {
    it('rechaza con sin-permiso-cargar-costos si alguna línea tiene costo y no tiene cargar_costos', async () => {
      vi.mocked(guardModule.hasModuleAccess).mockReturnValue(false)

      const res = await importarRemitoAction({
        idIngreso: VALID_UUID,
        lineas: [
          {
            nombre: 'Item 1',
            cantidad: 5,
            costoUnitario: 500,
            esNuevo: true,
            idProducto: null,
            idCategoria: VALID_UUID,
          },
        ],
      })

      expect(res).toEqual({ ok: false, reason: 'sin-permiso-cargar-costos' })
      expect(dalIngreso.spImportarRemito).not.toHaveBeenCalled()
    })

    it('permite importar líneas con costoUnitario null si no tiene cargar_costos', async () => {
      vi.mocked(guardModule.hasModuleAccess).mockReturnValue(false)
      vi.mocked(dalIngreso.spImportarRemito).mockResolvedValue({
        creados: 1,
        vinculados: 0,
        detalles: [],
      })

      const res = await importarRemitoAction({
        idIngreso: VALID_UUID,
        lineas: [
          {
            nombre: 'Item 1',
            cantidad: 5,
            costoUnitario: null,
            esNuevo: true,
            idProducto: null,
            idCategoria: VALID_UUID,
          },
        ],
      })

      expect(res.ok).toBe(true)
      expect(dalIngreso.spImportarRemito).toHaveBeenCalledWith(
        expect.objectContaining({
          lineas: [
            expect.objectContaining({
              costoUnitario: null,
            }),
          ],
        }),
      )
    })
  })

  describe('crearIngresoCompletoAction', () => {
    it('rechaza con sin-permiso-cargar-costos si alguna línea tiene costo y no tiene cargar_costos', async () => {
      vi.mocked(guardModule.hasModuleAccess).mockReturnValue(false)

      const res = await crearIngresoCompletoAction({
        tipoIngreso: 'compra',
        idProveedor: null,
        lineas: [
          {
            nombre: 'Item 1',
            cantidad: 5,
            costoUnitario: 1500,
            esNuevo: true,
            idProducto: null,
            idCategoria: VALID_UUID,
          },
        ],
      })

      expect(res).toEqual({ ok: false, reason: 'sin-permiso-cargar-costos' })
      expect(dalIngreso.createIngresoBorrador).not.toHaveBeenCalled()
    })

    it('permite crear ingreso completo con líneas con costoUnitario null si no tiene cargar_costos', async () => {
      vi.mocked(guardModule.hasModuleAccess).mockReturnValue(false)
      vi.mocked(dalIngreso.createIngresoBorrador).mockResolvedValue(VALID_UUID)
      vi.mocked(dalIngreso.spImportarRemito).mockResolvedValue({
        creados: 1,
        vinculados: 0,
        detalles: [],
      })
      vi.mocked(dalIngreso.spConfirmarIngreso).mockResolvedValue(5)

      const res = await crearIngresoCompletoAction({
        tipoIngreso: 'compra',
        idProveedor: null,
        lineas: [
          {
            nombre: 'Item 1',
            cantidad: 5,
            costoUnitario: null,
            esNuevo: true,
            idProducto: null,
            idCategoria: VALID_UUID,
          },
        ],
      })

      expect(res.ok).toBe(true)
      expect(dalIngreso.spImportarRemito).toHaveBeenCalledWith(
        expect.objectContaining({
          lineas: [
            expect.objectContaining({
              costoUnitario: null,
            }),
          ],
        }),
      )
    })
  })

  describe('confirmarIngresoAction', () => {
    it('rechaza con sin-permiso-cargar-costos si viene costo y no tiene cargar_costos', async () => {
      vi.mocked(guardModule.hasModuleAccess).mockReturnValue(false)

      const res = await confirmarIngresoAction({
        idIngreso: VALID_UUID,
        costo: 2000,
      })

      expect(res).toEqual({ ok: false, reason: 'sin-permiso-cargar-costos' })
      expect(dalIngreso.spConfirmarIngreso).not.toHaveBeenCalled()
    })
  })

  describe('completarCostoIngresoAction', () => {
    it('ejecuta los tres gates y llama a spCompletarCostoIngreso', async () => {
      vi.mocked(guardModule.requireModuleRole).mockResolvedValue(undefined)
      vi.mocked(dalIngreso.spCompletarCostoIngreso).mockResolvedValue(2)

      const res = await completarCostoIngresoAction({
        idIngreso: VALID_UUID,
        lineas: [
          {
            idDetalle: VALID_UUID_2,
            costoUnitario: 3500,
          },
        ],
      })

      expect(res).toEqual({ ok: true, data: { itemsActualizados: 2 } })
      expect(dalIngreso.spCompletarCostoIngreso).toHaveBeenCalledWith(
        expect.objectContaining({
          idIngreso: VALID_UUID,
          lineas: [{ idDetalle: VALID_UUID_2, costoUnitario: 3500 }],
        }),
      )
    })

    it('rechaza con datos inválidos de Zod', async () => {
      const res = await completarCostoIngresoAction({
        idIngreso: 'invalido',
        lineas: [],
      })

      expect(res.ok).toBe(false)
      expect(dalIngreso.spCompletarCostoIngreso).not.toHaveBeenCalled()
    })
  })
})
