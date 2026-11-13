import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { hasTestDb, unwrapFixture, withScopedTenant } from './_helpers'

/**
 * A tenant holding one CONFIRMED goods receipt with a single line.
 *
 * Built in that order on purpose: the line is inserted while the receipt is
 * still open, and only then is the receipt confirmed. Inserting into a
 * confirmed receipt is exactly what the 00051 trigger rejects, so a fixture
 * that confirmed first could not build itself.
 */
async function tenantConUnIngresoConfirmado() {
  const serviceRole = createServiceRoleTestClient()

  const tenant = unwrapFixture(
    'tenant insert',
    await serviceRole
      .from('tenant')
      .insert({
        nombre_comercial: 'Fixture ingreso confirmado',
        subdominio: withScopedTenant('ingreso-confirmado'),
      })
      .select('id_tenant')
      .single(),
  )

  const categoria = unwrapFixture(
    'categoria insert',
    await serviceRole
      .from('categoria')
      .insert({ id_tenant: tenant.id_tenant, nombre: 'Fixture categoría' })
      .select('id_categoria')
      .single(),
  )

  const producto = unwrapFixture(
    'producto insert',
    await serviceRole
      .from('producto')
      .insert({
        id_tenant: tenant.id_tenant,
        id_categoria: categoria.id_categoria,
        nombre: 'Fixture producto',
      })
      .select('id_producto')
      .single(),
  )

  const ingreso = unwrapFixture(
    'ingreso insert',
    await serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: tenant.id_tenant, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single(),
  )

  const detalle = unwrapFixture(
    'detalle insert',
    await serviceRole
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: tenant.id_tenant,
        id_ingreso: ingreso.id_ingreso,
        id_producto: producto.id_producto,
        cantidad: 1,
      })
      .select('id_detalle')
      .single(),
  )

  unwrapFixture(
    'detalle costo insert',
    await serviceRole
      .from('ingreso_detalle_costo')
      .insert({
        id_detalle: detalle.id_detalle,
        id_tenant: tenant.id_tenant,
        costo_unitario: 100,
      })
      .select('id_detalle')
      .single(),
  )

  const confirmar = await serviceRole
    .from('ingreso_mercaderia')
    .update({ confirmado: true })
    .eq('id_ingreso', ingreso.id_ingreso)
  if (confirmar.error) throw new Error(`fixture confirmar: ${confirmar.error.message}`)

  return {
    serviceRole,
    tenantId: tenant.id_tenant as string,
    ingresoId: ingreso.id_ingreso as string,
    detalleId: detalle.id_detalle as string,
  }
}

describe.skipIf(!hasTestDb)('ingreso_mercaderia_detalle — 00051 / 00065', () => {
  it('refuses to delete a single line of a confirmed receipt (00051)', async () => {
    const fx = await tenantConUnIngresoConfirmado()

    const { error } = await fx.serviceRole
      .from('ingreso_mercaderia_detalle')
      .delete()
      .eq('id_detalle', fx.detalleId)

    expect(error).not.toBeNull()
    expect(error?.message).toContain('ingreso-confirmado')
  })

  it('deletes the whole tenant even though its receipt is confirmed (00065)', async () => {
    const fx = await tenantConUnIngresoConfirmado()

    // `ingreso_mercaderia_detalle` reaches `tenant` through two cascading FKs
    // at once — its own `id_tenant` and its receipt's. Through the direct one
    // the header is still alive when the lines go, which is what used to make
    // the 00051 trigger abort this delete and left every tenant that had ever
    // confirmed a receipt impossible to remove.
    const { error } = await fx.serviceRole.from('tenant').delete().eq('id_tenant', fx.tenantId)
    expect(error).toBeNull()

    const { data } = await fx.serviceRole
      .from('ingreso_mercaderia_detalle')
      .select('id_detalle')
      .eq('id_detalle', fx.detalleId)
    expect(data).toEqual([])
  })
})
