import { describe, expect, it } from 'vitest'
import { bloquesVisibles } from './bloques'
import type { Session } from '../dal/session'

describe('bloquesVisibles', () => {
  it('retorna bloques de ventas si tiene acceso', () => {
    const session = {
      rolId: '123',
      tenantId: '123',
      modulosHabilitados: ['ventas'],
      permisos: { ventas: ['ver'] }
    } as unknown as Session
    const bloques = bloquesVisibles(session)
    expect(bloques).toContain('resultados')
    expect(bloques).toContain('flujo')
    expect(bloques).toContain('serie')
    expect(bloques).toContain('cobrar')
    expect(bloques).not.toContain('gastos')
  })

  it('retorna bloque de gastos si tiene acceso', () => {
    const session = {
      rolId: '123',
      tenantId: '123',
      modulosHabilitados: ['gastos'],
      permisos: { gastos: ['ver'] }
    } as unknown as Session
    const bloques = bloquesVisibles(session)
    expect(bloques).toContain('gastos')
    expect(bloques).not.toContain('resultados')
  })

  it('retorna bloques de inventario si tiene acceso', () => {
    const session = {
      rolId: '123',
      tenantId: '123',
      modulosHabilitados: ['inventario'],
      permisos: { inventario: ['ver'] }
    } as unknown as Session
    const bloques = bloquesVisibles(session)
    expect(bloques).toContain('mercaderia')
    expect(bloques).toContain('ranking')
    expect(bloques).not.toContain('gastos')
  })

  it('retorna bloques de rendiciones si tiene acceso', () => {
    const session = {
      rolId: '123',
      tenantId: '123',
      modulosHabilitados: ['consignaciones', 'rendiciones'],
      permisos: { rendiciones: ['ver'] }
    } as unknown as Session
    const bloques = bloquesVisibles(session)
    expect(bloques).toContain('proveedores')
    expect(bloques).not.toContain('mercaderia')
  })

  it('REQ-MODOP-08 N1: rol con rendiciones:ver en tenant sin el paquete → sin proveedores', () => {
    const session = {
      rolId: '123',
      tenantId: '123',
      modulosHabilitados: ['rendiciones'],
      permisos: { rendiciones: ['ver'] },
    } as unknown as Session
    const bloques = bloquesVisibles(session)
    expect(bloques).not.toContain('proveedores')
  })

  it('retorna bloques de revendedoras si tiene acceso', () => {
    const session = {
      rolId: '123',
      tenantId: '123',
      modulosHabilitados: ['revendedoras'],
      permisos: { revendedoras: ['ver'] }
    } as unknown as Session
    const bloques = bloquesVisibles(session)
    expect(bloques).toContain('revendedoras')
    expect(bloques).not.toContain('mercaderia')
  })

  it('no retorna revendedoras si solo tiene ver_propio', () => {
    const session = {
      rolId: '123',
      tenantId: '123',
      modulosHabilitados: ['revendedoras'],
      permisos: { revendedoras: ['ver_propio'] }
    } as unknown as Session
    const bloques = bloquesVisibles(session)
    expect(bloques).not.toContain('revendedoras')
  })

  it('no retorna revendedoras si tiene permiso ver pero el módulo está deshabilitado', () => {
    const session = {
      rolId: '123',
      tenantId: '123',
      modulosHabilitados: ['ventas'],
      permisos: { revendedoras: ['ver'], ventas: ['ver'] }
    } as unknown as Session
    const bloques = bloquesVisibles(session)
    expect(bloques).not.toContain('revendedoras')
    expect(bloques).toContain('resultados')
  })

  it('no retorna revendedoras si el módulo está habilitado pero no tiene permisos en revendedoras', () => {
    const session = {
      rolId: '123',
      tenantId: '123',
      modulosHabilitados: ['revendedoras'],
      permisos: {}
    } as unknown as Session
    const bloques = bloquesVisibles(session)
    expect(bloques).not.toContain('revendedoras')
  })

  it('retorna vacío si no tiene modulos', () => {
    const session = {
      rolId: '123',
      tenantId: '123',
      modulosHabilitados: [],
      permisos: {}
    } as unknown as Session
    const bloques = bloquesVisibles(session)
    expect(bloques.length).toBe(0)
  })

  it('retorna vacío si no tiene permiso ver', () => {
    const session = {
      rolId: '123',
      tenantId: '123',
      modulosHabilitados: ['ventas'],
      permisos: { ventas: ['crear'] } // Not ver
    } as unknown as Session
    const bloques = bloquesVisibles(session)
    expect(bloques.length).toBe(0)
  })
})

