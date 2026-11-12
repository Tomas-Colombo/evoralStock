import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, hasTestDb, signInAs } from './_helpers'
import { ventaFixture, venderContado } from './_fixtures-ventas'

describe.skipIf(!hasTestDb)('tenant_modulo guarda — REQ-MODOP-01, 02, 03, 10', () => {
  const serviceRole = createServiceRoleTestClient()

  async function getModulo(codigo: string) {
    const { data, error } = await serviceRole
      .from('modulo')
      .select('id_modulo, codigo')
      .eq('codigo', codigo)
      .single()
    expect(error, `lookup modulo ${codigo}`).toBeNull()
    return data!
  }

  describe('REQ-MODOP-01: El núcleo no se apaga ni se borra', () => {
    it('N1: update a false sobre módulo del núcleo levanta modulo-nucleo', async () => {
      const tenant = await createTenantWithUser('modop-01-n1')
      const modVentas = await getModulo('ventas')

      // Asegurar que la fila existe habilitada
      await serviceRole.from('tenant_modulo').upsert({
        id_tenant: tenant.tenantId,
        id_modulo: modVentas.id_modulo,
        habilitado: true,
      })

      const { error } = await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', tenant.tenantId)
        .eq('id_modulo', modVentas.id_modulo)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-nucleo/)
    })

    it('N1 (insert): insert de fila del núcleo con habilitado = false levanta modulo-nucleo', async () => {
      const tenant = await createTenantWithUser('modop-01-ins')
      const modVentas = await getModulo('ventas')

      const { error } = await serviceRole.from('tenant_modulo').insert({
        id_tenant: tenant.tenantId,
        id_modulo: modVentas.id_modulo,
        habilitado: false,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-nucleo/)
    })

    it('N2: delete de fila de módulo del núcleo levanta modulo-nucleo', async () => {
      const tenant = await createTenantWithUser('modop-01-n2')
      const modInv = await getModulo('inventario')

      await serviceRole.from('tenant_modulo').upsert({
        id_tenant: tenant.tenantId,
        id_modulo: modInv.id_modulo,
        habilitado: true,
      })

      const { error } = await serviceRole
        .from('tenant_modulo')
        .delete()
        .eq('id_tenant', tenant.tenantId)
        .eq('id_modulo', modInv.id_modulo)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-nucleo/)
    })

    it('N4: fn_modulo_es_nucleo y backfill del núcleo en tenants existentes', async () => {
      const coreCodes = ['administracion', 'inventario', 'ventas', 'precios', 'gastos', 'reportes']
      const optionalCodes = ['revendedoras', 'consignaciones', 'rendiciones']

      for (const code of coreCodes) {
        const { data, error } = await serviceRole.rpc('fn_modulo_es_nucleo', { p_codigo: code })
        expect(error).toBeNull()
        expect(data).toBe(true)
      }

      for (const code of optionalCodes) {
        const { data, error } = await serviceRole.rpc('fn_modulo_es_nucleo', { p_codigo: code })
        expect(error).toBeNull()
        expect(data).toBe(false)
      }

      // Los tenants existentes en la base deben tener las 6 del núcleo habilitadas
      const { data: demoTenant } = await serviceRole
        .from('tenant')
        .select('id_tenant')
        .eq('subdominio', 'utopia-demo')
        .maybeSingle()

      if (demoTenant) {
        const { data: rows, error } = await serviceRole
          .from('tenant_modulo')
          .select('habilitado, modulo!inner(codigo)')
          .eq('id_tenant', demoTenant.id_tenant)

        expect(error).toBeNull()
        const habilitados = (rows ?? [])
          .filter((r) => r.habilitado)
          .map((r) => (r.modulo as unknown as { codigo: string }).codigo)

        for (const code of coreCodes) {
          expect(habilitados).toContain(code)
        }
      }
    })
  })

  describe('REQ-MODOP-02: Paquete consignación de a par', () => {
    it('N1: habilitar solo consignaciones levanta modulo-paquete-incompleto', async () => {
      const tenant = await createTenantWithUser('modop-02-n1')
      const modCons = await getModulo('consignaciones')

      const { error } = await serviceRole.from('tenant_modulo').upsert({
        id_tenant: tenant.tenantId,
        id_modulo: modCons.id_modulo,
        habilitado: true,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-paquete-incompleto/)
    })

    it('Feliz: habilitar ambos a la vez en la misma transacción pasa', async () => {
      const tenant = await createTenantWithUser('modop-02-ok')
      const modCons = await getModulo('consignaciones')
      const modRend = await getModulo('rendiciones')

      const { error } = await serviceRole.from('tenant_modulo').upsert([
        { id_tenant: tenant.tenantId, id_modulo: modCons.id_modulo, habilitado: true },
        { id_tenant: tenant.tenantId, id_modulo: modRend.id_modulo, habilitado: true },
      ])

      expect(error).toBeNull()
    })
  })

  describe('REQ-MODOP-03: No apagar opcional con estado vivo', () => {
    it('Feliz: apagar consignacionProveedor sin estado vivo pasa ok', async () => {
      const tenant = await createTenantWithUser('modop-03-ok')
      const modCons = await getModulo('consignaciones')
      const modRend = await getModulo('rendiciones')

      // Habilitar ambos
      await serviceRole.from('tenant_modulo').upsert([
        { id_tenant: tenant.tenantId, id_modulo: modCons.id_modulo, habilitado: true },
        { id_tenant: tenant.tenantId, id_modulo: modRend.id_modulo, habilitado: true },
      ])

      // Deshabilitar ambos
      const { error } = await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', tenant.tenantId)
        .in('id_modulo', [modCons.id_modulo, modRend.id_modulo])

      expect(error).toBeNull()
    })

    it('N1: stock consignación en local bloquea apagar el paquete', async () => {
      const f = await ventaFixture('modop-03-n1', 2, { tipoIngreso: 'consignacion' })
      const modCons = await getModulo('consignaciones')
      const modRend = await getModulo('rendiciones')

      await serviceRole.from('tenant_modulo').upsert([
        { id_tenant: f.tenantId, id_modulo: modCons.id_modulo, habilitado: true },
        { id_tenant: f.tenantId, id_modulo: modRend.id_modulo, habilitado: true },
      ])

      const { error } = await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', f.tenantId)
        .in('id_modulo', [modCons.id_modulo, modRend.id_modulo])

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-con-estado-vivo/)
    })

    it('N2: devolución abierta (consignacion.estado = activa) bloquea apagar el paquete', async () => {
      const tenant = await createTenantWithUser('modop-03-n2')
      const modCons = await getModulo('consignaciones')
      const modRend = await getModulo('rendiciones')

      await serviceRole.from('tenant_modulo').upsert([
        { id_tenant: tenant.tenantId, id_modulo: modCons.id_modulo, habilitado: true },
        { id_tenant: tenant.tenantId, id_modulo: modRend.id_modulo, habilitado: true },
      ])

      // Proveedor
      const { data: prov } = await serviceRole
        .from('proveedor')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Prov Test', tipo: 'mayorista' })
        .select('id_proveedor')
        .single()

      // Lote de consignación activo (sin detalles)
      await serviceRole.from('consignacion').insert({
        id_tenant: tenant.tenantId,
        id_proveedor: prov!.id_proveedor,
        estado: 'activa',
      })

      const { error } = await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', tenant.tenantId)
        .in('id_modulo', [modCons.id_modulo, modRend.id_modulo])

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-con-estado-vivo/)
    })

    it('N3: venta sin rendir bloquea apagar el paquete', async () => {
      const f = await ventaFixture('modop-03-n3', 1, { tipoIngreso: 'consignacion' })
      const modCons = await getModulo('consignaciones')
      const modRend = await getModulo('rendiciones')

      await serviceRole.from('tenant_modulo').upsert([
        { id_tenant: f.tenantId, id_modulo: modCons.id_modulo, habilitado: true },
        { id_tenant: f.tenantId, id_modulo: modRend.id_modulo, habilitado: true },
      ])

      // Vender el ítem
      const { error: errVenta } = await venderContado(f)
      expect(errVenta).toBeNull()

      const { error } = await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', f.tenantId)
        .in('id_modulo', [modCons.id_modulo, modRend.id_modulo])

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-con-estado-vivo/)
    })

    it('N3.a: venta excluida de rendición NO bloquea apagar el paquete', async () => {
      const f = await ventaFixture('modop-03-n3a', 1, { tipoIngreso: 'consignacion' })
      const modCons = await getModulo('consignaciones')
      const modRend = await getModulo('rendiciones')

      await serviceRole.from('tenant_modulo').upsert([
        { id_tenant: f.tenantId, id_modulo: modCons.id_modulo, habilitado: true },
        { id_tenant: f.tenantId, id_modulo: modRend.id_modulo, habilitado: true },
      ])

      const { error: errVenta } = await venderContado(f)
      expect(errVenta).toBeNull()

      // Marcar detalle_venta como excluido
      await serviceRole
        .from('detalle_venta')
        .update({ excluida_rendicion: true })
        .eq('id_tenant', f.tenantId)

      const { error } = await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', f.tenantId)
        .in('id_modulo', [modCons.id_modulo, modRend.id_modulo])

      expect(error).toBeNull()
    })

    it('N3.b: venta devuelta por cliente NO bloquea apagar el paquete', async () => {
      const f = await ventaFixture('modop-03-n3b', 1, { tipoIngreso: 'consignacion' })
      const modCons = await getModulo('consignaciones')
      const modRend = await getModulo('rendiciones')

      await serviceRole.from('tenant_modulo').upsert([
        { id_tenant: f.tenantId, id_modulo: modCons.id_modulo, habilitado: true },
        { id_tenant: f.tenantId, id_modulo: modRend.id_modulo, habilitado: true },
      ])

      const { error: errVenta } = await venderContado(f)
      expect(errVenta).toBeNull()

      const { data: det } = await serviceRole
        .from('detalle_venta')
        .select('id_detalle_venta')
        .eq('id_item', f.items[0])
        .single()

      // Registrar devolución del cliente
      const { error: errDev } = await f.authenticated.rpc('sp_registrar_devolucion_cliente', {
        p_id_detalle_venta: det!.id_detalle_venta,
        p_motivo: 'Falla',
        p_id_cuenta_reintegro: f.idCuenta,
        p_medio_reintegro: 'efectivo',
      })
      expect(errDev).toBeNull()

      const { error } = await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', f.tenantId)
        .in('id_modulo', [modCons.id_modulo, modRend.id_modulo])

      expect(error).toBeNull()
    })

    it('N4: revendedora con stock en poder bloquea apagar revendedoras', async () => {
      const tenant = await createTenantWithUser('modop-03-n4a')
      const modRev = await getModulo('revendedoras')

      await serviceRole.from('tenant_modulo').upsert({
        id_tenant: tenant.tenantId,
        id_modulo: modRev.id_modulo,
        habilitado: true,
      })

      // Insertar producto e ítem con estado_item 'en_revendedora'
      const { data: cat } = await serviceRole
        .from('categoria')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Cat N4' })
        .select('id_categoria')
        .single()
      const { data: prod } = await serviceRole
        .from('producto')
        .insert({ id_tenant: tenant.tenantId, id_categoria: cat!.id_categoria, nombre: 'Prod N4' })
        .select('id_producto')
        .single()
      await serviceRole.from('item_producto').insert({
        id_tenant: tenant.tenantId,
        id_producto: prod!.id_producto,
        tipo_ingreso: 'compra',
        estado_item: 'en_revendedora',
        qr_code: `TEST-QR-${Date.now()}`,
      })

      const { error } = await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', tenant.tenantId)
        .eq('id_modulo', modRev.id_modulo)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-con-estado-vivo/)
    })

    it('N4: revendedora con consignacion abierta bloquea apagar revendedoras', async () => {
      const tenant = await createTenantWithUser('modop-03-n4b')
      const auth = await signInAs(tenant)
      const modRev = await getModulo('revendedoras')

      await serviceRole.from('tenant_modulo').upsert({
        id_tenant: tenant.tenantId,
        id_modulo: modRev.id_modulo,
        habilitado: true,
      })

      const { data: idRev } = await auth.rpc('sp_crear_revendedora', {
        p_nombre: 'Clara',
        p_apellido: 'Rev',
        p_email: 'clara@test.com',
      })

      await serviceRole.from('consignacion_revendedora').insert({
        id_tenant: tenant.tenantId,
        id_revendedora: idRev,
        estado: 'abierta',
      })

      const { error } = await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', tenant.tenantId)
        .eq('id_modulo', modRev.id_modulo)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-con-estado-vivo/)
    })

    it('N4: revendedora con liquidacion pendiente bloquea apagar revendedoras', async () => {
      const tenant = await createTenantWithUser('modop-03-n4c')
      const auth = await signInAs(tenant)
      const modRev = await getModulo('revendedoras')

      await serviceRole.from('tenant_modulo').upsert({
        id_tenant: tenant.tenantId,
        id_modulo: modRev.id_modulo,
        habilitado: true,
      })

      const { data: idRev } = await auth.rpc('sp_crear_revendedora', {
        p_nombre: 'Diana',
        p_apellido: 'Rev',
        p_email: 'diana@test.com',
      })

      await serviceRole.from('liquidacion_revendedora').insert({
        id_tenant: tenant.tenantId,
        id_revendedora: idRev,
        periodo_desde: '2026-10-01',
        periodo_hasta: '2026-10-15',
        monto_vendido: 10000,
        monto_comision: 2000,
        monto_a_cobrar: 8000,
        cantidad_lineas: 1,
        porcentaje_aplicado: 20,
        estado: 'pendiente',
      })

      const { error } = await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', tenant.tenantId)
        .eq('id_modulo', modRev.id_modulo)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-con-estado-vivo/)
    })

    it('N4: revendedora con declaracion pendiente bloquea apagar revendedoras', async () => {
      const tenant = await createTenantWithUser('modop-03-n4d')
      const auth = await signInAs(tenant)
      const modRev = await getModulo('revendedoras')

      await serviceRole.from('tenant_modulo').upsert({
        id_tenant: tenant.tenantId,
        id_modulo: modRev.id_modulo,
        habilitado: true,
      })

      const { data: idRev } = await auth.rpc('sp_crear_revendedora', {
        p_nombre: 'Elena',
        p_apellido: 'Rev',
        p_email: 'elena@test.com',
      })

      // Producto e item
      const { data: cat } = await serviceRole
        .from('categoria')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Cat N4d' })
        .select('id_categoria')
        .single()
      const { data: prod } = await serviceRole
        .from('producto')
        .insert({ id_tenant: tenant.tenantId, id_categoria: cat!.id_categoria, nombre: 'Prod N4d' })
        .select('id_producto')
        .single()
      const { data: item } = await serviceRole
        .from('item_producto')
        .insert({
          id_tenant: tenant.tenantId,
          id_producto: prod!.id_producto,
          tipo_ingreso: 'compra',
          estado_item: 'disponible',
          qr_code: `TEST-QR-DEC-${Date.now()}`,
        })
        .select('id_item')
        .single()

      await serviceRole.from('declaracion_venta_revendedora').insert({
        id_tenant: tenant.tenantId,
        id_revendedora: idRev,
        id_item: item!.id_item,
        estado: 'pendiente',
      })

      const { error } = await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', tenant.tenantId)
        .eq('id_modulo', modRev.id_modulo)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-con-estado-vivo/)
    })
  })

  describe('REQ-MODOP-10: SP de service-role no expuesto', () => {
    it('N1: authenticated no puede ejecutar sp_reactivar_acceso_revendedora', async () => {
      const tenant = await createTenantWithUser('modop-10-n1')
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_reactivar_acceso_revendedora', {
        p_id_revendedora: '00000000-0000-0000-0000-000000000001',
        p_id_usuario: '00000000-0000-0000-0000-000000000002',
        p_id_tenant: tenant.tenantId,
        p_nombre: 'Hacker',
        p_id_rol: tenant.rolId,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/permission denied/)
    })
  })

  describe('fn_modulo_habilitado(p_tenant, p_codigo)', () => {
    it('devuelve true si está habilitado y false si no', async () => {
      const tenant = await createTenantWithUser('modop-fn')
      const modRev = await getModulo('revendedoras')

      // Inicialmente revendedoras no está
      const { data: res1, error: err1 } = await serviceRole.rpc('fn_modulo_habilitado', {
        p_tenant: tenant.tenantId,
        p_codigo: 'revendedoras',
      })
      expect(err1).toBeNull()
      expect(res1).toBe(false)

      // Habilitar
      await serviceRole.from('tenant_modulo').upsert({
        id_tenant: tenant.tenantId,
        id_modulo: modRev.id_modulo,
        habilitado: true,
      })

      const { data: res2, error: err2 } = await serviceRole.rpc('fn_modulo_habilitado', {
        p_tenant: tenant.tenantId,
        p_codigo: 'revendedoras',
      })
      expect(err2).toBeNull()
      expect(res2).toBe(true)
    })
  })

  describe('fn_modulo_tiene_estado_vivo(p_tenant, p_codigo)', () => {
    it('devuelve false para tenant limpio y true cuando se genera estado', async () => {
      const tenant = await createTenantWithUser('modop-fn-vivo')

      const { data: limpio, error: errLimpio } = await serviceRole.rpc('fn_modulo_tiene_estado_vivo', {
        p_tenant: tenant.tenantId,
        p_codigo: 'consignaciones',
      })
      expect(errLimpio).toBeNull()
      expect(limpio).toBe(false)

      // Crear proveedor y devolución activa
      const { data: prov } = await serviceRole
        .from('proveedor')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Prov Vivo', tipo: 'mayorista' })
        .select('id_proveedor')
        .single()

      await serviceRole.from('consignacion').insert({
        id_tenant: tenant.tenantId,
        id_proveedor: prov!.id_proveedor,
        estado: 'activa',
      })

      const { data: conEstado, error: errEstado } = await serviceRole.rpc('fn_modulo_tiene_estado_vivo', {
        p_tenant: tenant.tenantId,
        p_codigo: 'consignaciones',
      })
      expect(errEstado).toBeNull()
      expect(conEstado).toBe(true)
    })
  })
})
