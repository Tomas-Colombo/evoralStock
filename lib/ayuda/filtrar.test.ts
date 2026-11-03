import { describe, expect, it } from 'vitest'
import type { EntradaGuia } from './tipos'
import type { Permiso } from '@/lib/types/administracion'
import { filtrarGuia } from './filtrar'

describe('filtrarGuia', () => {
  const fixtureGuia: EntradaGuia[] = [
    {
      id: 'ventas-crear',
      titulo: 'Crear venta',
      pasos: ['Ir a ventas', 'Click en nueva venta'],
      permisos: ['ventas.ver', 'ventas.crear'],
      ruta: '/ventas',
    },
    {
      id: 'ventas-ver',
      titulo: 'Ver ventas',
      pasos: ['Ir a ventas'],
      permisos: ['ventas.ver'],
      ruta: '/ventas',
    },
    {
      id: 'inventario-ver',
      titulo: 'Ver inventario',
      pasos: ['Ir a inventario'],
      permisos: ['inventario.ver'],
      ruta: '/inventario',
    },
  ]

  it('REQ-AYUDA-03 Feliz: entrada con todos sus permisos presentes es visible y mantiene orden', () => {
    const permisos = new Set<Permiso>(['ventas.ver', 'ventas.crear'])
    const resultado = filtrarGuia(fixtureGuia, permisos)

    expect(resultado.map((e) => e.id)).toEqual(['ventas-crear', 'ventas-ver'])
  })

  it('REQ-AYUDA-03 N1: falta uno de los permisos requeridos -> no es visible', () => {
    const permisos = new Set<Permiso>(['ventas.ver']) // falta ventas.crear
    const resultado = filtrarGuia(fixtureGuia, permisos)

    expect(resultado.map((e) => e.id)).toEqual(['ventas-ver'])
  })

  it('REQ-AYUDA-03 N2: entrada con permisos vacío en runtime (cast) -> no visible', () => {
    const entradaSinPermisos = {
      id: 'sin-permisos',
      titulo: 'Sin permisos',
      pasos: ['Paso 1'],
      permisos: [] as unknown as readonly [Permiso, ...Permiso[]],
    }

    const permisos = new Set<Permiso>(['ventas.ver', 'ventas.crear', 'ayuda.consultar'])
    const resultado = filtrarGuia([entradaSinPermisos], permisos)

    expect(resultado).toEqual([])
  })

  it('REQ-AYUDA-03 N3: conjunto de permisos vacío -> lista vacía', () => {
    const permisos = new Set<Permiso>()
    const resultado = filtrarGuia(fixtureGuia, permisos)

    expect(resultado).toEqual([])
  })
})
