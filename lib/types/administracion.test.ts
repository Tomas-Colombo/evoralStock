import { describe, expect, it } from 'vitest'
import {
  accionesDelModulo,
  type Permiso,
} from './administracion'
import type { EntradaGuia } from '@/lib/ayuda/tipos'

describe('REQ-AYUDA-01: Permisos tipados', () => {
  it('REQ-AYUDA-01 Feliz: ventas.crear es asignable al tipo Permiso', () => {
    const permiso: Permiso = 'ventas.crear'
    expect(permiso).toBe('ventas.crear')
  })

  it('REQ-AYUDA-01 N1: ventas.borrar no es un permiso válido y permisos no puede ser una tupla vacía', () => {
    // @ts-expect-error 'ventas.borrar' no existe en el catálogo de permisos
    const permisoInvalido: Permiso = 'ventas.borrar'
    expect(permisoInvalido).toBe('ventas.borrar')

    const entradaInvalida: EntradaGuia = {
      id: 'test-guia-invalida',
      titulo: 'Test inválido',
      pasos: ['Paso 1'],
      // @ts-expect-error permisos debe tener al menos un Permiso (tupla no vacía)
      permisos: [],
    }
    expect(entradaInvalida.permisos).toEqual([])
  })

  it('REQ-AYUDA-01 N2: accionesDelModulo con módulo inexistente devuelve undefined', () => {
    expect(accionesDelModulo('inexistente')).toBeUndefined()
  })
})
