import { describe, expect, it } from 'vitest'
import { anularVentaSchema, registrarVentaSchema } from './ventas'
import { primerReason } from './administracion'

const UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('anularVentaSchema', () => {
  it('acepta anular sin motivo', () => {
    const r = anularVentaSchema.safeParse({ idVenta: UUID })
    expect(r.success && r.data.motivo).toBeUndefined()
  })

  it('recorta el motivo', () => {
    const r = anularVentaSchema.safeParse({ idVenta: UUID, motivo: '  se arrepintió  ' })
    expect(r.success && r.data.motivo).toBe('se arrepintió')
  })

  it('un motivo en blanco es lo mismo que no haber puesto motivo', () => {
    const r = anularVentaSchema.safeParse({ idVenta: UUID, motivo: '   ' })
    expect(r.success && r.data.motivo).toBeUndefined()
  })

  it('rechaza un motivo más largo que el tope', () => {
    // El `maxLength` del textarea es de la UI; el límite real vive acá.
    const r = anularVentaSchema.safeParse({ idVenta: UUID, motivo: 'x'.repeat(301) })
    expect(r.success).toBe(false)
    if (!r.success) expect(primerReason(r.error)).toBe('motivo-largo (motivo)')
  })

  it('rechaza un id que no es uuid y campos de más', () => {
    expect(anularVentaSchema.safeParse({ idVenta: 'x' }).success).toBe(false)
    expect(
      anularVentaSchema.safeParse({ idVenta: UUID, idTenant: 'otro' }).success,
    ).toBe(false)
  })

  it('rechaza un motivo que no es string', () => {
    expect(anularVentaSchema.safeParse({ idVenta: UUID, motivo: 42 }).success).toBe(false)
  })
})

describe('anularVentaSchema — payload no objeto', () => {
  it('cae en payload-invalido', () => {
    const r = anularVentaSchema.safeParse('x')
    expect(r.success).toBe(false)
    if (!r.success) expect(primerReason(r.error)).toBe('payload-invalido')
  })
})

describe('registrarVentaSchema', () => {
  it('acepta venta local válida por defecto', () => {
    const r = registrarVentaSchema.safeParse({
      lineas: [{ id_item: UUID }],
      formaPago: 'efectivo',
    })
    expect(r.success).toBe(true)
  })

  it('rechaza canal extra por strictObject', () => {
    const r = registrarVentaSchema.safeParse({
      lineas: [{ id_item: UUID }],
      formaPago: 'efectivo',
      canal: 'local',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(primerReason(r.error)).toBe('campo-desconocido')
    }
  })

  it('rechaza líneas vacías', () => {
    const r = registrarVentaSchema.safeParse({
      lineas: [],
      formaPago: 'efectivo',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(primerReason(r.error)).toMatch(/lineas-vacias/)
    }
  })

  it('rechaza campos desconocidos por strictObject', () => {
    const r = registrarVentaSchema.safeParse({
      lineas: [{ id_item: UUID }],
      formaPago: 'efectivo',
      hack: 'campo-extra',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(primerReason(r.error)).toBe('campo-desconocido')
    }
  })
})

