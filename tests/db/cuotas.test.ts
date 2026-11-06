import { describe, expect, it } from 'vitest'
import {
  createTenantWithUser,
  hasTestDb,
  signInAs,
  unwrapFixture,
} from './_helpers'
import { venderFinanciado, ventaFixture } from './_fixtures-ventas'
import { getHoyBuenosAires } from '../fechas'

/**
 * Financiación propia (00059) + costo de cobro (00057) + incobrable en
 * cascada (00060).
 *
 * Todo lo que estas suites prueban vive en PL/pgSQL, así que se ejerce por
 * RPC con una SESIÓN REAL y no con el service_role: los SP arrancan con
 * `auth_tenant_id()` / `auth.uid()` y con service_role ambos son NULL — el
 * primer `raise 'no-tenant'` mataría la llamada antes de llegar a lo que se
 * quiere afirmar.
 *
 * Las lecturas de verificación sí usan service_role: interesa comprobar lo que
 * QUEDÓ en la tabla, sin que RLS pueda esconder una fila mal escrita y hacer
 * pasar el test por la razón equivocada.
 *
 * El fixture de venta vive en `_fixtures-ventas.ts` porque lo comparte la
 * suite de reportes.
 */

describe.skipIf(!hasTestDb)('cuota_financiada — 00059 registro', () => {
  it('la suma de pagos y cuotas cierra EXACTO contra el total de la venta', async () => {
    // La invariante central: 00047 la valida para el contado, y 00059 la
    // extiende a la deuda. Si no cierra, todo reporte de deuda arrastra un
    // error que nadie va a poder explicar después.
    const f = await ventaFixture('cuota-invariante')
    const { data: idVenta, error } = await venderFinanciado(f, {
      cuotas: 7, // 60.000 / 7 no divide exacto: fuerza el residuo
      primerVencimiento: '2027-01-10',
    })
    expect(error, 'sp_registrar_venta').toBeNull()

    const cuotas = unwrapFixture(
      'cuotas select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('monto')
        .eq('id_venta', idVenta as string),
    ) as Array<{ monto: string }>

    const sumaCuotas = cuotas.reduce((a, c) => a + Number(c.monto), 0)
    expect(cuotas).toHaveLength(7)
    expect(sumaCuotas).toBeCloseTo(f.precio, 2)
  })

  it('con anticipo, pagos + cuotas siguen cerrando contra el total', async () => {
    const f = await ventaFixture('cuota-anticipo')
    const anticipo = 20_000
    const { data: idVenta, error } = await venderFinanciado(f, {
      cuotas: 3,
      primerVencimiento: '2027-01-10',
      anticipo,
    })
    expect(error).toBeNull()

    const [cuotas, pagos] = await Promise.all([
      f.serviceRole.from('cuota_financiada').select('monto').eq('id_venta', idVenta as string),
      f.serviceRole.from('pago_venta').select('monto').eq('id_venta', idVenta as string),
    ])

    const sumaCuotas = (cuotas.data ?? []).reduce((a, c) => a + Number(c.monto), 0)
    const sumaPagos = (pagos.data ?? []).reduce((a, p) => a + Number(p.monto), 0)

    expect(sumaPagos).toBeCloseTo(anticipo, 2)
    expect(sumaCuotas).toBeCloseTo(f.precio - anticipo, 2)
    expect(sumaPagos + sumaCuotas).toBeCloseTo(f.precio, 2)
  })

  it('RECHAZA financiar una venta sin cliente', async () => {
    // Una deuda sin cliente es una deuda perdida.
    const f = await ventaFixture('cuota-sin-cliente')
    const { error } = await venderFinanciado(f, {
      cuotas: 3,
      primerVencimiento: '2027-01-10',
      idCliente: null,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/financiacion-sin-cliente/)
  })

  it('RECHAZA financiar cuando el anticipo ya cubre todo el total', async () => {
    const f = await ventaFixture('cuota-sin-saldo')
    const { error } = await venderFinanciado(f, {
      cuotas: 3,
      primerVencimiento: '2027-01-10',
      anticipo: f.precio,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/financiacion-sin-saldo/)
  })

  it('marca la venta como financiación propia y numera las cuotas desde 1', async () => {
    const f = await ventaFixture('cuota-numeracion')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 4,
      primerVencimiento: '2027-01-10',
    })

    const venta = unwrapFixture(
      'venta select',
      await f.serviceRole
        .from('venta')
        .select('financiacion')
        .eq('id_venta', idVenta as string)
        .single(),
    ) as { financiacion: string }
    expect(venta.financiacion).toBe('propia')

    const cuotas = unwrapFixture(
      'cuotas select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('numero, estado, monto_pagado, id_cliente')
        .eq('id_venta', idVenta as string)
        .order('numero'),
    ) as Array<{ numero: number; estado: string; monto_pagado: string; id_cliente: string }>

    expect(cuotas.map((c) => c.numero)).toEqual([1, 2, 3, 4])
    expect(cuotas.every((c) => c.estado === 'pendiente')).toBe(true)
    expect(cuotas.every((c) => Number(c.monto_pagado) === 0)).toBe(true)
    // Denormalizado a propósito: la deuda se busca por cliente sin joins.
    expect(cuotas.every((c) => c.id_cliente === f.idCliente)).toBe(true)
  })

  it('encadena vencimientos mensuales desde la fecha base', async () => {
    const f = await ventaFixture('cuota-vencimientos')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 3,
      primerVencimiento: '2027-01-31',
    })

    const cuotas = unwrapFixture(
      'cuotas select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('fecha_vencimiento')
        .eq('id_venta', idVenta as string)
        .order('numero'),
    ) as Array<{ fecha_vencimiento: string }>

    // 31/01 → 28/02 por ajuste de fin de mes, pero marzo VUELVE al 31: el
    // ajuste no se acumula porque cada fecha sale de la base.
    expect(cuotas.map((c) => c.fecha_vencimiento)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ])
  })
})

describe.skipIf(!hasTestDb)('sp_cobrar_cuota — 00059', () => {
  it('el cobro total deja la cuota pagada y GENERA un pago en la caja', async () => {
    // `cuota_financiada` es cuentas por cobrar; `pago_venta` es caja. Cobrar
    // tiene que mover plata de una a la otra, no sólo cambiar un estado.
    const f = await ventaFixture('cobro-total')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 3,
      primerVencimiento: '2027-01-10',
    })

    const cuota = unwrapFixture(
      'cuota select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada, monto')
        .eq('id_venta', idVenta as string)
        .eq('numero', 1)
        .single(),
    ) as { id_cuota_financiada: string; monto: string }

    const { error } = await f.authenticated.rpc('sp_cobrar_cuota', {
      p_id_cuota: cuota.id_cuota_financiada,
      p_monto: Number(cuota.monto),
      p_medio: 'efectivo',
      p_id_cuenta_destino: f.idCuenta,
    })
    expect(error, 'sp_cobrar_cuota').toBeNull()

    const despues = unwrapFixture(
      'cuota select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('estado, monto_pagado, fecha_cobro')
        .eq('id_cuota_financiada', cuota.id_cuota_financiada)
        .single(),
    ) as { estado: string; monto_pagado: string; fecha_cobro: string | null }

    expect(despues.estado).toBe('pagada')
    expect(Number(despues.monto_pagado)).toBeCloseTo(Number(cuota.monto), 2)
    expect(despues.fecha_cobro).not.toBeNull()

    const pagos = unwrapFixture(
      'pagos select',
      await f.serviceRole
        .from('pago_venta')
        .select('monto')
        .eq('id_cuota_financiada', cuota.id_cuota_financiada),
    ) as Array<{ monto: string }>
    expect(pagos).toHaveLength(1)
    expect(Number(pagos[0].monto)).toBeCloseTo(Number(cuota.monto), 2)
  })

  it('el cobro parcial deja la cuota en `parcial` con el saldo correcto', async () => {
    const f = await ventaFixture('cobro-parcial')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 3,
      primerVencimiento: '2027-01-10',
    })
    const cuota = unwrapFixture(
      'cuota select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada, monto')
        .eq('id_venta', idVenta as string)
        .eq('numero', 1)
        .single(),
    ) as { id_cuota_financiada: string; monto: string }

    const mitad = Math.round(Number(cuota.monto) / 2)
    const { error } = await f.authenticated.rpc('sp_cobrar_cuota', {
      p_id_cuota: cuota.id_cuota_financiada,
      p_monto: mitad,
      p_medio: 'efectivo',
      p_id_cuenta_destino: f.idCuenta,
    })
    expect(error).toBeNull()

    const despues = unwrapFixture(
      'cuota select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('estado, monto_pagado, fecha_cobro')
        .eq('id_cuota_financiada', cuota.id_cuota_financiada)
        .single(),
    ) as { estado: string; monto_pagado: string; fecha_cobro: string | null }

    expect(despues.estado).toBe('parcial')
    expect(Number(despues.monto_pagado)).toBeCloseTo(mitad, 2)
    // Todavía no se terminó de cobrar: la fecha de cobro es del cierre.
    expect(despues.fecha_cobro).toBeNull()
  })

  it('RECHAZA cobrar más que el saldo', async () => {
    const f = await ventaFixture('cobro-excede')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 3,
      primerVencimiento: '2027-01-10',
    })
    const cuota = unwrapFixture(
      'cuota select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada, monto')
        .eq('id_venta', idVenta as string)
        .eq('numero', 1)
        .single(),
    ) as { id_cuota_financiada: string; monto: string }

    const { error } = await f.authenticated.rpc('sp_cobrar_cuota', {
      p_id_cuota: cuota.id_cuota_financiada,
      p_monto: Number(cuota.monto) + 1,
      p_medio: 'efectivo',
      p_id_cuenta_destino: f.idCuenta,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/monto-excede-saldo/)
  })

  it('RECHAZA cobrar una cuota ya pagada', async () => {
    const f = await ventaFixture('cobro-repetido')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 2,
      primerVencimiento: '2027-01-10',
    })
    const cuota = unwrapFixture(
      'cuota select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada, monto')
        .eq('id_venta', idVenta as string)
        .eq('numero', 1)
        .single(),
    ) as { id_cuota_financiada: string; monto: string }

    const cobrar = () =>
      f.authenticated.rpc('sp_cobrar_cuota', {
        p_id_cuota: cuota.id_cuota_financiada,
        p_monto: Number(cuota.monto),
        p_medio: 'efectivo',
        p_id_cuenta_destino: f.idCuenta,
      })

    expect((await cobrar()).error).toBeNull()
    const segundo = await cobrar()
    expect(segundo.error).not.toBeNull()
    expect(segundo.error?.message).toMatch(/cuota-no-cobrable/)
  })
})

describe.skipIf(!hasTestDb)('sp_marcar_cuota_incobrable — 00060 cascada', () => {
  it('arrastra las cuotas POSTERIORES sin registrar gasto', async () => {
    const f = await ventaFixture('incobrable-cascada')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 6,
      primerVencimiento: '2027-01-10',
    })

    const cuotas = unwrapFixture(
      'cuotas select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada, numero, monto')
        .eq('id_venta', idVenta as string)
        .order('numero'),
    ) as Array<{ id_cuota_financiada: string; numero: number; monto: string }>

    // Se cobran las dos primeras: tienen que quedar intactas.
    for (const c of cuotas.slice(0, 2)) {
      const { error } = await f.authenticated.rpc('sp_cobrar_cuota', {
        p_id_cuota: c.id_cuota_financiada,
        p_monto: Number(c.monto),
        p_medio: 'efectivo',
        p_id_cuenta_destino: f.idCuenta,
      })
      expect(error).toBeNull()
    }

    const { data: resultado, error } = await f.authenticated.rpc(
      'sp_marcar_cuota_incobrable',
      { p_id_cuota: cuotas[2].id_cuota_financiada, p_motivo: 'No responde hace 4 meses' },
    )
    expect(error, 'sp_marcar_cuota_incobrable').toBeNull()

    const r = resultado as unknown as {
      cuotas_afectadas: number
      monto_total: number
      desde: number
      hasta: number
    }
    expect(r.cuotas_afectadas).toBe(4) // 3, 4, 5 y 6
    expect(r.desde).toBe(3)
    expect(r.hasta).toBe(6)

    const finales = unwrapFixture(
      'cuotas select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('numero, estado')
        .eq('id_venta', idVenta as string)
        .order('numero'),
    ) as Array<{ numero: number; estado: string }>

    expect(finales.map((c) => c.estado)).toEqual([
      'pagada',
      'pagada',
      'incobrable',
      'incobrable',
      'incobrable',
      'incobrable',
    ])
  })

  it('NO cruza a otra compra del mismo cliente', async () => {
    // Que no pague una compra no prueba que no vaya a pagar otra.
    const f = await ventaFixture('incobrable-dos-compras', 2)
    const [itemA, itemB] = f.items

    const { data: ventaA } = await venderFinanciado(f, {
      cuotas: 3,
      primerVencimiento: '2027-01-10',
      items: [itemA],
    })
    const { data: ventaB } = await venderFinanciado(f, {
      cuotas: 3,
      primerVencimiento: '2027-02-10',
      items: [itemB],
    })

    const cuotaA1 = unwrapFixture(
      'cuota select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada')
        .eq('id_venta', ventaA as string)
        .eq('numero', 1)
        .single(),
    ) as { id_cuota_financiada: string }

    const { error } = await f.authenticated.rpc('sp_marcar_cuota_incobrable', {
      p_id_cuota: cuotaA1.id_cuota_financiada,
      p_motivo: 'Se mudó sin avisar',
    })
    expect(error).toBeNull()

    const deB = unwrapFixture(
      'cuotas B',
      await f.serviceRole
        .from('cuota_financiada')
        .select('estado')
        .eq('id_venta', ventaB as string),
    ) as Array<{ estado: string }>
    expect(deB.every((c) => c.estado === 'pendiente')).toBe(true)
  })

  it('de una cuota PARCIAL da por perdido sólo el saldo, no el monto entero', async () => {
    const f = await ventaFixture('incobrable-parcial')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 2,
      primerVencimiento: '2027-01-10',
    })
    const cuota = unwrapFixture(
      'cuota select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada, monto')
        .eq('id_venta', idVenta as string)
        .eq('numero', 1)
        .single(),
    ) as { id_cuota_financiada: string; monto: string }

    const pagado = 10_000
    await f.authenticated.rpc('sp_cobrar_cuota', {
      p_id_cuota: cuota.id_cuota_financiada,
      p_monto: pagado,
      p_medio: 'efectivo',
      p_id_cuenta_destino: f.idCuenta,
    })

    const { data: resultado } = await f.authenticated.rpc('sp_marcar_cuota_incobrable', {
      p_id_cuota: cuota.id_cuota_financiada,
      p_motivo: 'Dejó de pagar',
    })
    const r = resultado as unknown as { monto_total: number }

    // Total del plan menos lo que efectivamente entró.
    expect(r.monto_total).toBeCloseTo(f.precio - pagado, 2)
  })

  it('RECHAZA sin motivo', async () => {
    const f = await ventaFixture('incobrable-sin-motivo')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 2,
      primerVencimiento: '2027-01-10',
    })
    const cuota = unwrapFixture(
      'cuota select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('id_cuota_financiada')
        .eq('id_venta', idVenta as string)
        .eq('numero', 1)
        .single(),
    ) as { id_cuota_financiada: string }

    const { error } = await f.authenticated.rpc('sp_marcar_cuota_incobrable', {
      p_id_cuota: cuota.id_cuota_financiada,
      p_motivo: '   ',
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/motivo-requerido/)
  })
})

describe.skipIf(!hasTestDb)('sp_anular_venta con cuotas — 00059', () => {
  it('las cuotas abiertas pasan a `anulada`, NO a incobrable', async () => {
    // Una venta anulada no es una pérdida: es una venta que no existió. Si
    // cayeran en incobrable, el reporte de pérdidas contaría plata que nadie
    // dejó de pagar.
    const f = await ventaFixture('anular-con-cuotas')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 4,
      primerVencimiento: '2027-01-10',
    })

    const { error } = await f.authenticated.rpc('sp_anular_venta', {
      p_id_venta: idVenta as string,
      p_motivo: 'Error de carga',
    })
    expect(error, 'sp_anular_venta').toBeNull()

    const cuotas = unwrapFixture(
      'cuotas select',
      await f.serviceRole
        .from('cuota_financiada')
        .select('estado')
        .eq('id_venta', idVenta as string),
    ) as Array<{ estado: string }>

    expect(cuotas.every((c) => c.estado === 'anulada')).toBe(true)

    // Y no se registró ninguna pérdida por esto.
    const gastos = unwrapFixture(
      'gastos select',
      await f.serviceRole.from('gasto_negocio').select('id_gasto').eq('id_tenant', f.tenantId),
    ) as Array<{ id_gasto: string }>
    expect(gastos).toHaveLength(0)
  })
})

describe.skipIf(!hasTestDb)('cuota_financiada — RLS y constraints', () => {
  it('un tenant NO ve las cuotas de otro', async () => {
    const a = await ventaFixture('rls-a')
    await venderFinanciado(a, { cuotas: 3, primerVencimiento: '2027-01-10' })

    const b = await createTenantWithUser('rls-b')
    const sesionB = await signInAs(b)

    const { data, error } = await sesionB.from('cuota_financiada').select('id_cuota_financiada')
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('el check de coherencia rechaza `pagada` con monto_pagado = 0', async () => {
    // El estado no puede contradecir al monto: una cuota "pagada" sin plata
    // desaparece del panel de deuda sin que haya entrado un peso.
    const f = await ventaFixture('check-coherencia')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 2,
      primerVencimiento: '2027-01-10',
    })

    // Con service_role: RLS no aplica, así que lo único que puede frenar esto
    // es el CHECK de la tabla — que es justo lo que se quiere probar.
    const { error } = await f.serviceRole
      .from('cuota_financiada')
      .update({ estado: 'pagada' })
      .eq('id_venta', idVenta as string)
      .eq('numero', 1)

    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514') // check_violation
  })

  it('el check rechaza pagar más que el monto de la cuota', async () => {
    const f = await ventaFixture('check-excede')
    const { data: idVenta } = await venderFinanciado(f, {
      cuotas: 2,
      primerVencimiento: '2027-01-10',
    })

    const { error } = await f.serviceRole
      .from('cuota_financiada')
      .update({ monto_pagado: 999_999 })
      .eq('id_venta', idVenta as string)
      .eq('numero', 1)

    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514')
  })
})

describe.skipIf(!hasTestDb)('sp_calcular_costo_cobro — 00057', () => {
  it('sin tarifario devuelve costo 0 y NO bloquea la venta', async () => {
    // El vendedor no puede cargar un arancel desde el mostrador: bloquear la
    // venta por eso pierde plata real para ganar precisión contable.
    const f = await ventaFixture('costo-sin-tarifario')
    const { data, error } = await f.authenticated.rpc('sp_calcular_costo_cobro', {
      p_id_cuenta_destino: f.idCuenta,
      p_medio: 'efectivo',
      p_cuotas: null,
      p_monto: 50_000,
    })
    expect(error).toBeNull()
    const r = data as unknown as { sin_tarifario: boolean; costo_total: number; neto: number }
    expect(r.sin_tarifario).toBe(true)
    expect(Number(r.costo_total)).toBe(0)
    expect(Number(r.neto)).toBeCloseTo(50_000, 2)
  })

  it('aplica arancel e IVA SOBRE EL ARANCEL, no sobre la venta', async () => {
    const f = await ventaFixture('costo-arancel')
    const banco = unwrapFixture(
      'cuenta banco',
      await f.serviceRole
        .from('cuenta_destino')
        .insert({ id_tenant: f.tenantId, nombre: 'Mercado Pago', tipo: 'billetera_virtual' })
        .select('id_cuenta_destino')
        .single(),
    ) as { id_cuenta_destino: string }

    unwrapFixture(
      'arancel insert',
      await f.serviceRole
        .from('arancel_cobro')
        .insert({
          id_tenant: f.tenantId,
          id_cuenta_destino: banco.id_cuenta_destino,
          medio: 'tarjeta_credito',
          cuotas: null,
          arancel_pct: 6.29,
          iva_arancel_pct: 21,
          dias_acreditacion: 18,
          vigente_desde: getHoyBuenosAires(),
        })
        .select('id_arancel_cobro')
        .single(),
    )

    const { data, error } = await f.authenticated.rpc('sp_calcular_costo_cobro', {
      p_id_cuenta_destino: banco.id_cuenta_destino,
      p_medio: 'tarjeta_credito',
      p_cuotas: 6,
      p_monto: 50_000,
    })
    expect(error).toBeNull()

    const r = data as unknown as {
      sin_tarifario: boolean
      arancel_monto: number
      iva_arancel_monto: number
      costo_total: number
      dias_acreditacion: number
    }
    expect(r.sin_tarifario).toBe(false)
    expect(Number(r.arancel_monto)).toBeCloseTo(3145, 2)
    // 21% de 3.145, NO de 50.000 (que serían 10.500).
    expect(Number(r.iva_arancel_monto)).toBeCloseTo(660.45, 2)
    expect(Number(r.costo_total)).toBeCloseTo(3805.45, 2)
    expect(r.dias_acreditacion).toBe(18)
  })
})
