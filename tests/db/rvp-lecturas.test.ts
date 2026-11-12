import { describe, expect, test, afterAll } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { hasTestDb, signInAs, createTenantWithUser, runPsql } from './_helpers'
import { ventaFixture } from './_fixtures-ventas'

describe.skipIf(!hasTestDb)('Slice 9c — Funciones de lectura rvp_* (REQ-RV-ACC-20…23, DR-13)', () => {
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

  async function setupRvpFixture() {
    const fA = await ventaFixture('RvpTenantA', 6, { tipoIngreso: 'compra' })
    tenantsToClean.push(fA.tenantId)

    // Habilitar módulo revendedoras
    const { data: mod } = await serviceRole
      .from('modulo')
      .select('id_modulo')
      .eq('codigo', 'revendedoras')
      .single()
    await serviceRole
      .from('tenant_modulo')
      .insert({ id_tenant: fA.tenantId, id_modulo: mod!.id_modulo, habilitado: true })

    // Crear dos revendedoras en tenant A
    const { data: idRevA } = await fA.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Ana',
      p_apellido: 'RvpA',
      p_email: 'ana_rvp@test.com',
    })

    const { data: idRevB } = await fA.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Berta',
      p_apellido: 'RvpB',
      p_email: 'berta_rvp@test.com',
    })

    // Rol Revendedora
    const { data: rolRev } = await serviceRole
      .from('rol')
      .insert({
        id_tenant: fA.tenantId,
        nombre: 'Revendedora',
        permisos: { revendedoras: ['ver_propio', 'declarar'] },
      })
      .select('id_rol')
      .single()

    // Crear usuario Auth para Ana
    const emailAna = `ana_rvp_${Date.now()}@test.com`
    const { data: userAna } = await serviceRole.auth.admin.createUser({
      email: emailAna,
      password: 'Password123!',
      email_confirm: true,
    })
    usersToClean.push(userAna.user!.id)

    await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRevA,
      p_id_usuario: userAna.user!.id,
      p_id_tenant: fA.tenantId,
      p_email: emailAna,
      p_nombre: 'Ana RevA',
      p_id_rol: rolRev!.id_rol,
    })

    // Crear usuario Auth para Berta
    const emailBerta = `berta_rvp_${Date.now()}@test.com`
    const { data: userBerta } = await serviceRole.auth.admin.createUser({
      email: emailBerta,
      password: 'Password123!',
      email_confirm: true,
    })
    usersToClean.push(userBerta.user!.id)

    await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRevB,
      p_id_usuario: userBerta.user!.id,
      p_id_tenant: fA.tenantId,
      p_email: emailBerta,
      p_nombre: 'Berta RevB',
      p_id_rol: rolRev!.id_rol,
    })

    // Tenant B para aislamiento cruzado
    const tC = await createTenantWithUser('RvpTenantC')
    tenantsToClean.push(tC.tenantId)

    // Items para Ana (0, 1, 2) y para Berta (3, 4)
    const itemsAna = [fA.items[0], fA.items[1], fA.items[2]]
    const itemsBerta = [fA.items[3], fA.items[4]]
    const itemDisponible = fA.items[5]

    const hoy = new Date().toISOString().slice(0, 10)

    // Consignación para Ana
    const { data: idConsAna } = await fA.authenticated.rpc('sp_crear_consignacion_revendedora_con_items', {
      p_id_revendedora: idRevA,
      p_items: itemsAna,
      p_periodo_desde: hoy,
    })
    await fA.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idConsAna,
    })

    // Consignación para Berta
    const { data: idConsBerta } = await fA.authenticated.rpc('sp_crear_consignacion_revendedora_con_items', {
      p_id_revendedora: idRevB,
      p_items: itemsBerta,
      p_periodo_desde: hoy,
    })
    await fA.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idConsBerta,
    })

    const authAna = await signInAs({ email: emailAna, password: 'Password123!' })
    const authBerta = await signInAs({ email: emailBerta, password: 'Password123!' })

    return {
      fA,
      idRevA,
      idRevB,
      authAna,
      authBerta,
      itemsAna,
      itemsBerta,
      itemDisponible,
      tC,
    }
  }

  test('1. Snapshot por función: payload no contiene ninguna columna prohibida (ACC-22)', async () => {
    const ctx = await setupRvpFixture()

    // Preparar ventas, liquidación y declaración para Ana
    // Declaración
    await ctx.authAna.rpc('sp_declarar_venta_revendedora', {
      p_id_item: ctx.itemsAna[0],
      p_nota: 'Para snapshot',
    })

    // Venta confirmada por el operador para item 1
    const { data: idDec1 } = await ctx.authAna.rpc('sp_declarar_venta_revendedora', {
      p_id_item: ctx.itemsAna[1],
      p_nota: 'Venta a liquidar',
    })
    await ctx.fA.authenticated.rpc('sp_confirmar_declaracion_venta', {
      p_id_declaracion: idDec1,
    })

    // Liquidación para Ana usando fecha del tenant
    const { data: hoy } = await ctx.fA.authenticated.rpc('fn_hoy_tenant')
    const desde = new Date(new Date(hoy).getTime() - 7 * 86400000).toISOString().slice(0, 10)
    const { data: idLiq, error: errLiq } = await ctx.fA.authenticated.rpc('sp_generar_liquidacion', {
      p_id_revendedora: ctx.idRevA,
      p_desde: desde,
      p_hasta: hoy,
    })
    expect(errLiq).toBeNull()
    expect(idLiq).toBeDefined()

    const FORBIDDEN_COLS = [
      'costo', 'costo_snapshot', 'costo_unitario', 'costo_producto', 'costo_recuperado',
      'monto_ganancia', 'margen', 'id_proveedor', 'monto_proveedor', 'id_cuenta',
      'id_cuenta_destino', 'id_usuario_alta', 'observaciones'
    ]

    // 1. rvp_mi_stock
    const { data: stock, error: errStock } = await ctx.authAna.rpc('rvp_mi_stock')
    expect(errStock).toBeNull()
    expect(stock!.length).toBeGreaterThan(0)
    const stockKeys = Object.keys(stock![0]).sort()
    for (const forbidden of FORBIDDEN_COLS) {
      expect(stockKeys).not.toContain(forbidden)
    }
    expect(stockKeys).toEqual([
      'color', 'declarado_pendiente', 'descripcion', 'fecha_consignacion',
      'id_item', 'id_producto', 'precio_venta', 'talle'
    ].sort())

    // 2. rvp_mis_ventas
    const { data: ventas, error: errVentas } = await ctx.authAna.rpc('rvp_mis_ventas')
    expect(errVentas).toBeNull()
    expect(ventas!.length).toBeGreaterThan(0)
    const ventasKeys = Object.keys(ventas![0]).sort()
    for (const forbidden of FORBIDDEN_COLS) {
      expect(ventasKeys).not.toContain(forbidden)
    }
    expect(ventasKeys).toEqual([
      'color', 'comision_estimada', 'comision_liquidada', 'descripcion',
      'estado_liquidacion', 'fecha_liquidacion', 'fecha_venta',
      'id_detalle_venta', 'id_item', 'id_venta', 'precio_venta', 'talle'
    ].sort())

    // 3. rvp_mi_cuenta
    const { data: cuenta, error: errCuenta } = await ctx.authAna.rpc('rvp_mi_cuenta')
    expect(errCuenta).toBeNull()
    const cuentaRow = Array.isArray(cuenta) ? cuenta[0] : cuenta
    expect(cuentaRow).toBeDefined()
    const cuentaKeys = Object.keys(cuentaRow).sort()
    for (const forbidden of FORBIDDEN_COLS) {
      expect(cuentaKeys).not.toContain(forbidden)
    }
    expect(cuentaKeys).toEqual([
      'comision_estimada', 'comision_liquidada', 'declaraciones_pendientes',
      'monto_en_poder', 'piezas_en_poder', 'porcentaje_comision_actual',
      'proximo_tramo_comision', 'total_adeudado', 'total_liquidado',
      'total_pagado', 'total_vendido'
    ].sort())

    // 4. rvp_mis_liquidaciones
    const { data: liqs, error: errLiqs } = await ctx.authAna.rpc('rvp_mis_liquidaciones')
    expect(errLiqs).toBeNull()
    expect(liqs!.length).toBeGreaterThan(0)
    const liqKeys = Object.keys(liqs![0]).sort()
    for (const forbidden of FORBIDDEN_COLS) {
      expect(liqKeys).not.toContain(forbidden)
    }
    expect(liqKeys).toEqual([
      'cantidad_lineas', 'estado', 'fecha_liquidacion', 'fecha_pago',
      'id_liquidacion', 'monto_a_cobrar', 'monto_comision', 'monto_pagado',
      'monto_vendido', 'periodo_desde', 'periodo_hasta', 'porcentaje_aplicado'
    ].sort())

    // 5. rvp_mis_declaraciones
    const { data: decs, error: errDecs } = await ctx.authAna.rpc('rvp_mis_declaraciones')
    expect(errDecs).toBeNull()
    expect(decs!.length).toBeGreaterThan(0)
    const decKeys = Object.keys(decs![0]).sort()
    for (const forbidden of FORBIDDEN_COLS) {
      expect(decKeys).not.toContain(forbidden)
    }
    expect(decKeys).toEqual([
      'color', 'created_at', 'descripcion', 'estado', 'fecha',
      'id_declaracion', 'id_item', 'motivo_rechazo', 'nota',
      'precio_venta', 'talle'
    ].sort())
  })

  test('2. Aislamiento: A no ve filas ni conteos de B ni de otro tenant', async () => {
    const ctx = await setupRvpFixture()

    // Berta declara su ítem 3
    await ctx.authBerta.rpc('sp_declarar_venta_revendedora', {
      p_id_item: ctx.itemsBerta[0],
      p_nota: 'De Berta',
    })

    // Ana consulta su stock -> no contiene itemsBerta
    const { data: stockAna } = await ctx.authAna.rpc('rvp_mi_stock')
    const itemIdsAna = stockAna!.map((s: { id_item: string }) => s.id_item)
    expect(itemIdsAna).toContain(ctx.itemsAna[0])
    expect(itemIdsAna).not.toContain(ctx.itemsBerta[0])
    expect(itemIdsAna).not.toContain(ctx.itemsBerta[1])

    // Ana consulta declaraciones -> no contiene la de Berta
    const { data: decsAna } = await ctx.authAna.rpc('rvp_mis_declaraciones')
    const decItemIds = decsAna!.map((d: { id_item: string }) => d.id_item)
    expect(decItemIds).not.toContain(ctx.itemsBerta[0])

    // Ana consulta cuenta -> piezas_en_poder es 3 (sus items)
    const { data: cuentaAna } = await ctx.authAna.rpc('rvp_mi_cuenta')
    const cAna = Array.isArray(cuentaAna) ? cuentaAna[0] : cuentaAna
    expect(Number(cAna.piezas_en_poder)).toBe(3)
  })

  test('3. Sesión de operador (sin claim) recibe no-revendedora en cada rvp_*', async () => {
    const ctx = await setupRvpFixture()

    const { error: eStock } = await ctx.fA.authenticated.rpc('rvp_mi_stock')
    expect(eStock?.message).toMatch(/no-revendedora/)

    const { error: eVentas } = await ctx.fA.authenticated.rpc('rvp_mis_ventas')
    expect(eVentas?.message).toMatch(/no-revendedora/)

    const { error: eCuenta } = await ctx.fA.authenticated.rpc('rvp_mi_cuenta')
    expect(eCuenta?.message).toMatch(/no-revendedora/)

    const { error: eLiqs } = await ctx.fA.authenticated.rpc('rvp_mis_liquidaciones')
    expect(eLiqs?.message).toMatch(/no-revendedora/)

    const { error: eDecs } = await ctx.fA.authenticated.rpc('rvp_mis_declaraciones')
    expect(eDecs?.message).toMatch(/no-revendedora/)
  })

  test('4. Módulo apagado -> modulo-revendedoras-deshabilitado en cada rvp_*', async () => {
    const fOff = await ventaFixture('RvpModOff', 1, { tipoIngreso: 'compra' })
    tenantsToClean.push(fOff.tenantId)

    // Habilitar módulo temporalmente para poder crear la revendedora y enlazar usuario
    const { data: mod } = await serviceRole
      .from('modulo')
      .select('id_modulo')
      .eq('codigo', 'revendedoras')
      .single()
    await serviceRole
      .from('tenant_modulo')
      .insert({ id_tenant: fOff.tenantId, id_modulo: mod!.id_modulo, habilitado: true })

    const { data: idRevOff } = await fOff.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Off',
      p_apellido: 'Rev',
      p_email: 'off@test.com',
    })

    const { data: rolRev } = await serviceRole
      .from('rol')
      .select('id_rol')
      .eq('id_tenant', fOff.tenantId)
      .eq('nombre', 'Revendedora')
      .single()

    const emailOff = `off_${Date.now()}@test.com`
    const { data: userOff } = await serviceRole.auth.admin.createUser({
      email: emailOff,
      password: 'Password123!',
      email_confirm: true,
    })
    usersToClean.push(userOff.user!.id)

    await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRevOff,
      p_id_usuario: userOff.user!.id,
      p_id_tenant: fOff.tenantId,
      p_email: emailOff,
      p_nombre: 'Off Rev',
      p_id_rol: rolRev!.id_rol,
    })

    // Apagar el módulo revendedoras
    await serviceRole
      .from('tenant_modulo')
      .update({ habilitado: false })
      .eq('id_tenant', fOff.tenantId)
      .eq('id_modulo', mod!.id_modulo)

    const authOff = await signInAs({ email: emailOff, password: 'Password123!' })

    const { error: eStock } = await authOff.rpc('rvp_mi_stock')
    expect(eStock?.message).toMatch(/modulo-revendedoras-deshabilitado/)

    const { error: eVentas } = await authOff.rpc('rvp_mis_ventas')
    expect(eVentas?.message).toMatch(/modulo-revendedoras-deshabilitado/)

    const { error: eCuenta } = await authOff.rpc('rvp_mi_cuenta')
    expect(eCuenta?.message).toMatch(/modulo-revendedoras-deshabilitado/)

    const { error: eLiqs } = await authOff.rpc('rvp_mis_liquidaciones')
    expect(eLiqs?.message).toMatch(/modulo-revendedoras-deshabilitado/)

    const { error: eDecs } = await authOff.rpc('rvp_mis_declaraciones')
    expect(eDecs?.message).toMatch(/modulo-revendedoras-deshabilitado/)
  })

  test('5. Sesión de revendedora no puede hacer SELECT directo ni INSERT/UPDATE fuera de lista blanca', async () => {
    const ctx = await setupRvpFixture()

    const TABLAS_BLOQUEADAS = [
      'item_producto', 'producto', 'detalle_venta', 'venta',
      'liquidacion_revendedora', 'pago_revendedora', 'proveedor',
      'gasto_negocio', 'cliente', 'usuario', 'rol'
    ]

    for (const tabla of TABLAS_BLOQUEADAS) {
      const { data, error } = await ctx.authAna.from(tabla).select('*')
      expect(
        data === null || data.length === 0 || error !== null,
        `Tabla ${tabla} no debería ser visible para revendedora`
      ).toBe(true)
    }

    // Intento de insert fuera de lista blanca
    const { error: errInsCliente } = await ctx.authAna.from('cliente').insert({
      id_tenant: ctx.fA.tenantId,
      nombre: 'Hacker',
      apellido: 'Test',
    })
    expect(errInsCliente).not.toBeNull()
  })

  test('6. Cruce de cifras de rvp_mi_cuenta con rf_cuenta_corriente_revendedora', async () => {
    const ctx = await setupRvpFixture()

    // 1 venta liquidada
    const { data: idDec1 } = await ctx.authAna.rpc('sp_declarar_venta_revendedora', {
      p_id_item: ctx.itemsAna[0],
      p_nota: 'Venta 1',
    })
    await ctx.fA.authenticated.rpc('sp_confirmar_declaracion_venta', {
      p_id_declaracion: idDec1,
    })
    const hoy = new Date().toISOString().slice(0, 10)
    const { data: idLiq } = await ctx.fA.authenticated.rpc('sp_generar_liquidacion', {
      p_id_revendedora: ctx.idRevA,
      p_desde: hoy,
      p_hasta: hoy,
    })

    // Registrar pago parcial de la liquidación
    const { data: cuentaDest } = await serviceRole
      .from('cuenta_destino')
      .select('id_cuenta_destino')
      .eq('id_tenant', ctx.fA.tenantId)
      .limit(1)
      .single()

    await ctx.fA.authenticated.rpc('sp_registrar_pago_revendedora', {
      p_id_liquidacion: idLiq,
      p_monto: 50,
      p_metodo: 'efectivo',
      p_id_cuenta: cuentaDest!.id_cuenta_destino,
    })

    // 1 venta sin liquidar
    const { data: idDec2 } = await ctx.authAna.rpc('sp_declarar_venta_revendedora', {
      p_id_item: ctx.itemsAna[1],
      p_nota: 'Venta 2 sin liquidar',
    })
    await ctx.fA.authenticated.rpc('sp_confirmar_declaracion_venta', {
      p_id_declaracion: idDec2,
    })

    // Llamar a rf_cuenta_corriente_revendedora como operador
    const { data: ccData, error: errCc } = await ctx.fA.authenticated.rpc('rf_cuenta_corriente_revendedora', {
      p_id_revendedora: ctx.idRevA,
    })
    expect(errCc).toBeNull()
    const cc = ccData![0]

    // Llamar a rvp_mi_cuenta como revendedora
    const { data: rvpData, error: errRvp } = await ctx.authAna.rpc('rvp_mi_cuenta')
    expect(errRvp).toBeNull()
    const rvp = Array.isArray(rvpData) ? rvpData[0] : rvpData

    expect(Number(rvp.piezas_en_poder)).toBe(Number(cc.items_en_poder))
    expect(Number(rvp.monto_en_poder)).toBe(Number(cc.monto_en_poder))
    expect(Number(rvp.total_vendido)).toBe(Number(cc.total_vendido))
    expect(Number(rvp.comision_liquidada)).toBe(Number(cc.total_comision_liquidada))
    expect(Number(rvp.total_liquidado)).toBe(Number(cc.total_liquidado))
    expect(Number(rvp.total_pagado)).toBe(Number(cc.total_pagado))
    expect(Number(rvp.total_adeudado)).toBe(Number(cc.adeudado))
  })

  test('7. search_path fijo y permisos limitados a authenticated', async () => {
    // Verificar en pg_proc que las funciones rvp_* tienen secdef y search_path seguro
    const query = "select json_agg(t) from (select proname, prosecdef, proconfig from pg_proc where proname like 'rvp_%') t;"
    const output = runPsql(query)
    const procs = JSON.parse(output || '[]') as Array<{
      proname: string
      prosecdef: boolean
      proconfig: string[] | null
    }>
    expect(procs.length).toBeGreaterThanOrEqual(5)

    for (const p of procs) {
      expect(p.prosecdef, `${p.proname} debe ser SECURITY DEFINER`).toBe(true)
      const configStr = (p.proconfig || []).join(',')
      expect(configStr, `${p.proname} debe fijar search_path`).toMatch(/search_path=public,\s*pg_temp/)
    }
  })

  test('8. Guardia anti-propagación de DEFINER: sólo rvp_* y funciones base autorizadas', async () => {
    const query = "select json_agg(t) from (select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef = true) t;"
    const output = runPsql(query)
    const defProcs = JSON.parse(output || '[]') as Array<{ proname: string }>

    // Lista blanca estricta de funciones SECURITY DEFINER que NO empiezan con rvp_
    const PERMITTED_NON_RVP_DEFINER = [
      'fn_auto_crear_rol_revendedora', // trigger on tenant_modulo (00079)
      'sp_enlazar_revendedora_usuario', // provisión de usuario revendedora (00079)
      'fn_sellar_costo_herencia_items', // sellador de herencia de costo vigente (00155, REQ-CPC §6.1)
      'fn_sellar_costo_venta', // sellador de costo/rendición en venta (00156, REQ-CPC §6.1)
      'fn_sellar_costo_cambio', // sellador de costo/rendición en cambio (00156, REQ-CPC §6.1)
      'fn_sellar_costo_devolucion', // sellador de costo recuperado en devolución (00156, REQ-CPC §6.1)
    ]

    for (const p of defProcs) {
      const name = p.proname
      if (name.startsWith('rvp_')) continue
      expect(
        PERMITTED_NON_RVP_DEFINER,
        `Función SECURITY DEFINER no autorizada en public: ${name}`
      ).toContain(name)
    }
  })

  test('9. rvp_mi_cuenta: proximo_tramo_comision solo expone tramos de su regla cuando tiene regla con escala (DR-13)', async () => {
    const fixture = await setupRvpFixture()
    const { fA, authAna, idRevA, idRevB } = fixture

    // Crear regla con escala para Revendedora A
    const { data: idReglaA, error: errRegA } = await fA.authenticated.rpc('sp_crear_regla_comision', {
      p_ambito: 'revendedora',
      p_nombre: 'Escala Reven A',
      p_id_revendedora: idRevA,
      p_escalas: [
        { objetivo_desde: 0, porcentaje: 10 },
        { objetivo_desde: 100000, porcentaje: 15 },
        { objetivo_desde: 200000, porcentaje: 20 },
      ],
    })
    expect(errRegA).toBeNull()
    expect(idReglaA).toBeDefined()

    // Crear regla con escala DISTINTA para Revendedora B
    const { data: idReglaB, error: errRegB } = await fA.authenticated.rpc('sp_crear_regla_comision', {
      p_ambito: 'revendedora',
      p_nombre: 'Escala Reven B',
      p_id_revendedora: idRevB,
      p_escalas: [
        { objetivo_desde: 0, porcentaje: 5 },
        { objetivo_desde: 500000, porcentaje: 30 },
      ],
    })
    expect(errRegB).toBeNull()
    expect(idReglaB).toBeDefined()

    // Consultar rvp_mi_cuenta con la sesión de Ana
    const { data: cuentaA, error: errA } = await authAna.rpc('rvp_mi_cuenta')
    expect(errA).toBeNull()
    expect(cuentaA).toHaveLength(1)

    const rvpA = cuentaA![0]
    expect(rvpA.proximo_tramo_comision).not.toBeNull()
    const tramoA = rvpA.proximo_tramo_comision as {
      tramo_actual: number
      proximo_porcentaje: number
      objetivo_desde: number
      falta: number
    }
    // Debe corresponder al primer escalón de A (100000 -> 15%) y NO al de B (500000 -> 30%)
    expect(Number(tramoA.objetivo_desde)).toBe(100000)
    expect(Number(tramoA.proximo_porcentaje)).toBe(15)
  })
})
