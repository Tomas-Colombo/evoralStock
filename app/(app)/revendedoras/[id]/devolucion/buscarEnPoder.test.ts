import { describe, expect, it } from 'vitest'
import { buscarEnPoder, type ItemEnPoderBuscable } from './buscarEnPoder'

const items: ItemEnPoderBuscable[] = [
  { id_item: 'a1', nombre_producto: 'Anillo plata', sku: 'ANI-01', qr_code: 'QR-A1' },
  { id_item: 'a2', nombre_producto: 'Anillo plata', sku: 'ANI-01', qr_code: 'QR-A2' },
  { id_item: 'c1', nombre_producto: 'Collar perlas', sku: 'COL-07', qr_code: null },
]

describe('buscarEnPoder', () => {
  it('el QR marca esa unidad exacta', () => {
    expect(buscarEnPoder(items, ' QR-A2 ', new Set())).toEqual({ ok: true, idItem: 'a2' })
  })

  it('un QR ya marcado no elige otra unidad', () => {
    expect(buscarEnPoder(items, 'QR-A2', new Set(['a2']))).toEqual({ ok: false, reason: 'item-ya-marcado' })
  })

  it('escanear el mismo SKU dos veces marca dos unidades distintas', () => {
    const primera = buscarEnPoder(items, 'ani-01', new Set())
    expect(primera).toEqual({ ok: true, idItem: 'a1' })
    expect(buscarEnPoder(items, 'ani-01', new Set(['a1']))).toEqual({ ok: true, idItem: 'a2' })
  })

  it('cuando ya se marcaron todas las unidades lo avisa', () => {
    expect(buscarEnPoder(items, 'ANI-01', new Set(['a1', 'a2']))).toEqual({
      ok: false,
      reason: 'item-ya-marcado',
    })
  })

  it('encuentra por nombre', () => {
    expect(buscarEnPoder(items, 'collar', new Set())).toEqual({ ok: true, idItem: 'c1' })
  })

  it('algo que no tiene en su poder no coincide', () => {
    expect(buscarEnPoder(items, 'pulsera', new Set())).toEqual({ ok: false, reason: 'item-no-en-poder-revendedora' })
    expect(buscarEnPoder(items, '   ', new Set())).toEqual({ ok: false, reason: 'qr-vacio' })
  })
})
