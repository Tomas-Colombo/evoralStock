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
import { habilitarPaqueteConsignacion } from './_fixtures-ventas'

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
      talle: 'L',
    })

    const { error: confErr } = await operadora.rpc('sp_confirmar_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
    })
    expect(confErr).toBeNull()

    const { data: items } = await serviceRole
      .from('item_producto')
      .select('id_item, item_costo(costo_ingreso)')
      .eq('id_tenant', t.tenantId)
      .eq('id_producto', t.idProd)
    expect(items?.length).toBe(2)
    expect(
      items?.every((i) => {
        const ic = Array.isArray(i.item_costo) ? i.item_costo[0] : i.item_costo
        return Number((ic as { costo_ingreso?: number } | null)?.costo_ingreso) === 1000
      }),
    ).toBe(true)
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
      .select('id_item')
      .eq('id_tenant', t.tenantId)
      .eq('id_producto', t.idProd)
    // sp_set_costo_producto sincronizó a 2000; bajamos manualmente el costo del ítem a 777 para probar no-sobrescritura
    await serviceRole
      .from('item_costo')
      .update({ costo_ingreso: 777 })
      .eq('id_item', items![0].id_item)

    const { error: sellErr } = await operadora.rpc('fn_sellar_costo_herencia_items', {
      p_id_producto: t.idProd,
      p_ids_items: [items![0].id_item],
    })
    expect(sellErr).toBeNull()

    const { data: after } = await serviceRole
      .from('item_costo')
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

describe.skipIf(!hasTestDb)('CPC Fase 3E.2 — satélites item_costo, detalle_venta_costo, detalle_venta_rendicion y devolucion_venta_costo', () => {
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

  async function setupSatelites(prefix: string) {
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

    await habilitarPaqueteConsignacion(fixture.tenantId)

    const proveedor = unwrapFixture(
      'proveedor insert',
      await serviceRole
        .from('proveedor')
        .insert({
          id_tenant: fixture.tenantId,
          nombre: 'Proveedor Consig 3E2',
          tipo: 'consignatario',
        })
        .select('id_proveedor')
        .single(),
    )

    const { data: idProd, error: prodErr } = await authAdmin.rpc('sp_create_producto', {
      p_id_categoria: categoria.id_categoria,
      p_nombre: 'Pantalón 3E2',
      p_sku: `SKU-3E2-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    })
    expect(prodErr).toBeNull()

    const { error: costoErr } = await authAdmin.rpc('sp_set_costo_producto', {
      p_id_producto: idProd,
      p_costo: 1000,
      p_moneda: 'ARS',
    })
    expect(costoErr).toBeNull()

    const { error: reglaErr } = await authAdmin.rpc('sp_create_regla_precio', {
      p_nombre: 'Margen 50%',
      p_tipo_regla: 'margen',
      p_tipo_valor: 'porcentaje',
      p_valor: 0.5,
      p_alcance: 'global',
    })
    expect(reglaErr).toBeNull()

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

  it('1. Rol sin ver_costos (Vendedora-Local) consulta las 4 satélites por PostgREST -> 0 filas', async () => {
    const t = await setupSatelites('3e2-postgrest')

    const { error: stockErr } = await t.authAdmin.rpc('sp_crear_stock_directo', {
      p_id_producto: t.idProd,
      p_costo: 1000,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: 'M', cantidad: 1 }],
    })
    expect(stockErr).toBeNull()

    const { data: items, error: itErr } = await serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_tenant', t.tenantId)
    expect(itErr).toBeNull()

    const { data: idVenta, error: vErr } = await t.authAdmin.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: items![0].id_item, descuentos: [] }],
      p_forma_pago: 'efectivo',
      p_pagos: [{ id_cuenta_destino: t.idCuenta, medio: 'efectivo', monto: 1500 }],
    })
    expect(vErr).toBeNull()

    const { data: det, error: detErr } = await serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single()
    expect(detErr).toBeNull()

    const { error: devErr } = await t.authAdmin.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: det!.id_detalle_venta,
      p_motivo: 'test',
      p_id_cuenta_reintegro: t.idCuenta,
      p_medio_reintegro: 'efectivo',
    })
    expect(devErr).toBeNull()

    const vendedora = await createClientWithPermisos(t, 'vendedora-3e2', {
      ventas: ['crear', 'editar'],
      precios: ['ver'],
      inventario: ['ver', 'crear', 'editar'],
    })

    const { data: ic } = await vendedora.from('item_costo').select('id_item')
    expect(ic).toEqual([])
    const { data: dvc } = await vendedora.from('detalle_venta_costo').select('id_detalle_venta')
    expect(dvc).toEqual([])
    const { data: dvr } = await vendedora.from('detalle_venta_rendicion').select('id_detalle_venta')
    expect(dvr).toEqual([])
    const { data: devc } = await vendedora.from('devolucion_venta_costo').select('id_devolucion')
    expect(devc).toEqual([])
  })

  it('2. Rol sin ver_costos confirma ingreso sin costo -> item_costo sellada; sellador no pisa costo previo', async () => {
    const t = await setupSatelites('3e2-herencia')
    const operadora = await createClientWithPermisos(t, 'operadora-3e2', {
      inventario: ['ver', 'crear'],
    })

    const { data: ing, error: ingErr } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()
    expect(ingErr).toBeNull()

    const { error: detErr } = await serviceRole.from('ingreso_mercaderia_detalle').insert({
      id_tenant: t.tenantId,
      id_ingreso: ing!.id_ingreso,
      id_producto: t.idProd,
      cantidad: 1,
      talle: 'M',
    })
    expect(detErr).toBeNull()

    const { error: confErr } = await operadora.rpc('sp_confirmar_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
    })
    expect(confErr).toBeNull()

    const { data: icRows, error: icErr } = await serviceRole
      .from('item_costo')
      .select('id_item, costo_ingreso')
      .eq('id_tenant', t.tenantId)
    expect(icErr).toBeNull()
    expect(icRows?.length).toBe(1)
    expect(Number(icRows![0].costo_ingreso)).toBe(1000)

    // Cambiar costo vigente a 2500 y llamar sellador sobre el ítem ya costeado -> no pisa
    const { error: c2Err } = await t.authAdmin.rpc('sp_set_costo_producto', {
      p_id_producto: t.idProd,
      p_costo: 2500,
      p_moneda: 'ARS',
    })
    expect(c2Err).toBeNull()

    const { error: upErr } = await serviceRole
      .from('item_costo')
      .update({ costo_ingreso: 1000 })
      .eq('id_item', icRows![0].id_item)
    expect(upErr).toBeNull()

    const { error: sellErr } = await operadora.rpc('fn_sellar_costo_herencia_items', {
      p_id_producto: t.idProd,
      p_ids_items: [icRows![0].id_item],
    })
    expect(sellErr).toBeNull()

    const { data: after } = await serviceRole
      .from('item_costo')
      .select('costo_ingreso')
      .eq('id_item', icRows![0].id_item)
      .single()
    expect(Number(after?.costo_ingreso)).toBe(1000)
  })

  it('3. Rol sin ver_costos vende y cambia ítem con item_costo -> éxito y sella satélites', async () => {
    const t = await setupSatelites('3e2-venta-cambio')

    const { error: stockErr } = await t.authAdmin.rpc('sp_crear_stock_directo', {
      p_id_producto: t.idProd,
      p_costo: 1000,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: 'M', cantidad: 2 }],
    })
    expect(stockErr).toBeNull()

    const { data: items, error: itErr } = await serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_tenant', t.tenantId)
    expect(itErr).toBeNull()
    expect(items?.length).toBe(2)

    const vendedora = await createClientWithPermisos(t, 'vendedora-vc', {
      ventas: ['crear', 'editar'],
      precios: ['ver'],
      inventario: ['ver', 'crear', 'editar'],
    })

    const { data: idVenta, error: vErr } = await vendedora.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: items![0].id_item, descuentos: [] }],
      p_forma_pago: 'efectivo',
      p_pagos: [{ id_cuenta_destino: t.idCuenta, medio: 'efectivo', monto: 1500 }],
    })
    expect(vErr).toBeNull()

    const { data: detOrig, error: detErr } = await serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single()
    expect(detErr).toBeNull()

    const { data: dvcOrig } = await serviceRole
      .from('detalle_venta_costo')
      .select('costo_snapshot, monto_ganancia')
      .eq('id_detalle_venta', detOrig!.id_detalle_venta)
      .single()
    expect(Number(dvcOrig?.costo_snapshot)).toBe(1000)
    expect(Number(dvcOrig?.monto_ganancia)).toBe(500)

    const { data: dvrOrig } = await serviceRole
      .from('detalle_venta_rendicion')
      .select('monto_proveedor')
      .eq('id_detalle_venta', detOrig!.id_detalle_venta)
      .single()
    expect(Number(dvrOrig?.monto_proveedor)).toBe(0)

    const { data: cambioRes, error: cErr } = await vendedora.rpc('sp_registrar_cambio', {
      p_id_detalle_original: detOrig!.id_detalle_venta,
      p_id_item_entregado: items![1].id_item,
      p_motivo: 'talle',
    })
    expect(cErr).toBeNull()
    const idDetNuevo = (cambioRes as { id_detalle_nuevo: string }).id_detalle_nuevo

    const { data: dvcNuevo } = await serviceRole
      .from('detalle_venta_costo')
      .select('costo_snapshot, monto_ganancia')
      .eq('id_detalle_venta', idDetNuevo)
      .single()
    expect(Number(dvcNuevo?.costo_snapshot)).toBe(1000)
    expect(Number(dvcNuevo?.monto_ganancia)).toBe(500)
  })

  it('4. Rol sin ver_costos intenta vender o cambiar ítem sin item_costo -> item-costo-pendiente (P0001) y rollback', async () => {
    const t = await setupSatelites('3e2-pendiente')

    // Producto nuevo sin costo vigente
    const { data: idProdSinCosto, error: p2Err } = await t.authAdmin.rpc('sp_create_producto', {
      p_id_categoria: t.idCategoria,
      p_nombre: 'Remera Sin Costo',
      p_sku: `SKU-SC-${Date.now()}`,
    })
    expect(p2Err).toBeNull()

    const { error: sdErr } = await t.authAdmin.rpc('sp_crear_stock_directo', {
      p_id_producto: idProdSinCosto,
      p_costo: null,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: 'S', cantidad: 1 }],
    })
    expect(sdErr).toBeNull()

    // Fijar precio de venta directo para que no falle precio-no-resoluble antes del sellador
    const { error: upProdErr } = await serviceRole
      .from('producto')
      .update({ precio_venta: 1500 })
      .eq('id_producto', idProdSinCosto)
    expect(upProdErr).toBeNull()

    const { data: itemsSinCosto } = await serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_producto', idProdSinCosto)

    const vendedora = await createClientWithPermisos(t, 'vendedora-pend', {
      ventas: ['crear', 'editar'],
      precios: ['ver'],
      inventario: ['ver', 'crear', 'editar'],
    })

    const { error: vErr } = await vendedora.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: itemsSinCosto![0].id_item, descuentos: [] }],
      p_forma_pago: 'efectivo',
      p_pagos: [{ id_cuenta_destino: t.idCuenta, medio: 'efectivo', monto: 1500 }],
    })
    expect(vErr?.code).toBe('P0001')
    expect(vErr?.message).toMatch(/item-costo-pendiente/)

    // Rollback total: no quedó venta ni cambio
    const { data: ventasDesp } = await serviceRole
      .from('venta')
      .select('id_venta')
      .eq('id_tenant', t.tenantId)
    expect(ventasDesp).toEqual([])

    // También probar cambio a ítem sin item_costo
    const { error: sdConErr } = await t.authAdmin.rpc('sp_crear_stock_directo', {
      p_id_producto: t.idProd,
      p_costo: 1000,
      p_tipo_ingreso: 'compra',
      p_items: [{ talle: 'M', cantidad: 1 }],
    })
    expect(sdConErr).toBeNull()
    const { data: itemsConCosto } = await serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_producto', t.idProd)

    const { data: idVentaOk, error: vOkErr } = await vendedora.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: itemsConCosto![0].id_item, descuentos: [] }],
      p_forma_pago: 'efectivo',
      p_pagos: [{ id_cuenta_destino: t.idCuenta, medio: 'efectivo', monto: 1500 }],
    })
    expect(vOkErr).toBeNull()

    const { data: detOk } = await serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVentaOk)
      .single()

    const { error: cErr } = await vendedora.rpc('sp_registrar_cambio', {
      p_id_detalle_original: detOk!.id_detalle_venta,
      p_id_item_entregado: itemsSinCosto![0].id_item,
      p_motivo: 'cambio',
    })
    expect(cErr?.code).toBe('P0001')
    expect(cErr?.message).toMatch(/item-costo-pendiente/)

    const { data: cambios } = await serviceRole
      .from('cambio_venta')
      .select('id_cambio')
      .eq('id_tenant', t.tenantId)
    expect(cambios).toEqual([])
  })

  it('5. Rol con rendiciones.ver sin ver_costos lee detalle_venta_rendicion y preview_rendicion, pero 0 filas en detalle_venta_costo', async () => {
    const t = await setupSatelites('3e2-rend-ver')

    const { data: ing, error: ingErr } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({
        id_tenant: t.tenantId,
        id_proveedor: t.idProveedor,
        tipo_ingreso: 'consignacion',
        confirmado: false,
      })
      .select('id_ingreso')
      .single()
    expect(ingErr).toBeNull()

    const { data: detIng, error: detIngErr } = await serviceRole
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: t.tenantId,
        id_ingreso: ing!.id_ingreso,
        id_producto: t.idProd,
        cantidad: 1,
        talle: 'M',
      })
      .select('id_detalle')
      .single()
    expect(detIngErr).toBeNull()

    const { error: detCostoErr } = await serviceRole
      .from('ingreso_detalle_costo')
      .insert({
        id_detalle: detIng!.id_detalle,
        id_tenant: t.tenantId,
        costo_unitario: 1000,
      })
    expect(detCostoErr).toBeNull()

    const { error: confErr } = await t.authAdmin.rpc('sp_confirmar_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
    })
    expect(confErr).toBeNull()

    const { data: items } = await serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_tenant', t.tenantId)

    const { error: vErr } = await t.authAdmin.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: items![0].id_item, descuentos: [] }],
      p_forma_pago: 'efectivo',
      p_pagos: [{ id_cuenta_destino: t.idCuenta, medio: 'efectivo', monto: 1500 }],
    })
    expect(vErr).toBeNull()

    const rendicionesUser = await createClientWithPermisos(t, 'rend-sin-costos', {
      rendiciones: ['ver', 'crear'],
    })

    const { data: dvr } = await rendicionesUser
      .from('detalle_venta_rendicion')
      .select('monto_proveedor')
    expect(dvr?.length).toBe(1)
    expect(Number(dvr![0].monto_proveedor)).toBe(1000)

    const { data: prev, error: prevErr } = await rendicionesUser.rpc('preview_rendicion', {
      p_id_proveedor: t.idProveedor,
    })
    expect(prevErr).toBeNull()
    expect(prev?.length).toBe(1)
    expect(Number(prev![0].monto_proveedor)).toBe(1000)

    const { data: dvc } = await rendicionesUser
      .from('detalle_venta_costo')
      .select('id_detalle_venta')
    expect(dvc).toEqual([])

    // Generar rendición desde detalle_venta_rendicion
    const { data: idRend, error: genErr } = await rendicionesUser.rpc('sp_generar_rendicion', {
      p_id_proveedor: t.idProveedor,
    })
    expect(genErr).toBeNull()
    const { data: rend } = await serviceRole
      .from('rendicion_proveedor')
      .select('monto_total')
      .eq('id_rendicion', idRend)
      .single()
    expect(Number(rend?.monto_total)).toBe(1000)
  })

  it('6. Rol con ver_costos ve las 4 satélites completas y devolución sin ver_costos sella devolucion_venta_costo', async () => {
    const t = await setupSatelites('3e2-devolucion')

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

    const vendedora = await createClientWithPermisos(t, 'vendedora-dev', {
      ventas: ['crear', 'editar'],
      precios: ['ver'],
      inventario: ['ver'],
    })

    const { data: idVenta, error: vErr } = await vendedora.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: items![0].id_item, descuentos: [] }],
      p_forma_pago: 'efectivo',
      p_pagos: [{ id_cuenta_destino: t.idCuenta, medio: 'efectivo', monto: 1500 }],
    })
    expect(vErr).toBeNull()

    const { data: det } = await serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single()

    const { error: devErr } = await vendedora.rpc('sp_registrar_devolucion_cliente', {
      p_id_detalle_venta: det!.id_detalle_venta,
      p_motivo: 'devolucion sin ver_costos',
      p_id_cuenta_reintegro: t.idCuenta,
      p_medio_reintegro: 'efectivo',
    })
    expect(devErr).toBeNull()

    // Admin con ver_costos ve las 4 satélites
    const { data: ic } = await t.authAdmin.from('item_costo').select('costo_ingreso')
    expect(ic?.length).toBe(1)
    const { data: dvc } = await t.authAdmin.from('detalle_venta_costo').select('costo_snapshot')
    expect(dvc?.length).toBe(1)
    const { data: dvr } = await t.authAdmin.from('detalle_venta_rendicion').select('monto_proveedor')
    expect(dvr?.length).toBe(1)
    const { data: devc } = await t.authAdmin.from('devolucion_venta_costo').select('costo_recuperado')
    expect(devc?.length).toBe(1)
    expect(Number(devc![0].costo_recuperado)).toBe(Number(dvc![0].costo_snapshot))

    // Verificación de conteos (consistencia tipo backfill)
    const { count: cntDv } = await serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta', { count: 'exact', head: true })
      .eq('id_tenant', t.tenantId)
    const { count: cntDvc } = await serviceRole
      .from('detalle_venta_costo')
      .select('id_detalle_venta', { count: 'exact', head: true })
      .eq('id_tenant', t.tenantId)
    const { count: cntDvr } = await serviceRole
      .from('detalle_venta_rendicion')
      .select('id_detalle_venta', { count: 'exact', head: true })
      .eq('id_tenant', t.tenantId)
    expect(cntDvc).toBe(cntDv)
    expect(cntDvr).toBe(cntDv)
  })

  it('7. Rol con revendedoras.crear y sin ventas.crear llama a fn_sellar_costo_cambio por RPC -> 42501', async () => {
    const fixture = await createTenantWithUser(withScopedTenant('CpcSellCambioPerm'))
    const authRevSinVentas = await createClientWithPermisos(fixture, 'SoloRev', {
      revendedoras: ['crear'],
    })

    const { error } = await authRevSinVentas.rpc('fn_sellar_costo_cambio', {
      p_id_detalle_venta: '00000000-0000-0000-0000-000000000000',
    })

    expect(error).toBeDefined()
    expect(error?.code).toBe('42501')
    expect(error?.message).toMatch(/no-permission/)
  })
})

describe.skipIf(!hasTestDb)('CPC Fase 3E.3 — satélite ingreso_detalle_costo', () => {
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

  async function setup3E3(prefix: string) {
    const fixture = await createTenantWithUser(withScopedTenant(prefix))
    const authAdmin = await signInAs(fixture)

    const categoria = unwrapFixture(
      'categoria insert',
      await serviceRole
        .from('categoria')
        .insert({ id_tenant: fixture.tenantId, nombre: 'Indumentaria 3E3' })
        .select('id_categoria')
        .single(),
    )

    const producto = unwrapFixture(
      'producto insert',
      await serviceRole
        .from('producto')
        .insert({
          id_tenant: fixture.tenantId,
          id_categoria: categoria.id_categoria,
          nombre: 'Remera 3E3',
          sku: `R3E3-${Date.now().toString().slice(-4)}`,
          precio_venta: 2000,
        })
        .select('id_producto')
        .single(),
    )

    return {
      ...fixture,
      authAdmin,
      idCat: categoria.id_categoria,
      idProd: producto.id_producto,
    }
  }

  it('1. Rol sin ver_costos consulta ingreso_detalle_costo por PostgREST -> 0 filas', async () => {
    const t = await setup3E3('3e3-r1')
    const operadora = await createClientWithPermisos(t, 'operadora-sin-ver-costos', {
      inventario: ['ver', 'crear'],
    })

    const { data: ing } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    const { data: det } = await serviceRole
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: t.tenantId,
        id_ingreso: ing!.id_ingreso,
        id_producto: t.idProd,
        cantidad: 2,
        talle: 'M',
      })
      .select('id_detalle')
      .single()

    await serviceRole.from('ingreso_detalle_costo').insert({
      id_detalle: det!.id_detalle,
      id_tenant: t.tenantId,
      costo_unitario: 1200,
    })

    // Rol sin ver_costos consulta ingreso_detalle_costo -> 0 filas
    const { data: idc, error } = await operadora.from('ingreso_detalle_costo').select('*')
    expect(error).toBeNull()
    expect(idc).toEqual([])
  })

  it('2. Rol sin cargar_costos importa remito con costo -> 42501; sin costo -> éxito', async () => {
    const t = await setup3E3('3e3-r2')
    const operadora = await createClientWithPermisos(t, 'operadora-sin-cargar-costos', {
      inventario: ['ver', 'crear'],
    })

    const { data: ing } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    // 2.a: Con costo -> 42501
    const { error: errConCosto } = await operadora.rpc('sp_importar_remito', {
      p_id_ingreso: ing!.id_ingreso,
      p_lineas: [
        {
          esNuevo: false,
          idProducto: t.idProd,
          nombre: 'Remera 3E3',
          costoUnitario: 1500,
          partes: [{ talle: 'L', cantidad: 3 }],
        },
      ],
    })
    expect(errConCosto).not.toBeNull()
    expect(errConCosto?.code).toBe('42501')

    // 2.b: Sin costo -> éxito
    const { data: resSinCosto, error: errSinCosto } = await operadora.rpc('sp_importar_remito', {
      p_id_ingreso: ing!.id_ingreso,
      p_lineas: [
        {
          esNuevo: false,
          idProducto: t.idProd,
          nombre: 'Remera 3E3',
          costoUnitario: null,
          partes: [{ talle: 'L', cantidad: 3 }],
        },
      ],
    })
    expect(errSinCosto).toBeNull()
    expect(resSinCosto).toBeDefined()
  })

  it('3. Administrador lee ingreso_detalle_costo normalmente', async () => {
    const t = await setup3E3('3e3-r3')

    const { data: ing } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    const { data: det } = await serviceRole
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: t.tenantId,
        id_ingreso: ing!.id_ingreso,
        id_producto: t.idProd,
        cantidad: 5,
        talle: 'S',
      })
      .select('id_detalle')
      .single()

    await serviceRole.from('ingreso_detalle_costo').insert({
      id_detalle: det!.id_detalle,
      id_tenant: t.tenantId,
      costo_unitario: 1750,
      costo_original_usd: 1.75,
      cotizacion_aplicada: 1000,
      cotizacion_fecha_valor: '2026-11-12',
    })

    const { data: idc, error } = await t.authAdmin
      .from('ingreso_detalle_costo')
      .select('costo_unitario, costo_original_usd, cotizacion_aplicada, cotizacion_fecha_valor')
      .eq('id_detalle', det!.id_detalle)
      .single()

    expect(error).toBeNull()
    expect(Number(idc!.costo_unitario)).toBe(1750)
    expect(Number(idc!.costo_original_usd)).toBe(1.75)
    expect(Number(idc!.cotizacion_aplicada)).toBe(1000)
    expect(idc!.cotizacion_fecha_valor).toBe('2026-11-12')
  })

  it('4. Rol con inventario.crear sin ver_costos confirma un ingreso con costo -> ítem queda con fila en item_costo', async () => {
    const t = await setup3E3('3e3-r4')
    const operadora = await createClientWithPermisos(t, 'operadora-confirma-con-costo', {
      inventario: ['ver', 'crear'],
    })

    // Remito cargado por Admin con costo
    const { data: ing } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    const { data: det } = await serviceRole
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: t.tenantId,
        id_ingreso: ing!.id_ingreso,
        id_producto: t.idProd,
        cantidad: 2,
        talle: 'XL',
      })
      .select('id_detalle')
      .single()

    await serviceRole.from('ingreso_detalle_costo').insert({
      id_detalle: det!.id_detalle,
      id_tenant: t.tenantId,
      costo_unitario: 3400,
    })

    // Operadora (sin ver_costos / sin cargar_costos) confirma el remito
    const { error: confErr } = await operadora.rpc('sp_confirmar_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
    })
    expect(confErr).toBeNull()

    // Los ítems generados quedaron con su fila en item_costo sellada con costo_ingreso = 3400
    const { data: items } = await serviceRole
      .from('item_producto')
      .select('id_item, item_costo(costo_ingreso)')
      .eq('id_ingreso', ing!.id_ingreso)

    expect(items).toHaveLength(2)
    for (const item of items!) {
      const ic = Array.isArray(item.item_costo) ? item.item_costo[0] : item.item_costo
      expect(Number((ic as { costo_ingreso: number }).costo_ingreso)).toBe(3400)
    }
  })
})
