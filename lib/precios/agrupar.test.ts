import { describe, expect, it } from 'vitest'
import { agruparPorCategoria } from './agrupar'

describe('agruparPorCategoria', () => {
  it('devuelve un array vacío si no hay filas', () => {
    expect(agruparPorCategoria([])).toEqual([])
  })

  it('respeta el orden de entrada de las filas dentro de cada categoría', () => {
    const rows = [
      { id_producto: '1', id_categoria: 'c1', categoria_nombre: 'Remeras', nombre: 'Remera B' },
      { id_producto: '2', id_categoria: 'c1', categoria_nombre: 'Remeras', nombre: 'Remera A' },
      { id_producto: '3', id_categoria: 'c1', categoria_nombre: 'Remeras', nombre: 'Remera C' },
    ]

    const grupos = agruparPorCategoria(rows)
    expect(grupos).toHaveLength(1)
    expect(grupos[0].filas.map((f) => f.id_producto)).toEqual(['1', '2', '3'])
  })

  it('ordena los grupos por nombre según es-AR (localeCompare)', () => {
    const rows = [
      { id_producto: '1', id_categoria: 'c1', categoria_nombre: 'Pantalones' },
      { id_producto: '2', id_categoria: 'c2', categoria_nombre: 'Buzos' },
      { id_producto: '3', id_categoria: 'c3', categoria_nombre: 'Ámbar' },
      { id_producto: '4', id_categoria: 'c4', categoria_nombre: 'Camisas' },
    ]

    const grupos = agruparPorCategoria(rows)
    expect(grupos.map((g) => g.nombre)).toEqual(['Ámbar', 'Buzos', 'Camisas', 'Pantalones'])
  })

  it('ubica el grupo "Sin categoría" (id null o undefined) al final', () => {
    const rows = [
      { id_producto: '1', id_categoria: null, categoria_nombre: null, nombre: 'Producto sin cat 1' },
      { id_producto: '2', id_categoria: 'c1', categoria_nombre: 'Zapatos', nombre: 'Zapato A' },
      { id_producto: '3', id_categoria: undefined, categoria_nombre: null, nombre: 'Producto sin cat 2' },
      { id_producto: '4', id_categoria: 'c2', categoria_nombre: 'Accesorios', nombre: 'Cinto' },
    ]

    const grupos = agruparPorCategoria(rows)
    expect(grupos).toHaveLength(3)
    expect(grupos.map((g) => g.nombre)).toEqual(['Accesorios', 'Zapatos', 'Sin categoría'])
    expect(grupos[2].idCategoria).toBeNull()
    expect(grupos[2].filas.map((f) => f.id_producto)).toEqual(['1', '3'])
  })

  it('nunca devuelve grupos vacíos', () => {
    const rows = [
      { id_producto: '1', id_categoria: 'c1', categoria_nombre: 'Vestidos' },
    ]

    const grupos = agruparPorCategoria(rows)
    expect(grupos).toHaveLength(1)
    expect(grupos.every((g) => g.filas.length > 0)).toBe(true)
  })
})
