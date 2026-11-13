import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, hasTestDb, signInAs } from './_helpers'

describe.skipIf(!hasTestDb)('Tablas del núcleo extendidas por consignación — REQ-MODOP-05, 06, 03', () => {
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

  async function habilitarPaqueteConsignacion(tenantId: string) {
    const modCons = await getModulo('consignaciones')
    const modRend = await getModulo('rendiciones')
    const { error } = await serviceRole.from('tenant_modulo').upsert([
      { id_tenant: tenantId, id_modulo: modCons.id_modulo, habilitado: true },
      { id_tenant: tenantId, id_modulo: modRend.id_modulo, habilitado: true },
    ])
    expect(error).toBeNull()
  }

  async function deshabilitarPaqueteConsignacion(tenantId: string) {
    const modCons = await getModulo('consignaciones')
    const modRend = await getModulo('rendiciones')
    return serviceRole
      .from('tenant_modulo')
      .update({ habilitado: false })
      .eq('id_tenant', tenantId)
      .in('id_modulo', [modCons.id_modulo, modRend.id_modulo])
  }

  describe('REQ-MODOP-05: Guarda en ingreso_mercaderia', () => {
    it('REQ-MODOP-05 N2: insert de tipo_ingreso consignacion sin paquete levanta module-disabled', async () => {
      const tenant = await createTenantWithUser('modop-05-n2-ins')

      // Crear proveedor base (mayorista)
      const { data: prov, error: errProv } = await serviceRole
        .from('proveedor')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Prov Base', tipo: 'mayorista' })
        .select('id_proveedor')
        .single()
      expect(errProv).toBeNull()

      // Intento de alta directa con tipo_ingreso = 'consignacion' sin el paquete
      const { error } = await serviceRole.from('ingreso_mercaderia').insert({
        id_tenant: tenant.tenantId,
        id_proveedor: prov!.id_proveedor,
        tipo_ingreso: 'consignacion',
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/module-disabled/)
    })

    it('REQ-MODOP-05 N2: update de tipo_ingreso a consignacion sin paquete levanta module-disabled', async () => {
      const tenant = await createTenantWithUser('modop-05-n2-upd')

      const { data: prov, error: errProv } = await serviceRole
        .from('proveedor')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Prov Base 2', tipo: 'mayorista' })
        .select('id_proveedor')
        .single()
      expect(errProv).toBeNull()

      // Alta válida de tipo compra
      const { data: ingreso, error: errIngreso } = await serviceRole
        .from('ingreso_mercaderia')
        .insert({
          id_tenant: tenant.tenantId,
          id_proveedor: prov!.id_proveedor,
          tipo_ingreso: 'compra',
        })
        .select('id_ingreso')
        .single()
      expect(errIngreso).toBeNull()

      // Intentar cambiar tipo_ingreso a consignacion sin el paquete
      const { error: errUpdate } = await serviceRole
        .from('ingreso_mercaderia')
        .update({ tipo_ingreso: 'consignacion' })
        .eq('id_ingreso', ingreso!.id_ingreso)

      expect(errUpdate).not.toBeNull()
      expect(errUpdate?.message).toMatch(/module-disabled/)
    })

    it('REQ-MODOP-05 Feliz: alta de compra pasa sin paquete, y consignacion pasa con paquete habilitado', async () => {
      const tenant = await createTenantWithUser('modop-05-ok')

      const { data: prov } = await serviceRole
        .from('proveedor')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Prov Base 3', tipo: 'mayorista' })
        .select('id_proveedor')
        .single()

      // 1. Sin paquete, alta de compra pasa
      const { error: errCompra } = await serviceRole.from('ingreso_mercaderia').insert({
        id_tenant: tenant.tenantId,
        id_proveedor: prov!.id_proveedor,
        tipo_ingreso: 'compra',
      })
      expect(errCompra).toBeNull()

      // 2. Con paquete habilitado, alta de consignación pasa
      await habilitarPaqueteConsignacion(tenant.tenantId)

      const { error: errConsignacion } = await serviceRole.from('ingreso_mercaderia').insert({
        id_tenant: tenant.tenantId,
        id_proveedor: prov!.id_proveedor,
        tipo_ingreso: 'consignacion',
      })
      expect(errConsignacion).toBeNull()
    })

    it('REQ-MODOP-05 N5 (a): sp_crear_stock_directo con tipo consignacion sin paquete levanta module-disabled', async () => {
      const tenant = await createTenantWithUser('modop-05-n5-dir')
      const auth = await signInAs(tenant)

      const { data: cat } = await serviceRole
        .from('categoria')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Cat Directo N5' })
        .select('id_categoria')
        .single()

      const { data: prod } = await serviceRole
        .from('producto')
        .insert({ id_tenant: tenant.tenantId, id_categoria: cat!.id_categoria, nombre: 'Prod Directo N5' })
        .select('id_producto')
        .single()

      const { error } = await auth.rpc('sp_crear_stock_directo', {
        p_id_producto: prod!.id_producto,
        p_costo: 1000,
        p_tipo_ingreso: 'consignacion',
        p_items: [{ talle: 'M', cantidad: 1 }],
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/module-disabled/)
    })

    it('REQ-MODOP-05 N5 (b): sp_confirmar_ingreso de borrador consignacion tras apagar el paquete levanta module-disabled', async () => {
      const tenant = await createTenantWithUser('modop-05-n5-borr')
      const auth = await signInAs(tenant)

      // 1. Habilitar el paquete para crear el borrador consignacion
      await habilitarPaqueteConsignacion(tenant.tenantId)

      const { data: prov } = await serviceRole
        .from('proveedor')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Prov Borrador N5', tipo: 'consignatario' })
        .select('id_proveedor')
        .single()

      const { data: cat } = await serviceRole
        .from('categoria')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Cat Borrador N5' })
        .select('id_categoria')
        .single()

      const { data: prod } = await serviceRole
        .from('producto')
        .insert({ id_tenant: tenant.tenantId, id_categoria: cat!.id_categoria, nombre: 'Prod Borrador N5' })
        .select('id_producto')
        .single()

      // Crear ingreso en borrador (confirmado = false)
      const { data: ingreso } = await serviceRole
        .from('ingreso_mercaderia')
        .insert({
          id_tenant: tenant.tenantId,
          id_proveedor: prov!.id_proveedor,
          tipo_ingreso: 'consignacion',
          confirmado: false,
        })
        .select('id_ingreso')
        .single()

      // Detalle del ingreso
      const { data: det, error: detErr } = await serviceRole
        .from('ingreso_mercaderia_detalle')
        .insert({
          id_ingreso: ingreso!.id_ingreso,
          id_tenant: tenant.tenantId,
          id_producto: prod!.id_producto,
          cantidad: 2,
          talle: 'L',
        })
        .select('id_detalle')
        .single()
      expect(detErr).toBeNull()

      const { error: detCostoErr } = await serviceRole
        .from('ingreso_detalle_costo')
        .insert({
          id_detalle: det!.id_detalle,
          id_tenant: tenant.tenantId,
          costo_unitario: 500,
        })
      expect(detCostoErr).toBeNull()

      // 2. Apagar paquete (sin ítems generados no hay estado vivo, pasa ok)
      const { error: errApagar } = await deshabilitarPaqueteConsignacion(tenant.tenantId)
      expect(errApagar).toBeNull()

      // 3. Confirmar con el cliente autenticado del tenant
      const { error: errConfirmar } = await auth.rpc('sp_confirmar_ingreso', {
        p_id_ingreso: ingreso!.id_ingreso,
      })

      expect(errConfirmar).not.toBeNull()
      expect(errConfirmar?.message).toMatch(/module-disabled/)
    })

    it('REQ-MODOP-05 N5 (c): insert directo en item_producto con tipo consignacion sin paquete levanta module-disabled', async () => {
      const tenant = await createTenantWithUser('modop-05-n5-ins')

      const { data: cat } = await serviceRole
        .from('categoria')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Cat Directo Ins' })
        .select('id_categoria')
        .single()

      const { data: prod } = await serviceRole
        .from('producto')
        .insert({ id_tenant: tenant.tenantId, id_categoria: cat!.id_categoria, nombre: 'Prod Directo Ins' })
        .select('id_producto')
        .single()

      const { error } = await serviceRole.from('item_producto').insert({
        id_tenant: tenant.tenantId,
        id_producto: prod!.id_producto,
        tipo_ingreso: 'consignacion',
        estado_item: 'disponible',
        qr_code: `TEST-QR-N5-INS-${Date.now()}`,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/module-disabled/)
    })
  })

  describe('REQ-MODOP-06: Guarda en proveedor', () => {
    it('REQ-MODOP-06 N2: insert de proveedor consignatario sin paquete levanta module-disabled', async () => {
      const tenant = await createTenantWithUser('modop-06-n2-ins')

      const { error } = await serviceRole.from('proveedor').insert({
        id_tenant: tenant.tenantId,
        nombre: 'Prov Consignatario No Autorizado',
        tipo: 'consignatario',
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/module-disabled/)
    })

    it('REQ-MODOP-06 N2: update de tipo a consignatario en proveedor existente levanta module-disabled sin el paquete', async () => {
      const tenant = await createTenantWithUser('modop-06-n2-upd')

      const { data: prov, error: errProv } = await serviceRole
        .from('proveedor')
        .insert({
          id_tenant: tenant.tenantId,
          nombre: 'Prov Mayorista Original',
          tipo: 'mayorista',
        })
        .select('id_proveedor')
        .single()
      expect(errProv).toBeNull()

      // Cambiar tipo a consignatario sin paquete
      const { error: errUpdate } = await serviceRole
        .from('proveedor')
        .update({ tipo: 'consignatario' })
        .eq('id_proveedor', prov!.id_proveedor)

      expect(errUpdate).not.toBeNull()
      expect(errUpdate?.message).toMatch(/module-disabled/)
    })

    it('REQ-MODOP-06 N3: proveedor histórico consignatario se edita sin cambiarle el tipo aunque el paquete esté apagado', async () => {
      const tenant = await createTenantWithUser('modop-06-n3')

      // Habilitar paquete para crear proveedor consignatario
      await habilitarPaqueteConsignacion(tenant.tenantId)

      const { data: prov, error: errProv } = await serviceRole
        .from('proveedor')
        .insert({
          id_tenant: tenant.tenantId,
          nombre: 'Consignatario Historico',
          tipo: 'consignatario',
          telefono: '1111-1111',
        })
        .select('id_proveedor')
        .single()
      expect(errProv).toBeNull()

      // Apagar paquete (no hay estado vivo de stock ni rendiciones)
      const { error: errApagar } = await deshabilitarPaqueteConsignacion(tenant.tenantId)
      expect(errApagar).toBeNull()

      // REQ-MODOP-06 N3: editar otras columnas del proveedor histórico conservando su tipo no levanta error
      const { error: errEdit } = await serviceRole
        .from('proveedor')
        .update({
          telefono: '2222-2222',
          notas: 'Actualización de contacto sin cambiar tipo',
        })
        .eq('id_proveedor', prov!.id_proveedor)

      expect(errEdit).toBeNull()

      // Verificar que el tipo sigue siendo consignatario y el teléfono se actualizó
      const { data: provActualizado, error: errGet } = await serviceRole
        .from('proveedor')
        .select('tipo, telefono, notas')
        .eq('id_proveedor', prov!.id_proveedor)
        .single()

      expect(errGet).toBeNull()
      expect(provActualizado?.tipo).toBe('consignatario')
      expect(provActualizado?.telefono).toBe('2222-2222')
    })
  })

  describe('REQ-MODOP-03: Estado vivo con ítems en revendedora', () => {
    it('REQ-MODOP-03 N1: ítem consignacion en estado en_revendedora bloquea apagar el paquete con modulo-con-estado-vivo', async () => {
      const tenant = await createTenantWithUser('modop-03-n1-rev')

      // Habilitar paquete de consignación y revendedoras
      await habilitarPaqueteConsignacion(tenant.tenantId)
      const modRev = await getModulo('revendedoras')
      await serviceRole.from('tenant_modulo').upsert({
        id_tenant: tenant.tenantId,
        id_modulo: modRev.id_modulo,
        habilitado: true,
      })

      // Crear categoria y producto
      const { data: cat } = await serviceRole
        .from('categoria')
        .insert({ id_tenant: tenant.tenantId, nombre: 'Cat Modop 03' })
        .select('id_categoria')
        .single()

      const { data: prod } = await serviceRole
        .from('producto')
        .insert({
          id_tenant: tenant.tenantId,
          id_categoria: cat!.id_categoria,
          nombre: 'Prod Modop 03',
        })
        .select('id_producto')
        .single()

      // Crear un ítem de consignación que fue entregado a una revendedora (estado_item = 'en_revendedora')
      const { error: errItem } = await serviceRole.from('item_producto').insert({
        id_tenant: tenant.tenantId,
        id_producto: prod!.id_producto,
        tipo_ingreso: 'consignacion',
        estado_item: 'en_revendedora',
        qr_code: `TEST-QR-REV-VIVO-${Date.now()}`,
      })
      expect(errItem).toBeNull()

      // fn_modulo_tiene_estado_vivo debe reportar true para consignaciones
      const { data: tieneEstado, error: errRpc } = await serviceRole.rpc('fn_modulo_tiene_estado_vivo', {
        p_tenant: tenant.tenantId,
        p_codigo: 'consignaciones',
      })
      expect(errRpc).toBeNull()
      expect(tieneEstado).toBe(true)

      // Intentar deshabilitar el paquete consignaciones + rendiciones
      const { error: errDeshabilitar } = await deshabilitarPaqueteConsignacion(tenant.tenantId)

      expect(errDeshabilitar).not.toBeNull()
      expect(errDeshabilitar?.message).toMatch(/modulo-con-estado-vivo/)
    })
  })
})
