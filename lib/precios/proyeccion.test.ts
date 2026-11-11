import { describe, expect, it } from 'vitest'
import { proyectarControlDePrecios } from './proyeccion'
import type { ProductoConPrecioStatus } from '@/lib/types/precios'

describe('proyectarControlDePrecios', () => {
  const baseRows: ProductoConPrecioStatus[] = [
    {
      id_producto: 'p1',
      nombre: 'Pantalón Cargo',
      sku: 'PAN-01',
      categoria_nombre: 'Pantalones',
      costo_vigente: 20000,
      precio_venta: 35000,
      precio_venta_resuelto_at: '2026-01-01',
      precio_venta_desactualizado: false,
      regla_margen_nombre: 'Margen 75%',
      precio_proyectado: 35000,
      diferencia_pct: 0,
    },
  ]

  it('proyecta todo completo con ambos permisos', () => {
    const res = proyectarControlDePrecios(baseRows, {
      puedeVerCostos: true,
      puedeVerMargenes: true,
    })
    expect(res[0].costo_vigente).toBe(20000)
    expect(res[0].regla_margen_nombre).toBe('Margen 75%')
    expect(res[0].precio_proyectado).toBe(35000)
    expect(res[0].diferencia_pct).toBe(0)
  })

  it('anula costo_vigente, precio_proyectado y diferencia_pct sin permiso de costos', () => {
    const res = proyectarControlDePrecios(baseRows, {
      puedeVerCostos: false,
      puedeVerMargenes: true,
    })
    expect(res[0].costo_vigente).toBeNull()
    expect(res[0].regla_margen_nombre).toBe('Margen 75%')
    expect(res[0].precio_proyectado).toBeNull()
    expect(res[0].diferencia_pct).toBeNull()
    expect(res[0].precio_venta).toBe(35000)
  })

  it('anula regla_margen_nombre, precio_proyectado y diferencia_pct sin permiso de márgenes', () => {
    const res = proyectarControlDePrecios(baseRows, {
      puedeVerCostos: true,
      puedeVerMargenes: false,
    })
    expect(res[0].costo_vigente).toBe(20000)
    expect(res[0].regla_margen_nombre).toBeNull()
    expect(res[0].precio_proyectado).toBeNull()
    expect(res[0].diferencia_pct).toBeNull()
    expect(res[0].precio_venta).toBe(35000)
  })

  it('anula todos los campos sensibles sin ninguno de los dos permisos', () => {
    const res = proyectarControlDePrecios(baseRows, {
      puedeVerCostos: false,
      puedeVerMargenes: false,
    })
    expect(res[0].costo_vigente).toBeNull()
    expect(res[0].regla_margen_nombre).toBeNull()
    expect(res[0].precio_proyectado).toBeNull()
    expect(res[0].diferencia_pct).toBeNull()
    expect(res[0].precio_venta).toBe(35000)
  })
})
