import { describe, expect, test } from 'vitest'
import { createTenantWithUser, signInAs, unwrapFixture, withScopedTenant, hasTestDb } from './_helpers'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'

interface PreviewLiquidacion {
  cantidad_lineas?: number
  monto_vendido?: number
  porcentaje_resuelto?: number
  monto_comision?: number
  monto_a_cobrar?: number
}

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

describe.skipIf(!hasTestDb)('Liquidación de revendedoras — Slice 7a (REQ-RV-DB-06 / DR-2, DR-3, DR-14)', () => {
  test('Flujo completo de liquidación: preview, exclusión, generación por tramo acumulado, pago inmutable y cuenta corriente', async () => {
    const user = await createTenantWithUser('LiqRev')
    const authenticated = await signInAs(user)
    const sr = user.serviceRole
    const tenantId = user.tenantId

    // 1. Habilitar módulo revendedoras
    await habilitarModulo(tenantId, 'revendedoras')

    // 2. Crear categoría, producto y stock
    const PRECIO_P1 = 100_000
    const COSTO_P1 = 40_000

    const cat = unwrapFixture(
      'categoria insert',
      await sr
        .from('categoria')
        .insert({ id_tenant: tenantId, nombre: withScopedTenant('cat-liq') })
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
          nombre: withScopedTenant('prod-liq'),
          precio_venta: PRECIO_P1,
          precio_venta_resuelto_at: new Date().toISOString(),
        })
        .select('id_producto')
        .single(),
    ) as { id_producto: string }

    // Ingresar 4 unidades de stock
    const { data: prov } = await sr
      .from('proveedor')
      .insert({ id_tenant: tenantId, nombre: 'Proveedor Liq' })
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

    await authenticated.rpc('sp_confirmar_ingreso', { p_id_ingreso: ing!.id_ingreso })

    const { data: stockItems } = await sr
      .from('item_producto')
      .select('id_item')
      .eq('id_producto', prod.id_producto)
      .eq('estado_item', 'disponible')
    expect(stockItems).toHaveLength(4)
    const items = stockItems!.map((i) => i.id_item)

    // 3. Crear Revendedora R1 con regla de comisión por tramos:
    // Tramo 1: $0 a $100.000 -> 10%
    // Tramo 2: > $100.000 -> 15%
    const { data: rev } = await sr
      .from('revendedora')
      .insert({
        id_tenant: tenantId,
        nombre: 'Lucia',
        apellido: 'Revendedora',
        activo: true,
      })
      .select('id_revendedora')
      .single()
    const idRev = rev!.id_revendedora

    // Fechas dinámicas para el mes actual
    const hoy = new Date().toISOString().slice(0, 10)
    const pDesde = hoy.slice(0, 8) + '01'
    const pHasta = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10)

    // Regla de comisión por tramos para la revendedora
    const { data: idRegla1, error: reglaErr } = await authenticated.rpc('sp_crear_regla_comision', {
      p_ambito: 'revendedora',
      p_nombre: 'Regla Tramos R1',
      p_id_revendedora: idRev,
      p_vigente_desde: pDesde,
      p_escalas: [
        { objetivo_desde: 0, porcentaje: 10 },
        { objetivo_desde: 100000.01, porcentaje: 15 },
      ],
    })
    expect(reglaErr).toBeNull()

    // Entregar 3 ítems en consignación
    const { data: consig } = await sr
      .from('consignacion_revendedora')
      .insert({
        id_tenant: tenantId,
        id_revendedora: idRev,
        confirmada: false,
        estado: 'abierta',
      })
      .select('id_consignacion_revendedora')
      .single()

    await sr.from('consignacion_revendedora_detalle').insert([
      { id_tenant: tenantId, id_consignacion_revendedora: consig!.id_consignacion_revendedora, id_item: items[0], id_producto: prod.id_producto, estado_detalle: 'pendiente' },
      { id_tenant: tenantId, id_consignacion_revendedora: consig!.id_consignacion_revendedora, id_item: items[1], id_producto: prod.id_producto, estado_detalle: 'pendiente' },
      { id_tenant: tenantId, id_consignacion_revendedora: consig!.id_consignacion_revendedora, id_item: items[2], id_producto: prod.id_producto, estado_detalle: 'pendiente' },
    ])

    await authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: consig!.id_consignacion_revendedora,
    })

    // 4. Registrar 2 ventas por canal revendedora:
    // Venta 1: ítem 0 ($100.000)
    const { data: v1, error: v1Err } = await authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: items[0] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: idRev,
    })
    expect(v1Err).toBeNull()
    const idVenta1 = v1 as string
    expect(idVenta1).toBeTruthy()

    // Venta 2: ítem 1 ($100.000)
    const { data: v2, error: v2Err } = await authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: items[1] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: idRev,
    })
    expect(v2Err).toBeNull()
    const idVenta2 = v2 as string
    expect(idVenta2).toBeTruthy()

    // Obtener id_detalle de venta 1 y 2
    const { data: d1, error: d1Err } = await sr.from('detalle_venta').select('id_detalle_venta').eq('id_venta', idVenta1).single()
    expect(d1Err).toBeNull()
    const { data: d2, error: d2Err } = await sr.from('detalle_venta').select('id_detalle_venta').eq('id_venta', idVenta2).single()
    expect(d2Err).toBeNull()
    const idDetalle1 = d1!.id_detalle_venta
    const idDetalle2 = d2!.id_detalle_venta

    // 5. Probar preview_liquidacion antes de excluir
    const { data: prev1Data, error: prev1Err } = await authenticated.rpc('preview_liquidacion', {
      p_id_revendedora: idRev,
      p_desde: pDesde,
      p_hasta: pHasta,
    })
    const prev1 = prev1Data as PreviewLiquidacion
    expect(prev1Err).toBeNull()
    expect(prev1.cantidad_lineas).toBe(2)
    expect(Number(prev1.monto_vendido)).toBe(200_000)
    // Con 200.000, caería en tramo 2 (15%) -> comision 30.000
    expect(Number(prev1.porcentaje_resuelto)).toBe(15)

    // 6. Probar sp_excluir_detalle_liquidacion sobre V2
    const { error: excErr } = await authenticated.rpc('sp_excluir_detalle_liquidacion', {
      p_id_detalle: idDetalle2,
    })
    expect(excErr).toBeNull()

    // Comprobar que en preview_liquidacion ahora solo aparece 1 línea ($100.000) con tramo 1 (10%)
    const { data: prev2Data, error: prev2Err } = await authenticated.rpc('preview_liquidacion', {
      p_id_revendedora: idRev,
      p_desde: pDesde,
      p_hasta: pHasta,
    })
    const prev2 = prev2Data as PreviewLiquidacion
    expect(prev2Err).toBeNull()
    expect(prev2.cantidad_lineas).toBe(1)
    expect(Number(prev2.monto_vendido)).toBe(100_000)
    expect(Number(prev2.porcentaje_resuelto)).toBe(10)
    expect(Number(prev2.monto_comision)).toBe(10_000)
    expect(Number(prev2.monto_a_cobrar)).toBe(90_000)

    // 7. Generar liquidación L1
    const { data: liqRes, error: liqErr } = await authenticated.rpc('sp_generar_liquidacion', {
      p_id_revendedora: idRev,
      p_desde: pDesde,
      p_hasta: pHasta,
      p_observaciones: 'Liquidacion Mayo 2026',
    })
    expect(liqErr).toBeNull()
    const idLiq = liqRes as string

    // Comprobar cabecera de la liquidación generada
    const { data: liqData } = await sr
      .from('liquidacion_revendedora')
      .select('*')
      .eq('id_liquidacion', idLiq)
      .single()
    expect(liqData!.estado).toBe('pendiente')
    expect(Number(liqData!.monto_vendido)).toBe(100_000)
    expect(Number(liqData!.monto_comision)).toBe(10_000)
    expect(Number(liqData!.monto_a_cobrar)).toBe(90_000)
    expect(Number(liqData!.porcentaje_aplicado)).toBe(10)
    expect(liqData!.cantidad_lineas).toBe(1)

    // Comprobar que V1 fue sellada con id_liquidacion
    const { data: d1Post } = await sr.from('detalle_venta').select('*').eq('id_detalle_venta', idDetalle1).single()
    expect(d1Post!.id_liquidacion).toBe(idLiq)
    expect(Number(d1Post!.monto_comision)).toBe(10_000)

    // Comprobar que V2 NO fue sellada (sigue excluida)
    const { data: d2Post } = await sr.from('detalle_venta').select('*').eq('id_detalle_venta', idDetalle2).single()
    expect(d2Post!.id_liquidacion).toBeNull()
    expect(d2Post!.excluida_liquidacion).toBe(true)

    // 8. Invariante: no se liquida dos veces (preview ahora da vacío)
    const { data: prev3Data, error: prev3Err } = await authenticated.rpc('preview_liquidacion', {
      p_id_revendedora: idRev,
      p_desde: pDesde,
      p_hasta: pHasta,
    })
    const prev3 = prev3Data as PreviewLiquidacion
    expect(prev3Err).toBeNull()
    expect(prev3.cantidad_lineas).toBe(0)

    // Generar de nuevo da liquidacion-vacia
    const { error: liqVaciaErr } = await authenticated.rpc('sp_generar_liquidacion', {
      p_id_revendedora: idRev,
      p_desde: pDesde,
      p_hasta: pHasta,
    })
    expect(liqVaciaErr?.message).toContain('liquidacion-vacia')

    // 9. Anular venta liquidada es rechazado con venta-liquidada
    const { error: anularErr } = await authenticated.rpc('sp_anular_venta', {
      p_id_venta: idVenta1,
      p_motivo: 'Intento anular liquidada',
    })
    expect(anularErr?.message).toContain('venta-liquidada')

    // 10. Intentar excluir o modificar línea ya liquidada es rechazado
    const { error: excLiqErr } = await authenticated.rpc('sp_excluir_detalle_liquidacion', {
      p_id_detalle: idDetalle1,
    })
    expect(excLiqErr?.message).toContain('detalle-ya-liquidado')

    // Trigger de inmutabilidad en detalle_venta: UPDATE directo sobre línea liquidada rechazado
    const { error: updDirectoErr } = await sr
      .from('detalle_venta')
      .update({ precio_venta: 120_000 })
      .eq('id_detalle_venta', idDetalle1)
    expect(updDirectoErr).not.toBeNull()

    // 11. Cambiar la regla de comisión DESPUÉS de liquidar no altera la liquidación
    const nextDate = new Date(new Date(pHasta).getTime() + 86400000).toISOString().slice(0, 10)
    await authenticated.rpc('sp_terminar_regla_comision', {
      p_id_regla: idRegla1 as string,
      p_vigente_hasta: pHasta,
    })
    const { error: r2Err } = await authenticated.rpc('sp_crear_regla_comision', {
      p_ambito: 'revendedora',
      p_nombre: 'Regla Nueva R1',
      p_id_revendedora: idRev,
      p_vigente_desde: nextDate,
      p_escalas: [{ objetivo_desde: 0, porcentaje: 50 }],
    })
    expect(r2Err).toBeNull()
    const { data: liqCheck } = await sr.from('liquidacion_revendedora').select('*').eq('id_liquidacion', idLiq).single()
    expect(Number(liqCheck!.monto_comision)).toBe(10_000)
    expect(Number(liqCheck!.porcentaje_aplicado)).toBe(10)

    // 12. Cuenta corriente antes de pagar L1
    const { data: ccAntes, error: ccAntesErr } = await authenticated.rpc('rf_cuenta_corriente_revendedora', {
      p_id_revendedora: idRev,
    })
    expect(ccAntesErr).toBeNull()
    const cc1 = Array.isArray(ccAntes) ? ccAntes[0] : ccAntes
    expect(Number(cc1.total_vendido)).toBe(200_000)
    expect(Number(cc1.total_comision_liquidada)).toBe(10_000)
    expect(Number(cc1.total_liquidado)).toBe(90_000)
    expect(Number(cc1.total_pagado)).toBe(0)
    // adeudado = total_vendido - total_comision_liquidada - total_pagado = 200.000 - 10.000 - 0 = 190.000
    expect(Number(cc1.adeudado)).toBe(190_000)

    // 13. Marcar liquidación pagada
    // Cuenta bancaria del tenant
    const { data: cta } = await sr
      .from('cuenta_destino')
      .insert({
        id_tenant: tenantId,
        nombre: 'Banco Test',
        tipo: 'banco',
        activo: true,
      })
      .select('id_cuenta_destino')
      .single()
    const idCuenta = cta!.id_cuenta_destino

    // Pago con monto incorrecto rechazado
    const { error: pagoMontoErr } = await authenticated.rpc('sp_marcar_liquidacion_pagada', {
      p_id_liquidacion: idLiq,
      p_id_cuenta: idCuenta,
      p_monto: 50_000, // debe ser 90.000
    })
    expect(pagoMontoErr?.message).toContain('monto-pago-invalido')

    // Pago a cuenta de otro tenant rechazado
    const otherUser = await createTenantWithUser('OtherTenantLiq')
    const { data: otherCta } = await otherUser.serviceRole
      .from('cuenta_destino')
      .insert({
        id_tenant: otherUser.tenantId,
        nombre: 'Banco Otro Tenant',
        tipo: 'banco',
        activo: true,
      })
      .select('id_cuenta_destino')
      .single()

    const { error: otherCtaErr } = await authenticated.rpc('sp_marcar_liquidacion_pagada', {
      p_id_liquidacion: idLiq,
      p_id_cuenta: otherCta!.id_cuenta_destino,
      p_monto: 90_000,
    })
    expect(otherCtaErr?.message).toContain('cuenta-invalida-liquidacion')

    // Pago correcto
    const { error: pagoOkErr } = await authenticated.rpc('sp_marcar_liquidacion_pagada', {
      p_id_liquidacion: idLiq,
      p_id_cuenta: idCuenta,
      p_monto: 90_000,
      p_metodo: 'transferencia',
      p_referencia: 'TR-123456',
    })
    expect(pagoOkErr).toBeNull()

    // Liquidación pasa a pagada
    const { data: liqPagada } = await sr.from('liquidacion_revendedora').select('*').eq('id_liquidacion', idLiq).single()
    expect(liqPagada!.estado).toBe('pagada')
    expect(liqPagada!.fecha_pago).not.toBeNull()

    // Intentar pagar nuevamente es rechazado
    const { error: yaPagadaErr } = await authenticated.rpc('sp_marcar_liquidacion_pagada', {
      p_id_liquidacion: idLiq,
      p_id_cuenta: idCuenta,
      p_monto: 90_000,
    })
    expect(yaPagadaErr?.message).toContain('liquidacion-ya-pagada')

    // 14. pago_revendedora es append-only: UPDATE y DELETE rechazados por trigger
    const { data: pagos } = await sr.from('pago_revendedora').select('*').eq('id_liquidacion', idLiq)
    expect(pagos).toHaveLength(1)
    const idPago = pagos![0].id_pago_revendedora

    const { error: updPagoErr } = await sr.from('pago_revendedora').update({ monto: 100_000 }).eq('id_pago_revendedora', idPago)
    expect(updPagoErr).not.toBeNull()

    const { error: delPagoErr } = await sr.from('pago_revendedora').delete().eq('id_pago_revendedora', idPago)
    expect(delPagoErr).not.toBeNull()

    // 15. Cuenta corriente después de pagar L1
    const { data: ccDespues, error: ccDespErr } = await authenticated.rpc('rf_cuenta_corriente_revendedora', {
      p_id_revendedora: idRev,
    })
    expect(ccDespErr).toBeNull()
    const cc2 = Array.isArray(ccDespues) ? ccDespues[0] : ccDespues
    expect(Number(cc2.total_vendido)).toBe(200_000)
    expect(Number(cc2.total_comision_liquidada)).toBe(10_000)
    expect(Number(cc2.total_liquidado)).toBe(90_000)
    expect(Number(cc2.total_pagado)).toBe(90_000)
    // adeudado = 200.000 - 10.000 - 90.000 = 100.000 (resta V2 excluida)
    expect(Number(cc2.adeudado)).toBe(100_000)

    // 16. Re-incluir detalle excluido (V2)
    const { error: reincErr } = await authenticated.rpc('sp_reincluir_detalle_liquidacion', {
      p_id_detalle: idDetalle2,
    })
    expect(reincErr).toBeNull()

    // Ahora preview_liquidacion la vuelve a incluir
    const { data: prevReincData } = await authenticated.rpc('preview_liquidacion', {
      p_id_revendedora: idRev,
      p_desde: pDesde,
      p_hasta: pHasta,
    })
    const prevReinc = prevReincData as PreviewLiquidacion
    expect(prevReinc.cantidad_lineas).toBe(1)
    expect(Number(prevReinc.monto_vendido)).toBe(100_000)

  })

  test('borrar un tenant con pago_revendedora funciona en cascada, pero el DELETE directo con tenant vivo se rechaza (00096)', async () => {
    const user = await createTenantWithUser('TenantBorradoPagos')
    const sr = user.serviceRole
    const tenantId = user.tenantId

    const { data: rev } = await sr
      .from('revendedora')
      .insert({ id_tenant: tenantId, nombre: 'Ana', apellido: 'Perez', activo: true })
      .select('id_revendedora')
      .single()

    const hoy = new Date().toISOString().slice(0, 10)
    const { data: liq } = await sr
      .from('liquidacion_revendedora')
      .insert({
        id_tenant: tenantId,
        id_revendedora: rev!.id_revendedora,
        periodo_desde: hoy,
        periodo_hasta: hoy,
        monto_vendido: 50_000,
        monto_comision: 5_000,
        monto_a_cobrar: 45_000,
        cantidad_lineas: 1,
        porcentaje_aplicado: 10,
        estado: 'pagada',
        fecha_liquidacion: hoy,
        fecha_pago: hoy,
      })
      .select('id_liquidacion')
      .single()

    const { data: cta } = await sr
      .from('cuenta_destino')
      .insert({ id_tenant: tenantId, nombre: 'Caja Test', tipo: 'efectivo', activo: true })
      .select('id_cuenta_destino')
      .single()

    const { data: pago, error: pagoInsertErr } = await sr
      .from('pago_revendedora')
      .insert({
        id_tenant: tenantId,
        id_liquidacion: liq!.id_liquidacion,
        monto: 45_000,
        metodo: 'transferencia',
        id_cuenta: cta!.id_cuenta_destino,
      })
      .select('id_pago_revendedora')
      .single()
    expect(pagoInsertErr).toBeNull()
    const idPago = pago!.id_pago_revendedora

    // 1. DELETE directo con tenant vivo se RECHAZA
    const { error: delDirectoErr } = await sr.from('pago_revendedora').delete().eq('id_pago_revendedora', idPago)
    expect(delDirectoErr).not.toBeNull()
    expect(delDirectoErr?.message).toContain('pago-revendedora-inmutable')

    // 2. Borrado del tenant en cascada FUNCIONA
    const { error: delTenantErr } = await sr.from('tenant').delete().eq('id_tenant', tenantId)
    expect(delTenantErr).toBeNull()

    // 3. El pago_revendedora desapareció con el tenant
    const { data: pagoPost } = await sr.from('pago_revendedora').select('*').eq('id_pago_revendedora', idPago)
    expect(pagoPost).toHaveLength(0)
  })
})
