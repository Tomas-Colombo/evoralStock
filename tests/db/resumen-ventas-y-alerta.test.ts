import { describe, expect, it } from 'vitest'
import { hasTestDb, unwrapFixture } from './_helpers'
import { ventaFixture, venderContado, PRECIO } from './_fixtures-ventas'

describe.skipIf(!hasTestDb)('Optimización de consultas analíticas (00129)', () => {
  describe('rf_resumen_ventas_periodo', () => {
    it('calcula registradas, anuladas y facturado coincidiendo exactamente con la suma calculada a mano', async () => {
      const f = await ventaFixture('resumen-vtas-calc', 3)

      // Venta 1: registrada
      const { data: v1, error: errV1 } = await venderContado(f, { items: [f.items[0]] })
      expect(errV1).toBeNull()
      expect(v1).toBeDefined()

      // Venta 2: registrada
      const { data: v2, error: errV2 } = await venderContado(f, { items: [f.items[1]] })
      expect(errV2).toBeNull()
      expect(v2).toBeDefined()

      // Venta 3: anulada
      const { data: v3, error: errV3 } = await venderContado(f, { items: [f.items[2]] })
      expect(errV3).toBeNull()
      expect(v3).toBeDefined()
      const { error: errAnular } = await f.authenticated.rpc('sp_anular_venta', {
        p_id_venta: v3 as string,
        p_motivo: 'test anulación',
      })
      expect(errAnular).toBeNull()

      // Suma calculada a mano:
      // 2 registradas de $60.000 = $120.000
      // 1 anulada de $60.000
      const registradasEsperadas = 2
      const anuladasEsperadas = 1
      const facturadoEsperado = PRECIO * 2

      const { data, error } = await f.authenticated
        .rpc('rf_resumen_ventas_periodo', {
          p_desde: null,
          p_hasta_exclusivo: null,
          p_canal: null,
        })
        .single<{ registradas: number | string; anuladas: number | string; facturado: number | string }>()

      expect(error).toBeNull()
      expect(data).toBeDefined()
      expect(Number(data!.registradas)).toBe(registradasEsperadas)
      expect(Number(data!.anuladas)).toBe(anuladasEsperadas)
      expect(Number(data!.facturado)).toBe(facturadoEsperado)
    })

    it('respeta los filtros de fecha y canal igual que recorrerPeriodo', async () => {
      const f = await ventaFixture('resumen-vtas-filtros', 2)

      // Venta 1 canal local
      const { data: v1, error: errV1 } = await venderContado(f, { items: [f.items[0]] })
      expect(errV1).toBeNull()
      expect(v1).toBeDefined()

      // Filtro por canal 'local' -> encuentra la venta
      const { data: dataLocal, error: errLocal } = await f.authenticated
        .rpc('rf_resumen_ventas_periodo', {
          p_desde: null,
          p_hasta_exclusivo: null,
          p_canal: 'local',
        })
        .single<{ registradas: number | string; facturado: number | string }>()
      expect(errLocal).toBeNull()
      expect(Number(dataLocal!.registradas)).toBe(1)
      expect(Number(dataLocal!.facturado)).toBe(PRECIO)

      // Filtro por canal 'online' -> 0 registradas
      const { data: dataOnline, error: errOnline } = await f.authenticated
        .rpc('rf_resumen_ventas_periodo', {
          p_desde: null,
          p_hasta_exclusivo: null,
          p_canal: 'online',
        })
        .single<{ registradas: number | string; facturado: number | string }>()
      expect(errOnline).toBeNull()
      expect(Number(dataOnline!.registradas)).toBe(0)
      expect(Number(dataOnline!.facturado)).toBe(0)

      // Filtro por fecha futura -> 0 ventas
      const { data: dataFuturo, error: errFuturo } = await f.authenticated
        .rpc('rf_resumen_ventas_periodo', {
          p_desde: '2099-01-01T00:00:00Z',
          p_hasta_exclusivo: '2099-12-31T23:59:59Z',
          p_canal: null,
        })
        .single<{ registradas: number | string; anuladas: number | string; facturado: number | string }>()
      expect(errFuturo).toBeNull()
      expect(Number(dataFuturo!.registradas)).toBe(0)
      expect(Number(dataFuturo!.anuladas)).toBe(0)
      expect(Number(dataFuturo!.facturado)).toBe(0)
    })

    it('si hay ventas existentes en la base, rf_resumen_ventas_periodo coincide con la suma manual de venta', async () => {
      const f = await ventaFixture('resumen-vtas-seed', 1)

      const { data: ventasTenant, error: errVentas } = await f.serviceRole
        .from('venta')
        .select('estado_venta, total')
        .eq('id_tenant', f.tenantId)
      expect(errVentas).toBeNull()

      let registradas = 0
      let anuladas = 0
      let facturado = 0
      for (const v of ventasTenant ?? []) {
        if (v.estado_venta === 'registrada') {
          registradas++
          facturado += Number(v.total)
        } else if (v.estado_venta === 'anulada') {
          anuladas++
        }
      }

      const { data: rpcRes, error: errRpc } = await f.authenticated
        .rpc('rf_resumen_ventas_periodo', {
          p_desde: null,
          p_hasta_exclusivo: null,
          p_canal: null,
        })
        .single<{ registradas: number | string; anuladas: number | string; facturado: number | string }>()

      expect(errRpc).toBeNull()
      expect(Number(rpcRes!.registradas)).toBe(registradas)
      expect(Number(rpcRes!.anuladas)).toBe(anuladas)
      expect(Number(rpcRes!.facturado)).toBe(facturado)
    })
  })

  describe('v_alerta_reposicion', () => {
    it('devuelve el mismo conjunto de filas que la definición vieja de la vista', async () => {
      const f = await ventaFixture('alerta-reposicion-equiv', 2)

      // Crear varios productos con diferentes condiciones de stock_minimo y disponibles
      const { data: cat } = await f.serviceRole
        .from('categoria')
        .select('id_categoria')
        .eq('id_tenant', f.tenantId)
        .single()

      // Producto 1: bajo_minimo (stock_minimo 5, 2 disponibles)
      const p1 = unwrapFixture(
        'insert p1',
        await f.serviceRole
          .from('producto')
          .insert({
            id_tenant: f.tenantId,
            id_categoria: cat!.id_categoria,
            nombre: 'Prod Bajo Mínimo',
            stock_minimo: 5,
            precio_venta: 1000,
            activo: true,
          })
          .select('id_producto')
          .single(),
      ) as { id_producto: string }

      await f.authenticated.rpc('sp_crear_stock_directo', {
        p_id_producto: p1.id_producto,
        p_costo: 500,
        p_tipo_ingreso: 'compra',
        p_items: [{ talle: null, cantidad: 2 }],
      })

      // Producto 2: sin_stock (stock_minimo 3, 0 disponibles)
      unwrapFixture(
        'insert p2',
        await f.serviceRole
          .from('producto')
          .insert({
            id_tenant: f.tenantId,
            id_categoria: cat!.id_categoria,
            nombre: 'Prod Sin Stock',
            stock_minimo: 3,
            precio_venta: 1000,
            activo: true,
          })
          .select('id_producto')
          .single(),
      )

      // Producto 3: stock suficiente (stock_minimo 1, 2 disponibles) -> no debe figurar
      const p3 = unwrapFixture(
        'insert p3',
        await f.serviceRole
          .from('producto')
          .insert({
            id_tenant: f.tenantId,
            id_categoria: cat!.id_categoria,
            nombre: 'Prod Con Stock',
            stock_minimo: 1,
            precio_venta: 1000,
            activo: true,
          })
          .select('id_producto')
          .single(),
      )

      await f.authenticated.rpc('sp_crear_stock_directo', {
        p_id_producto: p3.id_producto,
        p_costo: 500,
        p_tipo_ingreso: 'compra',
        p_items: [{ talle: null, cantidad: 2 }],
      })

      // Producto 4: inactivo con stock_minimo > 0 -> no debe figurar
      unwrapFixture(
        'insert p4',
        await f.serviceRole
          .from('producto')
          .insert({
            id_tenant: f.tenantId,
            id_categoria: cat!.id_categoria,
            nombre: 'Prod Inactivo',
            stock_minimo: 5,
            precio_venta: 1000,
            activo: false,
          })
          .select('id_producto')
          .single(),
      )

      // 1. Filas devueltas por la nueva vista (v_alerta_reposicion)
      const { data: vistaRows, error: errVista } = await f.authenticated
        .from('v_alerta_reposicion')
        .select('id_producto, nombre, sku, stock_minimo, disponibles, severidad')
        .order('id_producto', { ascending: true })

      expect(errVista).toBeNull()
      expect(vistaRows).toBeDefined()

      // 2. Filas calculadas con la definición vieja (subquery group by de 00028)
      // Obtenemos todos los productos activos con stock_minimo > 0 y sus disponibles
      const { data: prodsActivos, error: errProds } = await f.authenticated
        .from('producto')
        .select('id_producto, nombre, sku, stock_minimo')
        .eq('activo', true)
        .gt('stock_minimo', 0)

      expect(errProds).toBeNull()

      const { data: allItems, error: errItems } = await f.authenticated
        .from('item_producto')
        .select('id_producto')
        .eq('estado_item', 'disponible')

      expect(errItems).toBeNull()

      const conteos: Record<string, number> = {}
      for (const item of allItems ?? []) {
        conteos[item.id_producto] = (conteos[item.id_producto] ?? 0) + 1
      }

      const filasViejas = (prodsActivos ?? [])
        .map((p) => {
          const disponibles = conteos[p.id_producto] ?? 0
          return {
            id_producto: p.id_producto,
            nombre: p.nombre,
            sku: p.sku,
            stock_minimo: p.stock_minimo,
            disponibles,
            severidad: disponibles === 0 ? 'sin_stock' : 'bajo_minimo',
          }
        })
        .filter((p) => p.disponibles < p.stock_minimo)
        .sort((a, b) => a.id_producto.localeCompare(b.id_producto))

      expect(vistaRows).toHaveLength(filasViejas.length)
      expect(vistaRows).toEqual(
        filasViejas.map((f) => ({
          ...f,
          disponibles: f.disponibles,
        })),
      )
    })
  })
})
