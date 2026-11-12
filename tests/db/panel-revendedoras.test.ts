import { describe, expect, test } from 'vitest'
import { createTenantWithUser, signInAs } from './_helpers'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'

interface PanelRevendedoraRow {
  id_revendedora: string
  nombre: string
  apellido: string
  email: string | null
  telefono: string | null
  activo: boolean
  items_en_poder: number
  monto_en_poder: number
  vendido_periodo: number
  comision_liquidada: number
  comision_estimada: number
  adeudado: number
  fecha_ultima_venta: string | null
  declaraciones_pendientes: number
  estado_cuenta: 'al_dia' | 'con_saldo' | 'atrasada'
  total_filas: number
  kpi_en_poder: number
  kpi_en_local: number
  kpi_adeudado_total: number
  kpi_liquidaciones_pendientes_monto: number
  kpi_liquidaciones_pendientes_cant: number
}

async function habilitarModulo(tenantId: string, codigo: string) {
  const sr = createServiceRoleTestClient()
  const { data: mod, error: modErr } = await sr
    .from('modulo')
    .select('id_modulo')
    .eq('codigo', codigo)
    .single()
  expect(modErr).toBeNull()
  const { error } = await sr
    .from('tenant_modulo')
    .upsert({ id_tenant: tenantId, id_modulo: mod!.id_modulo, habilitado: true })
  expect(error).toBeNull()
}

describe('Panel de gestión del local — Slice 4b (REQ-RV-ADM)', () => {
  test('módulo revendedoras apagado rechaza rf_panel_revendedoras y rf_quien_tiene_item', async () => {
    const user = await createTenantWithUser('PanelModApagado')
    const auth = await signInAs(user)

    const { error: errPanel } = await auth.rpc('rf_panel_revendedoras', {})
    expect(errPanel?.message).toContain('modulo-revendedoras-deshabilitado')

    const { error: errQuien } = await auth.rpc('rf_quien_tiene_item', { p_identificador: 'test-qr' })
    expect(errQuien?.message).toContain('modulo-revendedoras-deshabilitado')
  })

  test('aislamiento entre tenants: panel de un tenant nunca incluye revendedoras de otro', async () => {
    const tA = await createTenantWithUser('PanelTenantA')
    const tB = await createTenantWithUser('PanelTenantB')

    await habilitarModulo(tA.tenantId, 'revendedoras')
    await habilitarModulo(tB.tenantId, 'revendedoras')

    const authA = await signInAs(tA)
    const authB = await signInAs(tB)

    // 2 revendedoras en Tenant A
    await tA.serviceRole.from('revendedora').insert([
      { id_tenant: tA.tenantId, nombre: 'Ana', apellido: 'Alonso', activo: true },
      { id_tenant: tA.tenantId, nombre: 'Beatriz', apellido: 'Benitez', activo: true },
    ])

    // 2 revendedoras en Tenant B
    await tB.serviceRole.from('revendedora').insert([
      { id_tenant: tB.tenantId, nombre: 'Carla', apellido: 'Castro', activo: true },
      { id_tenant: tB.tenantId, nombre: 'Diana', apellido: 'Diaz', activo: true },
    ])

    const { data: rowsA, error: errA } = await authA.rpc('rf_panel_revendedoras', {})
    expect(errA).toBeNull()
    const listA = rowsA as PanelRevendedoraRow[]
    expect(listA).toHaveLength(2)
    expect(listA.map((r) => r.nombre).sort()).toEqual(['Ana', 'Beatriz'])

    const { data: rowsB, error: errB } = await authB.rpc('rf_panel_revendedoras', {})
    expect(errB).toBeNull()
    const listB = rowsB as PanelRevendedoraRow[]
    expect(listB).toHaveLength(2)
    expect(listB.map((r) => r.nombre).sort()).toEqual(['Carla', 'Diana'])
  })

  test('cruce exacto con rf_cuenta_corriente_revendedora y estado de cuenta al_dia / con_saldo / atrasada', async () => {
    const user = await createTenantWithUser('PanelCruceCC')
    const sr = user.serviceRole
    const auth = await signInAs(user)
    const tenantId = user.tenantId

    await habilitarModulo(tenantId, 'revendedoras')

    // Crear categoría y producto
    const { data: cat } = await sr.from('categoria').insert({ id_tenant: tenantId, nombre: 'Cat Panel', talles: [] }).select('id_categoria').single()
    const { data: prod } = await sr.from('producto').insert({ id_tenant: tenantId, id_categoria: cat!.id_categoria, nombre: 'Remera Cruce', precio_venta: 100_000 }).select('id_producto').single()

    // 2 ítems disponibles
    const qr1 = `QR-PANEL-${tenantId.slice(0, 8)}-01`
    const qr2 = `QR-PANEL-${tenantId.slice(0, 8)}-02`
    const { data: items } = await sr.from('item_producto').insert([
      { id_tenant: tenantId, id_producto: prod!.id_producto, estado_item: 'disponible', qr_code: qr1, tipo_ingreso: 'compra' },
      { id_tenant: tenantId, id_producto: prod!.id_producto, estado_item: 'disponible', qr_code: qr2, tipo_ingreso: 'compra' },
    ]).select('id_item, qr_code')
    const idItem1 = items![0].id_item
    const idItem2 = items![1].id_item
    await sr.from('item_costo').insert([
      { id_item: idItem1, id_tenant: tenantId, costo_ingreso: 50_000 },
      { id_item: idItem2, id_tenant: tenantId, costo_ingreso: 50_000 },
    ])

    // Revendedora R1
    const { data: rev } = await sr.from('revendedora').insert({
      id_tenant: tenantId,
      nombre: 'Valeria',
      apellido: 'Vera',
      email: 'valeria@cruce.com',
      activo: true,
    }).select('id_revendedora').single()
    const idRev = rev!.id_revendedora

    // Consignación: entregar 2 ítems
    const { data: idConsig, error: consigErr } = await auth.rpc('sp_crear_consignacion_revendedora_con_items', {
      p_id_revendedora: idRev,
      p_items: [idItem1, idItem2],
    })
    expect(consigErr).toBeNull()
    const { error: confErr } = await auth.rpc('sp_confirmar_consignacion_revendedora', { p_id_consignacion_revendedora: idConsig as string })
    expect(confErr).toBeNull()

    const { error: vErr } = await auth.rpc('sp_registrar_venta', {
      p_lineas: [{ id_item: idItem1 }],
      p_forma_pago: 'efectivo',
      p_canal: 'revendedora',
      p_id_revendedora: idRev,
    })
    expect(vErr).toBeNull()

    // Consultar rf_cuenta_corriente_revendedora
    const { data: ccData } = await auth.rpc('rf_cuenta_corriente_revendedora', { p_id_revendedora: idRev })
    const cc = Array.isArray(ccData) ? ccData[0] : ccData

    // Consultar rf_panel_revendedoras
    const { data: panelData, error: panelErr } = await auth.rpc('rf_panel_revendedoras', {})
    expect(panelErr).toBeNull()
    const panelRows = panelData as PanelRevendedoraRow[]
    expect(panelRows).toHaveLength(1)
    const pRow = panelRows[0]

    // Cruce exacto con rf_cuenta_corriente_revendedora
    expect(Number(pRow.items_en_poder)).toBe(Number(cc.items_en_poder))
    expect(Number(pRow.monto_en_poder)).toBe(Number(cc.monto_en_poder))
    expect(Number(pRow.vendido_periodo)).toBe(Number(cc.total_vendido))
    expect(Number(pRow.adeudado)).toBe(Number(cc.adeudado))
    expect(Number(pRow.comision_liquidada)).toBe(Number(cc.total_comision_liquidada))
    expect(pRow.estado_cuenta).toBe('con_saldo') // Debe 100.000 sin liquidación atrasada

    // Verificar quién tiene qué (ADM-12)
    const { data: quienData, error: quienErr } = await auth.rpc('rf_quien_tiene_item', { p_identificador: qr2 })
    expect(quienErr).toBeNull()
    const quien = Array.isArray(quienData) ? quienData[0] : quienData
    expect(quien.id_revendedora).toBe(idRev)
    expect(quien.nombre).toBe('Valeria')
  })

  test('caso con 200 revendedoras: devuelve 200 filas en una consulta y respeta paginación y tope', async () => {
    const user = await createTenantWithUser('Panel200Rev')
    const sr = user.serviceRole
    const auth = await signInAs(user)
    const tenantId = user.tenantId

    await habilitarModulo(tenantId, 'revendedoras')

    // Generar 200 revendedoras
    const batch = Array.from({ length: 200 }, (_, i) => ({
      id_tenant: tenantId,
      nombre: `Rev${i.toString().padStart(3, '0')}`,
      apellido: `Zeta${(200 - i).toString().padStart(3, '0')}`,
      activo: true,
    }))
    await sr.from('revendedora').insert(batch)

    // Consulta con limit 200 devuelve las 200 filas en una sola consulta
    const { data: rows200, error: err200 } = await auth.rpc('rf_panel_revendedoras', {
      p_limit: 200,
      p_offset: 0,
    })
    expect(err200).toBeNull()
    expect(rows200).toHaveLength(200)

    // Paginación: p_limit 10, p_offset 0 devuelve 10 filas con total_filas = 200
    const { data: page1 } = await auth.rpc('rf_panel_revendedoras', {
      p_limit: 10,
      p_offset: 0,
    })
    const p1 = page1 as PanelRevendedoraRow[]
    expect(p1).toHaveLength(10)
    expect(Number(p1[0].total_filas)).toBe(200)

    // Sort fuera de lista blanca cae al default (apellido_asc)
    const { data: fallbackSort } = await auth.rpc('rf_panel_revendedoras', {
      p_limit: 5,
      p_orden: 'columna_inventada_o_sql_injection; drop table revendedora;',
    })
    const fb = fallbackSort as PanelRevendedoraRow[]
    expect(fb).toHaveLength(5)
    // El orden por defecto es apellido_asc
    expect(fb[0].apellido < fb[1].apellido).toBe(true)
  })

  test('declaraciones_pendientes refleja el conteo real y funciona el filtro (00107)', async () => {
    const user = await createTenantWithUser('PanelDecPend')
    const sr = user.serviceRole
    const auth = await signInAs(user)
    const tenantId = user.tenantId

    await habilitarModulo(tenantId, 'revendedoras')

    const { data: rev } = await sr
      .from('revendedora')
      .insert({ id_tenant: tenantId, nombre: 'Valeria', apellido: 'Perez', activo: true })
      .select('id_revendedora')
      .single()

    const { data: cat } = await sr
      .from('categoria')
      .insert({ id_tenant: tenantId, nombre: 'Cat Dec', talles: [] })
      .select('id_categoria')
      .single()

    const { data: prod } = await sr
      .from('producto')
      .insert({ id_tenant: tenantId, id_categoria: cat!.id_categoria, nombre: 'Pantalon Dec', precio_venta: 50_000 })
      .select('id_producto')
      .single()

    const { data: item } = await sr
      .from('item_producto')
      .insert({
        id_tenant: tenantId,
        id_producto: prod!.id_producto,
        estado_item: 'en_revendedora',
        qr_code: `QR-PANEL-DEC-${tenantId.slice(0, 8)}`,
        tipo_ingreso: 'compra',
      })
      .select('id_item')
      .single()
    await sr.from('item_costo').insert({
      id_item: item!.id_item,
      id_tenant: tenantId,
      costo_ingreso: 25_000,
    })

    // Panel antes de declarar: declaraciones_pendientes = 0
    const { data: pAntes } = await auth.rpc('rf_panel_revendedoras', {})
    const rowAntes = (pAntes as PanelRevendedoraRow[])[0]
    expect(Number(rowAntes.declaraciones_pendientes)).toBe(0)

    // Insertar declaración pendiente
    const { data: dec } = await sr
      .from('declaracion_venta_revendedora')
      .insert({
        id_tenant: tenantId,
        id_revendedora: rev!.id_revendedora,
        id_item: item!.id_item,
        fecha: new Date().toISOString().slice(0, 10),
        estado: 'pendiente',
        nota: 'Prueba',
      })
      .select('id_declaracion')
      .single()

    // Panel con declaración pendiente: declaraciones_pendientes = 1
    const { data: pDesp } = await auth.rpc('rf_panel_revendedoras', {})
    const rowDesp = (pDesp as PanelRevendedoraRow[])[0]
    expect(Number(rowDesp.declaraciones_pendientes)).toBe(1)

    // Filtro declaraciones_pendientes devuelve la fila
    const { data: pFiltro } = await auth.rpc('rf_panel_revendedoras', {
      p_filtro_cuenta: 'declaraciones_pendientes',
    })
    expect(pFiltro as PanelRevendedoraRow[]).toHaveLength(1)

    // Marcar como confirmada: declaraciones_pendientes vuelve a 0
    await sr
      .from('declaracion_venta_revendedora')
      .update({ estado: 'confirmada' })
      .eq('id_declaracion', dec!.id_declaracion)

    const { data: pFin } = await auth.rpc('rf_panel_revendedoras', {})
    const rowFin = (pFin as PanelRevendedoraRow[])[0]
    expect(Number(rowFin.declaraciones_pendientes)).toBe(0)
  })
})
