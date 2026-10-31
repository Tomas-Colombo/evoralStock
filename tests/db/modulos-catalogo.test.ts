import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { hasTestDb } from './_helpers'
import { MODULOS_NUCLEO, PAQUETES_OPCIONALES } from '@/lib/modulos/catalogo'

describe.skipIf(!hasTestDb)('DR-MODOP-3: Paridad de catálogo entre TS y Postgres', () => {
  const serviceRole = createServiceRoleTestClient()

  it('DR-MODOP-3: para cada clave de PAQUETES_OPCIONALES, fn_codigos_paquete devuelve exactamente sus códigos', async () => {
    for (const [clave, codigos] of Object.entries(PAQUETES_OPCIONALES)) {
      const { data, error } = await serviceRole.rpc('fn_codigos_paquete', { p_paquete: clave })
      expect(error).toBeNull()
      expect(data).toEqual([...codigos])
    }

    const { data: invalido } = await serviceRole.rpc('fn_codigos_paquete', { p_paquete: 'inexistente' })
    expect(invalido).toBeNull()
  })

  it('DR-MODOP-3: para cada código de la tabla modulo, fn_modulo_es_nucleo es true sii está en MODULOS_NUCLEO', async () => {
    const { data: modulos, error } = await serviceRole
      .from('modulo')
      .select('codigo')

    expect(error).toBeNull()
    expect(modulos).toBeDefined()
    expect(modulos!.length).toBeGreaterThan(0)

    const nucleoSet = new Set<string>(MODULOS_NUCLEO)

    for (const row of modulos!) {
      const { data: esNucleo, error: rpcError } = await serviceRole.rpc('fn_modulo_es_nucleo', {
        p_codigo: row.codigo,
      })
      expect(rpcError).toBeNull()
      expect(esNucleo).toBe(nucleoSet.has(row.codigo))
    }
  })
})
