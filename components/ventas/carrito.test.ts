import { describe, expect, it } from 'vitest'
import { agregarSinDuplicados, calcularTotalCarrito } from './carrito'

describe('carrito helpers', () => {
  describe('agregarSinDuplicados', () => {
    it('agrega ítems nuevos preservando orden y evitando duplicados por clave', () => {
      const actuales = [
        { id: 'a', nombre: 'Remera' },
        { id: 'b', nombre: 'Pantalón' },
      ]
      const nuevas = [
        { id: 'b', nombre: 'Pantalón repetido' },
        { id: 'c', nombre: 'Buzo' },
        { id: 'c', nombre: 'Buzo repetido en el mismo lote' },
      ]

      const res = agregarSinDuplicados(actuales, nuevas, (x) => x.id)

      expect(res.siguientes).toEqual([
        { id: 'a', nombre: 'Remera' },
        { id: 'b', nombre: 'Pantalón' },
        { id: 'c', nombre: 'Buzo' },
      ])
      expect(res.agregadas).toEqual([{ id: 'c', nombre: 'Buzo' }])
    })

    it('no muta el array original', () => {
      const actuales = [{ id: 'a' }]
      const res = agregarSinDuplicados(actuales, [{ id: 'b' }], (x) => x.id)
      expect(actuales).toHaveLength(1)
      expect(res.siguientes).toHaveLength(2)
    })
  })

  describe('calcularTotalCarrito', () => {
    it('suma precios y trata null como 0', () => {
      const items = [
        { precio: 1500 },
        { precio: null },
        { precio: 2500.5 },
      ]
      expect(calcularTotalCarrito(items, (x) => x.precio)).toBe(4000.5)
    })

    it('devuelve 0 para carrito vacío', () => {
      expect(calcularTotalCarrito([], () => 100)).toBe(0)
    })
  })
})
