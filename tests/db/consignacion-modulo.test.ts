import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, hasTestDb, signInAs } from './_helpers'

describe.skipIf(!hasTestDb)('SPs de consignación a proveedor — REQ-MODOP-07', () => {
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

  describe('Grupo A: ítems y cierre', () => {
    describe('sp_agregar_item_consignacion', () => {
      it('REQ-MODOP-07 N1 sp_agregar_item_consignacion', async () => {
        const tenant = await createTenantWithUser('modop-07-n1-agregar')
        const auth = await signInAs(tenant)

        const { error } = await auth.rpc('sp_agregar_item_consignacion', {
          p_id_consignacion: randomUUID(),
          p_id_item: randomUUID(),
        })

        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/module-disabled/)
      })

      it('REQ-MODOP-07 N2 sp_agregar_item_consignacion', async () => {
        const tenant = await createTenantWithUser('modop-07-n2-agregar')
        await habilitarPaqueteConsignacion(tenant.tenantId)
        const auth = await signInAs(tenant)

        const { error } = await auth.rpc('sp_agregar_item_consignacion', {
          p_id_consignacion: randomUUID(),
          p_id_item: randomUUID(),
        })

        if (error) {
          expect(error.message).not.toMatch(/module-disabled/)
        }
      })
    })

    describe('sp_cancelar_item_consignacion', () => {
      it('REQ-MODOP-07 N1 sp_cancelar_item_consignacion', async () => {
        const tenant = await createTenantWithUser('modop-07-n1-cancelar')
        const auth = await signInAs(tenant)

        const { error } = await auth.rpc('sp_cancelar_item_consignacion', {
          p_id_detalle: randomUUID(),
        })

        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/module-disabled/)
      })

      it('REQ-MODOP-07 N2 sp_cancelar_item_consignacion', async () => {
        const tenant = await createTenantWithUser('modop-07-n2-cancelar')
        await habilitarPaqueteConsignacion(tenant.tenantId)
        const auth = await signInAs(tenant)

        const { error } = await auth.rpc('sp_cancelar_item_consignacion', {
          p_id_detalle: randomUUID(),
        })

        if (error) {
          expect(error.message).not.toMatch(/module-disabled/)
        }
      })
    })

    describe('sp_confirmar_salida_item', () => {
      it('REQ-MODOP-07 N1 sp_confirmar_salida_item', async () => {
        const tenant = await createTenantWithUser('modop-07-n1-salida')
        const auth = await signInAs(tenant)

        const { error } = await auth.rpc('sp_confirmar_salida_item', {
          p_id_detalle: randomUUID(),
        })

        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/module-disabled/)
      })

      it('REQ-MODOP-07 N2 sp_confirmar_salida_item', async () => {
        const tenant = await createTenantWithUser('modop-07-n2-salida')
        await habilitarPaqueteConsignacion(tenant.tenantId)
        const auth = await signInAs(tenant)

        const { error } = await auth.rpc('sp_confirmar_salida_item', {
          p_id_detalle: randomUUID(),
        })

        if (error) {
          expect(error.message).not.toMatch(/module-disabled/)
        }
      })
    })

    describe('sp_cerrar_consignacion', () => {
      it('REQ-MODOP-07 N1 sp_cerrar_consignacion', async () => {
        const tenant = await createTenantWithUser('modop-07-n1-cerrar')
        const auth = await signInAs(tenant)

        const { error } = await auth.rpc('sp_cerrar_consignacion', {
          p_id_consignacion: randomUUID(),
        })

        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/module-disabled/)
      })

      it('REQ-MODOP-07 N2 sp_cerrar_consignacion', async () => {
        const tenant = await createTenantWithUser('modop-07-n2-cerrar')
        await habilitarPaqueteConsignacion(tenant.tenantId)
        const auth = await signInAs(tenant)

        const { error } = await auth.rpc('sp_cerrar_consignacion', {
          p_id_consignacion: randomUUID(),
        })

        if (error) {
          expect(error.message).not.toMatch(/module-disabled/)
        }
      })
    })
  })
})
