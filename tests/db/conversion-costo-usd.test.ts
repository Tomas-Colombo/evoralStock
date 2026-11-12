import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, hasTestDb, runPsql, signInAs, withScopedTenant } from './_helpers'
import { getHoyBuenosAires } from '../fechas'

describe.skipIf(!hasTestDb)('Slice 4 — Conversión en carga de productos, ingresos, remitos y revaluación', () => {
  const serviceRole = createServiceRoleTestClient()

  async function setupTenantWithCotizacion(prefix: string, valorCotizacion: number = 1500) {
    const fixture = await createTenantWithUser(withScopedTenant(prefix))
    const authAdmin = await signInAs(fixture)
    const hoy = getHoyBuenosAires()

    // Configurar cotización manual vigente
    await authAdmin.rpc('sp_set_cotizacion_manual', {
      p_valor: valorCotizacion,
      p_ip: '127.0.0.1',
    })

    // Crear categoría para productos de prueba
    const { data: cat } = await serviceRole
      .from('categoria')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'Categoría Test',
        talles: ['S', 'M', 'L'],
      })
      .select('id_categoria')
      .single()

    // Crear proveedor
    const { data: prov } = await serviceRole
      .from('proveedor')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'Proveedor USD',
        tipo: 'mayorista',
      })
      .select('id_proveedor')
      .single()

    return {
      ...fixture,
      authAdmin,
      idCategoria: cat!.id_categoria,
      idProveedor: prov!.id_proveedor,
      hoy,
    }
  }

  describe('Conversión de moneda y metadatos en carga', () => {
    it('USD 100 × 1500 → 150000.00 en costo_producto Y en item_producto.costo_ingreso', async () => {
      const t = await setupTenantWithCotizacion('prod-usd', 1500)

      // Alta de producto nuevo con USD 100 y stock inicial
      const { data: idProd, error: errProd } = await t.authAdmin.rpc('sp_create_producto', {
        p_id_categoria: t.idCategoria,
        p_nombre: 'Campera Cuero USD',
        p_sku: `SKU-${Date.now()}`,
        p_stock_minimo: 2,
        p_descripcion: null,
      })
      expect(errProd).toBeNull()

      // Circuito A: sp_set_costo_producto con metadatos
      const { error: errCosto } = await t.authAdmin.rpc('sp_set_costo_producto', {
        p_id_producto: idProd,
        p_costo: 150000.0,
        p_moneda: 'USD',
        p_motivo: 'costo inicial',
        p_ip: '127.0.0.1',
        p_costo_original_usd: 100.0,
        p_cotizacion_aplicada: 1500.0,
        p_cotizacion_fecha_valor: t.hoy,
      })
      expect(errCosto).toBeNull()

      // Circuito B: creación de stock directo en ARS 150000
      const { error: errStock } = await t.authAdmin.rpc('sp_crear_stock_directo', {
        p_id_producto: idProd,
        p_costo: 150000.0,
        p_tipo_ingreso: 'compra',
        p_items: [{ talle: 'M', cantidad: 2 }],
        p_ip: '127.0.0.1',
      })
      expect(errStock).toBeNull()

      // Verificación en costo_producto
      const { data: cp } = await serviceRole
        .from('costo_producto')
        .select('*')
        .eq('id_producto', idProd)
        .is('vigente_hasta', null)
        .single()

      expect(Number(cp!.costo)).toBe(150000.0)
      expect(cp!.moneda).toBe('USD')
      expect(Number(cp!.costo_original_usd)).toBe(100.0)
      expect(Number(cp!.cotizacion_aplicada)).toBe(1500.0)
      expect(cp!.cotizacion_fecha_valor).toBe(t.hoy)

      // Verificación en item_producto + item_costo
      const { data: items } = await serviceRole
        .from('item_producto')
        .select('id_item, item_costo(costo_ingreso)')
        .eq('id_producto', idProd)

      expect(items!.length).toBe(2)
      for (const item of items!) {
        const ic = Array.isArray(item.item_costo) ? item.item_costo[0] : item.item_costo
        expect(Number((ic as { costo_ingreso?: number } | null)?.costo_ingreso)).toBe(150000.0)
      }
    })

    it('Ingreso de un producto existente en USD', async () => {
      const t = await setupTenantWithCotizacion('ingreso-usd', 1500)

      // Producto existente con costo previo
      const { data: prod } = await serviceRole
        .from('producto')
        .insert({
          id_tenant: t.tenantId,
          id_categoria: t.idCategoria,
          nombre: 'Remera Existente',
        })
        .select('id_producto')
        .single()

      // Crear ingreso borrador
      const { data: ing } = await serviceRole
        .from('ingreso_mercaderia')
        .insert({
          id_tenant: t.tenantId,
          id_proveedor: t.idProveedor,
          tipo_ingreso: 'compra',
          observaciones: 'Ingreso USD',
          confirmado: false,
        })
        .select('id_ingreso')
        .single()
      const idIngreso = ing!.id_ingreso

      // Agregar detalle en USD: 10 unidades a USD 50 c/u (equivalente $75000 ARS)
      const { data: idDetalle } = await serviceRole
        .from('ingreso_mercaderia_detalle')
        .insert({
          id_tenant: t.tenantId,
          id_ingreso: idIngreso,
          id_producto: prod!.id_producto,
          cantidad: 10,
          costo_unitario: 75000.0,
          talle: 'L',
          costo_original_usd: 50.0,
          cotizacion_aplicada: 1500.0,
          cotizacion_fecha_valor: t.hoy,
        })
        .select('id_detalle')
        .single()

      // Confirmar ingreso
      const { error: errConf } = await t.authAdmin.rpc('sp_confirmar_ingreso', {
        p_id_ingreso: idIngreso,
        p_ip: '127.0.0.1',
      })
      expect(errConf).toBeNull()

      // Verificar detalle persistido con metadatos
      const { data: detalle } = await serviceRole
        .from('ingreso_mercaderia_detalle')
        .select('*')
        .eq('id_detalle', idDetalle!.id_detalle)
        .single()

      expect(Number(detalle!.costo_unitario)).toBe(75000.0)
      expect(Number(detalle!.costo_original_usd)).toBe(50.0)
      expect(Number(detalle!.cotizacion_aplicada)).toBe(1500.0)
      expect(detalle!.cotizacion_fecha_valor).toBe(t.hoy)

      // Verificar que los 10 ítems físicos tengan costo_ingreso 75000 en item_costo
      const { data: items } = await serviceRole
        .from('item_producto')
        .select('id_item, item_costo(costo_ingreso)')
        .eq('id_ingreso_detalle', idDetalle!.id_detalle)

      expect(items!.length).toBe(10)
      for (const item of items!) {
        const ic = Array.isArray(item.item_costo) ? item.item_costo[0] : item.item_costo
        expect(Number((ic as { costo_ingreso?: number } | null)?.costo_ingreso)).toBe(75000.0)
      }
    })

    it('Remito en USD', async () => {
      const t = await setupTenantWithCotizacion('remito-usd', 1500)

      // Crear ingreso borrador
      const { data: ing } = await serviceRole
        .from('ingreso_mercaderia')
        .insert({
          id_tenant: t.tenantId,
          id_proveedor: t.idProveedor,
          tipo_ingreso: 'compra',
          numero_remito: 'REM-USD-001',
        })
        .select('id_ingreso')
        .single()

      // Invocar sp_importar_remito en USD con metadatos de cotización
      const { data: resRemito, error: errRemito } = await t.authAdmin.rpc('sp_importar_remito', {
        p_id_ingreso: ing!.id_ingreso,
        p_moneda: 'USD',
        p_lineas: [
          {
            nombre: 'Pantalón Remito USD',
            esNuevo: true,
            idCategoria: t.idCategoria,
            costoUnitario: 75000.0, // ARS convertido
            costoOriginalUsd: 50.0,
            partes: [{ talle: '42', cantidad: 5 }],
          },
        ],
        p_ip: '127.0.0.1',
        p_cotizacion_aplicada: 1500.0,
        p_cotizacion_fecha_valor: t.hoy,
      })

      expect(errRemito).toBeNull()
      expect(resRemito.creados).toBe(1)

      // Verificar costo_producto generado
      const { data: cp } = await serviceRole
        .from('costo_producto')
        .select('*')
        .eq('moneda', 'USD')
        .eq('id_tenant', t.tenantId)
        .single()

      expect(Number(cp!.costo)).toBe(75000.0)
      expect(Number(cp!.costo_original_usd)).toBe(50.0)
      expect(Number(cp!.cotizacion_aplicada)).toBe(1500.0)
      expect(cp!.cotizacion_fecha_valor).toBe(t.hoy)

      // Verificar ingreso_mercaderia_detalle
      const { data: imd } = await serviceRole
        .from('ingreso_mercaderia_detalle')
        .select('*')
        .eq('id_ingreso', ing!.id_ingreso)
        .single()

      expect(Number(imd!.costo_unitario)).toBe(75000.0)
      expect(Number(imd!.costo_original_usd)).toBe(50.0)
      expect(Number(imd!.cotizacion_aplicada)).toBe(1500.0)
      expect(imd!.cotizacion_fecha_valor).toBe(t.hoy)
    })
  })

  describe('Revaluación masiva de costos USD', () => {
    it('sp_revaluar_costos_usd_vigentes: una revaluación, después otra (no se pierde costo_original_usd)', async () => {
      const t = await setupTenantWithCotizacion('reval-doble', 1500)

      // Producto con USD 100 a cotización 1500 ($150.000 ARS)
      const { data: prod } = await serviceRole
        .from('producto')
        .insert({
          id_tenant: t.tenantId,
          id_categoria: t.idCategoria,
          nombre: 'Vestido Fiesta USD',
        })
        .select('id_producto')
        .single()

      await t.authAdmin.rpc('sp_set_costo_producto', {
        p_id_producto: prod!.id_producto,
        p_costo: 150000.0,
        p_moneda: 'USD',
        p_motivo: 'costo inicial',
        p_costo_original_usd: 100.0,
        p_cotizacion_aplicada: 1500.0,
        p_cotizacion_fecha_valor: t.hoy,
      })

      // 1. Cambiar cotización a 1600 y ejecutar primera revaluación
      await t.authAdmin.rpc('sp_set_cotizacion_manual', { p_valor: 1600.0, p_ip: '127.0.0.1' })

      const { data: resReval1, error: errReval1 } = await t.authAdmin.rpc('sp_revaluar_costos_usd_vigentes', {
        p_ip: '127.0.0.1',
      })
      expect(errReval1).toBeNull()
      expect(resReval1.revaluados).toBe(1)
      expect(resReval1.sin_cambios).toBe(0)

      // Verificar nuevo costo vigente: 160.000 ARS conservando costo_original_usd = 100
      const { data: cp1 } = await serviceRole
        .from('costo_producto')
        .select('*')
        .eq('id_producto', prod!.id_producto)
        .is('vigente_hasta', null)
        .single()

      expect(Number(cp1!.costo)).toBe(160000.0)
      expect(Number(cp1!.costo_original_usd)).toBe(100.0)
      expect(Number(cp1!.cotizacion_aplicada)).toBe(1600.0)

      // 2. Cambiar cotización a 1750 y ejecutar segunda revaluación
      await t.authAdmin.rpc('sp_set_cotizacion_manual', { p_valor: 1750.0, p_ip: '127.0.0.1' })

      const { data: resReval2, error: errReval2 } = await t.authAdmin.rpc('sp_revaluar_costos_usd_vigentes', {
        p_ip: '127.0.0.1',
      })
      expect(errReval2).toBeNull()
      expect(resReval2.revaluados).toBe(1)
      expect(resReval2.sin_cambios).toBe(0)

      // Verificar nuevo costo vigente: 175.000 ARS conservando costo_original_usd = 100
      const { data: cp2 } = await serviceRole
        .from('costo_producto')
        .select('*')
        .eq('id_producto', prod!.id_producto)
        .is('vigente_hasta', null)
        .single()

      expect(Number(cp2!.costo)).toBe(175000.0)
      expect(Number(cp2!.costo_original_usd)).toBe(100.0)
      expect(Number(cp2!.cotizacion_aplicada)).toBe(1750.0)
    })

    it('Misma cotización dos veces → sin_cambios (no genera historial duplicado)', async () => {
      const t = await setupTenantWithCotizacion('reval-sin-cambios', 1500)

      const { data: prod } = await serviceRole
        .from('producto')
        .insert({
          id_tenant: t.tenantId,
          id_categoria: t.idCategoria,
          nombre: 'Vestido Sin Cambios USD',
        })
        .select('id_producto')
        .single()

      await t.authAdmin.rpc('sp_set_costo_producto', {
        p_id_producto: prod!.id_producto,
        p_costo: 150000.0,
        p_moneda: 'USD',
        p_motivo: 'costo inicial',
        p_costo_original_usd: 100.0,
        p_cotizacion_aplicada: 1500.0,
        p_cotizacion_fecha_valor: t.hoy,
      })

      // Revaluar con la misma cotización (1500): cotizacion_aplicada ya es 1500
      const { data: res, error } = await t.authAdmin.rpc('sp_revaluar_costos_usd_vigentes', {
        p_ip: '127.0.0.1',
      })
      expect(error).toBeNull()
      expect(res.revaluados).toBe(0)
      expect(res.sin_cambios).toBe(1)
      expect(res.omitidos_sin_original).toBe(0)

      // Total de filas en costo_producto sigue siendo exactamente 1
      const { count: countCosto } = await serviceRole
        .from('costo_producto')
        .select('*', { count: 'exact', head: true })
        .eq('id_producto', prod!.id_producto)

      expect(countCosto).toBe(1)
    })

    it('Una fila USD vieja (sin costo_original_usd) se omite y se cuenta', async () => {
      const t = await setupTenantWithCotizacion('reval-vieja', 1500)

      // Crear fila vieja directamente en DB con moneda='USD' pero costo_original_usd nulo
      const { data: prodViejo } = await serviceRole
        .from('producto')
        .insert({
          id_tenant: t.tenantId,
          id_categoria: t.idCategoria,
          nombre: 'Producto Viejo USD',
        })
        .select('id_producto')
        .single()

      // Simular fila preexistente a la migración 00136 sin metadatos
      runPsql(
        [
          'alter table costo_producto drop constraint if exists costo_producto_moneda_metadatos_check;',
          `insert into costo_producto (id_tenant, id_producto, costo, moneda, costo_original_usd) values ('${t.tenantId}', '${prodViejo!.id_producto}', 100.0, 'USD', null);`,
          'alter table costo_producto add constraint costo_producto_moneda_metadatos_check check ((moneda = \'USD\' and costo_original_usd is not null and cotizacion_aplicada is not null and cotizacion_fecha_valor is not null and costo = round(costo_original_usd * cotizacion_aplicada, 2)) or (moneda = \'ARS\' and costo_original_usd is null and cotizacion_aplicada is null and cotizacion_fecha_valor is null)) not valid;',
        ].join(' ')
      )

      // Ejecutar revaluación
      const { data: res, error } = await t.authAdmin.rpc('sp_revaluar_costos_usd_vigentes', {
        p_ip: '127.0.0.1',
      })
      expect(error).toBeNull()
      expect(res.revaluados).toBe(0)
      expect(res.omitidos_sin_original).toBe(1)
      expect(res.sin_cambios).toBe(0)

      // La fila vieja no debe haber cambiado
      const { data: cp } = await serviceRole
        .from('costo_producto')
        .select('*')
        .eq('id_producto', prodViejo!.id_producto)
        .is('vigente_hasta', null)
        .single()

      expect(Number(cp!.costo)).toBe(100.0)
    })

    it('item_producto.costo_ingreso de las piezas en stock se sincroniza al revaluar (costo-unico D5)', async () => {
      const t = await setupTenantWithCotizacion('stock-inmutable', 1500)

      const { data: prod } = await serviceRole
        .from('producto')
        .insert({
          id_tenant: t.tenantId,
          id_categoria: t.idCategoria,
          nombre: 'Blusa Stock Inmutable',
        })
        .select('id_producto')
        .single()

      await t.authAdmin.rpc('sp_set_costo_producto', {
        p_id_producto: prod!.id_producto,
        p_costo: 150000.0,
        p_moneda: 'USD',
        p_motivo: 'costo inicial',
        p_costo_original_usd: 100.0,
        p_cotizacion_aplicada: 1500.0,
        p_cotizacion_fecha_valor: t.hoy,
      })

      // Ingresar piezas con costo_ingreso = 150.000
      await t.authAdmin.rpc('sp_crear_stock_directo', {
        p_id_producto: prod!.id_producto,
        p_costo: 150000.0,
        p_tipo_ingreso: 'compra',
        p_items: [{ talle: 'S', cantidad: 3 }],
        p_ip: '127.0.0.1',
      })

      // Revaluar a 1800
      await t.authAdmin.rpc('sp_set_cotizacion_manual', { p_valor: 1800.0, p_ip: '127.0.0.1' })
      await t.authAdmin.rpc('sp_revaluar_costos_usd_vigentes', { p_ip: '127.0.0.1' })

      // El catálogo ahora es 180.000
      const { data: cp } = await serviceRole
        .from('costo_producto')
        .select('costo')
        .eq('id_producto', prod!.id_producto)
        .is('vigente_hasta', null)
        .single()
      expect(Number(cp!.costo)).toBe(180000.0)

      // Con change costo-unico (D5), el stock físico preexistente se sincroniza al costo vigente (180.000)
      const { data: items } = await serviceRole
        .from('item_producto')
        .select('id_item, item_costo(costo_ingreso)')
        .eq('id_producto', prod!.id_producto)

      expect(items!.length).toBe(3)
      for (const itm of items!) {
        const ic = Array.isArray(itm.item_costo) ? itm.item_costo[0] : itm.item_costo
        expect(Number((ic as { costo_ingreso?: number } | null)?.costo_ingreso)).toBe(180000.0)
      }
    })

    it('Sin fila de hoy + BCRA caído (desactualizada=true) → rechazo cotizacion-desactualizada y 0 filas nuevas', async () => {
      const fixture = await createTenantWithUser(withScopedTenant('bcra-caido'))
      const authAdmin = await signInAs(fixture)

      const { data: cat } = await serviceRole
        .from('categoria')
        .insert({
          id_tenant: fixture.tenantId,
          nombre: 'Cat BCRA',
        })
        .select('id_categoria')
        .single()

      const { data: prod } = await serviceRole
        .from('producto')
        .insert({
          id_tenant: fixture.tenantId,
          id_categoria: cat!.id_categoria,
          nombre: 'Producto BCRA Caído',
        })
        .select('id_producto')
        .single()

      // Costo inicial en USD cargado hace 5 días
      await serviceRole.from('costo_producto').insert({
        id_tenant: fixture.tenantId,
        id_producto: prod!.id_producto,
        costo: 140000.0,
        moneda: 'USD',
        costo_original_usd: 100.0,
        cotizacion_aplicada: 1400.0,
        cotizacion_fecha_valor: '2026-11-01',
      })

      // Configurar modo automatico con solo una cotización vieja de hace 2 días con origen 'bcra'
      await serviceRole.from('cotizacion_config').insert({
        id_tenant: fixture.tenantId,
        modo: 'automatica',
      })
      await serviceRole.from('cotizacion_dolar').insert({
        id_tenant: fixture.tenantId,
        valor: 1400.0,
        fecha: '2026-11-03',
        fecha_valor: '2026-11-02',
        origen: 'bcra',
        desactualizada: true,
      })

      const countBefore = await serviceRole
        .from('costo_producto')
        .select('*', { count: 'exact', head: true })
        .eq('id_tenant', fixture.tenantId)

      // Ejecutar revaluación en base de datos: debe rechazar porque sp_get_cotizacion_vigente retorna desactualizada=true
      const { error } = await authAdmin.rpc('sp_revaluar_costos_usd_vigentes', {
        p_ip: '127.0.0.1',
      })

      expect(error).not.toBeNull()
      expect(error!.message).toContain('cotizacion-desactualizada')

      // Verificar 0 filas nuevas en costo_producto
      const countAfter = await serviceRole
        .from('costo_producto')
        .select('*', { count: 'exact', head: true })
        .eq('id_tenant', fixture.tenantId)

      expect(countAfter.count).toBe(countBefore.count)
    })

    it('Sin cotización → sin-cotizacion-dolar y no se escribe nada', async () => {
      // Tenant NUEVO sin cotización cargada
      const fixture = await createTenantWithUser(withScopedTenant('sin-cot'))
      const authAdmin = await signInAs(fixture)

      const { error } = await authAdmin.rpc('sp_revaluar_costos_usd_vigentes', {
        p_ip: '127.0.0.1',
      })

      expect(error).not.toBeNull()
      expect(error!.message).toContain('sin-cotizacion-dolar')
    })
  })
})
