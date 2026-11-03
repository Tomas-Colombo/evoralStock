import { describe, expect, it } from 'vitest'
import { permisosEfectivos } from './permisos'

describe('permisosEfectivos', () => {
  it('REQ-AYUDA-02 Feliz: rol con permisos válidos y módulo habilitado', () => {
    const sesion = {
      rolId: 'rol-123',
      modulosHabilitados: ['ventas', 'ayuda'],
      permisos: {
        ventas: ['ver', 'crear'],
        ayuda: ['consultar'],
      },
    }

    const resultado = permisosEfectivos(sesion)
    expect(resultado.has('ventas.ver')).toBe(true)
    expect(resultado.has('ventas.crear')).toBe(true)
    expect(resultado.has('ayuda.consultar')).toBe(true)
    expect(resultado.size).toBe(3)
  })

  it('REQ-AYUDA-02 N1: módulo con permiso en el rol pero apagado en el tenant no aparece', () => {
    const sesion = {
      rolId: 'rol-123',
      modulosHabilitados: ['ventas'], // precios apagado
      permisos: {
        ventas: ['ver'],
        precios: ['ver', 'crear'],
      },
    }

    const resultado = permisosEfectivos(sesion)
    expect(resultado.has('ventas.ver')).toBe(true)
    expect((resultado as ReadonlySet<string>).has('precios.ver')).toBe(false)
    expect((resultado as ReadonlySet<string>).has('precios.crear')).toBe(false)
    expect(resultado.size).toBe(1)
  })

  it('REQ-AYUDA-02 N2: acción inexistente en el catálogo se ignora', () => {
    const sesion = {
      rolId: 'rol-123',
      modulosHabilitados: ['ventas'],
      permisos: {
        ventas: ['ver', 'volar', 'destruir'],
      },
    }

    const resultado = permisosEfectivos(sesion)
    expect(resultado.has('ventas.ver')).toBe(true)
    expect((resultado as ReadonlySet<string>).has('ventas.volar')).toBe(false)
    expect(resultado.size).toBe(1)
  })

  it('REQ-AYUDA-02 N3: rolId null devuelve conjunto vacío', () => {
    const sesion = {
      rolId: null,
      modulosHabilitados: ['ventas', 'inventario'],
      permisos: {
        ventas: ['ver', 'crear'],
      },
    }

    const resultado = permisosEfectivos(sesion)
    expect(resultado.size).toBe(0)
  })
})
