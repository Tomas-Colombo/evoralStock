import { describe, expect, test } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { hasTestDb, signInAs } from './_helpers'
import { ventaFixture, PRECIO } from './_fixtures-ventas'

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

describe.skipIf(!hasTestDb)('Venta por canal — Slice 6a (REQ-RV-DB-05)', () => {
  test('canal local sin cambios: venta registra canal "local" e id_revendedora null por defecto', async () => {
    const f = await ventaFixture('VtaCanalLocal', 1, { tipoIngreso: 'compra' })

    const { data: idVenta, error } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_forma_pago: 'efectivo',
    })

    expect(error).toBeNull()
    expect(idVenta).toBeTruthy()

    const { data: v } = await f.serviceRole
      .from('venta')
      .select('canal, id_revendedora')
      .eq('id_venta', idVenta)
      .single()

    expect(v?.canal).toBe('local')
    expect(v?.id_revendedora).toBeNull()

    const { data: det } = await f.serviceRole
      .from('detalle_venta')
      .select('porcentaje_comision_preview, monto_comision, id_liquidacion, excluida_liquidacion')
      .eq('id_venta', idVenta)
      .single()

    expect(Number(det?.porcentaje_comision_preview)).toBe(0)
    expect(Number(det?.monto_comision)).toBe(0)
    expect(det?.id_liquidacion).toBeNull()
    expect(det?.excluida_liquidacion).toBe(false)
  })

  test('canal revendedora sin id_revendedora: rechazada por validación / CHECK', async () => {
    const f = await ventaFixture('VtaSinRev', 1, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { error } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: null,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/venta-revendedora-sin-id|canal|check/i)
  })

  test('canal revendedora con módulo revendedoras apagado: rechazada con modulo-revendedoras-deshabilitado', async () => {
    const f = await ventaFixture('VtaModApagado', 1, { tipoIngreso: 'compra' })
    // No habilitamos módulo

    const { error } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: '00000000-0000-0000-0000-000000000000',
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/modulo-revendedoras-deshabilitado/)
  })

  test('canal revendedora con ítem que NO está en poder de esa revendedora: rechazada', async () => {
    const f = await ventaFixture('VtaItemNoRev', 2, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { data: idRevA } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Reven',
      p_apellido: 'A',
    })
    const { data: idRevB } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Reven',
      p_apellido: 'B',
    })

    // Entregar item 0 a Rev A
    const { data: idConsig } = await f.authenticated.rpc('sp_crear_consignacion_revendedora_con_items', {
      p_id_revendedora: idRevA,
      p_items: [f.items[0]],
      p_periodo_desde: '2026-10-01',
      p_periodo_hasta: '2026-10-31',
    })
    await f.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idConsig,
    })

    // 1. Intentar vender con Rev A un ítem disponible central (item 1)
    const { error: errNoConsig } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[1] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: idRevA,
    })
    expect(errNoConsig).not.toBeNull()
    expect(errNoConsig?.message).toMatch(/item-no-en-revendedora|item-no-disponible/i)

    // 2. Intentar vender con Rev B el ítem entregado a Rev A (item 0)
    const { error: errOtraRev } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: idRevB,
    })
    expect(errOtraRev).not.toBeNull()
    expect(errOtraRev?.message).toMatch(/item-no-en-revendedora/i)
  })

  test('canal revendedora exitosa: pasa ítem a vendido, marca detalle_consignacion como vendido y guarda porcentaje_comision_preview', async () => {
    const f = await ventaFixture('VtaCanalOk', 1, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { data: idRev } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Carla',
      p_apellido: 'Ventas',
    })

    // Crear regla propia de 15% para Carla
    await f.authenticated.rpc('sp_crear_regla_comision', {
      p_ambito: 'revendedora',
      p_nombre: 'Comisión Carla 15%',
      p_id_revendedora: idRev,
      p_vigente_desde: '2026-01-01',
      p_vigente_hasta: null,
      p_escalas: [{ objetivo_desde: 0, porcentaje: 15 }],
    })

    // Consignar ítem
    const { data: idConsig } = await f.authenticated.rpc('sp_crear_consignacion_revendedora_con_items', {
      p_id_revendedora: idRev,
      p_items: [f.items[0]],
      p_periodo_desde: '2026-10-01',
      p_periodo_hasta: '2026-10-31',
    })
    await f.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idConsig,
    })

    // Registrar venta canal revendedora
    const { data: idVenta, error: errVenta } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: idRev,
    })

    expect(errVenta).toBeNull()
    expect(idVenta).toBeTruthy()

    // 1. Venta tiene canal revendedora e id_revendedora
    const { data: v } = await f.serviceRole
      .from('venta')
      .select('canal, id_revendedora')
      .eq('id_venta', idVenta)
      .single()
    expect(v?.canal).toBe('revendedora')
    expect(v?.id_revendedora).toBe(idRev)

    // 2. Item está vendido
    const { data: it } = await f.serviceRole
      .from('item_producto')
      .select('estado_item')
      .eq('id_item', f.items[0])
      .single()
    expect(it?.estado_item).toBe('vendido')

    // 3. Detalle de consignación está vendido
    const { data: dcr } = await f.serviceRole
      .from('consignacion_revendedora_detalle')
      .select('estado_detalle')
      .eq('id_item', f.items[0])
      .single()
    expect(dcr?.estado_detalle).toBe('vendido')

    // 4. Detalle de venta guardó porcentaje_comision_preview = 15
    const { data: dv } = await f.serviceRole
      .from('detalle_venta')
      .select('porcentaje_comision_preview, monto_comision, id_liquidacion, excluida_liquidacion')
      .eq('id_venta', idVenta)
      .single()
    expect(Number(dv?.porcentaje_comision_preview)).toBe(15)
    expect(Number(dv?.monto_comision)).toBe(0) // No liquidada aún
    expect(dv?.id_liquidacion).toBeNull()
  })

  test('inmutabilidad: UPDATE directo de detalle_venta vs UPDATE de campos de liquidación vs línea ya liquidada', async () => {
    const f = await ventaFixture('VtaInmutDet', 1, { tipoIngreso: 'compra' })
    const { data: idVenta } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_forma_pago: 'efectivo',
    })

    const { data: det } = await f.serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single()
    const idDetalle = det!.id_detalle_venta

    // 1. UPDATE directo de precio_venta o porcentaje_comision_preview -> RECHAZADO
    const { error: errPrecio } = await f.serviceRole
      .from('detalle_venta')
      .update({ precio_venta: PRECIO + 1000 })
      .eq('id_detalle_venta', idDetalle)
    expect(errPrecio).not.toBeNull()
    expect(errPrecio?.message).toMatch(/detalle-venta-inmutable/)

    const { error: errPct } = await f.serviceRole
      .from('detalle_venta')
      .update({ porcentaje_comision_preview: 50 })
      .eq('id_detalle_venta', idDetalle)
    expect(errPct).not.toBeNull()
    expect(errPct?.message).toMatch(/detalle-venta-inmutable/)

    // 2. UPDATE de monto_comision y excluida_liquidacion sobre línea NO liquidada -> PERMITIDO
    const { error: errComision } = await f.serviceRole
      .from('detalle_venta')
      .update({ monto_comision: 5000, excluida_liquidacion: true })
      .eq('id_detalle_venta', idDetalle)
    expect(errComision).toBeNull()

    // 3. Simular liquidación sellando un id_liquidacion
    const { data: revInmut } = await f.serviceRole
      .from('revendedora')
      .insert({
        id_tenant: f.tenantId,
        nombre: 'Rev',
        apellido: 'Inmut',
        activo: true,
      })
      .select('id_revendedora')
      .single()

    const { data: liqInmut } = await f.serviceRole
      .from('liquidacion_revendedora')
      .insert({
        id_tenant: f.tenantId,
        id_revendedora: revInmut!.id_revendedora,
        periodo_desde: '2026-05-01',
        periodo_hasta: '2026-05-31',
        monto_vendido: 100000,
        monto_comision: 10000,
        monto_a_cobrar: 90000,
        cantidad_lineas: 1,
        porcentaje_aplicado: 10,
        estado: 'pendiente',
      })
      .select('id_liquidacion')
      .single()

    const dummyLiqId = liqInmut!.id_liquidacion
    const { error: errSellar } = await f.serviceRole
      .from('detalle_venta')
      .update({ id_liquidacion: dummyLiqId })
      .eq('id_detalle_venta', idDetalle)
    expect(errSellar).toBeNull()

    // 4. UPDATE sobre línea YA liquidada -> RECHAZADO
    const { error: errSobreLiq } = await f.serviceRole
      .from('detalle_venta')
      .update({ monto_comision: 8000 })
      .eq('id_detalle_venta', idDetalle)
    expect(errSobreLiq).not.toBeNull()
    expect(errSobreLiq?.message).toMatch(/detalle-venta-inmutable/)
  })

  test('anulación (DR-7): venta revendedora no liquidada devuelve ítem a en_revendedora y reabre consignación', async () => {
    const f = await ventaFixture('VtaAnularNoLiq', 1, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { data: idRev } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Ana',
      p_apellido: 'Anulacion',
    })

    const { data: idConsig } = await f.authenticated.rpc('sp_crear_consignacion_revendedora_con_items', {
      p_id_revendedora: idRev,
      p_items: [f.items[0]],
      p_periodo_desde: '2026-10-01',
      p_periodo_hasta: '2026-10-31',
    })
    await f.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idConsig,
    })

    const { data: idVenta } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: idRev,
    })

    // Anular la venta
    const { error: errAnular } = await f.authenticated.rpc('sp_anular_venta', {
      p_id_venta: idVenta,
      p_motivo: 'Cancelada por revendedora',
    })
    expect(errAnular).toBeNull()

    // 1. Item vuelve a 'en_revendedora' (NO a 'disponible')
    const { data: it } = await f.serviceRole
      .from('item_producto')
      .select('estado_item')
      .eq('id_item', f.items[0])
      .single()
    expect(it?.estado_item).toBe('en_revendedora')

    // 2. Detalle de consignación vuelve a 'en_poder'
    const { data: dcr } = await f.serviceRole
      .from('consignacion_revendedora_detalle')
      .select('estado_detalle')
      .eq('id_item', f.items[0])
      .single()
    expect(dcr?.estado_detalle).toBe('en_poder')
  })

  test('anulación y devolución rechazadas en venta revendedora liquidada / canal revendedora', async () => {
    const f = await ventaFixture('VtaLiqDev', 1, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { data: idRev } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Mariana',
      p_apellido: 'Liquidada',
    })

    const { data: idConsig } = await f.authenticated.rpc('sp_crear_consignacion_revendedora_con_items', {
      p_id_revendedora: idRev,
      p_items: [f.items[0]],
      p_periodo_desde: '2026-10-01',
      p_periodo_hasta: '2026-10-31',
    })
    await f.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idConsig,
    })

    const { data: idVenta } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: idRev,
    })

    const { data: det } = await f.serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single()
    const idDetalle = det!.id_detalle_venta

    // 1. Devolución de cliente en canal revendedora -> rechazada con devolucion-venta-revendedora
    const { error: errDev } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: idDetalle,
      p_motivo: 'Devolución particular',
    })
    expect(errDev).not.toBeNull()
    expect(errDev?.message).toMatch(/devolucion-venta-revendedora/)

    // 2. Sellar id_liquidacion para simular liquidación
    const { data: liqAnul } = await f.serviceRole
      .from('liquidacion_revendedora')
      .insert({
        id_tenant: f.tenantId,
        id_revendedora: idRev,
        periodo_desde: '2026-05-01',
        periodo_hasta: '2026-05-31',
        monto_vendido: 100000,
        monto_comision: 10000,
        monto_a_cobrar: 90000,
        cantidad_lineas: 1,
        porcentaje_aplicado: 10,
        estado: 'pendiente',
      })
      .select('id_liquidacion')
      .single()

    const { error: errSellarAnul } = await f.serviceRole
      .from('detalle_venta')
      .update({ id_liquidacion: liqAnul!.id_liquidacion })
      .eq('id_detalle_venta', idDetalle)
    expect(errSellarAnul).toBeNull()

    // 3. Anulación de venta liquidada -> rechazada con venta-liquidada
    const { error: errAnularLiq } = await f.authenticated.rpc('sp_anular_venta', {
      p_id_venta: idVenta,
      p_motivo: 'Intento anular liquidada',
    })
    expect(errAnularLiq).not.toBeNull()
    expect(errAnularLiq?.message).toMatch(/venta-liquidada/)
  })

  test('seguridad (ACC-07): una sesión de revendedora no puede llamar sp_registrar_venta', async () => {
    const f = await ventaFixture('VtaSesionRev', 1, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { data: idRev } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Sofi',
      p_apellido: 'RevAuth',
    })

    // Crear usuaria y rol Revendedora
    const emailRev = `sofi_${Date.now()}@utopia.test`
    const { data: userAuth, error: authErr } = await f.serviceRole.auth.admin.createUser({
      email: emailRev,
      password: 'Password123!',
      email_confirm: true,
    })
    expect(authErr).toBeNull()

    const { data: rId } = await f.serviceRole.from('rol').insert({
      id_tenant: f.tenantId,
      nombre: 'Revendedora',
      permisos: { revendedoras: ['ver_propio'] },
    }).select('id_rol').single()

    await f.serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRev,
      p_id_usuario: userAuth.user!.id,
      p_id_tenant: f.tenantId,
      p_email: emailRev,
      p_nombre: 'Sofi RevAuth',
      p_id_rol: rId!.id_rol,
    })

    const authRev = await signInAs({ email: emailRev, password: 'Password123!' })

    const { error: errRevVenta } = await authRev.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_forma_pago: 'efectivo',
    })

    expect(errRevVenta).not.toBeNull()
    expect(errRevVenta?.message).toMatch(/violates row-level security policy|permission denied|no-permission/i)
  })

  test('canal online se rechaza con canal-no-disponible', async () => {
    const f = await ventaFixture('VentaOnline', 1)

    const { error } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_forma_pago: 'efectivo',
      p_canal: 'online',
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/canal-no-disponible/)
  })

  test('Slice 6d — canal revendedora registra pago con medio cuenta_revendedora sin cuenta destino', async () => {
    const f = await ventaFixture('VtaRevPago', 1, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { data: idRev } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Clara',
      p_apellido: 'Pagos',
    })

    const { data: idCons } = await f.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      { p_id_revendedora: idRev, p_items: [f.items[0]] },
    )
    await f.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idCons,
    })

    const { data: idVenta, error } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_canal: 'revendedora',
      p_id_revendedora: idRev,
    })

    expect(error).toBeNull()
    expect(idVenta).toBeTruthy()

    // El pago debe existir, tener medio cuenta_revendedora y sin id_cuenta_destino
    const { data: pagos, error: pErr } = await f.serviceRole
      .from('pago_venta')
      .select('medio, monto, id_cuenta_destino, costo_cobro')
      .eq('id_venta', idVenta)

    expect(pErr).toBeNull()
    expect(pagos).toHaveLength(1)
    expect(pagos![0].medio).toBe('cuenta_revendedora')
    expect(pagos![0].id_cuenta_destino).toBeNull()
    expect(Number(pagos![0].costo_cobro)).toBe(0)
    expect(Number(pagos![0].monto)).toBe(PRECIO)
  })

  test('Slice 6d — canal local con medio cuenta_revendedora se rechaza con medio-solo-revendedora', async () => {
    const f = await ventaFixture('VtaLocalMedioRev', 1, { tipoIngreso: 'compra' })

    const { error } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_canal: 'local',
      p_pagos: [
        {
          id_cuenta_destino: f.idCuenta,
          medio: 'cuenta_revendedora',
          monto: PRECIO,
        },
      ],
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/medio-solo-revendedora/)
  })

  test('Slice 6d — canal local con financiacion externa medio cuenta_revendedora se rechaza con medio-solo-revendedora', async () => {
    const f = await ventaFixture('VtaLocalFinRev', 1, { tipoIngreso: 'compra' })

    const { error } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_canal: 'local',
      p_id_cliente: f.idCliente,
      p_financiacion: { cuotas: 3, primer_vencimiento: '2026-12-01' },
      p_financiador: {
        propia: false,
        medio: 'cuenta_revendedora',
        id_cuenta_destino: f.idCuenta,
      },
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/medio-solo-revendedora/)
  })

  test('Slice 6d — canal revendedora con pagos manuales se rechaza con venta-revendedora-con-pagos', async () => {
    const f = await ventaFixture('VtaRevConPagos', 1, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { data: idRev } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Dora',
      p_apellido: 'PagosManuales',
    })

    const { data: idCons } = await f.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      { p_id_revendedora: idRev, p_items: [f.items[0]] },
    )
    await f.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idCons,
    })

    const { error } = await f.authenticated.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: f.items[0] }],
      p_canal: 'revendedora',
      p_id_revendedora: idRev,
      p_pagos: [
        {
          id_cuenta_destino: f.idCuenta,
          medio: 'efectivo',
          monto: PRECIO,
        },
      ],
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/venta-revendedora-con-pagos/)
  })
})


