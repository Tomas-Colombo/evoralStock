import { describe, expect, test } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { COSTO, PRECIO, ventaFixture } from './_fixtures-ventas'

describe('EstadoItem transiciones — DB-02', () => {
  test('matriz completa de is_transicion_item_valida', async () => {
    const serviceRole = createServiceRoleTestClient()
    // Helper para verificar si una transición es válida en DB
    const isValida = async (desde: string, hasta: string) => {
      const { data, error } = await serviceRole.rpc('is_transicion_item_valida', { p_desde: desde, p_hasta: hasta })
      if (error) throw error
      return data
    }

    const estados = ['disponible', 'reservado', 'vendido', 'devuelto', 'baja', 'devuelto_cliente', 'en_revendedora']

    const allowedTransitions: Record<string, string[]> = {
      'disponible': ['reservado', 'vendido', 'devuelto', 'baja', 'en_revendedora'],
      'reservado': ['disponible', 'vendido', 'baja'],
      'vendido': ['disponible', 'devuelto_cliente', 'devuelto', 'baja', 'en_revendedora'],
      'devuelto_cliente': ['disponible', 'baja'],
      'en_revendedora': ['disponible', 'vendido', 'devuelto', 'baja'],
      'devuelto': ['disponible', 'baja'],
      'baja': []
    }

    for (const desde of estados) {
      for (const hasta of estados) {
        const expected = allowedTransitions[desde]?.includes(hasta) ?? false
        const actual = await isValida(desde, hasta)
        expect(actual, `Transición ${desde} -> ${hasta} debería ser ${expected}`).toBe(expected)
      }
    }
  })

  test('un ítem en_revendedora suma a capital_propio y valor_venta_potencial igual que uno disponible', async () => {
    const f = await ventaFixture('PosRev', 2, { tipoIngreso: 'compra' })

    const { data: posAntes, error: errAntes } = await f.authenticated.rpc('rf_finanzas_posicion').single()
    expect(errAntes).toBeNull()
    expect(Number((posAntes as Record<string, unknown>).capital_propio)).toBe(2 * COSTO)
    expect(Number((posAntes as Record<string, unknown>).valor_venta_potencial)).toBe(2 * PRECIO)

    // Transicionamos el segundo ítem de disponible a en_revendedora
    const { error: errTrans } = await f.authenticated.rpc('sp_transicion_item_producto', {
      p_id_item: f.items[1],
      p_estado_hasta: 'en_revendedora',
      p_tipo_movimiento: 'consignacion_revendedora',
    })
    expect(errTrans).toBeNull()

    const { data: posDespues, error: errDespues } = await f.authenticated.rpc('rf_finanzas_posicion').single()
    expect(errDespues).toBeNull()
    expect(Number((posDespues as Record<string, unknown>).capital_propio)).toBe(2 * COSTO)
    expect(Number((posDespues as Record<string, unknown>).valor_venta_potencial)).toBe(2 * PRECIO)
  })
})

