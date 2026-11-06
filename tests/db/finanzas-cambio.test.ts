import { describe, expect, test } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { hasTestDb } from './_helpers'
import { ventaFixture, venderContado, PRECIO, COSTO } from './_fixtures-ventas'
import { getHoyBuenosAires } from '../fechas'

async function habilitarModuloRevendedoras(tenantId: string) {
  const sr = createServiceRoleTestClient()
  const { data: mod, error: modErr } = await sr
    .from('modulo')
    .select('id_modulo')
    .eq('codigo', 'revendedoras')
    .single()
  expect(modErr).toBeNull()
  const { error } = await sr
    .from('tenant_modulo')
    .upsert({ id_tenant: tenantId, id_modulo: mod!.id_modulo, habilitado: true })
  expect(error).toBeNull()
}

describe.skipIf(!hasTestDb)('Slice 10 / Parte A — Finanzas del Cambio (00110)', () => {
  test('1. cambio en local con diferencia positiva: resultados y flujo reflejan la diferencia exacta', async () => {
    const f = await ventaFixture('FinCambioLocalPos', 1, { tipoIngreso: 'compra' })

    // Crear un segundo producto más caro ($62.000 vs PRECIO $60.000 -> dif 2000, costo 15000 vs 14000 -> delta costo 1000)
    const { data: cat } = await f.serviceRole
      .from('categoria')
      .select('id_categoria')
      .eq('id_tenant', f.tenantId)
      .single()

    const { data: prodCaro } = await f.serviceRole
      .from('producto')
      .insert({
        id_tenant: f.tenantId,
        id_categoria: cat!.id_categoria,
        nombre: 'Producto Caro 62k',
        precio_venta: PRECIO + 2000,
        precio_venta_resuelto_at: new Date().toISOString(),
      })
      .select('id_producto')
      .single()

    await f.authenticated.rpc('sp_crear_stock_directo', {
      p_id_producto: prodCaro!.id_producto,
      p_costo: COSTO + 1000,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: null, cantidad: 1 }],
    })

    const { data: itemCaro } = await f.serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_producto', prodCaro!.id_producto)
      .eq('estado_item', 'disponible')
      .single()

    // 1. Venta contado de ítem 0 (PRECIO = 60000, COSTO = 14000)
    const { data: idVenta } = await venderContado(f, { items: [f.items[0]] })

    const { data: detOriginal } = await f.serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single()

    // 2. Registrar cambio cobrando diferencia de $2.000
    const { error: errCambio } = await f.authenticated.rpc('sp_registrar_cambio', {
      p_id_detalle_original: detOriginal!.id_detalle_venta,
      p_id_item_entregado: itemCaro!.id_item,
      p_motivo: 'Cambio por modelo superior',
      p_medio_cobro: 'efectivo',
      p_id_cuenta_destino: f.idCuenta,
    })
    expect(errCambio).toBeNull()

    const hoy = getHoyBuenosAires()

    // 3. Verificar rf_finanzas_resultados
    const { data: res } = await f.authenticated.rpc('rf_finanzas_resultados', {
      p_desde: hoy,
      p_hasta: hoy,
    })
    expect(res).toBeDefined()
    const r = res![0]

    // Ventas brutas: 60.000 (venta inicial) + 2.000 (diferencia de cambio) = 62.000
    expect(Number(r.ventas_brutas)).toBe(PRECIO + 2000)
    expect(Number(r.ventas_netas)).toBe(PRECIO + 2000)
    // Costo mercadería: nuevo costo (15.000) - costo devuelto recuperado (14.000) + costo original (14.000) = 15.000
    expect(Number(r.costo_mercaderia)).toBe(COSTO + 1000)
    // Ganancia sobre ventas: 62.000 - 15.000 = 47.000
    expect(Number(r.ganancia_sobre_ventas)).toBe((PRECIO + 2000) - (COSTO + 1000))

    // 4. Verificar rf_finanzas_flujo: cobrado = 60.000 + 2.000 = 62.000
    const { data: flujo } = await f.authenticated.rpc('rf_finanzas_flujo', {
      p_desde: hoy,
      p_hasta: hoy,
    })
    expect(flujo).toBeDefined()
    expect(Number(flujo![0].cobrado)).toBe(PRECIO + 2000)
  })

  test('2. anulación de venta con cambio: suma diferencias de cambio al total anulado y bloquea devolución de línea cambiada', async () => {
    const f = await ventaFixture('FinAnulacionCambio', 2, { tipoIngreso: 'compra' })

    // Venta contado de ítem 0
    const { data: idVenta } = await venderContado(f, { items: [f.items[0]] })
    const { data: detOriginal } = await f.serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single()

    // Crear ítem más caro (+2.000)
    const { data: cat } = await f.serviceRole
      .from('categoria')
      .select('id_categoria')
      .eq('id_tenant', f.tenantId)
      .single()
    const { data: prodCaro } = await f.serviceRole
      .from('producto')
      .insert({
        id_tenant: f.tenantId,
        id_categoria: cat!.id_categoria,
        nombre: 'Producto Caro Anul',
        precio_venta: PRECIO + 2000,
        precio_venta_resuelto_at: new Date().toISOString(),
      })
      .select('id_producto')
      .single()
    await f.authenticated.rpc('sp_crear_stock_directo', {
      p_id_producto: prodCaro!.id_producto,
      p_costo: COSTO + 1000,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: null, cantidad: 1 }],
    })
    const { data: itemCaro } = await f.serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_producto', prodCaro!.id_producto)
      .eq('estado_item', 'disponible')
      .single()

    // Cambio cobrando +2.000
    await f.authenticated.rpc('sp_registrar_cambio', {
      p_id_detalle_original: detOriginal!.id_detalle_venta,
      p_id_item_entregado: itemCaro!.id_item,
      p_motivo: 'Cambio',
      p_medio_cobro: 'efectivo',
      p_id_cuenta_destino: f.idCuenta,
    })

    // Intento de devolver la línea original cambiada -> rechazo con detalle-ya-cambiado
    const { error: errDev } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: detOriginal!.id_detalle_venta,
      p_motivo: 'Intento de devolución de línea cambiada',
    })
    expect(errDev).toBeDefined()
    expect(errDev?.message).toContain('detalle-ya-cambiado')

    // Ahora anular la venta
    const { data: resAnul, error: errAnul } = await f.authenticated.rpc('sp_anular_venta', {
      p_id_venta: idVenta,
      p_motivo: 'Anulación completa con cambio',
    })
    expect(errAnul).toBeNull()
    // Total reintegrado debe ser 60.000 + 2.000 = 62.000
    expect(Number(resAnul.total_reintegrado)).toBe(PRECIO + 2000)

    // En resultados financieros: anulaciones debe reflejar 62.000 (60.000 total venta + 2.000 diferencia cambio)
    const hoy = getHoyBuenosAires()
    const { data: resFin } = await f.authenticated.rpc('rf_finanzas_resultados', {
      p_desde: hoy,
      p_hasta: hoy,
    })
    expect(resFin).toBeDefined()
    expect(Number(resFin![0].anulaciones)).toBe(PRECIO + 2000)
    expect(Number(resFin![0].ventas_netas)).toBe(0)
  })

  test('3. revendedora con cambio: cobrado en flujo sin cambio, cuenta corriente +2.000 adeudado, base comisión inmutable', async () => {
    const f = await ventaFixture('FinCambioRev', 1, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    // Crear revendedora y regla 10%
    const { data: idRev } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Mariana',
      p_apellido: 'Fin',
    })
    const { data: regla } = await f.serviceRole
      .from('regla_comision')
      .insert({
        id_tenant: f.tenantId,
        id_revendedora: idRev,
        ambito: 'revendedora',
        vigente_desde: '2026-01-01',
        activo: true,
      })
      .select('id_regla')
      .single()
    await f.serviceRole.from('escala_comision').insert({
      id_tenant: f.tenantId,
      id_regla: regla!.id_regla,
      objetivo_desde: 0,
      porcentaje: 10,
    })

    // Crear ítem más caro (+2.000)
    const { data: cat } = await f.serviceRole
      .from('categoria')
      .select('id_categoria')
      .eq('id_tenant', f.tenantId)
      .single()
    const { data: prodCaro } = await f.serviceRole
      .from('producto')
      .insert({
        id_tenant: f.tenantId,
        id_categoria: cat!.id_categoria,
        nombre: 'Prod Caro Rev',
        precio_venta: PRECIO + 2000,
        precio_venta_resuelto_at: new Date().toISOString(),
      })
      .select('id_producto')
      .single()
    await f.authenticated.rpc('sp_crear_stock_directo', {
      p_id_producto: prodCaro!.id_producto,
      p_costo: COSTO + 1000,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: null, cantidad: 1 }],
    })
    const { data: itemCaro } = await f.serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_producto', prodCaro!.id_producto)
      .eq('estado_item', 'disponible')
      .single()

    // Entregar ambos ítems a la revendedora
    const { data: idConsig } = await f.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      {
        p_id_revendedora: idRev,
        p_items: [f.items[0], itemCaro!.id_item],
        p_periodo_desde: '2026-10-01',
      },
    )
    await f.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idConsig,
    })

    // Venta canal revendedora del ítem 0
    const { data: idVenta, error: errVenta } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0], descuentos: [] }],
      p_canal: 'revendedora',
      p_id_revendedora: idRev,
    })
    expect(errVenta).toBeNull()

    const { data: detOrig } = await f.serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single()

    // Registrar cambio por el ítem caro
    const { error: errCambio } = await f.authenticated.rpc('sp_registrar_cambio', {
      p_id_detalle_original: detOrig!.id_detalle_venta,
      p_id_item_entregado: itemCaro!.id_item,
      p_motivo: 'Cambio revendedora',
    })
    expect(errCambio).toBeNull()

    const hoy = getHoyBuenosAires()

    // 1. En flujo financiero: cobrado debe ser 0 (cuenta_revendedora excluida de fondos de caja)
    const { data: flujo } = await f.authenticated.rpc('rf_finanzas_flujo', {
      p_desde: hoy,
      p_hasta: hoy,
    })
    expect(flujo).toBeDefined()
    expect(Number(flujo![0].cobrado)).toBe(0)

    // 2. En cuenta corriente de revendedora: total_vendido = 60.000 + 2.000 = 62.000, adeudado = 62.000
    const { data: cc } = await f.authenticated.rpc('rf_cuenta_corriente_revendedora', {
      p_id_revendedora: idRev,
    })
    expect(cc).toBeDefined()
    expect(Number(cc![0].total_vendido)).toBe(PRECIO + 2000)
    expect(Number(cc![0].adeudado)).toBe(PRECIO + 2000)

    // 3. Base de comisión inmutable: nueva línea en detalle_venta tiene precio_venta = PRECIO (60.000), no 62.000
    const { data: detNuevo } = await f.serviceRole
      .from('detalle_venta')
      .select('precio_venta, porcentaje_comision_preview')
      .eq('id_venta', idVenta)
      .eq('id_item', itemCaro!.id_item)
      .single()
    expect(Number(detNuevo!.precio_venta)).toBe(PRECIO)
    expect(Number(detNuevo!.porcentaje_comision_preview)).toBe(10)
  })

  test('4. rechazo con venta-liquidada en cambio, anulación y devolución', async () => {
    const f = await ventaFixture('FinRechazoLiq', 1, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { data: idRev } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Silvia',
      p_apellido: 'Liq',
    })
    const { data: regla } = await f.serviceRole
      .from('regla_comision')
      .insert({
        id_tenant: f.tenantId,
        id_revendedora: idRev,
        ambito: 'revendedora',
        vigente_desde: '2026-01-01',
        activo: true,
      })
      .select('id_regla')
      .single()
    await f.serviceRole.from('escala_comision').insert({
      id_tenant: f.tenantId,
      id_regla: regla!.id_regla,
      objetivo_desde: 0,
      porcentaje: 10,
    })

    const { data: idConsig } = await f.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      {
        p_id_revendedora: idRev,
        p_items: [f.items[0]],
        p_periodo_desde: '2026-10-01',
      },
    )
    await f.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idConsig,
    })

    // Venta canal revendedora
    const { data: idVenta } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0], descuentos: [] }],
      p_canal: 'revendedora',
      p_id_revendedora: idRev,
    })
    const { data: det } = await f.serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single()

    // Liquidar la venta
    const { data: idLiq, error: errLiq } = await f.authenticated.rpc('sp_generar_liquidacion', {
      p_id_revendedora: idRev,
      p_desde: '2026-01-01',
      p_hasta: '2026-12-31',
    })
    expect(errLiq).toBeNull()
    expect(idLiq).toBeDefined()

    // 1. Intento de cambio sobre línea liquidada -> venta-liquidada
    const { error: errCambio } = await f.authenticated.rpc('sp_registrar_cambio', {
      p_id_detalle_original: det!.id_detalle_venta,
      p_id_item_entregado: f.items[0], // dummy item
    })
    expect(errCambio).toBeDefined()
    expect(errCambio?.message).toContain('venta-liquidada')

    // 2. Intento de devolución sobre línea liquidada -> venta-liquidada
    const { error: errDev } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: det!.id_detalle_venta,
      p_motivo: 'Intento devolución liquidada',
    })
    expect(errDev).toBeDefined()
    expect(errDev?.message).toContain('venta-liquidada')

    // 3. Intento de anulación sobre venta liquidada -> venta-liquidada
    const { error: errAnul } = await f.authenticated.rpc('sp_anular_venta', {
      p_id_venta: idVenta,
      p_motivo: 'Intento anular liquidada',
    })
    expect(errAnul).toBeDefined()
    expect(errAnul?.message).toContain('venta-liquidada')
  })
})
