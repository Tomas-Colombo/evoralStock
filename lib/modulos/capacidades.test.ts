import { describe, expect, it } from 'vitest'
import {
  capacidades,
  tiposIngresoPermitidos,
  tiposProveedorPermitidos,
  modulosDePermisoVisibles,
} from './capacidades'
import { MODULOS_NUCLEO } from './catalogo'

describe('capacidades — REQ-MODOP-04', () => {
  it('REQ-MODOP-04 Feliz: paquete consignación completo habilita consignacionProveedor y sus tipos', () => {
    const modulos = ['consignaciones', 'rendiciones', 'revendedoras', ...MODULOS_NUCLEO]
    const cap = capacidades(modulos)

    expect(cap).toEqual({
      revendedoras: true,
      consignacionProveedor: true,
      ayuda: false,
    })
    expect(tiposIngresoPermitidos(cap)).toEqual(['compra', 'consignacion'])
    expect(tiposProveedorPermitidos(cap)).toEqual(['mayorista', 'particular', 'consignatario'])
    expect(modulosDePermisoVisibles(cap)).toEqual([
      ...MODULOS_NUCLEO,
      'revendedoras',
      'consignaciones',
      'rendiciones',
    ])
  })

  it('REQ-MODOP-04 N1: solo uno de los dos códigos de consignación deja consignacionProveedor = false', () => {
    const soloConsignaciones = capacidades(['consignaciones', ...MODULOS_NUCLEO])
    expect(soloConsignaciones.consignacionProveedor).toBe(false)
    expect(tiposIngresoPermitidos(soloConsignaciones)).toEqual(['compra'])
    expect(tiposProveedorPermitidos(soloConsignaciones)).toEqual(['mayorista', 'particular'])

    const soloRendiciones = capacidades(['rendiciones', ...MODULOS_NUCLEO])
    expect(soloRendiciones.consignacionProveedor).toBe(false)
    expect(tiposIngresoPermitidos(soloRendiciones)).toEqual(['compra'])
    expect(tiposProveedorPermitidos(soloRendiciones)).toEqual(['mayorista', 'particular'])
  })

  it('REQ-MODOP-04 N2: lista vacía devuelve todo false y tipos base del núcleo', () => {
    const cap = capacidades([])
    expect(cap).toEqual({
      revendedoras: false,
      consignacionProveedor: false,
      ayuda: false,
    })
    expect(tiposIngresoPermitidos(cap)).toEqual(['compra'])
    expect(tiposProveedorPermitidos(cap)).toEqual(['mayorista', 'particular'])
    expect(modulosDePermisoVisibles(cap)).toEqual([...MODULOS_NUCLEO])
  })
})
