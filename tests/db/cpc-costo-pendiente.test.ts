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

describe.skipIf(!hasTestDb)('CPC Fase 3C.1 — costo pendiente en SQL (REQ-CPC-04, D-CPC-01, D-CPC-03)', () => {
  const serviceRole = createServiceRoleTestClient()

  async function setupFixture(prefix: string) {
    const fixture = await createTenantWithUser(withScopedTenant(prefix))
    const authAdmin = await signInAs(fixture)

    // Cuenta de cobro predeterminada para que sp_registrar_venta funcione con p_pagos null
    unwrapFixture(
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

    // Categoría de prueba
    const categoria = unwrapFixture(
      'categoria insert',
      await serviceRole
        .from('categoria')
        .insert({
          id_tenant: fixture.tenantId,
          nombre: 'Indumentaria',
        })
        .select('id_categoria')
        .single(),
    )

    // Regla de margen para calcular precio de venta
    const { error: errRegla } = await authAdmin.rpc('sp_create_regla_precio', {
      p_nombre: 'Margen 50%',
      p_tipo_regla: 'margen',
      p_tipo_valor: 'porcentaje',
      p_valor: 0.5,
      p_alcance: 'global',
    })
    expect(errRegla).toBeNull()

    return {
      ...fixture,
      authAdmin,
      idCategoria: categoria.id_categoria,
    }
  }

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

  function costoDe(row: { item_costo?: unknown } | null | undefined): number | null {
    const ic = Array.isArray(row?.item_costo) ? row?.item_costo[0] : row?.item_costo
    const raw = (ic as { costo_ingreso?: number | string | null } | null | undefined)?.costo_ingreso
    return raw != null ? Number(raw) : null
  }

  it('1. confirmar un remito con costo (igual que hoy)', async () => {
    const t = await setupFixture('remito-con-costo')

    const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
      p_id_categoria: t.idCategoria,
      p_nombre: 'Remera Azul',
      p_sku: `SKU-${Date.now()}-1`,
    })

    const { data: ing } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    const { data: detIng1 } = await serviceRole
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: t.tenantId,
        id_ingreso: ing!.id_ingreso,
        id_producto: idProd,
        cantidad: 2,
        talle: 'M',
      })
      .select('id_detalle')
      .single()

    await serviceRole.from('ingreso_detalle_costo').insert({
      id_detalle: detIng1!.id_detalle,
      id_tenant: t.tenantId,
      costo_unitario: 1000,
    })

    const { data: count, error: errConf } = await t.authAdmin.rpc('sp_confirmar_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
    })
    expect(errConf).toBeNull()
    expect(count).toBe(2)

    // Items generados tienen costo_ingreso = 1000
    const { data: items } = await serviceRole
      .from('item_producto')
      .select('estado_item, item_costo(costo_ingreso)')
      .eq('id_ingreso', ing!.id_ingreso)

    expect(items).toHaveLength(2)
    expect(items?.every((i) => costoDe(i) === 1000)).toBe(true)

    // costo_producto tiene fila vigente = 1000
    const { data: vigentes } = await serviceRole
      .from('costo_producto')
      .select('costo, vigente_hasta')
      .eq('id_producto', idProd)
      .is('vigente_hasta', null)

    expect(vigentes).toHaveLength(1)
    expect(Number(vigentes![0].costo)).toBe(1000)
  })

  it('2. sin costo y con vigente (hereda; costo_producto no cambia)', async () => {
    const t = await setupFixture('sin-costo-con-vigente')

    const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
      p_id_categoria: t.idCategoria,
      p_nombre: 'Pantalón Negro',
      p_sku: `SKU-${Date.now()}-2`,
    })

    // Seteamos costo vigente inicial = 2000
    await t.authAdmin.rpc('sp_aplicar_ultimo_costo', {
      p_id_producto: idProd,
      p_costo: 2000,
      p_moneda: 'ARS',
    })

    const { data: vigentesAntes } = await serviceRole
      .from('costo_producto')
      .select('id_costo, costo')
      .eq('id_producto', idProd)
      .is('vigente_hasta', null)
    expect(vigentesAntes).toHaveLength(1)
    const idCostoInicial = vigentesAntes![0].id_costo

    // Ingreso sin costo (costo_unitario null)
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
        id_producto: idProd,
        cantidad: 3,
        talle: 'L',
      })
      .select('id_detalle')
      .single()

    const { data: detCostoPre } = await serviceRole
      .from('ingreso_detalle_costo')
      .select('costo_unitario')
      .eq('id_detalle', det!.id_detalle)
      .maybeSingle()
    expect(detCostoPre).toBeNull()

    const { data: count, error: errConf } = await t.authAdmin.rpc('sp_confirmar_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
    })
    expect(errConf).toBeNull()
    expect(count).toBe(3)

    // Items heredaron el costo vigente = 2000
    const { data: items } = await serviceRole
      .from('item_producto')
      .select('id_item, item_costo(costo_ingreso)')
      .eq('id_ingreso', ing!.id_ingreso)

    expect(items).toHaveLength(3)
    expect(items?.every((i) => costoDe(i) === 2000)).toBe(true)

    // La línea del detalle permanece sin fila en el satélite
    const { data: detDespues } = await serviceRole
      .from('ingreso_detalle_costo')
      .select('costo_unitario')
      .eq('id_detalle', det!.id_detalle)
      .maybeSingle()
    expect(detDespues).toBeNull()

    // costo_producto NO cambia (misma fila vigente, no se crearon filas nuevas)
    const { data: vigentesDespues } = await serviceRole
      .from('costo_producto')
      .select('id_costo, costo')
      .eq('id_producto', idProd)
      .is('vigente_hasta', null)

    expect(vigentesDespues).toHaveLength(1)
    expect(vigentesDespues![0].id_costo).toBe(idCostoInicial)
    expect(Number(vigentesDespues![0].costo)).toBe(2000)
  })

  it('3. sin costo y sin vigente (null)', async () => {
    const t = await setupFixture('sin-costo-sin-vigente')

    const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
      p_id_categoria: t.idCategoria,
      p_nombre: 'Campera Verde',
      p_sku: `SKU-${Date.now()}-3`,
    })

    // Ingreso sin costo de un producto sin costo previo
    const { data: ing } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    await serviceRole.from('ingreso_mercaderia_detalle').insert({
      id_tenant: t.tenantId,
      id_ingreso: ing!.id_ingreso,
      id_producto: idProd,
      cantidad: 2,
      talle: 'S',
    })

    const { data: count, error: errConf } = await t.authAdmin.rpc('sp_confirmar_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
    })
    expect(errConf).toBeNull()
    expect(count).toBe(2)

    // Items quedan con costo_ingreso = null
    const { data: items } = await serviceRole
      .from('item_producto')
      .select('id_item, item_costo(costo_ingreso)')
      .eq('id_ingreso', ing!.id_ingreso)

    expect(items).toHaveLength(2)
    expect(items?.every((i) => costoDe(i) === null)).toBe(true)

    // costo_producto sigue sin ninguna fila para este producto
    const { data: costos } = await serviceRole
      .from('costo_producto')
      .select('id_costo')
      .eq('id_producto', idProd)

    expect(costos).toHaveLength(0)
  })

  it('4. vender un pendiente → item-costo-pendiente', async () => {
    const t = await setupFixture('vender-pendiente')

    const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
      p_id_categoria: t.idCategoria,
      p_nombre: 'Buzo Blanco',
      p_sku: `SKU-${Date.now()}-4`,
    })

    // Ingreso sin costo
    const { data: ing } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    await serviceRole.from('ingreso_mercaderia_detalle').insert({
      id_tenant: t.tenantId,
      id_ingreso: ing!.id_ingreso,
      id_producto: idProd,
      cantidad: 1,
      talle: 'M',
    })

    await t.authAdmin.rpc('sp_confirmar_ingreso', { p_id_ingreso: ing!.id_ingreso })

    // Fijar precio de venta para que sp_calcular_precio_venta_snapshot resuelva
    // y no falle con precio-no-resoluble antes de que el sellador evalúe item-costo-pendiente
    await serviceRole
      .from('producto')
      .update({ precio_venta: 1500 })
      .eq('id_producto', idProd)

    const { data: itemPendiente } = await serviceRole
      .from('item_producto')
      .select('id_item, item_costo(costo_ingreso)')
      .eq('id_ingreso', ing!.id_ingreso)
      .single()

    expect(costoDe(itemPendiente)).toBeNull()

    // Intentar registrar venta con ítem con costo pendiente
    const { error: errVenta } = await t.authAdmin.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: itemPendiente!.id_item, descuentos: [] }],
      p_forma_pago: 'efectivo',
    })

    expect(errVenta).not.toBeNull()
    expect(errVenta?.code).toBe('P0001')
    expect(errVenta?.message).toContain('item-costo-pendiente')

    // El ítem no fue vendido y sigue disponible
    const { data: itemVerif } = await serviceRole
      .from('item_producto')
      .select('estado_item')
      .eq('id_item', itemPendiente!.id_item)
      .single()
    expect(itemVerif!.estado_item).toBe('disponible')
  })

  it('5. completar → los ítems no vendidos toman el costo y los vendidos no cambian', async () => {
    const t = await setupFixture('completar-costo')

    const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
      p_id_categoria: t.idCategoria,
      p_nombre: 'Short Deportivo',
      p_sku: `SKU-${Date.now()}-5`,
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
        id_producto: idProd,
        cantidad: 2,
        talle: 'L',
      })
      .select('id_detalle')
      .single()

    await t.authAdmin.rpc('sp_confirmar_ingreso', { p_id_ingreso: ing!.id_ingreso })

    const { data: items } = await serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_ingreso', ing!.id_ingreso)
      .order('id_item')

    expect(items).toHaveLength(2)

    // Simulamos que un ítem ya fue vendido previamente con snapshot de costo 600
    await serviceRole
      .from('item_producto')
      .update({ estado_item: 'vendido' }).eq('id_item', items![0].id_item)
    await serviceRole.from('item_costo').upsert({ id_item: items![0].id_item, id_tenant: t.tenantId, costo_ingreso: 600 })

    // Completar el costo de la línea a 1500
    const { data: actualizados, error: errComp } = await t.authAdmin.rpc('sp_completar_costo_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
      p_lineas: [{ id_detalle: det!.id_detalle, costo_unitario: 1500 }],
    })

    expect(errComp).toBeNull()
    // Solo se actualizó 1 ítem (el que estaba disponible; el vendido no)
    expect(actualizados).toBe(1)

    // Ítem no vendido tomó el costo 1500
    const { data: itemDisponible } = await serviceRole
      .from('item_producto')
      .select('id_item, item_costo(costo_ingreso)')
      .eq('id_item', items![1].id_item)
      .single()
    expect(costoDe(itemDisponible)).toBe(1500)

    // Ítem vendido no cambió (conserva 600)
    const { data: itemVendido } = await serviceRole
      .from('item_producto')
      .select('id_item, item_costo(costo_ingreso)')
      .eq('id_item', items![0].id_item)
      .single()
    expect(costoDe(itemVendido)).toBe(600)

    // La línea del detalle se completó con 1500 en el satélite
    const { data: detFinal } = await serviceRole
      .from('ingreso_detalle_costo')
      .select('costo_unitario')
      .eq('id_detalle', det!.id_detalle)
      .single()
    expect(Number(detFinal!.costo_unitario)).toBe(1500)

    // costo_producto tiene ahora costo vigente = 1500
    const { data: vigentes } = await serviceRole
      .from('costo_producto')
      .select('costo')
      .eq('id_producto', idProd)
      .is('vigente_hasta', null)
    expect(vigentes).toHaveLength(1)
    expect(Number(vigentes![0].costo)).toBe(1500)
  })

  it('6. un rol sin cargar_costos que inserta una línea con costo → rechazado por la policy', async () => {
    const t = await setupFixture('policy-sin-cargar-costos')

    // Cliente con solo inventario.crear e inventario.ver (sin inventario.cargar_costos)
    const clientSinCargar = await createClientWithPermisos(t, 'operador-sin-costos', {
      inventario: ['ver', 'crear'],
    })

    const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
      p_id_categoria: t.idCategoria,
      p_nombre: 'Gorra Roja',
      p_sku: `SKU-${Date.now()}-6`,
    })

    const { data: ing } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    // Intento 1: insertar costo en satélite → Rechazado por policy restrictiva
    const { data: detConCosto } = await clientSinCargar.from('ingreso_mercaderia_detalle').insert({
      id_tenant: t.tenantId,
      id_ingreso: ing!.id_ingreso,
      id_producto: idProd,
      cantidad: 5,
      talle: 'U',
    }).select('id_detalle').single()

    const { error: errConCosto } = await clientSinCargar.from('ingreso_detalle_costo').insert({
      id_detalle: detConCosto!.id_detalle,
      id_tenant: t.tenantId,
      costo_unitario: 800,
    })

    expect(errConCosto).not.toBeNull()
    expect(errConCosto?.code).toBe('42501')

    // Intento 2: insertar línea SIN costo → Permitido por policy
    const { error: errSinCosto } = await clientSinCargar.from('ingreso_mercaderia_detalle').insert({
      id_tenant: t.tenantId,
      id_ingreso: ing!.id_ingreso,
      id_producto: idProd,
      cantidad: 5,
      talle: 'U',
    })

    expect(errSinCosto).toBeNull()

    // sp_importar_remito con costo sin permiso también debe ser rechazado
    const { error: errImport } = await clientSinCargar.rpc('sp_importar_remito', {
      p_id_ingreso: ing!.id_ingreso,
      p_lineas: [
        {
          nombre: 'Gorra Azul',
          costoUnitario: 500,
          esNuevo: true,
          idCategoria: t.idCategoria,
          partes: [{ talle: 'U', cantidad: 2 }],
        },
      ],
    })

    expect(errImport).not.toBeNull()
    expect(errImport?.code).toBe('42501')
    expect(errImport?.message).toContain('no-permission')
  })

  it('6b. con cargar_costos, un UPDATE directo de cantidad falla por privilegio de columna', async () => {
    const t = await setupFixture('update-directo-columna')

    const clientCargarCostos = await createClientWithPermisos(t, 'operador-con-costos', {
      inventario: ['ver', 'crear', 'cargar_costos'],
    })

    const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
      p_id_categoria: t.idCategoria,
      p_nombre: 'Zapatos Cuero',
      p_sku: `SKU-${Date.now()}-col`,
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
        id_producto: idProd,
        cantidad: 4,
      })
      .select('id_detalle')
      .single()

    // Intento de UPDATE directo sobre 'cantidad' con rol que tiene 'cargar_costos':
    // Falla por permisos de PostgreSQL (UPDATE revocado en ingreso_mercaderia_detalle)
    const { error: errUpdateCantidad } = await clientCargarCostos
      .from('ingreso_mercaderia_detalle')
      .update({ cantidad: 10 })
      .eq('id_detalle', det!.id_detalle)

    expect(errUpdateCantidad).not.toBeNull()
    expect(errUpdateCantidad?.code).toBe('42501')
  })

  it('7. sp_completar_costo_ingreso sin permiso → no-permission', async () => {
    const t = await setupFixture('completar-sin-permiso')

    const clientSinCargar = await createClientWithPermisos(t, 'vendedora-sin-costo', {
      inventario: ['ver', 'crear'],
      ventas: ['crear'],
    })

    const { data: ing } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: true })
      .select('id_ingreso')
      .single()

    const { error } = await clientSinCargar.rpc('sp_completar_costo_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
      p_lineas: [],
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    expect(error?.message).toContain('no-permission')
  })

  it('8. ninguna operación deja dos filas vigentes en costo_producto para un producto', async () => {
    const t = await setupFixture('no-duplicar-vigencias')

    const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
      p_id_categoria: t.idCategoria,
      p_nombre: 'Producto Múltiple',
      p_sku: `SKU-${Date.now()}-8`,
    })

    // Sucesión de operaciones de costo:
    // a. Ingreso inicial con costo 1000
    const { data: ing1 } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()
    const { data: det1 } = await serviceRole.from('ingreso_mercaderia_detalle').insert({
      id_tenant: t.tenantId,
      id_ingreso: ing1!.id_ingreso,
      id_producto: idProd,
      cantidad: 1,
    }).select('id_detalle').single()
    await serviceRole.from('ingreso_detalle_costo').insert({
      id_detalle: det1!.id_detalle,
      id_tenant: t.tenantId,
      costo_unitario: 1000,
    })
    await t.authAdmin.rpc('sp_confirmar_ingreso', { p_id_ingreso: ing1!.id_ingreso })

    // b. Ingreso sin costo (hereda 1000)
    const { data: ing2 } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()
    const { data: det2 } = await serviceRole
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: t.tenantId,
        id_ingreso: ing2!.id_ingreso,
        id_producto: idProd,
        cantidad: 1,
      })
      .select('id_detalle')
      .single()
    await t.authAdmin.rpc('sp_confirmar_ingreso', { p_id_ingreso: ing2!.id_ingreso })

    // c. Completar costo de ingreso 2 a 1200
    await t.authAdmin.rpc('sp_completar_costo_ingreso', {
      p_id_ingreso: ing2!.id_ingreso,
      p_lineas: [{ id_detalle: det2!.id_detalle, costo_unitario: 1200 }],
    })

    // d. Ingreso 3 con costo 1500
    const { data: ing3 } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()
    const { data: det3 } = await serviceRole.from('ingreso_mercaderia_detalle').insert({
      id_tenant: t.tenantId,
      id_ingreso: ing3!.id_ingreso,
      id_producto: idProd,
      cantidad: 1,
    }).select('id_detalle').single()
    await serviceRole.from('ingreso_detalle_costo').insert({
      id_detalle: det3!.id_detalle,
      id_tenant: t.tenantId,
      costo_unitario: 1500,
    })
    await t.authAdmin.rpc('sp_confirmar_ingreso', { p_id_ingreso: ing3!.id_ingreso })

    // Verificación de invariante estricta: exactamente 1 fila con vigente_hasta is null
    const { data: vigentes } = await serviceRole
      .from('costo_producto')
      .select('id_costo, costo, vigente_hasta')
      .eq('id_producto', idProd)
      .is('vigente_hasta', null)

    expect(vigentes).toHaveLength(1)
    expect(Number(vigentes![0].costo)).toBe(1500)
  })

  describe('9. sp_crear_stock_directo (00154 — costo opcional/pendiente)', () => {
    it('operador sin inventario.cargar_costos intenta enviar p_costo -> rechazo no-permission', async () => {
      const t = await setupFixture('stock-directo-sin-permiso')
      const clientSinCostos = await createClientWithPermisos(t, 'OperadorSinCargarCostos', {
        inventario: ['ver', 'crear', 'editar'],
      })

      const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
        p_id_categoria: t.idCategoria,
        p_nombre: 'Remera Directa',
        p_sku: `SKU-${Date.now()}-sd1`,
      })

      const { data, error } = await clientSinCostos.rpc('sp_crear_stock_directo', {
        p_id_producto: idProd,
        p_costo: 1500,
        p_items: [{ talle: 'M', cantidad: 2 }],
      })

      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501')
      expect(error?.message).toMatch(/no-permission/)
      expect(data).toBeNull()

      // Invariante: no se crearon items
      const { data: items } = await serviceRole
        .from('item_producto')
        .select('id_item')
        .eq('id_producto', idProd)
      expect(items).toHaveLength(0)
    })

    it('operador sin inventario.cargar_costos crea stock directo sin costo en producto sin costo previo -> costo_ingreso null', async () => {
      const t = await setupFixture('stock-directo-costo-null')
      const clientSinCostos = await createClientWithPermisos(t, 'OperadorSinCargarCostos', {
        inventario: ['ver', 'crear', 'editar'],
      })

      const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
        p_id_categoria: t.idCategoria,
        p_nombre: 'Remera Sin Costo Previo',
        p_sku: `SKU-${Date.now()}-sd2`,
      })

      const { data: itemsCreados, error } = await clientSinCostos.rpc('sp_crear_stock_directo', {
        p_id_producto: idProd,
        p_costo: null,
        p_items: [{ talle: 'M', cantidad: 2 }],
      })

      expect(error).toBeNull()
      expect(itemsCreados).toBe(2)

      const { data: items } = await serviceRole
        .from('item_producto')
        .select('id_item, estado_item, item_costo(costo_ingreso)')
        .eq('id_producto', idProd)
      expect(items).toHaveLength(2)
      expect(costoDe(items![0])).toBeNull()
      expect(costoDe(items![1])).toBeNull()
    })

    it('operador crea stock directo con p_costo null en producto CON costo vigente -> hereda fn_costo_vigente_producto', async () => {
      const t = await setupFixture('stock-directo-hereda-vigente')
      const clientSinCostos = await createClientWithPermisos(t, 'OperadorSinCargarCostos', {
        inventario: ['ver', 'crear', 'editar'],
      })

      const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
        p_id_categoria: t.idCategoria,
        p_nombre: 'Remera Con Costo Previo',
        p_sku: `SKU-${Date.now()}-sd3`,
      })

      // Admin fija costo vigente 3000
      await t.authAdmin.rpc('sp_set_costo_producto', {
        p_id_producto: idProd,
        p_costo: 3000,
        p_motivo: 'costo inicial',
      })

      // Operador sin cargar_costos da de alta stock directo con p_costo null
      const { data: itemsCreados, error } = await clientSinCostos.rpc('sp_crear_stock_directo', {
        p_id_producto: idProd,
        p_costo: null,
        p_items: [{ talle: 'L', cantidad: 1 }],
      })

      expect(error).toBeNull()
      expect(itemsCreados).toBe(1)

      const { data: items } = await serviceRole
        .from('item_producto')
        .select('id_item, item_costo(costo_ingreso)')
        .eq('id_producto', idProd)
      expect(items).toHaveLength(1)
      expect(costoDe(items![0])).toBe(3000)
    })

    it('operador con inventario.cargar_costos crea stock directo con costo -> fija costo_ingreso y actualiza costo_producto', async () => {
      const t = await setupFixture('stock-directo-con-costo')

      const { data: idProd } = await t.authAdmin.rpc('sp_create_producto', {
        p_id_categoria: t.idCategoria,
        p_nombre: 'Remera Con Costo Nuevo',
        p_sku: `SKU-${Date.now()}-sd4`,
      })

      const { data: itemsCreados, error } = await t.authAdmin.rpc('sp_crear_stock_directo', {
        p_id_producto: idProd,
        p_costo: 4500,
        p_items: [{ talle: 'XL', cantidad: 3 }],
      })

      expect(error).toBeNull()
      expect(itemsCreados).toBe(3)

      const { data: items } = await serviceRole
        .from('item_producto')
        .select('id_item, item_costo(costo_ingreso)')
        .eq('id_producto', idProd)
      expect(items).toHaveLength(3)
      expect(costoDe(items![0])).toBe(4500)

      const { data: vigentes } = await serviceRole
        .from('costo_producto')
        .select('costo')
        .eq('id_producto', idProd)
        .is('vigente_hasta', null)
      expect(vigentes).toHaveLength(1)
      expect(Number(vigentes![0].costo)).toBe(4500)
    })
  })
})
