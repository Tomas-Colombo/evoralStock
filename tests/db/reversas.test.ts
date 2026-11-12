import { describe, expect, it } from 'vitest'
import { hasTestDb } from './_helpers'
import { ventaFixture, venderContado, venderFinanciado } from './_fixtures-ventas'

describe.skipIf(!hasTestDb)('Reversas — Anulación y Reintegros (Slice 5)', () => {
  it('Anulación de venta contado crea reintegro_cliente y retorna total_reintegrado', async () => {
    const f = await ventaFixture('reversa-contado')
    
    // Vender contado
    const { data: id_venta, error: errV } = await venderContado(f)
    expect(errV).toBeNull()
    
    // Anular venta
    const { data, error } = await f.authenticated.rpc('sp_anular_venta', {
      p_id_venta: id_venta,
      p_motivo: 'Me arrepentí',
      p_ip: '127.0.0.1'
    })
    
    expect(error).toBeNull()
    
    // Debe retornar el JSON con total_reintegrado
    expect(data).toBeDefined()
    expect(data!.total_reintegrado).toBe(f.precio) // f.precio es el precio del fixture

    // Verificar en DB que se creó reintegro_cliente
    const { data: reintegros } = await f.serviceRole.from('reintegro_cliente')
      .select('*')
      .eq('id_venta', id_venta)
    
    expect(reintegros).toHaveLength(1)
    expect(reintegros![0].monto).toBe(f.precio)
    expect(reintegros![0].origen).toBe('anulacion')
    expect(reintegros![0].id_cuenta_destino).toBe(f.idCuenta)
    expect(reintegros![0].motivo).toBe('Me arrepentí')
  })

  it('Anulación de venta con cuotas pagadas crea reintegros por los pagos', async () => {
    const f = await ventaFixture('reversa-cuotas')
    
    // Venta propia, 20.000 (anticipo 5.000, 3 cuotas de 5.000)
    const { data: id_venta, error: errV } = await venderFinanciado(f, {
      cuotas: 3,
      primerVencimiento: '2026-02-01',
      anticipo: 5000
    })
    expect(errV).toBeNull()

    // Cobrar cuota 1
    const { data: cuotas } = await f.serviceRole.from('cuota_financiada')
      .select('id_cuota_financiada')
      .eq('id_venta', id_venta)
      .order('numero', { ascending: true })
    
    const { error: errCobro } = await f.authenticated.rpc('sp_cobrar_cuota', {
      p_id_cuota: cuotas![0].id_cuota_financiada,
      p_id_cuenta_destino: f.idCuenta,
      p_medio: 'efectivo',
      p_monto: 5000,
      p_ip: null
    })
    expect(errCobro).toBeNull()

    // Anular venta
    const { data, error } = await f.authenticated.rpc('sp_anular_venta', {
      p_id_venta: id_venta,
      p_motivo: 'Test',
      p_ip: '127.0.0.1'
    })
    
    expect(error).toBeNull()
    expect(data!.total_reintegrado).toBe(10000) // anticipo + 1 cuota

    // Verificamos reintegros
    const { data: reintegros } = await f.serviceRole.from('reintegro_cliente')
      .select('*')
      .eq('id_venta', id_venta)
    
    expect(reintegros).toHaveLength(2)
  })

  it('Anulación bloqueada por incobrable devuelve error venta-con-incobrables', async () => {
    const f = await ventaFixture('reversa-incobrable')
    
    const { data: id_venta, error: errV } = await venderFinanciado(f, {
      cuotas: 1,
      primerVencimiento: '2026-02-01'
    })
    expect(errV).toBeNull()

    const { data: cuotas } = await f.serviceRole.from('cuota_financiada')
      .select('id_cuota_financiada')
      .eq('id_venta', id_venta)
    
    // Marcar incobrable
    const { error: errInc } = await f.authenticated.rpc('sp_marcar_cuota_incobrable', {
      p_id_cuota: cuotas![0].id_cuota_financiada,
      p_motivo: 'test',
      p_ip: null
    })
    expect(errInc).toBeNull()

    // Anular
    const { error } = await f.authenticated.rpc('sp_anular_venta', {
      p_id_venta: id_venta,
      p_motivo: 'Test',
      p_ip: '127.0.0.1'
    })
    
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/venta-con-incobrables/)
  })
})

describe.skipIf(!hasTestDb)('Devoluciones de Cliente (Slice 6)', () => {
  it('Devolución total pagada crea reintegro por el monto de la línea', async () => {
    const f = await ventaFixture('dev-total')
    
    // Vender contado (1 ítem)
    const { data: id_venta } = await venderContado(f)
    
    const { data: detalles } = await f.serviceRole.from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', id_venta)
    
    // Devolver
    const { data, error } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: detalles![0].id_detalle_venta,
      p_motivo: 'Test',
      p_id_cuenta_reintegro: f.idCuenta,
      p_medio_reintegro: 'efectivo',
      p_ip: '127.0.0.1'
    })
    
    expect(error, 'sp_registrar_devolucion_cliente').toBeNull()
    expect(data.reintegro).toBe(f.precio) // El total del ítem
    
    // Verificar que se creó la devolución y el reintegro
    const { data: devs } = await f.serviceRole.from('devolucion_venta')
      .select('*')
      .eq('id_detalle_venta', detalles![0].id_detalle_venta)
    expect(devs).toHaveLength(1)
    
    const { data: reintegros } = await f.serviceRole.from('reintegro_cliente')
      .select('*')
      .eq('id_devolucion', devs![0].id_devolucion)
    expect(reintegros).toHaveLength(1)
    expect(reintegros![0].monto).toBe(f.precio)
  })

  it('Devolución bloqueada si hay cuotas abiertas', async () => {
    const f = await ventaFixture('dev-cuotas-abiertas')
    
    const { data: id_venta } = await venderFinanciado(f, {
      cuotas: 1,
      primerVencimiento: '2026-02-01'
    })
    
    const { data: detalles } = await f.serviceRole.from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', id_venta)
    
    const { error } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: detalles![0].id_detalle_venta,
      p_motivo: 'Test',
      p_ip: null
    })
    
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/devolucion-venta-con-cuotas-abiertas/)
  })

  it('Anular una venta ya devuelta en parte NO reintegra lo que ya se devolvió', async () => {
    const f = await ventaFixture('anula-tras-devolucion', 2)

    // Venta de contado de dos ítems, pagada completa: total = 2 * f.precio.
    const { data: id_venta, error: errV } = await venderContado(f)
    expect(errV).toBeNull()

    const { data: detalles } = await f.serviceRole.from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', id_venta)

    // Se devuelve una línea y se reintegra su precio.
    const { data: dev, error: errDev } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: detalles![0].id_detalle_venta,
      p_motivo: 'Talle',
      p_id_cuenta_reintegro: f.idCuenta,
      p_medio_reintegro: 'efectivo',
      p_ip: null,
    })
    expect(errDev, 'errDev').toBeNull()
    expect(dev!.reintegro).toBe(f.precio)

    // Al anular, solo queda por devolver lo que no se devolvió: una línea.
    const { data: anul, error: errAnul } = await f.authenticated.rpc('sp_anular_venta', {
      p_id_venta: id_venta,
      p_motivo: 'Se arrepintió del resto',
      p_ip: null,
    })
    expect(errAnul, 'errAnul').toBeNull()
    expect(anul!.total_reintegrado).toBe(f.precio)

    // El cliente nunca recibe más de lo que pagó.
    const { data: reintegros } = await f.serviceRole.from('reintegro_cliente')
      .select('monto')
      .eq('id_venta', id_venta)
    const devuelto = (reintegros ?? []).reduce((acc, r) => acc + Number(r.monto), 0)
    expect(devuelto).toBe(f.precio * 2)
  })

  it('Devolución en venta con varias líneas reintegra fórmula max(0, pagos - (total - previas - monto) - reint_previos)', async () => {
    const f = await ventaFixture('dev-formulas', 2)
    
    // Venta propia, 2 ítems, total 20.000 (f.precio = 10000). 
    // Anticipo 12.000, queda deuda de 8.000.
    const { data: id_venta } = await venderFinanciado(f, {
      cuotas: 1,
      primerVencimiento: '2026-02-01',
      anticipo: 12000
    })
    
    // Total venta es f.precio * 2 = 120.000.
    // Anticipo = 12.000. Saldo = 108.000.
    const { data: cuotas } = await f.serviceRole.from('cuota_financiada')
      .select('id_cuota_financiada')
      .eq('id_venta', id_venta)
    
    const { error: errCobro } = await f.authenticated.rpc('sp_cobrar_cuota', {
      p_id_cuota: cuotas![0].id_cuota_financiada,
      p_monto: 108000,
      p_medio: 'efectivo',
      p_id_cuenta_destino: f.idCuenta,
      p_ip: null
    })
    expect(errCobro, 'errCobro').toBeNull()
    
    const { data: detalles } = await f.serviceRole.from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', id_venta)
      
    // Primera devolución: la venta estaba pagada por 120.000.
    // Devolvemos 1 ítem (60.000). Reintegro debe ser 60.000.
    const { data: d1, error: errD1 } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: detalles![0].id_detalle_venta,
      p_motivo: 'D1',
      p_id_cuenta_reintegro: f.idCuenta,
      p_medio_reintegro: 'efectivo',
      p_ip: null
    })
    expect(errD1, 'errD1').toBeNull()
    expect(d1!.reintegro).toBe(60000)
    
    // Segunda devolución: devolvemos el segundo ítem (60.000). Reintegro debe ser 60.000.
    const { data: d2, error: errD2 } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: detalles![1].id_detalle_venta,
      p_motivo: 'D2',
      p_id_cuenta_reintegro: f.idCuenta,
      p_medio_reintegro: 'efectivo',
      p_ip: null
    })
    expect(errD2, 'errD2').toBeNull()
    expect(d2!.reintegro).toBe(60000)
  })

  it('Consignación devuelta NO entra en sp_generar_rendicion', async () => {
    const f = await ventaFixture('dev-consignacion', 1, { tipoIngreso: 'consignacion' })
    
    const { data: id_venta } = await venderContado(f)
    
    const { data: detalles } = await f.serviceRole.from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', id_venta)
      
    await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: detalles![0].id_detalle_venta,
      p_motivo: 'Test',
      p_id_cuenta_reintegro: f.idCuenta,
      p_medio_reintegro: 'efectivo',
      p_ip: null
    })
    
    const { data: dev } = await f.serviceRole.from('detalle_venta').select('id_proveedor').eq('id_venta', id_venta).limit(1).single()
    const idProveedor = dev!.id_proveedor
    
    // Intentar rendir al proveedor, debe fallar por no haber líneas pendientes
    const { error: errRend } = await f.authenticated.rpc('sp_generar_rendicion', {
      p_id_proveedor: idProveedor,
      p_observaciones: 'Test',
      p_ip: null
    })
    expect(errRend!.message).toBe('sin-lineas-pendientes')
  })

  it('Devolución recupera el costo_snapshot de la línea', async () => {
    const f = await ventaFixture('dev-costo', 1)
    
    const { data: id_venta } = await venderContado(f)
    
    const { data: detalles } = await f.serviceRole.from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', id_venta)
      
    await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: detalles![0].id_detalle_venta,
      p_motivo: 'Test costo',
      p_id_cuenta_reintegro: f.idCuenta,
      p_medio_reintegro: 'efectivo',
      p_ip: null
    })
    
    const { data: dev } = await f.serviceRole.from('devolucion_venta')
      .select('id_devolucion, devolucion_venta_costo(costo_recuperado)')
      .eq('id_detalle_venta', detalles![0].id_detalle_venta)
      .single()

    const devc = Array.isArray(dev?.devolucion_venta_costo)
      ? dev.devolucion_venta_costo[0]
      : dev?.devolucion_venta_costo
    expect(Number((devc as { costo_recuperado?: number } | null)?.costo_recuperado)).toBe(f.costo)
  })

  it('Devolución bloqueada si la línea ya fue rendida al proveedor (detalle-ya-rendido)', async () => {
    const f = await ventaFixture('dev-ya-rendida', 1, { tipoIngreso: 'consignacion' })
    const { data: id_venta } = await venderContado(f)

    const { data: detalles } = await f.serviceRole.from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', id_venta)

    // Una rendición cualquiera alcanza: id_rendicion es una de las dos columnas
    // de detalle_venta que sigue siendo editable (00068).
    const { data: prov } = await f.serviceRole.from('proveedor')
      .insert({ id_tenant: f.tenantId, nombre: 'Prov devolución rendida' })
      .select('id_proveedor')
      .single()
    const { data: rend } = await f.serviceRole.from('rendicion_proveedor')
      .insert({ id_tenant: f.tenantId, id_proveedor: prov!.id_proveedor, monto_total: 0, cantidad_lineas: 0 })
      .select('id_rendicion')
      .single()
    const { error: errSet } = await f.serviceRole.from('detalle_venta')
      .update({ id_rendicion: rend!.id_rendicion })
      .eq('id_detalle_venta', detalles![0].id_detalle_venta)
    expect(errSet, 'marcar línea como rendida').toBeNull()

    const { error } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: detalles![0].id_detalle_venta,
      p_motivo: 'Test',
      p_id_cuenta_reintegro: f.idCuenta,
      p_medio_reintegro: 'efectivo',
      p_ip: null
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/detalle-ya-rendido/)
  })

  it('Devolución sobre una venta anulada de verdad se rechaza (el ítem ya volvió a disponible)', async () => {
    const f = await ventaFixture('dev-venta-anulada')
    const { data: id_venta } = await venderContado(f)

    const { data: detalles } = await f.serviceRole.from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', id_venta)

    const { error: errAnular } = await f.authenticated.rpc('sp_anular_venta', {
      p_id_venta: id_venta,
      p_motivo: 'Test',
      p_ip: null
    })
    expect(errAnular, 'sp_anular_venta').toBeNull()

    // Anular libera el ítem (00062): el guard item-no-esta-vendido se dispara
    // antes que venta-anulada, así que por el flujo real nunca se llega al otro.
    const { error } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: detalles![0].id_detalle_venta,
      p_motivo: 'Test',
      p_id_cuenta_reintegro: f.idCuenta,
      p_medio_reintegro: 'efectivo',
      p_ip: null
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/item-no-esta-vendido/)
  })

  it('Devolución bloqueada con venta-anulada cuando el ítem sigue vendido', async () => {
    const f = await ventaFixture('dev-venta-anulada-forzada')
    const { data: id_venta } = await venderContado(f)

    const { data: detalles } = await f.serviceRole.from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', id_venta)

    // Estado forzado (el trigger de 00068 deja pasar estado_venta): aísla el
    // guard de venta-anulada del de estado del ítem.
    const { error: errSet } = await f.serviceRole.from('venta')
      .update({ estado_venta: 'anulada' })
      .eq('id_venta', id_venta)
    expect(errSet, 'forzar estado_venta').toBeNull()

    const { error } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: detalles![0].id_detalle_venta,
      p_motivo: 'Test',
      p_id_cuenta_reintegro: f.idCuenta,
      p_medio_reintegro: 'efectivo',
      p_ip: null
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/venta-anulada/)
  })
})
 
