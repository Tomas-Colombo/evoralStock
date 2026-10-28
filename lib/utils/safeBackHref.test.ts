import { describe, expect, it } from 'vitest'
import { safeBackHref } from './safeBackHref'

describe('safeBackHref', () => {
  it('conserva una ruta interna con su query', () => {
    expect(safeBackHref('/inventario?page=2', '/x')).toBe('/inventario?page=2')
  })

  it('usa el fallback si no hay `from`', () => {
    expect(safeBackHref(undefined, '/consignaciones')).toBe('/consignaciones')
    expect(safeBackHref('', '/consignaciones')).toBe('/consignaciones')
  })

  it('rechaza URLs de otro host', () => {
    expect(safeBackHref('//evil.com', '/x')).toBe('/x')
    expect(safeBackHref('/\\evil.com', '/x')).toBe('/x')
    expect(safeBackHref('http://evil.com', '/x')).toBe('/x')
    expect(safeBackHref('https://evil.com/inventario', '/x')).toBe('/x')
    expect(safeBackHref('javascript:alert(1)', '/x')).toBe('/x')
  })

  it('rechaza rutas relativas', () => {
    expect(safeBackHref('inventario', '/x')).toBe('/x')
  })
})
