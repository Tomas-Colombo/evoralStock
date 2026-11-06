import { describe, expect, it } from 'vitest'
import {
  hasTestDb,
  unwrapFixture,
} from './_helpers'
import { ventaFixture, venderFinanciado } from './_fixtures-ventas'
import { oraculoDeudores, type FilaCuotaOraculo } from './_oraculo-deudores'
import { aplicarFiltro, type FiltroCuotas } from '@/lib/dal/cuotas/cuota'

describe.skipIf(!hasTestDb)('rf_deudores_resumen vs oraculoDeudores', () => {
  it('produce exactamente el mismo resultado (rows + resumen) en todos los filtros y con search', async () => {
    // Fixture con stock suficiente para 6 ventas financiadas
    const f = await ventaFixture('rf-deudores', 12)

    // Creamos 4 clientes con nombres específicos para ejercitar search y desempate
    const cliA = unwrapFixture(
      'cliente A',
      await f.serviceRole
        .from('cliente')
        .insert({
          id_tenant: f.tenantId,
          nombre: 'Ana',
          apellido: 'Gómez',
          telefono: '11111111',
        })
        .select('id_cliente')
        .single(),
    ) as { id_cliente: string }

    const cliB = unwrapFixture(
      'cliente B',
      await f.serviceRole
        .from('cliente')
        .insert({
          id_tenant: f.tenantId,
          nombre: 'Bernardo',
          apellido: 'López',
          telefono: '22222222',
        })
        .select('id_cliente')
        .single(),
    ) as { id_cliente: string }

    const cliC = unwrapFixture(
      'cliente C',
      await f.serviceRole
        .from('cliente')
        .insert({
          id_tenant: f.tenantId,
          nombre: 'Carlos',
          apellido: 'Martínez',
          telefono: null,
        })
        .select('id_cliente')
        .single(),
    ) as { id_cliente: string }

    const cliD = unwrapFixture(
      'cliente D',
      await f.serviceRole
        .from('cliente')
        .insert({
          id_tenant: f.tenantId,
          nombre: 'Diana',
          apellido: 'Gómez', // Mismo apellido para search 'Gómez'
          telefono: '44444444',
        })
        .select('id_cliente')
        .single(),
    ) as { id_cliente: string }

    // Registramos ventas financiadas para cada cliente
    const { data: vA1 } = await venderFinanciado(f, {
      cuotas: 3,
      primerVencimiento: '2026-08-05',
      idCliente: cliA.id_cliente,
      items: [f.items[0]],
    })
    const { data: vA2 } = await venderFinanciado(f, {
      cuotas: 1,
      primerVencimiento: '2026-08-01',
      idCliente: cliA.id_cliente,
      items: [f.items[1]],
    })
    const { data: vB } = await venderFinanciado(f, {
      cuotas: 2,
      primerVencimiento: '2026-08-16',
      idCliente: cliB.id_cliente,
      items: [f.items[2]],
    })
    const { data: vC } = await venderFinanciado(f, {
      cuotas: 1,
      primerVencimiento: '2026-07-20',
      idCliente: cliC.id_cliente,
      items: [f.items[3]],
    })
    const { data: vD } = await venderFinanciado(f, {
      cuotas: 1,
      primerVencimiento: '2026-08-10',
      idCliente: cliD.id_cliente,
      items: [f.items[4]],
    })

    const hoy = '2026-08-15'

    // Ajustamos cuotas con serviceRole para armar todas las ramas de negocio:
    // Cliente A:
    //  - Venta 1, cuota 1: vencida (2026-08-05), monto 1000, pendiente
    //  - Venta 1, cuota 2: vence hoy (2026-08-15), monto 1500, pendiente
    //  - Venta 1, cuota 3: mes siguiente (2026-09-15), monto 2000, pendiente
    //  - Venta 2, cuota 1: vencida parcial (2026-08-01), monto 1000, monto_pagado 400, estado 'parcial'
    const cuotasA1 = unwrapFixture(
      'cuotasA1',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada, numero')
        .eq('id_venta', vA1 as string)
        .order('numero'),
    ) as Array<{ id_cuota_financiada: string; numero: number }>

    await f.serviceRole
      .from('cuota_financiada')
      .update({ fecha_vencimiento: '2026-08-05', monto: 1000, monto_pagado: 0, estado: 'pendiente' })
      .eq('id_cuota_financiada', cuotasA1[0].id_cuota_financiada)
    await f.serviceRole
      .from('cuota_financiada')
      .update({ fecha_vencimiento: '2026-08-15', monto: 1500, monto_pagado: 0, estado: 'pendiente' })
      .eq('id_cuota_financiada', cuotasA1[1].id_cuota_financiada)
    await f.serviceRole
      .from('cuota_financiada')
      .update({ fecha_vencimiento: '2026-09-15', monto: 2000, monto_pagado: 0, estado: 'pendiente' })
      .eq('id_cuota_financiada', cuotasA1[2].id_cuota_financiada)

    const cuotasA2 = unwrapFixture(
      'cuotasA2',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada')
        .eq('id_venta', vA2 as string),
    ) as Array<{ id_cuota_financiada: string }>

    await f.serviceRole
      .from('cuota_financiada')
      .update({ fecha_vencimiento: '2026-08-01', monto: 1000, monto_pagado: 400, estado: 'parcial' })
      .eq('id_cuota_financiada', cuotasA2[0].id_cuota_financiada)

    // Cliente B:
    //  - Venta B, cuota 1: vence mañana (2026-08-16), monto 800, pendiente
    //  - Venta B, cuota 2: vence fin de mes (2026-08-31), monto 1200, pendiente
    const cuotasB = unwrapFixture(
      'cuotasB',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada, numero')
        .eq('id_venta', vB as string)
        .order('numero'),
    ) as Array<{ id_cuota_financiada: string; numero: number }>

    await f.serviceRole
      .from('cuota_financiada')
      .update({ fecha_vencimiento: '2026-08-16', monto: 800, monto_pagado: 0, estado: 'pendiente' })
      .eq('id_cuota_financiada', cuotasB[0].id_cuota_financiada)
    await f.serviceRole
      .from('cuota_financiada')
      .update({ fecha_vencimiento: '2026-08-31', monto: 1200, monto_pagado: 0, estado: 'pendiente' })
      .eq('id_cuota_financiada', cuotasB[1].id_cuota_financiada)

    // Cliente C:
    //  - Venta C, cuota 1: incobrable, monto 5000, monto_pagado 1000, saldo 4000
    const cuotasC = unwrapFixture(
      'cuotasC',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada')
        .eq('id_venta', vC as string),
    ) as Array<{ id_cuota_financiada: string }>

    await f.serviceRole
      .from('cuota_financiada')
      .update({ fecha_vencimiento: '2026-07-20', monto: 5000, monto_pagado: 1000, estado: 'incobrable' })
      .eq('id_cuota_financiada', cuotasC[0].id_cuota_financiada)

    // Cliente D:
    //  - Venta D, cuota 1: pagada, monto 3000, monto_pagado 3000
    const cuotasD = unwrapFixture(
      'cuotasD',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada')
        .eq('id_venta', vD as string),
    ) as Array<{ id_cuota_financiada: string }>

    await f.serviceRole
      .from('cuota_financiada')
      .update({ fecha_vencimiento: '2026-08-10', monto: 3000, monto_pagado: 3000, estado: 'pagada' })
      .eq('id_cuota_financiada', cuotasD[0].id_cuota_financiada)

    async function checkParidad(filtro: FiltroCuotas & { hoy: string }) {
      // 1. Ejecutar función en base de datos via RPC
      const { data: dbResult, error: dbError } = await f.authenticated.rpc('rf_deudores_resumen', {
        p_hoy: filtro.hoy,
        p_estado: filtro.estado ?? 'con_deuda',
        p_desde: filtro.desde ?? null,
        p_hasta: filtro.hastaInclusivo ?? null,
        p_search: filtro.search ? filtro.search.trim() : null,
      })
      expect(dbError, `RPC rf_deudores_resumen con filtro ${JSON.stringify(filtro)}`).toBeNull()

      // 2. Traer las cuotas filtradas de la base de datos simulando listDeudores
      let q = f.authenticated
        .from('cuota_financiada')
        .select(
          `id_cliente, id_venta, estado, monto, monto_pagado, fecha_vencimiento,
           cliente:cliente!inner(id_cliente, nombre, apellido, nombre_completo, telefono)`,
        )
        .order('fecha_vencimiento', { ascending: true })
      q = aplicarFiltro(q, filtro, filtro.hoy)
      const { data: rawFilas, error: selectError } = await q
      expect(selectError, `Select cuotas con filtro ${JSON.stringify(filtro)}`).toBeNull()

      // 3. Ejecutar el oráculo puro TS
      const oraculoResult = oraculoDeudores(
        (rawFilas ?? []) as unknown as FilaCuotaOraculo[],
        filtro.hoy,
      )

      // 4. Comparación campo por campo y orden exacto
      expect(dbResult).toEqual(oraculoResult)
    }

    // Casos de prueba:
    // A) Todos los estados del catálogo de filtros
    const estados = [
      'con_deuda',
      'todas',
      'vencidas',
      'vence_este_mes',
      'parciales',
      'pagadas',
      'incobrables',
    ] as const

    for (const estado of estados) {
      await checkParidad({ hoy, estado })
    }

    // B) Filtros con búsqueda (search)
    await checkParidad({ hoy, search: 'Gómez' })
    await checkParidad({ hoy, search: '  López  ' })
    await checkParidad({ hoy, search: 'Carlos' })
    await checkParidad({ hoy, search: 'inexistente_xyz' })

    // C) Filtros por rango de fechas
    await checkParidad({ hoy, desde: '2026-08-01', hastaInclusivo: '2026-08-15' })
    await checkParidad({ hoy, estado: 'todas', desde: '2026-07-01', hastaInclusivo: '2026-08-31' })

    // D) Búsqueda combinada con estado y rango
    await checkParidad({
      hoy,
      estado: 'vencidas',
      search: 'Ana',
      desde: '2026-08-01',
      hastaInclusivo: '2026-08-10',
    })

    // E) Aserción absoluta: con 'todas', la cuota incobrable no suma en adeudado
    // y la pagada vencida no cuenta en clientesVencidos
    const { data: todasResult, error: todasError } = await f.authenticated.rpc('rf_deudores_resumen', {
      p_hoy: hoy,
      p_estado: 'todas',
    })
    expect(todasError).toBeNull()

    const todas = todasResult as {
      rows: Array<{ id_cliente: string; adeudado: number; vencidas: number; pendientes: number }>
      resumen: { clientesConDeuda: number; clientesVencidos: number }
    }

    const filaC = todas.rows.find((r) => r.id_cliente === cliC.id_cliente)
    expect(filaC).toBeDefined()
    expect(filaC?.adeudado).toBe(0)
    expect(filaC?.pendientes).toBe(0)

    const filaD = todas.rows.find((r) => r.id_cliente === cliD.id_cliente)
    expect(filaD).toBeDefined()
    expect(filaD?.vencidas).toBe(0)
    expect(todas.resumen.clientesVencidos).toBe(1) // Solo Cliente A
    expect(todas.resumen.clientesConDeuda).toBe(2)  // Solo Clientes A y B
  })
})
