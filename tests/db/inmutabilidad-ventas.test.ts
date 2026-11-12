import { describe, expect, it } from 'vitest'
import { hasTestDb, unwrapFixture } from './_helpers'
import { ventaFixture, venderContado, type VentaFixture } from './_fixtures-ventas'

/**
 * Inmutabilidad de ventas (00068): triggers sobre venta, detalle_venta y
 * pago_venta, y el cuadre de pagos diferido al commit.
 *
 * Las mutaciones se intentan con la sesión autenticada del tenant: la policy
 * `for all to authenticated` las deja pasar, así que lo único que las frena es
 * el trigger. Con service-role solo se arman datos.
 */

async function ventaContado(prefix: string) {
  const f = await ventaFixture(prefix)
  const { data, error } = await venderContado(f)
  expect(error, 'venderContado').toBeNull()
  const idVenta = data as string

  const detalle = unwrapFixture(
    'detalle_venta select',
    await f.serviceRole
      .from('detalle_venta')
      .select('id_detalle_venta')
      .eq('id_venta', idVenta)
      .single(),
  ) as { id_detalle_venta: string }

  const pago = unwrapFixture(
    'pago_venta select',
    await f.serviceRole.from('pago_venta').select('id_pago_venta').eq('id_venta', idVenta).single(),
  ) as { id_pago_venta: string }

  return { f, idVenta, idDetalle: detalle.id_detalle_venta, idPago: pago.id_pago_venta }
}

describe.skipIf(!hasTestDb)('Inmutabilidad de ventas (00068)', () => {
  describe('venta', () => {
    it('UPDATE venta SET total levanta venta-inmutable', async () => {
      const { f, idVenta } = await ventaContado('inmut-venta-total')

      const { error } = await f.authenticated
        .from('venta')
        .update({ total: 1 })
        .eq('id_venta', idVenta)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/^venta-inmutable/)
    })

    it('UPDATE venta SET fecha levanta venta-inmutable', async () => {
      const { f, idVenta } = await ventaContado('inmut-venta-fecha')

      const { error } = await f.authenticated
        .from('venta')
        .update({ fecha: '2020-01-01T00:00:00Z' })
        .eq('id_venta', idVenta)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/^venta-inmutable/)
    })

    it('DELETE de una venta levanta venta-inmutable', async () => {
      const { f, idVenta } = await ventaContado('inmut-venta-delete')

      const { error } = await f.authenticated.from('venta').delete().eq('id_venta', idVenta)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/^venta-inmutable/)
    })
  })

  describe('detalle_venta', () => {
    it.each([
      ['precio_venta', { precio_venta: 1 }],
    ])('UPDATE detalle_venta SET %s levanta detalle-venta-inmutable', async (_col, cambio) => {
      const { f, idDetalle } = await ventaContado(`inmut-det-${_col}`)

      const { error } = await f.authenticated
        .from('detalle_venta')
        .update(cambio)
        .eq('id_detalle_venta', idDetalle)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/^detalle-venta-inmutable/)
    })

    it('UPDATE detalle_venta_costo y detalle_venta_rendicion levantan inmutabilidad', async () => {
      const { f, idDetalle } = await ventaContado('inmut-det-satelites')

      const { error: eCosto } = await f.serviceRole
        .from('detalle_venta_costo')
        .update({ costo_snapshot: 1 })
        .eq('id_detalle_venta', idDetalle)
      expect(eCosto?.message).toMatch(/^detalle-venta-costo-inmutable/)

      const { error: eRend } = await f.serviceRole
        .from('detalle_venta_rendicion')
        .update({ monto_proveedor: 1 })
        .eq('id_detalle_venta', idDetalle)
      expect(eRend?.message).toMatch(/^detalle-venta-rendicion-inmutable/)
    })

    it('UPDATE de excluida_rendicion SÍ se permite', async () => {
      const { f, idDetalle } = await ventaContado('inmut-det-excluida')

      const { error } = await f.authenticated
        .from('detalle_venta')
        .update({ excluida_rendicion: true })
        .eq('id_detalle_venta', idDetalle)
      expect(error).toBeNull()

      const { data } = await f.serviceRole
        .from('detalle_venta')
        .select('excluida_rendicion')
        .eq('id_detalle_venta', idDetalle)
        .single()
      expect(data?.excluida_rendicion).toBe(true)
    })

    it('UPDATE de id_rendicion SÍ se permite', async () => {
      const { f, idDetalle } = await ventaContado('inmut-det-rendicion')
      const idRendicion = await crearRendicion(f)

      const { error } = await f.authenticated
        .from('detalle_venta')
        .update({ id_rendicion: idRendicion })
        .eq('id_detalle_venta', idDetalle)
      expect(error).toBeNull()

      const { data } = await f.serviceRole
        .from('detalle_venta')
        .select('id_rendicion')
        .eq('id_detalle_venta', idDetalle)
        .single()
      expect(data?.id_rendicion).toBe(idRendicion)
    })

    it('UPDATE de monto_comision y excluida_liquidacion pasa en línea no liquidada y tira detalle-venta-inmutable en línea liquidada (00088)', async () => {
      const { f, idDetalle } = await ventaContado('inmut-det-comis')

      // 1. Línea no liquidada (id_liquidacion is null): UPDATE pasa
      const { error: errNoLiq } = await f.authenticated
        .from('detalle_venta')
        .update({ monto_comision: 500, excluida_liquidacion: true })
        .eq('id_detalle_venta', idDetalle)
      expect(errNoLiq).toBeNull()

      const { data: detUpdated } = await f.serviceRole
        .from('detalle_venta')
        .select('monto_comision, excluida_liquidacion')
        .eq('id_detalle_venta', idDetalle)
        .single()
      expect(Number(detUpdated?.monto_comision)).toBe(500)
      expect(detUpdated?.excluida_liquidacion).toBe(true)

      // 2. Línea liquidada: asignar id_liquidacion con serviceRole
      const idLiq = await crearLiquidacion(f)
      await f.serviceRole
        .from('detalle_venta')
        .update({ id_liquidacion: idLiq })
        .eq('id_detalle_venta', idDetalle)

      // Intentar modificar monto_comision con sesión autenticada
      const { error: errLiqComis } = await f.authenticated
        .from('detalle_venta')
        .update({ monto_comision: 600 })
        .eq('id_detalle_venta', idDetalle)

      expect(errLiqComis).not.toBeNull()
      expect(errLiqComis?.message).toMatch(/detalle-venta-inmutable: linea ya liquidada no se puede modificar/)

      // Intentar modificar excluida_liquidacion con sesión autenticada
      const { error: errLiqExcl } = await f.authenticated
        .from('detalle_venta')
        .update({ excluida_liquidacion: false })
        .eq('id_detalle_venta', idDetalle)

      expect(errLiqExcl).not.toBeNull()
      expect(errLiqExcl?.message).toMatch(/detalle-venta-inmutable: linea ya liquidada no se puede modificar/)
    })

    it('DELETE de un detalle_venta levanta detalle-venta-inmutable', async () => {
      const { f, idDetalle } = await ventaContado('inmut-det-delete')

      const { error } = await f.authenticated
        .from('detalle_venta')
        .delete()
        .eq('id_detalle_venta', idDetalle)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/^detalle-venta-inmutable/)
    })
  })

  describe('pago_venta', () => {
    it('DELETE de un pago_venta levanta pago-venta-inmutable', async () => {
      const { f, idPago } = await ventaContado('inmut-pago-delete')

      const { error } = await f.authenticated.from('pago_venta').delete().eq('id_pago_venta', idPago)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/^pago-venta-inmutable/)
    })

    it('UPDATE de un pago_venta levanta pago-venta-inmutable', async () => {
      const { f, idPago } = await ventaContado('inmut-pago-update')

      const { error } = await f.authenticated
        .from('pago_venta')
        .update({ monto: 1 })
        .eq('id_pago_venta', idPago)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/^pago-venta-inmutable/)
    })
  })

  describe('cuadre de pagos (constraint trigger diferido)', () => {
    it('una venta sin pagos que sumen su total falla al commit con cuadre-pagos-fallido', async () => {
      const f = await ventaFixture('inmut-cuadre')

      // Cada request de PostgREST es una transacción: el INSERT de la venta
      // sola llega al commit con la suma de pagos en 0 contra un total > 0.
      const { error } = await f.authenticated.from('venta').insert({
        id_tenant: f.tenantId,
        id_cliente: f.idCliente,
        id_usuario_alta: f.userId,
        forma_pago: 'efectivo',
        total: f.precio,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/^cuadre-pagos-fallido/)
    })
  })

  describe('borrado de tenant', () => {
    it('borrar un tenant con ventas y pagos tiene éxito (bypass de los triggers)', async () => {
      const { f, idVenta, idDetalle, idPago } = await ventaContado('inmut-tenant-delete')

      const { error } = await f.serviceRole.from('tenant').delete().eq('id_tenant', f.tenantId)
      expect(error, 'delete tenant').toBeNull()

      // Que no queden huérfanos: el éxito del DELETE no alcanza si el cascade
      // dejó filas colgando.
      const [v, d, p] = await Promise.all([
        f.serviceRole.from('venta').select('id_venta').eq('id_venta', idVenta),
        f.serviceRole.from('detalle_venta').select('id_detalle_venta').eq('id_detalle_venta', idDetalle),
        f.serviceRole.from('pago_venta').select('id_pago_venta').eq('id_pago_venta', idPago),
      ])
      expect(v.data).toEqual([])
      expect(d.data).toEqual([])
      expect(p.data).toEqual([])
    })
  })
})

/** Una rendición con su proveedor, solo para tener un `id_rendicion` válido. */
async function crearRendicion(f: VentaFixture): Promise<string> {
  const prov = unwrapFixture(
    'proveedor insert',
    await f.serviceRole
      .from('proveedor')
      .insert({ id_tenant: f.tenantId, nombre: 'Prov inmutabilidad' })
      .select('id_proveedor')
      .single(),
  ) as { id_proveedor: string }

  const rend = unwrapFixture(
    'rendicion_proveedor insert',
    await f.serviceRole
      .from('rendicion_proveedor')
      .insert({
        id_tenant: f.tenantId,
        id_proveedor: prov.id_proveedor,
        monto_total: 0,
        cantidad_lineas: 0,
      })
      .select('id_rendicion')
      .single(),
  ) as { id_rendicion: string }

  return rend.id_rendicion
}

/** Una liquidación de revendedora, solo para tener un `id_liquidacion` válido. */
async function crearLiquidacion(f: VentaFixture): Promise<string> {
  const rev = unwrapFixture(
    'revendedora insert',
    await f.serviceRole
      .from('revendedora')
      .insert({ id_tenant: f.tenantId, nombre: 'Rev', apellido: 'Inmut' })
      .select('id_revendedora')
      .single(),
  ) as { id_revendedora: string }

  const liq = unwrapFixture(
    'liquidacion insert',
    await f.serviceRole
      .from('liquidacion_revendedora')
      .insert({
        id_tenant: f.tenantId,
        id_revendedora: rev.id_revendedora,
        periodo_desde: '2026-01-01',
        periodo_hasta: '2026-01-31',
        monto_vendido: 1000,
        monto_comision: 100,
        monto_a_cobrar: 900,
        cantidad_lineas: 1,
        porcentaje_aplicado: 10,
      })
      .select('id_liquidacion')
      .single(),
  ) as { id_liquidacion: string }

  return liq.id_liquidacion
}
