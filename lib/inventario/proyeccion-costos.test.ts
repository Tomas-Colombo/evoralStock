import { describe, expect, it } from 'vitest'
import {
  proyectarConsignacionConDetalle,
  proyectarIngresoDetalle,
  proyectarIngresosConResumen,
  proyectarItemConDetalle,
  proyectarLookupConsignacionItem,
} from './proyeccion-costos'
import type { ConsignacionConDetalle } from '@/lib/types/consignaciones'
import type { IngresoConResumen, ItemConProducto } from '@/lib/types/inventario'

describe('proyeccion-costos', () => {
  it('proyectarItemConDetalle conserva o anula costo_ingreso según permiso', () => {
    const item = {
      id_item: 'i1',
      id_tenant: 't1',
      id_producto: 'p1',
      id_ingreso: null,
      id_ingreso_detalle: null,
      qr_code: 'QR123',
      estado_item: 'disponible',
      talle: 'M',
      costo_ingreso: 4500,
      tipo_ingreso: 'compra',
      fecha_ingreso: '2026-01-01',
      fecha_venta: null,
      fecha_devolucion: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      producto: { id_producto: 'p1', nombre: 'Remera', sku: 'REM', categoria: null },
      proveedor: null,
      movimientos: [],
    } as unknown as ItemConProducto

    expect(proyectarItemConDetalle(item, true)?.costo_ingreso).toBe(4500)
    expect(proyectarItemConDetalle(item, false)?.costo_ingreso).toBeNull()
    expect(proyectarItemConDetalle(null, false)).toBeNull()
  })

  it('proyectarLookupConsignacionItem oculta costo_ingreso sin permiso', () => {
    const lookup = {
      id_item: 'i1',
      qr_code: 'QR1',
      costo_ingreso: 1200,
    }
    expect(proyectarLookupConsignacionItem(lookup, true).costo_ingreso).toBe(1200)
    expect(proyectarLookupConsignacionItem(lookup, false).costo_ingreso).toBeNull()
  })

  it('proyectarConsignacionConDetalle oculta costo_ingreso en ítems de detalles', () => {
    const cons = {
      id_consignacion: 'c1',
      detalles: [
        {
          id_consignacion_detalle: 'cd1',
          item: { qr_code: 'QR1', estado_item: 'pendiente', costo_ingreso: 3000 },
        },
      ],
    } as unknown as ConsignacionConDetalle

    const conPermiso = proyectarConsignacionConDetalle(cons, true)
    expect(conPermiso?.detalles[0].item?.costo_ingreso).toBe(3000)

    const sinPermiso = proyectarConsignacionConDetalle(cons, false)
    expect(sinPermiso?.detalles[0].item?.costo_ingreso).toBeNull()
    expect(proyectarConsignacionConDetalle(null, false)).toBeNull()
  })

  it('proyectarIngresosConResumen oculta total_costo si no puede ver costos', () => {
    const rows = [
      { id_ingreso: 'ing1', total_costo: 50000 },
      { id_ingreso: 'ing2', total_costo: 12000 },
    ] as unknown as IngresoConResumen[]

    expect(proyectarIngresosConResumen(rows, true)[0].total_costo).toBe(50000)
    expect(proyectarIngresosConResumen(rows, false)[0].total_costo).toBeNull()
  })

  it('proyectarIngresoDetalle oculta costo_unitario de cada línea solo si confirmado es true', () => {
    const ingresoConfirmado = {
      id_ingreso: 'ing1',
      confirmado: true,
      detalle: [
        { id_detalle: 'd1', cantidad: 5, costo_unitario: 1000 },
        { id_detalle: 'd2', cantidad: 2, costo_unitario: 2500 },
      ],
    } as Parameters<typeof proyectarIngresoDetalle>[0]

    const conPermiso = proyectarIngresoDetalle(ingresoConfirmado, true)
    expect(conPermiso?.detalle[0].costo_unitario).toBe(1000)

    const sinPermisoConfirmado = proyectarIngresoDetalle(ingresoConfirmado, false)
    expect(sinPermisoConfirmado?.detalle[0].costo_unitario).toBeNull()
    expect(sinPermisoConfirmado?.detalle[1].costo_unitario).toBeNull()

    // El select real trae columnas que el tipo no declara (costo en USD).
    const conUsd = {
      id_ingreso: 'ing2',
      confirmado: true,
      detalle: [{ id_detalle: 'd3', cantidad: 1, costo_unitario: 900, costo_original_usd: 1, cotizacion_aplicada: 900 }],
    } as unknown as Parameters<typeof proyectarIngresoDetalle>[0]
    const lineaSinUsd = proyectarIngresoDetalle(conUsd, false)?.detalle[0] as unknown as Record<string, unknown>
    expect('costo_original_usd' in lineaSinUsd).toBe(false)
    expect('cotizacion_aplicada' in lineaSinUsd).toBe(false)

    const ingresoBorrador = {
      id_ingreso: 'ing2',
      confirmado: false,
      detalle: [
        { id_detalle: 'd1', cantidad: 5, costo_unitario: 1000 },
      ],
    } as Parameters<typeof proyectarIngresoDetalle>[0]

    const sinPermisoBorrador = proyectarIngresoDetalle(ingresoBorrador, false)
    expect(sinPermisoBorrador?.detalle[0].costo_unitario).toBe(1000)

    expect(proyectarIngresoDetalle(null, false)).toBeNull()
  })
})
