import { describe, expect, test } from 'vitest'
import { createTenantWithUser, signInAs, unwrapFixture, withScopedTenant, hasTestDb } from './_helpers'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'

async function habilitarModulo(tenantId: string, codigo: string) {
  const sr = createServiceRoleTestClient()
  const { data: mod, error: modErr } = await sr
    .from('modulo')
    .select('id_modulo')
    .eq('codigo', codigo)
    .single()
  expect(modErr).toBeNull()
  const { error } = await sr
    .from('tenant_modulo')
    .upsert({ id_tenant: tenantId, id_modulo: mod!.id_modulo, habilitado: true })
  expect(error).toBeNull()
}

describe.skipIf(!hasTestDb)('Finanzas de revendedoras — Slice 6b (REQ-RV-DB-08 / specs/golden.md)', () => {
  test('Escenario Dorado de Revendedoras: canal local, comision liquidada, comision pendiente y venta anulada', async () => {
    const user = await createTenantWithUser('GoldRev')
    const authenticated = await signInAs(user)
    const sr = user.serviceRole
    const tenantId = user.tenantId

    // 1. Habilitar módulo revendedoras y gastos
    await habilitarModulo(tenantId, 'revendedoras')
    await habilitarModulo(tenantId, 'gastos')

    // 2. Crear categoría y producto P1: precio_venta = 100.000
    const PRECIO_P1 = 100_000
    const COSTO_P1 = 40_000

    const cat = unwrapFixture(
      'categoria insert',
      await sr
        .from('categoria')
        .insert({ id_tenant: tenantId, nombre: withScopedTenant('cat-gold') })
        .select('id_categoria')
        .single(),
    ) as { id_categoria: string }

    const prod = unwrapFixture(
      'producto insert',
      await sr
        .from('producto')
        .insert({
          id_tenant: tenantId,
          id_categoria: cat.id_categoria,
          nombre: withScopedTenant('prod-p1'),
          precio_venta: PRECIO_P1,
          precio_venta_resuelto_at: new Date().toISOString(),
        })
        .select('id_producto')
        .single(),
    ) as { id_producto: string }

    // 3. Crear 4 ítems de P1 al costo de $40.000 c/u comprados y confirmados en M (total compras: $160.000)
    const { data: prov } = await sr
      .from('proveedor')
      .insert({ id_tenant: tenantId, nombre: 'Proveedor P1' })
      .select('id_proveedor')
      .single()

    const { data: ing } = await sr
      .from('ingreso_mercaderia')
      .insert({
        id_tenant: tenantId,
        tipo_ingreso: 'compra',
        confirmado: false,
        id_proveedor: prov!.id_proveedor,
      })
      .select('id_ingreso')
      .single()

    const { data: det, error: detErr } = await sr
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: tenantId,
        id_ingreso: ing!.id_ingreso,
        id_producto: prod.id_producto,
        cantidad: 4,
      })
      .select('id_detalle')
      .single()
    expect(detErr).toBeNull()

    const { error: detCostoErr } = await sr.from('ingreso_detalle_costo').insert({
      id_detalle: det!.id_detalle,
      id_tenant: tenantId,
      costo_unitario: COSTO_P1,
    })
    expect(detCostoErr).toBeNull()

    const { error: stockErr } = await authenticated.rpc('sp_confirmar_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
    })
    expect(stockErr).toBeNull()

    const { data: stockItems } = await sr
      .from('item_producto')
      .select('id_item')
      .eq('id_producto', prod.id_producto)
      .eq('estado_item', 'disponible')
    expect(stockItems).toHaveLength(4)
    const items = stockItems!.map((i) => i.id_item)

    // Cuenta de efectivo
    const { data: cuenta } = await sr
      .from('cuenta_destino')
      .insert({
        id_tenant: tenantId,
        nombre: 'Caja Efectivo',
        tipo: 'efectivo',
        es_predeterminada: true,
      })
      .select('id_cuenta_destino')
      .single()
    expect(cuenta).toBeTruthy()

    // 4. Crear revendedora R1
    const { data: rId, error: rErr } = await authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Mariana',
      p_apellido: 'López',
      p_telefono: '1123456789',
    })
    expect(rErr).toBeNull()
    const idRevendedora = rId as string

    // Fechas dinámicas para el mes M (actual) y mes M+1
    const hoy = new Date().toISOString().slice(0, 10)
    const pDesdeM = hoy.slice(0, 8) + '01'
    const pHastaM = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10)

    const mesSig = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 15)
    const pDesdeM1 = mesSig.toISOString().slice(0, 8) + '01'
    const pHastaM1 = new Date(mesSig.getFullYear(), mesSig.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10)
    const fechaLiqM1 = `${pDesdeM1.slice(0, 7)}-05`
    const fechaPagoM1 = `${pDesdeM1.slice(0, 7)}-10T12:00:00Z`

    // Regla de comisión propia para R1 (Tramo 1: 10%, Tramo 2: 15%)
    const { error: reglaErr } = await authenticated.rpc('sp_crear_regla_comision', {
      p_ambito: 'revendedora',
      p_nombre: 'Comision R1',
      p_id_revendedora: idRevendedora,
      p_vigente_desde: pDesdeM,
      p_escalas: [
        { objetivo_desde: 0, porcentaje: 10 },
        { objetivo_desde: 100000.01, porcentaje: 15 },
      ],
    })
    expect(reglaErr).toBeNull()

    // 5. Entregar ítems 2, 3 y 4 en consignación a R1
    const { data: idConsignacion, error: consErr } = await authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      {
        p_id_revendedora: idRevendedora,
        p_items: [items[1], items[2], items[3]],
      },
    )
    expect(consErr).toBeNull()

    const { error: confErr } = await authenticated.rpc(
      'sp_confirmar_consignacion_revendedora',
      { p_id_consignacion_revendedora: idConsignacion as string },
    )
    expect(confErr).toBeNull()

    // V1 — Venta local (ítem 1)
    const { data: v1, error: errV1 } = await authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: items[0] }],
      p_forma_pago: 'efectivo',
      p_canal: 'local',
    })
    expect(errV1).toBeNull()
    expect(v1).toBeTruthy()

    // V2 — Venta revendedora (ítem 2, preview 10%)
    const { data: v2, error: errV2 } = await authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: items[1] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: idRevendedora,
    })
    expect(errV2).toBeNull()
    expect(v2).toBeTruthy()

    // V3 — Venta revendedora (ítem 3, preview 10% base)
    const { data: v3, error: errV3 } = await authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: items[2] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: idRevendedora,
    })
    expect(errV3).toBeNull()
    expect(v3).toBeTruthy()

    // Excluir V3 con sp_excluir_detalle_liquidacion
    const { data: detV3 } = await sr
      .from('detalle_venta')
      .select('id_detalle_venta, porcentaje_comision_preview')
      .eq('id_venta', v3)
      .single()
    expect(Number(detV3?.porcentaje_comision_preview)).toBe(10)

    const { error: excErr } = await authenticated.rpc('sp_excluir_detalle_liquidacion', {
      p_id_detalle: detV3!.id_detalle_venta,
      p_motivo: 'Excluida de L1 segun escenario dorado',
    })
    expect(excErr).toBeNull()

    // V4 — Venta revendedora (ítem 4) y luego anulada en M
    const { data: v4, error: errV4 } = await authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: items[3] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: idRevendedora,
    })
    expect(errV4).toBeNull()

    const { error: errAnul } = await authenticated.rpc('sp_anular_venta', {
      p_id_venta: v4,
      p_motivo: 'Cliente devolvió mercadería',
    })
    expect(errAnul).toBeNull()

    // G1 — Gasto de $5.000 en M
    const { data: catG } = await sr
      .from('categoria_gasto')
      .insert({ id_tenant: tenantId, nombre: 'Servicios' })
      .select('id_categoria_gasto')
      .single()
    const { error: gErr } = await sr.from('gasto_negocio').insert({
      id_tenant: tenantId,
      id_categoria_gasto: catG!.id_categoria_gasto,
      monto: 5_000,
      descripcion: 'Gasto operativo G1',
    })
    expect(gErr).toBeNull()

    // L1 — Generar liquidación para el período Mes M
    const { data: idLiq, error: liqErr } = await authenticated.rpc('sp_generar_liquidacion', {
      p_id_revendedora: idRevendedora,
      p_desde: pDesdeM,
      p_hasta: pHastaM,
      p_observaciones: 'L1 Mes M',
    })
    expect(liqErr).toBeNull()
    expect(idLiq).toBeDefined()

    // DR-2: Simular fecha de liquidación en Mes M+1 (2026-06-05)
    await sr
      .from('liquidacion_revendedora')
      .update({ fecha_liquidacion: fechaLiqM1 })
      .eq('id_liquidacion', idLiq as string)

    // Posición Financiera y Cuenta Corriente ANTES del pago de L1
    const { data: posAntesData } = await authenticated.rpc('rf_finanzas_posicion').single()
    const posAntes = posAntesData as { por_cobrar?: { a_cobrar?: number } }
    expect(Number(posAntes.por_cobrar?.a_cobrar)).toBe(190_000)

    const { data: ccAntesData } = await authenticated.rpc('rf_cuenta_corriente_revendedora', {
      p_id_revendedora: idRevendedora,
    }).single()
    const ccAntes = ccAntesData as {
      total_vendido?: number
      total_comision_liquidada?: number
      total_liquidado?: number
      total_pagado?: number
      adeudado?: number
    }
    expect(Number(ccAntes.total_vendido)).toBe(200_000)
    expect(Number(ccAntes.total_comision_liquidada)).toBe(10_000)
    expect(Number(ccAntes.total_liquidado)).toBe(90_000)
    expect(Number(ccAntes.total_pagado)).toBe(0)
    expect(Number(ccAntes.adeudado)).toBe(190_000)

    // PAGO_L1 — Pagar liquidación L1 en Mes M+1 (2026-06-10) con $90.000
    const { data: ctaBanco } = await sr
      .from('cuenta_destino')
      .insert({
        id_tenant: tenantId,
        nombre: 'Banco Tenant',
        tipo: 'banco',
        activo: true,
      })
      .select('id_cuenta_destino')
      .single()

    const { error: pagoErr } = await authenticated.rpc('sp_marcar_liquidacion_pagada', {
      p_id_liquidacion: idLiq as string,
      p_id_cuenta: ctaBanco!.id_cuenta_destino,
      p_monto: 90_000,
      p_metodo: 'transferencia',
      p_referencia: 'TR-PAGO-L1',
      p_fecha: fechaPagoM1,
    })
    expect(pagoErr).toBeNull()

    // Posición Financiera y Cuenta Corriente DESPUÉS del pago de L1
    const { data: posDespData } = await authenticated.rpc('rf_finanzas_posicion').single()
    const posDesp = posDespData as { por_cobrar?: { a_cobrar?: number } }
    expect(Number(posDesp.por_cobrar?.a_cobrar)).toBe(100_000)

    const { data: ccDespData } = await authenticated.rpc('rf_cuenta_corriente_revendedora', {
      p_id_revendedora: idRevendedora,
    }).single()
    const ccDesp = ccDespData as {
      total_vendido?: number
      total_comision_liquidada?: number
      total_liquidado?: number
      total_pagado?: number
      adeudado?: number
    }
    expect(Number(ccDesp.total_vendido)).toBe(200_000)
    expect(Number(ccDesp.total_comision_liquidada)).toBe(10_000)
    expect(Number(ccDesp.total_liquidado)).toBe(90_000)
    expect(Number(ccDesp.total_pagado)).toBe(90_000)
    expect(Number(ccDesp.adeudado)).toBe(100_000)

    // 6. Consultar v_linea_venta
    const { data: lineasVenta, error: lineasErr } = await authenticated
      .from('v_linea_venta')
      .select('id_venta, precio_venta, costo, comision, comision_estimada, estado_venta, fecha_liquidacion')
      .in('id_venta', [v1, v2, v3, v4])
    expect(lineasErr).toBeNull()
    expect(lineasVenta).toHaveLength(4)

    const l1 = lineasVenta!.find((l) => l.id_venta === v1)
    const l2 = lineasVenta!.find((l) => l.id_venta === v2)
    const l3 = lineasVenta!.find((l) => l.id_venta === v3)
    const l4 = lineasVenta!.find((l) => l.id_venta === v4)

    expect(Number(l1?.comision)).toBe(0)
    expect(Number(l1?.comision_estimada)).toBe(0)

    expect(Number(l2?.comision)).toBe(10_000)
    expect(Number(l2?.comision_estimada)).toBe(0)
    expect(l2?.fecha_liquidacion).toBe(fechaLiqM1)

    expect(Number(l3?.comision)).toBe(0)
    expect(Number(l3?.comision_estimada)).toBe(10_000)

    expect(Number(l4?.comision)).toBe(0)
    expect(Number(l4?.comision_estimada)).toBe(0)

    // 7. Evaluar rf_finanzas_resultados para el período M (DR-2: liquidación en M+1 no reescribe M)
    const { data: resMData, error: resMErr } = await authenticated
      .rpc('rf_finanzas_resultados', {
        p_desde: pDesdeM,
        p_hasta: pHastaM,
      })
      .single()

    expect(resMErr).toBeNull()
    expect(resMData).toBeDefined()
    const resM = resMData as Record<string, unknown>

    expect(Number(resM.ventas_brutas)).toBe(400_000)
    expect(Number(resM.anulaciones)).toBe(100_000)
    expect(Number(resM.devoluciones)).toBe(0)
    expect(Number(resM.ventas_netas)).toBe(300_000)
    expect(Number(resM.costo_mercaderia)).toBe(120_000)
    expect(Number(resM.ganancia_sobre_ventas)).toBe(180_000)
    expect(Number(resM.costo_cobro)).toBe(0)
    expect(Number(resM.incobrables)).toBe(0)
    expect(Number(resM.bajas_inventario)).toBe(0)
    expect(Number(resM.ganancia_despues_de_costos)).toBe(180_000)
    expect(Number(resM.gastos)).toBe(5_000)

    // DR-2: comision_liquidada es 0 en M porque fecha_liquidacion cayó en M+1
    expect(Number(resM.comision_liquidada)).toBe(0)
    expect(Number(resM.comision_pendiente_estimada)).toBe(10_000)
    expect(Number(resM.ganancia_final)).toBe(175_000)
    expect(Number(resM.cantidad_ventas)).toBe(3)
    expect(Number(resM.ticket_promedio)).toBe(100_000)

    // 8. Evaluar rf_finanzas_flujo para el período M (DR-14: cuenta_revendedora no entra a caja)
    const { data: flujoMData, error: flujoMErr } = await authenticated
      .rpc('rf_finanzas_flujo', {
        p_desde: pDesdeM,
        p_hasta: pHastaM,
      })
      .single()

    expect(flujoMErr).toBeNull()
    expect(flujoMData).toBeDefined()
    const flujoM = flujoMData as Record<string, unknown>

    expect(Number(flujoM.cobrado)).toBe(100_000)
    expect(Number(flujoM.devuelto_clientes)).toBe(0)
    expect(Number(flujoM.costo_cobro)).toBe(0)
    expect(Number(flujoM.neto_cobros)).toBe(100_000)
    expect(Number(flujoM.compras_mercaderia)).toBe(160_000)
    expect(Number(flujoM.pagos_proveedores)).toBe(0)
    expect(Number(flujoM.gastos)).toBe(5_000)
    expect(Number(flujoM.flujo_neto)).toBe(-65_000)
    expect(flujoM.por_acreditar).toEqual({})

    // 9. Evaluar rf_finanzas_resultados para el período M+1 (DR-2: devenga comision_liquidada)
    const { data: resM1Data, error: resM1Err } = await authenticated
      .rpc('rf_finanzas_resultados', {
        p_desde: pDesdeM1,
        p_hasta: pHastaM1,
      })
      .single()

    expect(resM1Err).toBeNull()
    const resM1 = resM1Data as Record<string, unknown>
    expect(Number(resM1.ventas_netas)).toBe(0)
    expect(Number(resM1.costo_mercaderia)).toBe(0)
    expect(Number(resM1.gastos)).toBe(0)
    expect(Number(resM1.comision_liquidada)).toBe(10_000)
    expect(Number(resM1.comision_pendiente_estimada)).toBe(0)
    expect(Number(resM1.ganancia_final)).toBe(-10_000)

    // 10. Evaluar rf_finanzas_flujo para el período M+1 (DR-3/DR-14: cobro de liquidacion L1)
    const { data: flujoM1Data, error: flujoM1Err } = await authenticated
      .rpc('rf_finanzas_flujo', {
        p_desde: pDesdeM1,
        p_hasta: pHastaM1,
      })
      .single()

    expect(flujoM1Err).toBeNull()
    const flujoM1 = flujoM1Data as Record<string, unknown>
    expect(Number(flujoM1.cobrado)).toBe(90_000)
    expect(Number(flujoM1.neto_cobros)).toBe(90_000)
    expect(Number(flujoM1.compras_mercaderia)).toBe(0)
    expect(Number(flujoM1.gastos)).toBe(0)
    expect(Number(flujoM1.flujo_neto)).toBe(90_000)
  })

  test('con modulo revendedoras apagado: comision_liquidada y comision_pendiente_estimada son 0 (REQ-RV-MOD)', async () => {
    const user = await createTenantWithUser('GoldSinMod')
    const authenticated = await signInAs(user)
    const sr = user.serviceRole
    const tenantId = user.tenantId

    // Módulo revendedoras NO habilitado
    await sr.from('cuenta_destino').insert({
      id_tenant: tenantId,
      nombre: 'Caja',
      tipo: 'efectivo',
      es_predeterminada: true,
    })

    const cat = unwrapFixture(
      'categoria insert',
      await sr
        .from('categoria')
        .insert({ id_tenant: tenantId, nombre: withScopedTenant('cat-local') })
        .select('id_categoria')
        .single(),
    ) as { id_categoria: string }

    const prod = unwrapFixture(
      'producto insert',
      await sr
        .from('producto')
        .insert({
          id_tenant: tenantId,
          id_categoria: cat.id_categoria,
          nombre: withScopedTenant('prod-local'),
          precio_venta: 50_000,
          precio_venta_resuelto_at: new Date().toISOString(),
        })
        .select('id_producto')
        .single(),
    ) as { id_producto: string }

    const { error: stockErr } = await authenticated.rpc('sp_crear_stock_directo', {
      p_id_producto: prod.id_producto,
      p_costo: 20_000,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: null, cantidad: 1 }],
    })
    expect(stockErr).toBeNull()

    const { data: stockItems } = await sr
      .from('item_producto')
      .select('id_item')
      .eq('id_producto', prod.id_producto)
      .eq('estado_item', 'disponible')
      .single()

    const { data: idVenta, error: vErr } = await authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: stockItems!.id_item }],
      p_forma_pago: 'efectivo',
    })
    expect(vErr).toBeNull()
    expect(idVenta).toBeTruthy()

    const hoy = new Date().toISOString().slice(0, 10)
    const pDesde = hoy.slice(0, 8) + '01'
    const pHasta = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10)

    const { data, error: resErr } = await authenticated
      .rpc('rf_finanzas_resultados', {
        p_desde: pDesde,
        p_hasta: pHasta,
      })
      .single()

    expect(resErr).toBeNull()
    expect(data).toBeDefined()
    const res = data as Record<string, unknown>
    expect(Number(res.comision_liquidada)).toBe(0)
    expect(Number(res.comision_pendiente_estimada)).toBe(0)
    expect(Number(res.ventas_netas)).toBe(50_000)
    expect(Number(res.costo_mercaderia)).toBe(20_000)
    expect(Number(res.ganancia_final)).toBe(30_000)
  })
})

