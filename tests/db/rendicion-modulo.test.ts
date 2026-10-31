import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, hasTestDb, signInAs } from './_helpers'

describe.skipIf(!hasTestDb)('SPs de rendición a proveedor — REQ-MODOP-07', () => {
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

  describe('preview_rendicion', () => {
    it('REQ-MODOP-07 N1 preview_rendicion', async () => {
      const tenant = await createTenantWithUser('modop-07-n1-preview')
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('preview_rendicion', {
        p_id_proveedor: randomUUID(),
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/module-disabled/)
    })

    it('REQ-MODOP-07 N2 preview_rendicion', async () => {
      const tenant = await createTenantWithUser('modop-07-n2-preview')
      await habilitarPaqueteConsignacion(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { data, error } = await auth.rpc('preview_rendicion', {
        p_id_proveedor: randomUUID(),
      })

      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  })

  describe('sp_generar_rendicion', () => {
    it('REQ-MODOP-07 N1 sp_generar_rendicion', async () => {
      const tenant = await createTenantWithUser('modop-07-n1-generar')
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_generar_rendicion', {
        p_id_proveedor: randomUUID(),
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/module-disabled/)
    })

    it('REQ-MODOP-07 N2 sp_generar_rendicion', async () => {
      const tenant = await createTenantWithUser('modop-07-n2-generar')
      await habilitarPaqueteConsignacion(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_generar_rendicion', {
        p_id_proveedor: randomUUID(),
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/sin-lineas-pendientes/)
    })
  })

  describe('sp_excluir_detalle_rendicion', () => {
    it('REQ-MODOP-07 N1 sp_excluir_detalle_rendicion', async () => {
      const tenant = await createTenantWithUser('modop-07-n1-excluir')
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_excluir_detalle_rendicion', {
        p_id_detalle: randomUUID(),
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/module-disabled/)
    })

    it('REQ-MODOP-07 N2 sp_excluir_detalle_rendicion', async () => {
      const tenant = await createTenantWithUser('modop-07-n2-excluir')
      await habilitarPaqueteConsignacion(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_excluir_detalle_rendicion', {
        p_id_detalle: randomUUID(),
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/detalle-not-found/)
    })
  })

  describe('sp_reincluir_detalle_rendicion', () => {
    it('REQ-MODOP-07 N1 sp_reincluir_detalle_rendicion', async () => {
      const tenant = await createTenantWithUser('modop-07-n1-reincluir')
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_reincluir_detalle_rendicion', {
        p_id_detalle: randomUUID(),
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/module-disabled/)
    })

    it('REQ-MODOP-07 N2 sp_reincluir_detalle_rendicion', async () => {
      const tenant = await createTenantWithUser('modop-07-n2-reincluir')
      await habilitarPaqueteConsignacion(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_reincluir_detalle_rendicion', {
        p_id_detalle: randomUUID(),
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/detalle-not-found/)
    })
  })

  describe('sp_marcar_rendicion_pagada', () => {
    it('REQ-MODOP-07 N1 sp_marcar_rendicion_pagada', async () => {
      const tenant = await createTenantWithUser('modop-07-n1-pagar')
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_marcar_rendicion_pagada', {
        p_id_rendicion: randomUUID(),
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/module-disabled/)
    })

    it('REQ-MODOP-07 N2 sp_marcar_rendicion_pagada', async () => {
      const tenant = await createTenantWithUser('modop-07-n2-pagar')
      await habilitarPaqueteConsignacion(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_marcar_rendicion_pagada', {
        p_id_rendicion: randomUUID(),
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/rendicion-not-found/)
    })
  })
})
