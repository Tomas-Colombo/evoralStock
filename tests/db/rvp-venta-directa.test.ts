import { describe, expect, test, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { hasTestDb, signInAs } from './_helpers'
import { ventaFixture } from './_fixtures-ventas'

describe.skipIf(!hasTestDb)('Portal venta directa — sp_registrar_venta_revendedora y rvp_resolver_item_stock', () => {
  const serviceRole = createServiceRoleTestClient()
  const tenantsToClean: string[] = []
  const usersToClean: string[] = []

  afterAll(async () => {
    for (const t of tenantsToClean) {
      await serviceRole.rpc('sp_borrar_tenant', { p_id: t })
    }
    for (const u of usersToClean) {
      await serviceRole.auth.admin.deleteUser(u)
    }
  })

  async function crearRevendedoraConStock(
    fixture: Awaited<ReturnType<typeof ventaFixture>>,
    nombre: string,
    emailPrefix: string,
    items: string[],
    permisos: string[] = ['ver_propio', 'vender'],
  ) {
    const { data: idRev } = await fixture.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: nombre,
      p_apellido: 'Test',
      p_email: `${emailPrefix}@test.com`,
    })

    const { data: rolRev } = await serviceRole
      .from('rol')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: `Rev_${nombre}_${Date.now()}`,
        permisos: { revendedoras: permisos },
      })
      .select('id_rol')
      .single()

    const email = `${emailPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`
    const { data: user } = await serviceRole.auth.admin.createUser({
      email,
      password: 'Password123!',
      email_confirm: true,
    })
    usersToClean.push(user.user!.id)

    await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRev,
      p_id_usuario: user.user!.id,
      p_id_tenant: fixture.tenantId,
      p_email: email,
      p_nombre: nombre,
      p_id_rol: rolRev!.id_rol,
    })

    if (items.length > 0) {
      const hoy = new Date().toISOString().slice(0, 10)
      const { data: idCons } = await fixture.authenticated.rpc('sp_crear_consignacion_revendedora_con_items', {
        p_id_revendedora: idRev,
        p_items: items,
        p_periodo_desde: hoy,
      })
      await fixture.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
        p_id_consignacion_revendedora: idCons,
      })
    }

    const auth = await signInAs({ email, password: 'Password123!' })
    return { idRev: idRev as string, auth }
  }

  async function setupContext() {
    const fA = await ventaFixture('VtaDirA', 7, { tipoIngreso: 'compra' })
    tenantsToClean.push(fA.tenantId)

    const { data: mod } = await serviceRole
      .from('modulo')
      .select('id_modulo')
      .eq('codigo', 'revendedoras')
      .single()
    await serviceRole
      .from('tenant_modulo')
      .insert({ id_tenant: fA.tenantId, id_modulo: mod!.id_modulo, habilitado: true })

    const ana = await crearRevendedoraConStock(fA, 'Ana', 'ana_vd', [
      fA.items[0],
      fA.items[1],
      fA.items[2],
      fA.items[3],
    ])
    const berta = await crearRevendedoraConStock(fA, 'Berta', 'berta_vd', [fA.items[4]])
    const itemLocal = fA.items[5]
    const itemSinCosto = fA.items[6]

    // Consignar itemSinCosto a Ana y eliminar su item_costo para probar N6
    const hoy = new Date().toISOString().slice(0, 10)
    const { data: idConsSinCosto } = await fA.authenticated.rpc('sp_crear_consignacion_revendedora_con_items', {
      p_id_revendedora: ana.idRev,
      p_items: [itemSinCosto],
      p_periodo_desde: hoy,
    })
    await fA.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idConsSinCosto,
    })
    await serviceRole.from('item_costo').delete().eq('id_item', itemSinCosto)

    // Tenant B para aislamiento cruzado
    const fB = await ventaFixture('VtaDirB', 2, { tipoIngreso: 'compra' })
    tenantsToClean.push(fB.tenantId)
    await serviceRole
      .from('tenant_modulo')
      .insert({ id_tenant: fB.tenantId, id_modulo: mod!.id_modulo, habilitado: true })
    const carla = await crearRevendedoraConStock(fB, 'Carla', 'carla_vd', [fB.items[0]])

    return { fA, fB, ana, berta, carla, itemLocal, itemSinCosto, idModuloRev: mod!.id_modulo }
  }

  test('Caso feliz de lote (3 ítems): venta, detalles, pago cuenta_revendedora, costos sellados y snapshot de precio', async () => {
    const ctx = await setupContext()
    const lote = [ctx.fA.items[0], ctx.fA.items[1], ctx.fA.items[2]]

    // Verificar precio snapshot y rvp_resolver_item_stock antes de vender
    const { data: snap } = await ctx.fA.authenticated.rpc('sp_calcular_precio_venta_snapshot', {
      p_id_producto: ctx.fA.idProducto,
      p_forma_pago: 'efectivo',
      p_ids_descuentos: [],
    })
    const precioEsperado = Number((snap as { precio_final: number }).precio_final)

    const { data: itemMeta } = await serviceRole
      .from('item_producto')
      .select('qr_code')
      .eq('id_item', lote[0])
      .single()

    const { data: resuelto, error: errRes } = await ctx.ana.auth.rpc('rvp_resolver_item_stock', {
      p_codigo: itemMeta!.qr_code,
    })
    expect(errRes).toBeNull()
    expect(resuelto).toHaveLength(1)
    expect(Number(resuelto![0].precio_venta)).toBe(precioEsperado)

    // Registrar venta directa en lote (con duplicado intencional para validar dedupe en SQL)
    const { data: idVenta, error: errVenta } = await ctx.ana.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: [lote[0], lote[1], lote[2], lote[0]],
    })
    expect(errVenta).toBeNull()
    expect(idVenta).toBeTruthy()

    // 1 venta, canal 'revendedora', estado 'registrada'
    const { data: venta } = await serviceRole
      .from('venta')
      .select('*')
      .eq('id_venta', idVenta)
      .single()
    expect(venta!.canal).toBe('revendedora')
    expect(venta!.estado_venta).toBe('registrada')
    expect(venta!.id_revendedora).toBe(ctx.ana.idRev)
    expect(Number(venta!.total)).toBe(precioEsperado * 3)

    // 3 detalle_venta con precio snapshot y costos sellados
    const { data: detalles } = await serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta, id_item, precio_venta')
      .eq('id_venta', idVenta)
    expect(detalles).toHaveLength(3)
    for (const d of detalles!) {
      expect(Number(d.precio_venta)).toBe(precioEsperado)
      const { data: dvc } = await serviceRole
        .from('detalle_venta_costo')
        .select('id_detalle_venta')
        .eq('id_detalle_venta', d.id_detalle_venta)
        .maybeSingle()
      const { data: dvr } = await serviceRole
        .from('detalle_venta_rendicion')
        .select('id_detalle_venta')
        .eq('id_detalle_venta', d.id_detalle_venta)
        .maybeSingle()
      expect(dvc).not.toBeNull()
      expect(dvr).not.toBeNull()
    }

    // 1 pago_venta cuenta_revendedora
    const { data: pagos } = await serviceRole
      .from('pago_venta')
      .select('medio, monto')
      .eq('id_venta', idVenta)
    expect(pagos).toHaveLength(1)
    expect(pagos![0].medio).toBe('cuenta_revendedora')
    expect(Number(pagos![0].monto)).toBe(precioEsperado * 3)

    // Ítems y consignacion_revendedora_detalle pasaron a 'vendido'
    const { data: itemsDb } = await serviceRole
      .from('item_producto')
      .select('estado_item')
      .in('id_item', lote)
    expect(itemsDb!.every((i) => i.estado_item === 'vendido')).toBe(true)

    const { data: crdDb } = await serviceRole
      .from('consignacion_revendedora_detalle')
      .select('estado_detalle')
      .in('id_item', lote)
    expect(crdDb!.every((c) => c.estado_detalle === 'vendido')).toBe(true)

    // Aparece de inmediato en rvp_mis_ventas
    const { data: misVentas } = await ctx.ana.auth.rpc('rvp_mis_ventas')
    expect(misVentas!.length).toBeGreaterThanOrEqual(3)
  })

  test('N1: lista vacía, tope 50 excedido y usuario sin permiso revendedoras.vender', async () => {
    const ctx = await setupContext()

    const { error: errVacio } = await ctx.ana.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: [],
    })
    expect(errVacio?.message).toMatch(/lineas-vacias/)

    const cincuentaYUno = Array.from({ length: 51 }, () => randomUUID())
    const { error: errTope } = await ctx.ana.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: cincuentaYUno,
    })
    expect(errTope?.message).toMatch(/payload-invalido/)

    const sinPermiso = await crearRevendedoraConStock(ctx.fA, 'SinPerm', 'sinperm_vd', [], ['ver_propio'])
    const { error: errPerm } = await sinPermiso.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: [ctx.fA.items[0]],
    })
    expect(errPerm?.message).toMatch(/no-permission/)
  })

  test('N2, N2b, N2c: otro tenant, otra revendedora o ítem disponible del local -> item-no-en-poder', async () => {
    const ctx = await setupContext()

    // N2: ítem de otro tenant
    const { error: errOtroTenant } = await ctx.ana.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: [ctx.fB.items[0]],
    })
    expect(errOtroTenant?.message).toMatch(/item-no-en-poder/)

    // N2b: ítem de otra revendedora del mismo tenant
    const { error: errOtraRev } = await ctx.ana.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: [ctx.fA.items[4]],
    })
    expect(errOtraRev?.message).toMatch(/item-no-en-poder/)

    // N2c: ítem disponible del local
    const { error: errLocal } = await ctx.ana.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: [ctx.itemLocal],
    })
    expect(errLocal?.message).toMatch(/item-no-en-poder/)
  })

  test('N3: módulo revendedoras apagado -> modulo-revendedoras-deshabilitado', async () => {
    const ctx = await setupContext()

    await serviceRole
      .from('tenant_modulo')
      .update({ habilitado: false })
      .eq('id_tenant', ctx.fA.tenantId)
      .eq('id_modulo', ctx.idModuloRev)

    const { error: errMod } = await ctx.ana.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: [ctx.fA.items[0]],
    })
    expect(errMod?.message).toMatch(/modulo-revendedoras-deshabilitado/)

    const { error: errRes } = await ctx.ana.auth.rpc('rvp_resolver_item_stock', {
      p_codigo: 'CUALQUIERA',
    })
    expect(errRes?.message).toMatch(/modulo-revendedoras-deshabilitado/)
  })

  test('N4a y N4b: ítem ya vendido y atomicidad de lote (2 válidos + 1 inválido -> 0 filas)', async () => {
    const ctx = await setupContext()

    // Vender item[0] primero
    const { error: err1 } = await ctx.ana.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: [ctx.fA.items[0]],
    })
    expect(err1).toBeNull()

    // N4a: intentar vender item[0] otra vez -> item-no-en-poder
    const { error: errVendido } = await ctx.ana.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: [ctx.fA.items[0]],
    })
    expect(errVendido?.message).toMatch(/item-no-en-poder/)

    // N4b: lote mixto con 2 válidos (item[1], item[2]) + 1 inválido (item[0] ya vendido)
    const { count: ventasAntes } = await serviceRole
      .from('venta')
      .select('*', { count: 'exact', head: true })
      .eq('id_tenant', ctx.fA.tenantId)

    const { error: errMixto } = await ctx.ana.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: [ctx.fA.items[1], ctx.fA.items[2], ctx.fA.items[0]],
    })
    expect(errMixto?.message).toMatch(/item-no-en-poder/)

    const { count: ventasDespues } = await serviceRole
      .from('venta')
      .select('*', { count: 'exact', head: true })
      .eq('id_tenant', ctx.fA.tenantId)
    expect(ventasDespues).toBe(ventasAntes)

    const { data: itemsValidos } = await serviceRole
      .from('item_producto')
      .select('estado_item')
      .in('id_item', [ctx.fA.items[1], ctx.fA.items[2]])
    expect(itemsValidos!.every((i) => i.estado_item === 'en_revendedora')).toBe(true)
  })

  test('N5: sesión de operador del local -> no-revendedora', async () => {
    const ctx = await setupContext()

    const { error: errOp } = await ctx.fA.authenticated.rpc('sp_registrar_venta_revendedora', {
      p_items: [ctx.fA.items[0]],
    })
    expect(errOp?.message).toMatch(/no-revendedora/)

    const { error: errOpRes } = await ctx.fA.authenticated.rpc('rvp_resolver_item_stock', {
      p_codigo: 'TEST',
    })
    expect(errOpRes?.message).toMatch(/no-revendedora/)
  })

  test('N6: lote con ítem sin item_costo -> item-costo-pendiente y rollback completo', async () => {
    const ctx = await setupContext()

    const { count: ventasAntes } = await serviceRole
      .from('venta')
      .select('*', { count: 'exact', head: true })
      .eq('id_tenant', ctx.fA.tenantId)

    const { error: errCosto } = await ctx.ana.auth.rpc('sp_registrar_venta_revendedora', {
      p_items: [ctx.fA.items[0], ctx.itemSinCosto],
    })
    expect(errCosto?.message).toMatch(/item-costo-pendiente/)

    const { count: ventasDespues } = await serviceRole
      .from('venta')
      .select('*', { count: 'exact', head: true })
      .eq('id_tenant', ctx.fA.tenantId)
    expect(ventasDespues).toBe(ventasAntes)

    const { data: item0 } = await serviceRole
      .from('item_producto')
      .select('estado_item')
      .eq('id_item', ctx.fA.items[0])
      .single()
    expect(item0!.estado_item).toBe('en_revendedora')
  })

  test('rvp_resolver_item_stock: resuelve qr_code, codigo_ean y SKU, y devuelve 0 filas para ítems ajenos', async () => {
    const ctx = await setupContext()

    const { data: metaAna } = await serviceRole
      .from('item_producto')
      .select('id_item, qr_code, codigo_ean, talle')
      .eq('id_item', ctx.fA.items[0])
      .single()
    const { data: prodAna } = await serviceRole
      .from('producto')
      .select('sku')
      .eq('id_producto', ctx.fA.idProducto)
      .single()

    // Por qr_code
    const { data: byQr } = await ctx.ana.auth.rpc('rvp_resolver_item_stock', {
      p_codigo: metaAna!.qr_code,
    })
    expect(byQr).toHaveLength(1)
    expect(byQr![0].id_item).toBe(metaAna!.id_item)

    // Por codigo_ean
    const { data: byEan } = await ctx.ana.auth.rpc('rvp_resolver_item_stock', {
      p_codigo: metaAna!.codigo_ean,
    })
    expect(byEan).toHaveLength(1)
    expect(byEan![0].id_item).toBe(metaAna!.id_item)

    // Por SKU (respetando p_excluir)
    if (prodAna?.sku) {
      const { data: bySku } = await ctx.ana.auth.rpc('rvp_resolver_item_stock', {
        p_codigo: prodAna.sku,
        p_excluir: [ctx.fA.items[0]],
      })
      expect(bySku!.length).toBeGreaterThanOrEqual(1)
      expect(bySku!.some((r: { id_item: string }) => r.id_item === ctx.fA.items[0])).toBe(false)
    }

    // Ítem de otra revendedora (Berta), de otro tenant (Carla) y disponible del local -> 0 filas
    const { data: metaBerta } = await serviceRole
      .from('item_producto')
      .select('qr_code')
      .eq('id_item', ctx.fA.items[4])
      .single()
    const { data: metaCarla } = await serviceRole
      .from('item_producto')
      .select('qr_code')
      .eq('id_item', ctx.fB.items[0])
      .single()
    const { data: metaLocal } = await serviceRole
      .from('item_producto')
      .select('qr_code')
      .eq('id_item', ctx.itemLocal)
      .single()

    for (const codigoAjeno of [metaBerta!.qr_code, metaCarla!.qr_code, metaLocal!.qr_code]) {
      const { data, error } = await ctx.ana.auth.rpc('rvp_resolver_item_stock', {
        p_codigo: codigoAjeno,
      })
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
  })

  test('Seguridad: el schema interno no es alcanzable por RPC (anon, operador, revendedora)', async () => {
    const ctx = await setupContext()
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST!
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST!
    const anon = createClient(url, anonKey)

    for (const client of [anon, ctx.fA.authenticated, ctx.ana.auth]) {
      const { error: errNucleo } = await client.rpc('fn_registrar_venta_nucleo', {})
      expect(errNucleo).not.toBeNull()

      const { error: errSellar } = await client.rpc('fn_sellar_costo_venta_nucleo', {})
      expect(errSellar).not.toBeNull()
    }

    // Llamada HTTP directa a /rest/v1/rpc/fn_registrar_venta_nucleo
    const res = await fetch(`${url}/rest/v1/rpc/fn_registrar_venta_nucleo`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
