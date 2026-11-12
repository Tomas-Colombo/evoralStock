import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import {
  createTenantWithUser,
  hasTestDb,
  signInAs,
  unwrapFixture,
  withScopedTenant,
  type TenantFixture,
} from './_helpers'

describe.skipIf(!hasTestDb)('CPC Fase 3E.1 — segregación RLS, sellador de herencia y D-CPC-08/09', () => {
  const serviceRole = createServiceRoleTestClient()

  async function createClientWithPermisos(
    fixture: TenantFixture,
    nombreRol: string,
    permisos: Record<string, string[]>,
  ) {
    const { data: rol, error: rolErr } = await fixture.serviceRole
      .from('rol')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant(nombreRol), permisos })
      .select('id_rol')
      .single()
    if (rolErr || !rol) throw new Error(`createClientWithPermisos rol failed: ${rolErr?.message}`)

    const email = `${withScopedTenant(nombreRol)}@example.com`
    const password = 'Fixture-Password-1!'
    const { data: authUser, error: authErr } = await fixture.serviceRole.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authErr || !authUser?.user) throw new Error(`createClientWithPermisos auth failed: ${authErr?.message}`)

    const { error: usrErr } = await fixture.serviceRole.from('usuario').insert({
      id_usuario: authUser.user.id,
      id_tenant: fixture.tenantId,
      email,
      nombre_completo: `Usuario ${nombreRol}`,
      id_rol: rol.id_rol,
      estado_usuario: 'activo',
    })
    if (usrErr) throw new Error(`createClientWithPermisos usuario failed: ${usrErr.message}`)

    return signInAs({ email, password })
  }

  async function setupBase(prefix: string) {
    const fixture = await createTenantWithUser(withScopedTenant(prefix))
    const authAdmin = await signInAs(fixture)

    const cuenta = unwrapFixture(
      'cuenta_destino insert',
      await serviceRole
        .from('cuenta_destino')
        .insert({
          id_tenant: fixture.tenantId,
          nombre: 'Caja Principal',
          tipo: 'efectivo',
          activo: true,
          es_predeterminada: true,
        })
        .select('id_cuenta_destino')
        .single(),
    )

    const categoria = unwrapFixture(
      'categoria insert',
      await serviceRole
        .from('categoria')
        .insert({ id_tenant: fixture.tenantId, nombre: 'Indumentaria' })
        .select('id_categoria')
        .single(),
    )

    // El proveedor consignatario exige el paquete consignaciones + rendiciones
    // encendido (guarda de 00122): sin esto el insert levanta module-disabled.
    const { data: modulos, error: modErr } = await serviceRole
      .from('modulo')
      .select('id_modulo, codigo')
      .in('codigo', ['consignaciones', 'rendiciones'])
    expect(modErr).toBeNull()
    expect(modulos).toHaveLength(2)
    const { error: habErr } = await serviceRole.from('tenant_modulo').upsert(
      modulos!.map((m) => ({ id_tenant: fixture.tenantId, id_modulo: m.id_modulo, habilitado: true })),
    )
    expect(habErr).toBeNull()

    const proveedor = unwrapFixture(
      'proveedor insert',
      await serviceRole
        .from('proveedor')
        .insert({
          id_tenant: fixture.tenantId,
          nombre: 'Proveedor Consig',
          tipo: 'consignatario',
        })
        .select('id_proveedor')
        .single(),
    )


    const { data: idProd, error: prodErr } = await authAdmin.rpc('sp_create_producto', {
      p_id_categoria: categoria.id_categoria,
      p_nombre: 'Campera Prueba',
      p_sku: `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    })
    expect(prodErr).toBeNull()

    const { error: costoErr } = await authAdmin.rpc('sp_set_costo_producto', {
      p_id_producto: idProd,
      p_costo: 1000,
      p_moneda: 'ARS',
    })
    expect(costoErr).toBeNull()

    const { error: reglaMargenErr } = await authAdmin.rpc('sp_create_regla_precio', {
      p_nombre: 'Margen 50%',
      p_tipo_regla: 'margen',
      p_tipo_valor: 'porcentaje',
      p_valor: 0.5,
      p_alcance: 'global',
    })
    expect(reglaMargenErr).toBeNull()

    const { error: recalcErr } = await authAdmin.rpc('sp_recalcular_precio_venta', {
      p_id_producto: idProd,
    })
    expect(recalcErr).toBeNull()

    return {
      ...fixture,
      authAdmin,
      idCuenta: cuenta.id_cuenta_destino,
      idCategoria: categoria.id_categoria,
      idProveedor: proveedor.id_proveedor,
      idProd: idProd as string,
    }
  }

  it('1. Rol sin ver_costos/ver_margenes/rendiciones.ver lee 0 filas en costo_producto, regla margen, auditoria y rendicion_proveedor', async () => {
    const t = await setupBase('seg-select')

    const { error: descErr } = await t.authAdmin.rpc('sp_create_regla_precio', {
      p_nombre: 'Descuento 10%',
      p_tipo_regla: 'descuento',
      p_tipo_valor: 'porcentaje',
      p_valor: 0.1,
      p_alcance: 'global',
    })
    expect(descErr).toBeNull()

    await serviceRole.from('rendicion_proveedor').insert({
      id_tenant: t.tenantId,
      id_proveedor: t.idProveedor,
      monto_total: 500,
      cantidad_lineas: 1,
    })

    const vendedora = await createClientWithPermisos(t, 'vendedora-sin-costos', {
      inventario: ['ver', 'crear', 'editar'],
      precios: ['ver'],
      ventas: ['crear', 'editar'],
      administracion: ['ver'],
    })

    const { data: costos } = await vendedora.from('costo_producto').select('id_costo')
    expect(costos).toEqual([])

    const { data: reglas } = await vendedora.from('regla_precio').select('tipo_regla')
    expect(reglas?.every((r) => r.tipo_regla !== 'margen')).toBe(true)
    expect(reglas?.some((r) => r.tipo_regla === 'descuento')).toBe(true)

    const { data: aud } = await vendedora.from('auditoria').select('id_auditoria')
    expect(aud).toEqual([])

    const { data: rends } = await vendedora.from('rendicion_proveedor').select('id_rendicion')
    expect(rends).toEqual([])
  })

  it('2. Rol sin rendiciones.ver llama preview_rendicion -> 42501', async () => {
    const t = await setupBase('seg-preview-rend')
    const sinRend = await createClientWithPermisos(t, 'sin-rend-ver', {
      inventario: ['ver'],
    })

    const { error } = await sinRend.rpc('preview_rendicion', {
      p_id_proveedor: t.idProveedor,
    })
    expect(error?.code).toBe('42501')
  })

  it('3. Recalcular/revaluar sin ver_costos -> 42501; reportes sin ver_costos -> null y nunca 0 (D-CPC-08)', async () => {
    const t = await setupBase('seg-rep-null')

    // Crear stock y registrar venta para tener datos reales de venta y costo
    const { error: stockErr } = await t.authAdmin.rpc('sp_crear_stock_directo', {
      p_id_producto: t.idProd,
      p_costo: 1000,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: 'M', cantidad: 1 }],
    })
    expect(stockErr).toBeNull()

    const { data: items } = await serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_tenant', t.tenantId)
      .eq('id_producto', t.idProd)
    const idItem = items![0].id_item

    const { data: idVenta, error: vErr } = await t.authAdmin.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: idItem, descuentos: [] }],
      p_forma_pago: 'efectivo',
      p_pagos: [{ medio: 'efectivo', id_cuenta_destino: t.idCuenta, monto: 1500 }],
    })
    expect(vErr).toBeNull()

    const sinCostos = await createClientWithPermisos(t, 'rep-sin-costos', {
      precios: ['editar', 'editar_cotizacion', 'ver_margenes'],
      reportes: ['ver'],
      ventas: ['ver'],
    })

    const { error: errRecalc } = await sinCostos.rpc('sp_recalcular_precio_venta', {
      p_id_producto: t.idProd,
    })
    expect(errRecalc?.code).toBe('42501')

    const { error: errReval } = await sinCostos.rpc('sp_revaluar_costos_usd_vigentes')
    expect(errReval?.code).toBe('42501')

    const hoy = new Date().toISOString().slice(0, 10)
    const desde = `${hoy.slice(0, 8)}01`

    const { data: resAdminRaw } = await t.authAdmin
      .rpc('rf_finanzas_resultados', { p_desde: desde, p_hasta: hoy })
      .single()
    const { data: resSinRaw, error: resSinErr } = await sinCostos
      .rpc('rf_finanzas_resultados', { p_desde: desde, p_hasta: hoy })
      .single()
    expect(resSinErr).toBeNull()
    const resAdmin = resAdminRaw as Record<string, unknown>
    const resSin = resSinRaw as Record<string, unknown>
    expect(Number(resSin.ventas_netas)).toBe(Number(resAdmin.ventas_netas))
    expect(resSin.costo_mercaderia).toBeNull()
    expect(resSin.ganancia_sobre_ventas).toBeNull()
    expect(resSin.bajas_inventario).toBeNull()
    expect(resSin.ganancia_despues_de_costos).toBeNull()
    expect(resSin.ganancia_final).toBeNull()

    const { data: flujoAdminRaw } = await t.authAdmin
      .rpc('rf_finanzas_flujo', { p_desde: desde, p_hasta: hoy })
      .single()
    const { data: flujoSinRaw, error: flujoSinErr } = await sinCostos
      .rpc('rf_finanzas_flujo', { p_desde: desde, p_hasta: hoy })
      .single()
    expect(flujoSinErr).toBeNull()
    const flujoAdmin = flujoAdminRaw as Record<string, unknown>
    const flujoSin = flujoSinRaw as Record<string, unknown>
    expect(Number(flujoSin.cobrado)).toBe(Number(flujoAdmin.cobrado))
    expect(flujoSin.compras_mercaderia).toBeNull()
    expect(flujoSin.pagos_proveedores).toBeNull()
    expect(flujoSin.flujo_neto).toBeNull()

    const { data: posSinRaw, error: posSinErr } = await sinCostos
      .rpc('rf_finanzas_posicion')
      .single()
    expect(posSinErr).toBeNull()
    const posSin = posSinRaw as Record<string, unknown>
    expect(posSin.capital_propio).toBeNull()
    expect(posSin.mercaderia_terceros).toBeNull()
    expect(posSin.devueltos_clientes).toBeNull()
    expect(posSin.deuda_proveedores).toBeNull()

    const { data: rankSin, error: rankSinErr } = await sinCostos.rpc(
      'rf_finanzas_ranking_productos',
      { p_desde: desde, p_hasta: hoy, p_limite: 10, p_orden: 'ganancia' },
    )
    expect(rankSinErr).toBeNull()
    expect(rankSin?.length).toBeGreaterThan(0)
    expect(rankSin![0].ganancia).toBeNull()

    const { data: serieSin, error: serieSinErr } = await sinCostos.rpc(
      'rf_finanzas_serie_mensual',
      { p_hasta: hoy, p_meses: 1 },
    )
    expect(serieSinErr).toBeNull()
    expect(serieSin![0].ganancia_sobre_ventas).toBeNull()
    expect(serieSin![0].ganancia_final).toBeNull()

    const { data: incSin, error: incSinErr } = await sinCostos.rpc(
      'sp_perdida_incobrable_venta',
      { p_id_venta: idVenta },
    )
    expect(incSinErr).toBeNull()
    expect(incSin.costo_total).toBeNull()
    expect(incSin.costo_no_cubierto).toBeNull()
  })

  it('4. Rol sin ver_costos con inventario.crear confirma ingreso y stock directo sin costo -> hereda costo vigente', async () => {
    const t = await setupBase('seg-herencia')
    const operadora = await createClientWithPermisos(t, 'operadora-ingreso', {
      inventario: ['ver', 'crear'],
    })

    // Stock directo sin costo
    const { error: sdErr } = await operadora.rpc('sp_crear_stock_directo', {
      p_id_producto: t.idProd,
      p_costo: null,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: 'S', cantidad: 1 }],
    })
    expect(sdErr).toBeNull()

    // Ingreso sin costo
    const { data: ing } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()
    await serviceRole.from('ingreso_mercaderia_detalle').insert({
      id_tenant: t.tenantId,
      id_ingreso: ing!.id_ingreso,
      id_producto: t.idProd,
      cantidad: 1,
      costo_unitario: null,
      talle: 'L',
    })

    const { error: confErr } = await operadora.rpc('sp_confirmar_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
    })
    expect(confErr).toBeNull()

    const { data: items } = await serviceRole
      .from('item_producto')
      .select('costo_ingreso')
      .eq('id_tenant', t.tenantId)
      .eq('id_producto', t.idProd)
    expect(items?.length).toBe(2)
    expect(items?.every((i) => Number(i.costo_ingreso) === 1000)).toBe(true)
  })

  it('5. fn_sellar_costo_herencia_items no pisa ítems que ya tienen costo', async () => {
    const t = await setupBase('seg-no-pisa')
    const operadora = await createClientWithPermisos(t, 'operadora-sellador', {
      inventario: ['crear'],
    })

    const { error: sdErr } = await t.authAdmin.rpc('sp_crear_stock_directo', {
      p_id_producto: t.idProd,
      p_costo: 777,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: 'M', cantidad: 1 }],
    })
    expect(sdErr).toBeNull()

    // Cambiar costo vigente a 2000
    await t.authAdmin.rpc('sp_set_costo_producto', {
      p_id_producto: t.idProd,
      p_costo: 2000,
      p_moneda: 'ARS',
    })

    const { data: items } = await serviceRole
      .from('item_producto')
      .select('id_item, costo_ingreso')
      .eq('id_tenant', t.tenantId)
      .eq('id_producto', t.idProd)
    // sp_set_costo_producto sincronizó a 2000; bajamos manualmente el costo del ítem a 777 para probar no-sobrescritura
    await serviceRole
      .from('item_producto')
      .update({ costo_ingreso: 777 })
      .eq('id_item', items![0].id_item)

    const { error: sellErr } = await operadora.rpc('fn_sellar_costo_herencia_items', {
      p_id_producto: t.idProd,
      p_ids_items: [items![0].id_item],
    })
    expect(sellErr).toBeNull()

    const { data: after } = await serviceRole
      .from('item_producto')
      .select('costo_ingreso')
      .eq('id_item', items![0].id_item)
      .single()
    expect(Number(after?.costo_ingreso)).toBe(777)
  })

  it('6. Vendedora vende en mostrador con descuento -> precio final intacto', async () => {
    const t = await setupBase('seg-venta-desc')
    const { data: idDescuento, error: descErr } = await t.authAdmin.rpc('sp_create_regla_precio', {
      p_nombre: 'Descuento 10%',
      p_tipo_regla: 'descuento',
      p_tipo_valor: 'porcentaje',
      p_valor: 0.1,
      p_alcance: 'global',
    })
    await t.authAdmin.rpc('sp_crear_stock_directo', {
      p_id_producto: t.idProd,
      p_costo: 1000,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: 'M', cantidad: 1 }],
    })
    const { data: items } = await serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_tenant', t.tenantId)
      .eq('id_producto', t.idProd)

    const vendedora = await createClientWithPermisos(t, 'vendedora-mostrador', {
      ventas: ['crear', 'editar'],
      precios: ['ver'],
      inventario: ['ver', 'crear', 'editar'],
    })

    expect(descErr).toBeNull()
    const { data: idVenta, error: vErr } = await vendedora.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: items![0].id_item, descuentos: [idDescuento] }],
      p_forma_pago: 'efectivo',
      p_pagos: [{ medio: 'efectivo', id_cuenta_destino: t.idCuenta, monto: 1350 }],
    })
    expect(vErr).toBeNull()

    const { data: venta } = await serviceRole
      .from('venta')
      .select('total')
      .eq('id_venta', idVenta)
      .single()
    expect(Number(venta?.total)).toBe(1350)
  })

  it('7. (4.3) Rol con editar_cotizacion sin ver_costos llama sp_aplicar_ultimo_costo -> 42501 y no duplica vigentes', async () => {
    const t = await setupBase('seg-ultimo-costo')
    const sinVerCostos = await createClientWithPermisos(t, 'cotiz-sin-ver', {
      precios: ['editar_cotizacion'],
    })

    const { error } = await sinVerCostos.rpc('sp_aplicar_ultimo_costo', {
      p_id_producto: t.idProd,
      p_costo: 1500,
      p_moneda: 'ARS',
    })
    expect(error?.code).toBe('42501')

    const { data: vigentes } = await serviceRole
      .from('costo_producto')
      .select('id_costo')
      .eq('id_tenant', t.tenantId)
      .eq('id_producto', t.idProd)
      .is('vigente_hasta', null)
    expect(vigentes?.length).toBe(1)
  })

  it('8. (D-CPC-09) regla_precio y rendicion_proveedor exigen poder ver para escribir', async () => {
    const t = await setupBase('seg-dcpc09')

    // 8a. precios.crear sin ver_margenes -> margen falla 42501, descuento ok
    const soloCrearRegla = await createClientWithPermisos(t, 'regla-sin-margen', {
      precios: ['ver', 'crear'],
    })
    const { error: errMargen } = await soloCrearRegla.rpc('sp_create_regla_precio', {
      p_nombre: 'Margen Bloqueado',
      p_tipo_regla: 'margen',
      p_tipo_valor: 'porcentaje',
      p_valor: 0.4,
      p_alcance: 'global',
    })
    expect(errMargen?.code).toBe('42501')

    const { data: margenRows } = await serviceRole
      .from('regla_precio')
      .select('id_regla')
      .eq('id_tenant', t.tenantId)
      .eq('nombre', 'Margen Bloqueado')
    expect(margenRows).toEqual([])

    const { error: errDesc } = await soloCrearRegla.rpc('sp_create_regla_precio', {
      p_nombre: 'Descuento Permitido',
      p_tipo_regla: 'descuento',
      p_tipo_valor: 'porcentaje',
      p_valor: 0.1,
      p_alcance: 'global',
    })
    expect(errDesc).toBeNull()

    // 8b. precios.crear + ver_margenes -> margen ok
    const conMargen = await createClientWithPermisos(t, 'regla-con-margen', {
      precios: ['ver', 'crear', 'ver_margenes'],
    })
    const { error: errMargenOk } = await conMargen.rpc('sp_create_regla_precio', {
      p_nombre: 'Margen Permitido',
      p_tipo_regla: 'margen',
      p_tipo_valor: 'porcentaje',
      p_valor: 0.4,
      p_alcance: 'global',
    })
    expect(errMargenOk).toBeNull()

    // Preparar línea vendida en consignación para rendición
    await t.authAdmin.rpc('sp_crear_stock_directo', {
      p_id_producto: t.idProd,
      p_costo: 1000,
      p_tipo_ingreso: 'consignacion',
      p_items: [{ talle: 'M', cantidad: 1 }],
    })
    const { data: consItems } = await serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_tenant', t.tenantId)
      .eq('tipo_ingreso', 'consignacion')
    // La venta toma el proveedor del ingreso del ítem: el stock directo no tiene,
    // así que se cuelga de un ingreso de consignación (como rls-por-permiso.test.ts).
    const ingCons = unwrapFixture(
      'ingreso consignacion insert',
      await serviceRole
        .from('ingreso_mercaderia')
        .insert({
          id_tenant: t.tenantId,
          id_proveedor: t.idProveedor,
          tipo_ingreso: 'consignacion',
          confirmado: true,
        })
        .select('id_ingreso')
        .single(),
    )
    const { error: linkErr } = await serviceRole
      .from('item_producto')
      .update({ id_ingreso: ingCons.id_ingreso })
      .eq('id_item', consItems![0].id_item)
    expect(linkErr).toBeNull()
    const { error: ventaConsErr } = await t.authAdmin.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: consItems![0].id_item, descuentos: [] }],
      p_forma_pago: 'efectivo',
      p_pagos: [{ medio: 'efectivo', id_cuenta_destino: t.idCuenta, monto: 1500 }],
    })
    expect(ventaConsErr).toBeNull()

    // 8c. rendiciones.crear sin rendiciones.ver -> 42501 y no queda fila
    const soloCrearRend = await createClientWithPermisos(t, 'rend-solo-crear', {
      rendiciones: ['crear'],
    })
    const { error: errGenSinVer } = await soloCrearRend.rpc('sp_generar_rendicion', {
      p_id_proveedor: t.idProveedor,
    })
    expect(errGenSinVer?.code).toBe('42501')

    const { data: rendsDesp } = await serviceRole
      .from('rendicion_proveedor')
      .select('id_rendicion')
      .eq('id_tenant', t.tenantId)
    expect(rendsDesp).toEqual([])

    // Con las dos -> ok
    const crearYVerRend = await createClientWithPermisos(t, 'rend-crear-ver', {
      rendiciones: ['ver', 'crear'],
    })
    const { data: idRend, error: errGenOk } = await crearYVerRend.rpc('sp_generar_rendicion', {
      p_id_proveedor: t.idProveedor,
    })
    expect(errGenOk).toBeNull()
    expect(idRend).toBeTruthy()

    // 8d. rendiciones.editar sin rendiciones.ver -> 42501; con las dos -> ok
    const soloEditRend = await createClientWithPermisos(t, 'rend-solo-edit', {
      rendiciones: ['editar'],
    })
    const { error: errPagSinVer } = await soloEditRend.rpc('sp_marcar_rendicion_pagada', {
      p_id_rendicion: idRend,
    })
    expect(errPagSinVer?.code).toBe('42501')

    const editYVerRend = await createClientWithPermisos(t, 'rend-edit-ver', {
      rendiciones: ['ver', 'editar'],
    })
    const { error: errPagOk } = await editYVerRend.rpc('sp_marcar_rendicion_pagada', {
      p_id_rendicion: idRend,
    })
    expect(errPagOk).toBeNull()
  })
})
