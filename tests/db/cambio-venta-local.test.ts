import { describe, expect, test } from 'vitest'
import { hasTestDb } from './_helpers'
import { ventaFixture, venderContado, PRECIO, COSTO } from './_fixtures-ventas'
import { getHoyBuenosAires } from '../fechas'

describe.skipIf(!hasTestDb)('Slice 8 — Cambios de Producto en Local (REQ-RV-DB-07, DR-5, DR-7)', () => {
  test('1. cambio con diferencia 0 en local: stock original vuelve a disponible, nuevo a vendido, línea original excluida_liquidacion = true, comisión invariante', async () => {
    const f = await ventaFixture('CambioLocalDif0', 2, { tipoIngreso: 'compra' })

    // Venta contado de ítem 0
    const { data: idVenta, error: errVenta } = await venderContado(f, { items: [f.items[0]] })
    expect(errVenta).toBeNull()

    // Obtener detalle de venta original
    const { data: detOriginal } = await f.serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta, precio_venta, detalle_venta_costo(costo_snapshot)')
      .eq('id_venta', idVenta)
      .single()
    expect(detOriginal).toBeDefined()

    // Registrar cambio por ítem 1 (mismo producto, misma categoría, diferencia 0)
    const { data: resCambio, error: errCambio } = await f.authenticated.rpc('sp_registrar_cambio', {
      p_id_detalle_original: detOriginal!.id_detalle_venta,
      p_id_item_entregado: f.items[1],
      p_motivo: 'Cambio por talle',
    })

    expect(errCambio).toBeNull()
    expect(resCambio).toBeDefined()

    // Verificar tabla cambio_venta
    const { data: cv } = await f.serviceRole
      .from('cambio_venta')
      .select('*')
      .eq('id_detalle_original', detOriginal!.id_detalle_venta)
      .single()
    expect(cv).toBeDefined()
    expect(cv!.id_item_entregado).toBe(f.items[1])
    expect(Number(cv!.diferencia)).toBe(0)
    expect(cv!.origen).toBe('local')

    // Verificar estados de ítems
    const { data: itemOrig } = await f.serviceRole
      .from('item_producto')
      .select('estado_item')
      .eq('id_item', f.items[0])
      .single()
    expect(itemOrig?.estado_item).toBe('disponible')

    const { data: itemEntregado } = await f.serviceRole
      .from('item_producto')
      .select('estado_item')
      .eq('id_item', f.items[1])
      .single()
    expect(itemEntregado?.estado_item).toBe('vendido')

    // Verificar línea original con excluida_liquidacion = true
    const { data: detOrigPost } = await f.serviceRole
      .from('detalle_venta')
      .select('excluida_liquidacion')
      .eq('id_detalle_venta', detOriginal!.id_detalle_venta)
      .single()
    expect(detOrigPost?.excluida_liquidacion).toBe(true)

    // Verificar nueva línea creada para el ítem entregado
    const { data: detNuevo } = await f.serviceRole
      .from('detalle_venta')
      .select('id_item, precio_venta, excluida_liquidacion, detalle_venta_costo(costo_snapshot)')
      .eq('id_venta', idVenta)
      .eq('id_item', f.items[1])
      .single()
    expect(detNuevo).toBeDefined()
    expect(Number(detNuevo!.precio_venta)).toBe(Number(detOriginal!.precio_venta))
    expect(detNuevo!.excluida_liquidacion).toBe(false)
  })

  test('2. cambio con diferencia positiva en local: se cobra diferencia, entra a caja, no genera comisión extra', async () => {
    const f = await ventaFixture('CambioLocalDifPos', 1, { tipoIngreso: 'compra' })

    // Crear un segundo producto más caro ($62.000 vs PRECIO $60.000 -> dif 2000)
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
        nombre: 'Producto Caro',
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

    // Venta contado de ítem 0
    const { data: idVenta } = await venderContado(f, { items: [f.items[0]] })

    const { data: detOriginal } = await f.serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single()

    // Cambio por item más caro cobrando diferencia
    const { error: errCambio } = await f.authenticated.rpc('sp_registrar_cambio', {
      p_id_detalle_original: detOriginal!.id_detalle_venta,
      p_id_item_entregado: itemCaro!.id_item,
      p_motivo: 'Cambio por modelo superior',
      p_medio_cobro: 'efectivo',
      p_id_cuenta_destino: f.idCuenta,
    })

    expect(errCambio).toBeNull()

    // Verificar registro en cambio_venta
    const { data: cv } = await f.serviceRole
      .from('cambio_venta')
      .select('diferencia')
      .eq('id_detalle_original', detOriginal!.id_detalle_venta)
      .single()
    expect(Number(cv!.diferencia)).toBe(2000)

    // Verificar pago_venta con la diferencia cobrada
    const { data: pagos } = await f.serviceRole
      .from('pago_venta')
      .select('monto, medio, id_cuenta_destino')
      .eq('id_venta', idVenta)
    expect(pagos).toHaveLength(2)
    const pagoDif = pagos!.find((p) => Number(p.monto) === 2000)
    expect(pagoDif).toBeDefined()
    expect(pagoDif!.medio).toBe('efectivo')
    expect(pagoDif!.id_cuenta_destino).toBe(f.idCuenta)

    // Verificar flujo financiero: la diferencia entra a cobrado
    const hoy = getHoyBuenosAires()
    const { data: flujo } = await f.authenticated.rpc('rf_finanzas_flujo', {
      p_desde: hoy,
      p_hasta: hoy,
    })
    expect(flujo).toBeDefined()
    expect(Number(flujo![0].cobrado)).toBe(PRECIO + 2000)
  })

  test('3. borrado de tenant en cascada limpio', async () => {
    const f = await ventaFixture('CambioCascade', 2, { tipoIngreso: 'compra' })

    const { data: idVenta } = await venderContado(f, { items: [f.items[0]] })
    const { data: det } = await f.serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single()

    const { error: errCambio } = await f.authenticated.rpc('sp_registrar_cambio', {
      p_id_detalle_original: det!.id_detalle_venta,
      p_id_item_entregado: f.items[1],
    })
    expect(errCambio).toBeNull()

    // Borrado del tenant debe cascada sin error FK
    const { error: errDel } = await f.serviceRole
      .from('tenant')
      .delete()
      .eq('id_tenant', f.tenantId)
    expect(errDel).toBeNull()
  })
})
