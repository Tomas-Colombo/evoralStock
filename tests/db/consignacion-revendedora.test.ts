import { describe, expect, test } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { hasTestDb } from './_helpers'
import { ventaFixture, venderContado } from './_fixtures-ventas'

async function habilitarModuloRevendedoras(tenantId: string) {
  const sr = createServiceRoleTestClient()
  const { data: mod, error: modErr } = await sr
    .from('modulo')
    .select('id_modulo')
    .eq('codigo', 'revendedoras')
    .single()
  expect(modErr).toBeNull()
  const { error } = await sr
    .from('tenant_modulo')
    .upsert({ id_tenant: tenantId, id_modulo: mod!.id_modulo, habilitado: true })
  expect(error).toBeNull()
}

describe.skipIf(!hasTestDb)('Consignación de salida a revendedora — Slice 3 (REQ-RV-DB-03)', () => {
  test('ciclo completo: borrador, edición, confirmación (mueve a en_revendedora), devolución (disponible y baja), cierre y auditoría', async () => {
    const f = await ventaFixture('ConsigCiclo', 3, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { data: idRev, error: errRev } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Lucía',
      p_apellido: 'Gómez',
    })
    expect(errRev).toBeNull()

    // 1. Crear consignación en borrador con 2 ítems
    const { data: idConsig, error: errCrear } = await f.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      {
        p_id_revendedora: idRev,
        p_items: [f.items[0], f.items[1]],
        p_periodo_desde: '2026-10-01',
        p_periodo_hasta: '2026-10-31',
        p_observaciones: 'Borrador inicial',
        p_motivo: 'Entrega temporada',
      },
    )
    expect(errCrear).toBeNull()
    expect(idConsig).toBeTruthy()

    // En borrador los ítems siguen físicamente en 'disponible'
    const { data: itemsBorrador } = await f.serviceRole
      .from('item_producto')
      .select('id_item, estado_item')
      .in('id_item', [f.items[0], f.items[1]])
    expect(itemsBorrador?.every((i) => i.estado_item === 'disponible')).toBe(true)

    // 2. Editar observaciones y período en borrador
    const { error: errEditar } = await f.authenticated.rpc('sp_editar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idConsig,
      p_observaciones: 'Observación actualizada',
      p_periodo_desde: '2026-10-02',
      p_periodo_hasta: '2026-10-30',
    })
    expect(errEditar).toBeNull()

    // 3. Confirmar consignación: mueve ítems a 'en_revendedora' y detalles a 'en_poder'
    const { data: confirmados, error: errConfirmar } = await f.authenticated.rpc(
      'sp_confirmar_consignacion_revendedora',
      { p_id_consignacion_revendedora: idConsig },
    )
    expect(errConfirmar).toBeNull()
    expect(confirmados).toBe(2)

    const { data: itemsConfirmados } = await f.serviceRole
      .from('item_producto')
      .select('id_item, estado_item')
      .in('id_item', [f.items[0], f.items[1]])
    expect(itemsConfirmados?.every((i) => i.estado_item === 'en_revendedora')).toBe(true)

    // 4. Stock por tenencia refleja 1 disponible central y 2 en revendedoras
    const { data: tenencia, error: errTenencia } = await f.authenticated.rpc(
      'rf_stock_por_tenencia',
      { p_id_producto: f.idProducto },
    )
    expect(errTenencia).toBeNull()
    expect(tenencia).toHaveLength(1)
    expect(Number(tenencia![0].disponible_central)).toBe(1)
    expect(Number(tenencia![0].en_revendedoras)).toBe(2)

    // 5. No se puede dar de baja a la revendedora ni cerrar la consignación con ítems en poder
    const { error: errBajaRev } = await f.authenticated.rpc('sp_baja_revendedora', {
      p_id: idRev,
    })
    expect(errBajaRev).not.toBeNull()
    expect(errBajaRev?.message).toMatch(/revendedora-con-stock/)

    const { error: errCerrarConStock } = await f.authenticated.rpc(
      'sp_cerrar_consignacion_revendedora',
      { p_id_consignacion_revendedora: idConsig },
    )
    expect(errCerrarConStock).not.toBeNull()
    expect(errCerrarConStock?.message).toMatch(/consignacion-con-items-en-poder/)

    // 6. Devolución sana del ítem 0 (vuelve a disponible) y devolución dañada del ítem 1 (pasa a baja)
    const { data: dev1, error: errDev1 } = await f.authenticated.rpc(
      'sp_registrar_devolucion_revendedora',
      {
        p_id_consignacion_revendedora: idConsig,
        p_items: [f.items[0]],
        p_estado_destino: 'disponible',
        p_motivo: 'No se vendió',
      },
    )
    expect(errDev1).toBeNull()
    expect(dev1).toBe(1)

    const { data: dev2, error: errDev2 } = await f.authenticated.rpc(
      'sp_registrar_devolucion_revendedora',
      {
        p_id_consignacion_revendedora: idConsig,
        p_items: [f.items[1]],
        p_estado_destino: 'baja',
        p_motivo: 'Volvió roto',
      },
    )
    expect(errDev2).toBeNull()
    expect(dev2).toBe(1)

    const { data: item0 } = await f.serviceRole
      .from('item_producto')
      .select('estado_item')
      .eq('id_item', f.items[0])
      .single()
    const { data: item1 } = await f.serviceRole
      .from('item_producto')
      .select('estado_item')
      .eq('id_item', f.items[1])
      .single()
    expect(item0?.estado_item).toBe('disponible')
    expect(item1?.estado_item).toBe('baja')

    // 7. Ahora sí se puede cerrar la consignación y dar de baja a la revendedora
    const { error: errCerrarOk } = await f.authenticated.rpc(
      'sp_cerrar_consignacion_revendedora',
      { p_id_consignacion_revendedora: idConsig },
    )
    expect(errCerrarOk).toBeNull()

    const { error: errBajaOk } = await f.authenticated.rpc('sp_baja_revendedora', {
      p_id: idRev,
    })
    expect(errBajaOk).toBeNull()

    // 8. Verificar auditoría de todas las operaciones
    const { data: audits } = await f.serviceRole
      .from('auditoria')
      .select('accion')
      .eq('entidad', 'consignacion_revendedora')
      .eq('entidad_id', idConsig)
    const acciones = (audits ?? []).map((a) => a.accion)
    expect(acciones).toEqual(
      expect.arrayContaining(['crear', 'editar', 'confirmar', 'devolucion', 'cerrar']),
    )
  })

  test('rechaza ítems reservado, vendido o ya en_revendedora y evita mismo ítem en dos consignaciones abiertas', async () => {
    const f = await ventaFixture('ConsigRechazos', 4, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { data: idRev1 } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Ana',
      p_apellido: 'Uno',
    })
    const { data: idRev2 } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Bea',
      p_apellido: 'Dos',
    })

    // Item 0: lo vendemos ('vendido')
    await venderContado(f, { items: [f.items[0]] })

    // Item 1: lo pasamos a 'reservado'
    const { error: errRes } = await f.authenticated.rpc('sp_transicion_item_producto', {
      p_id_item: f.items[1],
      p_estado_hasta: 'reservado',
      p_tipo_movimiento: 'reserva',
    })
    expect(errRes).toBeNull()

    // Intentar entregar item vendido -> item-no-entregable
    const { error: errVendido } = await f.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      { p_id_revendedora: idRev1, p_items: [f.items[0]] },
    )
    expect(errVendido?.message).toMatch(/item-no-entregable/)

    // Intentar entregar item reservado -> item-no-entregable
    const { error: errReservado } = await f.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      { p_id_revendedora: idRev1, p_items: [f.items[1]] },
    )
    expect(errReservado?.message).toMatch(/item-no-entregable/)

    // Item 2: entra en consignación abierta de Rev 1
    const { data: idConsig1, error: errC1 } = await f.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      { p_id_revendedora: idRev1, p_items: [f.items[2]] },
    )
    expect(errC1).toBeNull()

    // Intentar meter el mismo Item 2 en otra consignación abierta (incluso en borrador) -> rechazado
    const { error: errDobleAbierta } = await f.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      { p_id_revendedora: idRev2, p_items: [f.items[2]] },
    )
    expect(errDobleAbierta?.message).toMatch(/item-ya-en-consignacion-revendedora/)

    // Confirmamos la consignación 1 (Item 2 pasa a en_revendedora)
    await f.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idConsig1,
    })

    // Intentar entregar Item 2 que ya está en_revendedora -> item-no-entregable
    const { error: errYaEnRev } = await f.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      { p_id_revendedora: idRev2, p_items: [f.items[2]] },
    )
    expect(errYaEnRev?.message).toMatch(/item-no-entregable/)

    // Intentar eliminar consignación ya confirmada -> rechazado (solo borrador)
    const { error: errElimConfirmada } = await f.authenticated.rpc(
      'sp_eliminar_consignacion_revendedora',
      { p_id_consignacion_revendedora: idConsig1 },
    )
    expect(errElimConfirmada?.message).toMatch(/consignacion-confirmada/)

    // Crear un borrador con Item 3 y eliminarlo -> permitido y libera el ítem para otra consignación
    const { data: idBorrador } = await f.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      { p_id_revendedora: idRev1, p_items: [f.items[3]] },
    )
    const { error: errElimBorrador } = await f.authenticated.rpc(
      'sp_eliminar_consignacion_revendedora',
      { p_id_consignacion_revendedora: idBorrador },
    )
    expect(errElimBorrador).toBeNull()
  })

  test('aislamiento multitenant, módulo apagado y anti-cruce de tenant (MOD-09)', async () => {
    const fA = await ventaFixture('ConsigTenantA', 1, { tipoIngreso: 'compra' })
    const fB = await ventaFixture('ConsigTenantB', 1, { tipoIngreso: 'compra' })

    // Con el módulo apagado en B, falla con modulo-revendedoras-deshabilitado
    const { error: errModApagado } = await fB.authenticated.rpc(
      'rf_stock_por_tenencia',
    )
    expect(errModApagado?.message).toMatch(/modulo-revendedoras-deshabilitado/)

    await habilitarModuloRevendedoras(fA.tenantId)
    await habilitarModuloRevendedoras(fB.tenantId)

    const { data: idRevA } = await fA.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'RevA',
      p_apellido: 'TenantA',
    })
    const { data: idRevB } = await fB.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'RevB',
      p_apellido: 'TenantB',
    })

    const { data: idConsigA, error: errCA } = await fA.authenticated.rpc(
      'sp_crear_consignacion_revendedora_con_items',
      { p_id_revendedora: idRevA, p_items: [fA.items[0]] },
    )
    expect(errCA).toBeNull()

    // B no ve la consignación de A
    const { data: vistaPorB } = await fB.authenticated
      .from('consignacion_revendedora')
      .select('id_consignacion_revendedora')
    expect(vistaPorB).toEqual([])

    // MOD-09: inserción cruzada directa (incluso con serviceRole) debe fallar por FK compuesta / trigger
    const { error: errCrossCabecera } = await fA.serviceRole
      .from('consignacion_revendedora')
      .insert({
        id_tenant: fA.tenantId,
        id_revendedora: idRevB, // revendedora de B en tenant A
      })
    expect(errCrossCabecera).not.toBeNull()

    const { error: errCrossDetalleItem } = await fA.serviceRole
      .from('consignacion_revendedora_detalle')
      .insert({
        id_tenant: fA.tenantId,
        id_consignacion_revendedora: idConsigA,
        id_item: fB.items[0], // ítem de B en consignación de A
        id_producto: fA.idProducto,
      })
    expect(errCrossDetalleItem).not.toBeNull()
  })

  test('entrega en un paso y devolución por revendedora a través de varias consignaciones', async () => {
    const f = await ventaFixture('ConsigEntrega', 4, { tipoIngreso: 'compra' })
    await habilitarModuloRevendedoras(f.tenantId)

    const { data: idRev } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Ana',
      p_apellido: 'Paz',
    })
    const { data: idOtra } = await f.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Otra',
      p_apellido: 'Rev',
    })

    // Sin borrador: la entrega deja la consignación confirmada y los ítems en poder.
    const { data: idC1, error: errC1 } = await f.authenticated.rpc(
      'sp_entregar_consignacion_revendedora',
      { p_id_revendedora: idRev, p_items: [f.items[0], f.items[1]] },
    )
    expect(errC1).toBeNull()
    const { data: idC2, error: errC2 } = await f.authenticated.rpc(
      'sp_entregar_consignacion_revendedora',
      { p_id_revendedora: idRev, p_items: [f.items[2]] },
    )
    expect(errC2).toBeNull()
    const { error: errOtra } = await f.authenticated.rpc('sp_entregar_consignacion_revendedora', {
      p_id_revendedora: idOtra,
      p_items: [f.items[3]],
    })
    expect(errOtra).toBeNull()

    const { data: cabeceras } = await f.serviceRole
      .from('consignacion_revendedora')
      .select('id_consignacion_revendedora, confirmada')
      .in('id_consignacion_revendedora', [idC1, idC2])
    expect(cabeceras?.every((c) => c.confirmada)).toBe(true)

    // Un rechazo no deja cabecera huérfana: el ítem ya está en poder.
    const { error: errRepetido } = await f.authenticated.rpc('sp_entregar_consignacion_revendedora', {
      p_id_revendedora: idRev,
      p_items: [f.items[0]],
    })
    expect(errRepetido?.message).toMatch(/item-no-entregable/)
    const { count: totalConsig } = await f.serviceRole
      .from('consignacion_revendedora')
      .select('id_consignacion_revendedora', { count: 'exact', head: true })
      .eq('id_revendedora', idRev)
    expect(totalConsig).toBe(2)

    // Un ítem de otra revendedora rechaza toda la devolución.
    const { error: errAjeno } = await f.authenticated.rpc('sp_devolver_items_revendedora', {
      p_id_revendedora: idRev,
      p_items: [f.items[0], f.items[3]],
    })
    expect(errAjeno?.message).toMatch(/item-no-en-poder-revendedora/)
    const { data: item0Intacto } = await f.serviceRole
      .from('item_producto')
      .select('estado_item')
      .eq('id_item', f.items[0])
      .single()
    expect(item0Intacto?.estado_item).toBe('en_revendedora')

    // Ítems de dos consignaciones distintas vuelven en una sola devolución.
    const { data: devueltos, error: errDev } = await f.authenticated.rpc(
      'sp_devolver_items_revendedora',
      { p_id_revendedora: idRev, p_items: [f.items[0], f.items[2]], p_motivo: 'Fin de temporada' },
    )
    expect(errDev).toBeNull()
    expect(devueltos).toBe(2)

    const { data: estados } = await f.serviceRole
      .from('item_producto')
      .select('id_item, estado_item')
      .in('id_item', [f.items[0], f.items[1], f.items[2]])
    const porId = new Map(estados?.map((i) => [i.id_item, i.estado_item]))
    expect(porId.get(f.items[0])).toBe('disponible')
    expect(porId.get(f.items[1])).toBe('en_revendedora')
    expect(porId.get(f.items[2])).toBe('disponible')
  })
})
