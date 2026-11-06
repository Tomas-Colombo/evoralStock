import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import {
  createTenantWithUser,
  hasTestDb,
  signInAs,
  unwrapFixture,
  withScopedTenant,
} from './_helpers'
import { habilitarPaqueteConsignacion } from './_fixtures-ventas'

describe.skipIf(!hasTestDb)('costo-unico — Escenario dorado y casos negativos (specs/golden.md)', () => {
  const serviceRole = createServiceRoleTestClient()

  async function setupFixture(prefix: string) {
    const fixture = await createTenantWithUser(withScopedTenant(prefix))
    const authAdmin = await signInAs(fixture)

    // Cuenta predeterminada para que sp_registrar_venta funcione con p_pagos null
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
          nombre: 'Ropa',
        })
        .select('id_categoria')
        .single(),
    )

    // Regla de margen global 50 %
    const { error: errRegla } = await authAdmin.rpc('sp_create_regla_precio', {
      p_nombre: 'Margen Global 50%',
      p_tipo_regla: 'margen',
      p_tipo_valor: 'porcentaje',
      p_valor: 0.5,
      p_alcance: 'global',
    })
    expect(errRegla).toBeNull()

    // Producto P
    const { data: idProducto, error: errProd } = await authAdmin.rpc('sp_create_producto', {
      p_id_categoria: categoria.id_categoria,
      p_nombre: 'Producto P',
      p_sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      p_stock_minimo: 0,
      p_descripcion: null,
    })
    expect(errProd).toBeNull()

    return {
      ...fixture,
      authAdmin,
      idProducto: idProducto as string,
      idCategoria: categoria.id_categoria as string,
    }
  }

  async function getCapital(tenantId: string, idProducto: string): Promise<number> {
    const { data, error } = await serviceRole
      .from('item_producto')
      .select('costo_ingreso')
      .eq('id_tenant', tenantId)
      .eq('id_producto', idProducto)
      .eq('tipo_ingreso', 'compra')
      .in('estado_item', ['disponible', 'reservado', 'en_revendedora'])

    expect(error).toBeNull()
    return (data ?? []).reduce((acc, row) => acc + Number(row.costo_ingreso), 0)
  }

  async function getCostoVigente(tenantId: string, idProducto: string) {
    const { data, error } = await serviceRole
      .from('costo_producto')
      .select('*')
      .eq('id_tenant', tenantId)
      .eq('id_producto', idProducto)
      .is('vigente_hasta', null)
      .maybeSingle()

    expect(error).toBeNull()
    return data
  }

  async function getProducto(tenantId: string, idProducto: string) {
    const { data, error } = await serviceRole
      .from('producto')
      .select('precio_venta, precio_venta_desactualizado')
      .eq('id_tenant', tenantId)
      .eq('id_producto', idProducto)
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    return data!
  }

  async function confirmarIngresoCompra(
    authAdmin: Awaited<ReturnType<typeof signInAs>>,
    tenantId: string,
    idProducto: string,
    cantidad: number,
    costoUnitario: number,
    tipoIngreso: 'compra' | 'consignacion' = 'compra',
  ): Promise<string> {
    const { data: ingreso, error: errIngreso } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({
        id_tenant: tenantId,
        tipo_ingreso: tipoIngreso,
        confirmado: false,
      })
      .select('id_ingreso')
      .single()
    expect(errIngreso).toBeNull()

    const { error: errDet } = await serviceRole
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: tenantId,
        id_ingreso: ingreso!.id_ingreso,
        id_producto: idProducto,
        cantidad,
        costo_unitario: costoUnitario,
        talle: 'U',
      })
    expect(errDet).toBeNull()

    const { error: errConf } = await authAdmin.rpc('sp_confirmar_ingreso', {
      p_id_ingreso: ingreso!.id_ingreso,
    })
    expect(errConf).toBeNull()

    return ingreso!.id_ingreso
  }

  it('Escenario dorado completo: E1–E7', async () => {
    const t = await setupFixture('golden-e')

    // E1: Ingreso confirmado: 5 u × 1.000
    // Esperado: Vigente 1.000. Precio resuelto 1.500. Capital 5.000.
    const idIngreso1 = await confirmarIngresoCompra(t.authAdmin, t.tenantId, t.idProducto, 5, 1000)

    const vigenteE1 = await getCostoVigente(t.tenantId, t.idProducto)
    expect(Number(vigenteE1?.costo)).toBe(1000)

    const { data: nuevoPrecioE1, error: errRecalcE1 } = await t.authAdmin.rpc('sp_recalcular_precio_venta', {
      p_id_producto: t.idProducto,
    })
    expect(errRecalcE1).toBeNull()
    expect(Number(nuevoPrecioE1)).toBe(1500)

    const prodE1 = await getProducto(t.tenantId, t.idProducto)
    expect(Number(prodE1.precio_venta)).toBe(1500)
    expect(prodE1.precio_venta_desactualizado).toBe(false)

    const capitalE1 = await getCapital(t.tenantId, t.idProducto)
    expect(capitalE1).toBe(5000)

    // Obtener ítems del ingreso 1
    const { data: itemsIngreso1 } = await serviceRole
      .from('item_producto')
      .select('id_item, costo_ingreso')
      .eq('id_ingreso', idIngreso1)
      .order('id_item')
    expect(itemsIngreso1).toHaveLength(5)
    itemsIngreso1?.forEach((item) => expect(Number(item.costo_ingreso)).toBe(1000))

    // E2: Venta A de 1 unidad de E1 a 1.500
    // Esperado: costo_snapshot 1.000, monto_ganancia 500. Capital 4.000.
    const itemVentaA = itemsIngreso1![0].id_item
    const { data: idVentaA, error: errVentaA } = await t.authAdmin.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: itemVentaA }],
      p_forma_pago: 'efectivo',
    })
    expect(errVentaA).toBeNull()

    const { data: detVentaA } = await serviceRole
      .from('detalle_venta')
      .select('precio_venta, costo_snapshot, monto_ganancia')
      .eq('id_venta', idVentaA)
      .single()
    expect(Number(detVentaA?.precio_venta)).toBe(1500)
    expect(Number(detVentaA?.costo_snapshot)).toBe(1000)
    expect(Number(detVentaA?.monto_ganancia)).toBe(500)

    const capitalE2 = await getCapital(t.tenantId, t.idProducto)
    expect(capitalE2).toBe(4000)

    // E3: Ingreso confirmado: 5 u × 1.300
    // Esperado: Vigente 1.300 (el de E1 cerrado).
    // Las 4 unidades de E1 en stock pasan a costo_ingreso 1.300.
    // P con precio_venta_desactualizado = true. Capital 11.700.
    const idIngreso2 = await confirmarIngresoCompra(t.authAdmin, t.tenantId, t.idProducto, 5, 1300)

    const vigenteE3 = await getCostoVigente(t.tenantId, t.idProducto)
    expect(Number(vigenteE3?.costo)).toBe(1300)

    // Verificar que el costo anterior de 1000 quedó cerrado
    const { data: anteriorCerrado } = await serviceRole
      .from('costo_producto')
      .select('*')
      .eq('id_costo', vigenteE1?.id_costo)
      .single()
    expect(anteriorCerrado?.vigente_hasta).not.toBeNull()

    // Las 4 unidades de E1 que siguen en stock deben haber pasado a 1.300
    const { data: itemsRestantesIngreso1 } = await serviceRole
      .from('item_producto')
      .select('id_item, costo_ingreso, estado_item')
      .eq('id_ingreso', idIngreso1)
      .neq('id_item', itemVentaA)
    expect(itemsRestantesIngreso1).toHaveLength(4)
    itemsRestantesIngreso1?.forEach((item) => {
      expect(Number(item.costo_ingreso)).toBe(1300)
    })

    // P con precio_venta_desactualizado = true
    const prodE3 = await getProducto(t.tenantId, t.idProducto)
    expect(prodE3.precio_venta_desactualizado).toBe(true)

    // Capital 11.700 (9 u en stock x 1.300)
    const capitalE3 = await getCapital(t.tenantId, t.idProducto)
    expect(capitalE3).toBe(11700)

    // E4: Resolver precio de P
    // Esperado: Precio 1.950.
    const { data: nuevoPrecioE4, error: errRecalcE4 } = await t.authAdmin.rpc('sp_recalcular_precio_venta', {
      p_id_producto: t.idProducto,
    })
    expect(errRecalcE4).toBeNull()
    expect(Number(nuevoPrecioE4)).toBe(1950)

    const prodE4 = await getProducto(t.tenantId, t.idProducto)
    expect(Number(prodE4.precio_venta)).toBe(1950)
    expect(prodE4.precio_venta_desactualizado).toBe(false)

    // E5: Venta B de 1 unidad de E1 a 1.950
    // Esperado: costo_snapshot 1.300, monto_ganancia 650.
    const itemVentaB = itemsRestantesIngreso1![0].id_item
    const { data: idVentaB, error: errVentaB } = await t.authAdmin.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: itemVentaB }],
      p_forma_pago: 'efectivo',
    })
    expect(errVentaB).toBeNull()

    const { data: detVentaB } = await serviceRole
      .from('detalle_venta')
      .select('precio_venta, costo_snapshot, monto_ganancia')
      .eq('id_venta', idVentaB)
      .single()
    expect(Number(detVentaB?.precio_venta)).toBe(1950)
    expect(Number(detVentaB?.costo_snapshot)).toBe(1300)
    expect(Number(detVentaB?.monto_ganancia)).toBe(650)

    // E6: Venta C de 1 unidad de E3 a 1.950
    // Esperado: costo_snapshot 1.300, monto_ganancia 650.
    const { data: itemsIngreso2 } = await serviceRole
      .from('item_producto')
      .select('id_item, costo_ingreso')
      .eq('id_ingreso', idIngreso2)
      .order('id_item')
    const itemVentaC = itemsIngreso2![0].id_item

    const { data: idVentaC, error: errVentaC } = await t.authAdmin.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: itemVentaC }],
      p_forma_pago: 'efectivo',
    })
    expect(errVentaC).toBeNull()

    const { data: detVentaC } = await serviceRole
      .from('detalle_venta')
      .select('precio_venta, costo_snapshot, monto_ganancia')
      .eq('id_venta', idVentaC)
      .single()
    expect(Number(detVentaC?.precio_venta)).toBe(1950)
    expect(Number(detVentaC?.costo_snapshot)).toBe(1300)
    expect(Number(detVentaC?.monto_ganancia)).toBe(650)

    // E7: Cierre
    // Ganancia acumulada 1.800 (500 + 650 + 650). Capital 9.100 (7 × 1.300).
    // La línea de venta A sigue con costo 1.000 y ganancia 500.
    const gananciaTotal =
      Number(detVentaA?.monto_ganancia) +
      Number(detVentaB?.monto_ganancia) +
      Number(detVentaC?.monto_ganancia)
    expect(gananciaTotal).toBe(1800)

    const capitalFinal = await getCapital(t.tenantId, t.idProducto)
    expect(capitalFinal).toBe(9100)

    // Comprobar inmutabilidad de la venta A histórica
    const { data: checkVentaA } = await serviceRole
      .from('detalle_venta')
      .select('precio_venta, costo_snapshot, monto_ganancia')
      .eq('id_venta', idVentaA)
      .single()
    expect(Number(checkVentaA?.costo_snapshot)).toBe(1000)
    expect(Number(checkVentaA?.monto_ganancia)).toBe(500)
  })

  it('N1: ingreso E3 en consignación actualiza vigente a 1.300 pero no toca unidades de E1', async () => {
    const t = await setupFixture('neg-n1')
    await habilitarPaqueteConsignacion(t.tenantId, serviceRole)

    // Ingreso compra inicial 5 u x 1000
    const idIngreso1 = await confirmarIngresoCompra(t.authAdmin, t.tenantId, t.idProducto, 5, 1000)

    // Ingreso consignación 5 u x 1300
    await confirmarIngresoCompra(t.authAdmin, t.tenantId, t.idProducto, 5, 1300, 'consignacion')

    // Vigente pasa a 1.300 (fija el precio de venta)
    const vigente = await getCostoVigente(t.tenantId, t.idProducto)
    expect(Number(vigente?.costo)).toBe(1300)

    // Unidades de E1 (compra) NO cambian: conservan 1.000
    const { data: itemsE1 } = await serviceRole
      .from('item_producto')
      .select('costo_ingreso')
      .eq('id_ingreso', idIngreso1)
    expect(itemsE1).toHaveLength(5)
    itemsE1?.forEach((item) => {
      expect(Number(item.costo_ingreso)).toBe(1000)
    })
  })

  it('N2: ingreso con dos líneas de P a 1.300 y 1.400 es rechazado con costos-distintos-mismo-producto', async () => {
    const t = await setupFixture('neg-n2')

    const { data: ingreso } = await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: t.tenantId, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    // Importar remito con dos líneas del mismo producto con distintos costos
    const { error: errImport } = await t.authAdmin.rpc('sp_importar_remito', {
      p_id_ingreso: ingreso!.id_ingreso,
      p_moneda: 'ARS',
      p_lineas: [
        {
          idProducto: t.idProducto,
          esNuevo: false,
          nombre: 'Producto P',
          costoUnitario: 1300,
          partes: [{ talle: 'S', cantidad: 2 }],
        },
        {
          idProducto: t.idProducto,
          esNuevo: false,
          nombre: 'Producto P',
          costoUnitario: 1400,
          partes: [{ talle: 'M', cantidad: 3 }],
        },
      ],
    })

    expect(errImport).not.toBeNull()
    expect(errImport?.message).toContain('costos-distintos-mismo-producto')

    // Nada confirmado ni ingresado
    const { data: detalles } = await serviceRole
      .from('ingreso_mercaderia_detalle')
      .select('*')
      .eq('id_ingreso', ingreso!.id_ingreso)
    expect(detalles).toHaveLength(0)
  })

  it('N3: reestock al mismo costo 1.000 es idempotente (no-op en costo_producto, sin auditoría, precio no desactualizado)', async () => {
    const t = await setupFixture('neg-n3')

    // E1 inicial a 1.000
    await confirmarIngresoCompra(t.authAdmin, t.tenantId, t.idProducto, 5, 1000)
    await t.authAdmin.rpc('sp_recalcular_precio_venta', { p_id_producto: t.idProducto })

    const vigenteAntes = await getCostoVigente(t.tenantId, t.idProducto)

    const { count: auditAntes } = await serviceRole
      .from('auditoria')
      .select('*', { count: 'exact', head: true })
      .eq('id_tenant', t.tenantId)
      .eq('entidad', 'costo_producto')

    // Reestock al mismo costo 1.000
    await confirmarIngresoCompra(t.authAdmin, t.tenantId, t.idProducto, 3, 1000)

    const vigenteDespues = await getCostoVigente(t.tenantId, t.idProducto)
    expect(vigenteDespues?.id_costo).toBe(vigenteAntes?.id_costo)

    const { count: auditDespues } = await serviceRole
      .from('auditoria')
      .select('*', { count: 'exact', head: true })
      .eq('id_tenant', t.tenantId)
      .eq('entidad', 'costo_producto')
    expect(auditDespues).toBe(auditAntes)

    const prod = await getProducto(t.tenantId, t.idProducto)
    expect(prod.precio_venta_desactualizado).toBe(false)
  })

  it('N4: unidad de E1 reservada antes de E3 pasa a 1.300 igual que las disponibles', async () => {
    const t = await setupFixture('neg-n4')

    const idIngreso1 = await confirmarIngresoCompra(t.authAdmin, t.tenantId, t.idProducto, 5, 1000)

    const { data: items } = await serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_ingreso', idIngreso1)
      .order('id_item')

    const itemReservado = items![0].id_item

    // Transicionar el ítem a reservado
    const { error: errTrans } = await t.authAdmin.rpc('sp_transicion_item_producto', {
      p_id_item: itemReservado,
      p_estado_hasta: 'reservado',
      p_tipo_movimiento: 'reserva',
    })
    expect(errTrans).toBeNull()

    // Confirmar reestock a 1.300
    await confirmarIngresoCompra(t.authAdmin, t.tenantId, t.idProducto, 5, 1300)

    const { data: itemVerif } = await serviceRole
      .from('item_producto')
      .select('costo_ingreso, estado_item')
      .eq('id_item', itemReservado)
      .single()
    expect(itemVerif?.estado_item).toBe('reservado')
    expect(Number(itemVerif?.costo_ingreso)).toBe(1300)
  })

  it('N5: unidad de E1 en baja o devuelto_cliente antes de E3 conserva 1.000', async () => {
    const t = await setupFixture('neg-n5')

    const idIngreso1 = await confirmarIngresoCompra(t.authAdmin, t.tenantId, t.idProducto, 5, 1000)

    const { data: items } = await serviceRole
      .from('item_producto')
      .select('id_item')
      .eq('id_ingreso', idIngreso1)
      .order('id_item')

    const itemBaja = items![0].id_item

    // Mover a baja
    const { error: errBaja } = await t.authAdmin.rpc('sp_transicion_item_producto', {
      p_id_item: itemBaja,
      p_estado_hasta: 'baja',
      p_tipo_movimiento: 'baja',
    })
    expect(errBaja).toBeNull()

    // Reestock a 1.300
    await confirmarIngresoCompra(t.authAdmin, t.tenantId, t.idProducto, 5, 1300)

    const { data: itemVerif } = await serviceRole
      .from('item_producto')
      .select('costo_ingreso, estado_item')
      .eq('id_item', itemBaja)
      .single()
    expect(itemVerif?.estado_item).toBe('baja')
    expect(Number(itemVerif?.costo_ingreso)).toBe(1000)
  })

  it('N6: otro tenant con el mismo producto no ve ni modifica nada', async () => {
    const t1 = await setupFixture('neg-n6-t1')
    const t2 = await setupFixture('neg-n6-t2')

    // T1 y T2 ingresan stock inicial a 1.000
    await confirmarIngresoCompra(t1.authAdmin, t1.tenantId, t1.idProducto, 5, 1000)
    const idIngresoT2 = await confirmarIngresoCompra(t2.authAdmin, t2.tenantId, t2.idProducto, 5, 1000)

    // T1 reestockea a 1.300
    await confirmarIngresoCompra(t1.authAdmin, t1.tenantId, t1.idProducto, 5, 1300)

    // T2 debe seguir con costo vigente 1.000 y sus unidades a 1.000
    const vigenteT2 = await getCostoVigente(t2.tenantId, t2.idProducto)
    expect(Number(vigenteT2?.costo)).toBe(1000)

    const { data: itemsT2 } = await serviceRole
      .from('item_producto')
      .select('costo_ingreso')
      .eq('id_ingreso', idIngresoT2)
    expect(itemsT2).toHaveLength(5)
    itemsT2?.forEach((item) => {
      expect(Number(item.costo_ingreso)).toBe(1000)
    })

    const capitalT2 = await getCapital(t2.tenantId, t2.idProducto)
    expect(capitalT2).toBe(5000)
  })
})
