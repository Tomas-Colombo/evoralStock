import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProductoAction, crearIngresoCompletoAction, importarRemitoAction } from './actions'
import * as dalCotizacion from '@/lib/dal/precios/cotizacion'
import * as dalProducto from '@/lib/dal/inventario/producto'
import * as dalIngreso from '@/lib/dal/inventario/ingreso'
import * as sessionModule from '@/lib/dal/session'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn(),
}))

vi.mock('@/lib/dal/guard', () => ({
  requireModuleRole: vi.fn(),
  hasModuleAccess: vi.fn(() => true),
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
  remitoDuplicado: vi.fn(),
}))

const VALID_UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const VALID_UUID_2 = '4f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('Conversión de moneda en Server Actions de Inventario', () => {
  const fakeSession = {
    tenantId: 'tenant-123',
    user: { id: 'user-456' },
    rol: {
      permisos: {
        inventario: ['ver', 'crear', 'editar'],
      },
    },
    modulosHabilitados: ['inventario', 'precios'],
  } as unknown as sessionModule.Session

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue(fakeSession)
  })

  describe('createProductoAction', () => {
    it('convierte USD 100 × 1500 → 150000.00 y envía el mismo ARS a catálogo y stock directo', async () => {
      vi.mocked(dalCotizacion.getCotizacionVigente).mockResolvedValueOnce({
        modo: 'automatica',
        valor: 1500,
        fecha: '2026-11-05',
        fechaValor: '2026-11-04',
        origen: 'bcra',
        desactualizada: false,
      })
      vi.mocked(dalProducto.spCreateProducto).mockResolvedValueOnce('prod-uuid-1')
      vi.mocked(dalProducto.spSetCostoProducto).mockResolvedValueOnce('costo-uuid-1')
      vi.mocked(dalProducto.spCrearStockDirecto).mockResolvedValueOnce(2)

      const res = await createProductoAction({
        idCategoria: 'cat-uuid',
        nombre: 'Campera USD',
        costoInicial: 100,
        moneda: 'USD',
        stock: [{ talle: 'M', cantidad: 2 }],
      })

      expect(res).toEqual({
        ok: true,
        data: { id: 'prod-uuid-1', itemsCreados: 2, cotizacionDesactualizada: false },
      })

      // Circuito A: spSetCostoProducto recibe 150000 ARS y metadatos
      expect(dalProducto.spSetCostoProducto).toHaveBeenCalledWith({
        idProducto: 'prod-uuid-1',
        costo: 150000,
        moneda: 'USD',
        motivo: 'costo inicial',
        costoOriginalUsd: 100,
        cotizacionAplicada: 1500,
        cotizacionFechaValor: '2026-11-04',
      })

      // Circuito B: spCrearStockDirecto recibe los mismos 150000 ARS
      expect(dalProducto.spCrearStockDirecto).toHaveBeenCalledWith({
        idProducto: 'prod-uuid-1',
        costo: 150000,
        items: [{ talle: 'M', cantidad: 2 }],
      })
    })

    it('un cliente que manda un costo en ARS inventado junto con USD se ignora', async () => {
      vi.mocked(dalCotizacion.getCotizacionVigente).mockResolvedValueOnce({
        modo: 'automatica',
        valor: 1500,
        fecha: '2026-11-05',
        fechaValor: '2026-11-04',
        origen: 'bcra',
        desactualizada: false,
      })
      vi.mocked(dalProducto.spCreateProducto).mockResolvedValueOnce('prod-uuid-2')
      vi.mocked(dalProducto.spSetCostoProducto).mockResolvedValueOnce('costo-uuid-2')
      vi.mocked(dalProducto.spCrearStockDirecto).mockResolvedValueOnce(1)

      // El payload incluye un campo inventado o un valor falso en ARS
      const inputInyector = {
        idCategoria: 'cat-uuid',
        nombre: 'Campera Hack',
        costoInicial: 100,
        moneda: 'USD',
        costoArsInventado: 1, // Intentan pagar 1 peso en vez de 150.000
        stock: [{ talle: 'S', cantidad: 1 }],
      }

      await createProductoAction(inputInyector)

      // Se calcula estrictamente 100 * 1500 = 150000 en el servidor
      expect(dalProducto.spSetCostoProducto).toHaveBeenCalledWith(
        expect.objectContaining({
          costo: 150000,
          costoOriginalUsd: 100,
        }),
      )
      expect(dalProducto.spCrearStockDirecto).toHaveBeenCalledWith(
        expect.objectContaining({
          costo: 150000,
        }),
      )
    })

    it('sin cotización → rechaza con sin-cotizacion-dolar y no escribe nada', async () => {
      vi.mocked(dalCotizacion.getCotizacionVigente).mockRejectedValueOnce(
        new Error('sin-cotizacion-dolar'),
      )

      const res = await createProductoAction({
        idCategoria: 'cat-uuid',
        nombre: 'Campera Sin Cot',
        costoInicial: 100,
        moneda: 'USD',
      })

      expect(res).toEqual({ ok: false, reason: 'sin-cotizacion-dolar' })
      expect(dalProducto.spCreateProducto).not.toHaveBeenCalled()
      expect(dalProducto.spSetCostoProducto).not.toHaveBeenCalled()
    })
  })

  describe('crearIngresoCompletoAction', () => {
    it('realiza UNA sola llamada a getCotizacionVigente para todo el comprobante en USD', async () => {
      vi.mocked(dalCotizacion.getCotizacionVigente).mockResolvedValueOnce({
        modo: 'automatica',
        valor: 1500,
        fecha: '2026-11-05',
        fechaValor: '2026-11-04',
        origen: 'bcra',
        desactualizada: false,
      })
      vi.mocked(dalIngreso.remitoDuplicado).mockResolvedValueOnce(false)
      vi.mocked(dalIngreso.createIngresoBorrador).mockResolvedValueOnce('ing-uuid-1')
      vi.mocked(dalIngreso.spImportarRemito).mockResolvedValueOnce({
        creados: 0,
        vinculados: 3,
        detalles: [],
      })
      vi.mocked(dalIngreso.spConfirmarIngreso).mockResolvedValueOnce(30)

      const res = await crearIngresoCompletoAction({
        idProveedor: VALID_UUID,
        tipoIngreso: 'compra',
        numeroRemito: 'REM-1234',
        moneda: 'USD',
        lineas: [
          {
            esNuevo: false,
            idProducto: VALID_UUID_2,
            idCategoria: null,
            nombre: 'Item 1',
            cantidad: 10,
            costoUnitario: 10, // USD 10
          },
          {
            esNuevo: false,
            idProducto: VALID_UUID_2,
            idCategoria: null,
            nombre: 'Item 2',
            cantidad: 10,
            costoUnitario: 20, // USD 20
          },
          {
            esNuevo: false,
            idProducto: VALID_UUID_2,
            idCategoria: null,
            nombre: 'Item 3',
            cantidad: 10,
            costoUnitario: 30, // USD 30
          },
        ],
      })

      expect(res).toEqual({
        ok: true,
        data: { id: 'ing-uuid-1', itemsGenerados: 30, cotizacionDesactualizada: false },
      })
      // UNA sola llamada a getCotizacionVigente
      expect(dalCotizacion.getCotizacionVigente).toHaveBeenCalledTimes(1)

      // Verifica conversión en cada línea
      expect(dalIngreso.spImportarRemito).toHaveBeenCalledWith(
        expect.objectContaining({
          idIngreso: 'ing-uuid-1',
          moneda: 'USD',
          cotizacionAplicada: 1500,
          cotizacionFechaValor: '2026-11-04',
          lineas: expect.arrayContaining([
            expect.objectContaining({ costoUnitario: 15000, costoOriginalUsd: 10 }),
            expect.objectContaining({ costoUnitario: 30000, costoOriginalUsd: 20 }),
            expect.objectContaining({ costoUnitario: 45000, costoOriginalUsd: 30 }),
          ]),
        }),
      )
    })

    it('sin cotización → rechaza con sin-cotizacion-dolar antes de crear el borrador', async () => {
      vi.mocked(dalCotizacion.getCotizacionVigente).mockRejectedValueOnce(
        new Error('sin-cotizacion-dolar'),
      )

      const res = await crearIngresoCompletoAction({
        idProveedor: VALID_UUID,
        tipoIngreso: 'compra',
        moneda: 'USD',
        lineas: [
          {
            esNuevo: false,
            idProducto: VALID_UUID_2,
            idCategoria: null,
            nombre: 'Item 1',
            cantidad: 5,
            costoUnitario: 10,
          },
        ],
      })

      expect(res).toEqual({ ok: false, reason: 'sin-cotizacion-dolar' })
      expect(dalIngreso.createIngresoBorrador).not.toHaveBeenCalled()
      expect(dalIngreso.spImportarRemito).not.toHaveBeenCalled()
    })
  })

  describe('importarRemitoAction', () => {
    it('convierte líneas USD a ARS con metadatos y UNA sola llamada a getCotizacionVigente', async () => {
      vi.mocked(dalCotizacion.getCotizacionVigente).mockResolvedValueOnce({
        modo: 'manual',
        valor: 1600,
        fecha: '2026-11-05',
        fechaValor: '2026-11-05',
        origen: 'manual',
        desactualizada: false,
      })
      vi.mocked(dalIngreso.spImportarRemito).mockResolvedValueOnce({
        creados: 1,
        vinculados: 0,
        detalles: [],
      })

      const res = await importarRemitoAction({
        idIngreso: 'ing-uuid-2',
        moneda: 'USD',
        lineas: [
          {
            esNuevo: true,
            idProducto: null,
            idCategoria: 'cat-uuid-1',
            nombre: 'Item Remito',
            cantidad: 4,
            costoUnitario: 25, // USD 25
            talles: [{ talle: 'S', cantidad: 4 }],
          },
        ],
      })

      expect(res).toEqual({
        ok: true,
        data: { creados: 1, vinculados: 0, detalles: [], cotizacionDesactualizada: false },
      })
      expect(dalCotizacion.getCotizacionVigente).toHaveBeenCalledTimes(1)
      expect(dalIngreso.spImportarRemito).toHaveBeenCalledWith(
        expect.objectContaining({
          idIngreso: 'ing-uuid-2',
          moneda: 'USD',
          cotizacionAplicada: 1600,
          cotizacionFechaValor: '2026-11-05',
          lineas: [
            expect.objectContaining({
              costoUnitario: 40000, // 25 * 1600 = 40000
              costoOriginalUsd: 25,
            }),
          ],
        }),
      )
    })

    it('devuelve cotizacionDesactualizada: true cuando la cotización es de un día anterior', async () => {
      vi.mocked(dalCotizacion.getCotizacionVigente).mockResolvedValueOnce({
        modo: 'automatica',
        valor: 1550,
        fecha: '2026-11-04',
        fechaValor: '2026-11-03',
        origen: 'bcra',
        desactualizada: true,
      })
      vi.mocked(dalIngreso.spImportarRemito).mockResolvedValueOnce({
        creados: 1,
        vinculados: 0,
        detalles: [],
      })

      const res = await importarRemitoAction({
        idIngreso: 'ing-uuid-3',
        moneda: 'USD',
        lineas: [
          {
            esNuevo: true,
            idProducto: null,
            idCategoria: 'cat-uuid-1',
            nombre: 'Item Desact',
            cantidad: 1,
            costoUnitario: 10,
          },
        ],
      })

      expect(res).toEqual({
        ok: true,
        data: { creados: 1, vinculados: 0, detalles: [], cotizacionDesactualizada: true },
      })
    })
  })
})
