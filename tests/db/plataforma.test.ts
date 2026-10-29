import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { SupabaseClient } from '@supabase/supabase-js'
import { createAnonTestClient, createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, hasTestDb, signInAs, runPsql } from './_helpers'
import { MEDIOS_PAGO_TENANT, PAQUETES_OPCIONALES } from '@/lib/types/plataforma'

describe.skipIf(!hasTestDb)('DB: Super Admin Plataforma (REQ-SA-03..08 / DR-SA-01..05)', () => {
  const serviceRole = createServiceRoleTestClient()
  const anonClient = createAnonTestClient()

  let tenantA: string
  let tenantB: string
  let authAdminA: SupabaseClient

  let superAdminUserId: string

  let nonAdminUserId: string

  let revendedoraUserId: string
  let authRev: SupabaseClient

  const usersToClean: string[] = []
  const tenantsToClean: string[] = []

  beforeAll(async () => {
    // 1. Crear tenant A
    const tA = await createTenantWithUser('PlataformaTenantA')
    tenantA = tA.tenantId
    tenantsToClean.push(tenantA)
    authAdminA = await signInAs(tA)

    // 2. Crear tenant B
    const tB = await createTenantWithUser('PlataformaTenantB')
    tenantB = tB.tenantId
    tenantsToClean.push(tenantB)

    // 3. Crear superadmin en auth.users y superadmin
    const emailSA = `superadmin_${Date.now()}_${randomUUID().slice(0, 8)}@utopia.test`
    const { data: saUser, error: saErr } = await serviceRole.auth.admin.createUser({
      email: emailSA,
      password: 'Password123!',
      email_confirm: true,
    })
    if (saErr || !saUser.user) throw saErr ?? new Error('Failed to create superadmin user')
    superAdminUserId = saUser.user.id
    usersToClean.push(superAdminUserId)

    const { error: saInsertErr } = await serviceRole.from('superadmin').insert({ id_auth_user: superAdminUserId })
    if (saInsertErr) throw saInsertErr


    // 4. Crear usuario autenticado común (sin tenant y sin superadmin)
    const emailNon = `nonadmin_${Date.now()}_${randomUUID().slice(0, 8)}@utopia.test`
    const { data: nonUser, error: nonErr } = await serviceRole.auth.admin.createUser({
      email: emailNon,
      password: 'Password123!',
      email_confirm: true,
    })
    if (nonErr || !nonUser.user) throw nonErr ?? new Error('Failed to create nonadmin user')
    nonAdminUserId = nonUser.user.id
    usersToClean.push(nonAdminUserId)

    // 5. Crear revendedora en tenant A
    const { data: mRev } = await serviceRole.from('modulo').select('id_modulo').eq('codigo', 'revendedoras').single()
    await serviceRole.from('tenant_modulo').upsert({ id_tenant: tenantA, id_modulo: mRev!.id_modulo, habilitado: true })

    const { data: rolRev, error: rolErr } = await serviceRole
      .from('rol')
      .insert({
        id_tenant: tenantA,
        nombre: 'Revendedora',
        permisos: { revendedoras: ['ver_propio'] },
      })
      .select('id_rol')
      .single()
    if (rolErr || !rolRev) throw rolErr ?? new Error('Failed to create rol revendedora')

    const { data: revData, error: revErr } = await serviceRole
      .from('revendedora')
      .insert({
        id_tenant: tenantA,
        nombre: 'Reven Plataforma',
        apellido: 'Test',
        email: `rev_${Date.now()}_${randomUUID().slice(0, 8)}@utopia.test`,
      })
      .select('id_revendedora, email')
      .single()
    if (revErr || !revData) throw revErr ?? new Error('Failed to create revendedora')

    const { data: revUser, error: revUserErr } = await serviceRole.auth.admin.createUser({
      email: revData.email,
      password: 'Password123!',
      email_confirm: true,
    })
    if (revUserErr || !revUser.user) throw revUserErr ?? new Error('Failed to create rev auth user')
    revendedoraUserId = revUser.user.id
    usersToClean.push(revendedoraUserId)

    const { error: enlazarErr } = await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: revData.id_revendedora,
      p_id_usuario: revendedoraUserId,
      p_id_tenant: tenantA,
      p_email: revData.email,
      p_nombre: 'Reven Plataforma',
      p_id_rol: rolRev.id_rol,
    })
    if (enlazarErr) throw enlazarErr

    authRev = await signInAs({ email: revData.email, password: 'Password123!' })
  })

  afterAll(async () => {
    for (const id of usersToClean) {
      try {
        await serviceRole.auth.admin.deleteUser(id)
      } catch {}
    }
    for (const t of tenantsToClean) {
      try {
        await serviceRole.rpc('sp_borrar_tenant', { p_id: t })
      } catch {}
    }
  })

  // ─── CHECK MEDIOS DE PAGO ──────────────────────────────────────────
  describe('Catálogo cerrado de medios de pago', () => {
    test('Paridad entre MEDIOS_PAGO_TENANT en TS y CHECK de Postgres en tenant_pago', () => {
      const constraintDef = runPsql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'tenant_pago_medio_check'")

      expect(constraintDef).toBeDefined()
      expect(constraintDef.length).toBeGreaterThan(0)

      for (const medio of MEDIOS_PAGO_TENANT) {
        expect(constraintDef).toContain(`'${medio}'`)
      }
    })
  })

  // ─── CHECK PAQUETES OPCIONALES ──────────────────────────────────────
  describe('Catálogo de paquetes opcionales', () => {
    test('Paridad entre PAQUETES_OPCIONALES en TS y fn_codigos_paquete en Postgres', () => {
      for (const [paquete, codigosEsperados] of Object.entries(PAQUETES_OPCIONALES)) {
        const sqlRes = runPsql(`select fn_codigos_paquete('${paquete}')`)
        expect(sqlRes).toBeDefined()
        for (const codigo of codigosEsperados) {
          expect(sqlRes).toContain(codigo)
        }
      }

      // Paquete inválido no debe devolver códigos
      const invalidoRes = runPsql("select fn_codigos_paquete('inexistente')")
      expect(invalidoRes).toBe('')
    })
  })

  // ─── CASOS FELICES ─────────────────────────────────────────────────
  describe('Casos felices', () => {
    test('REQ-SA-04: Registrar cargo a tenant', async () => {
      const { data: cargoId, error } = await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tenantA,
        p_periodo: '2026-11-01',
        p_monto: 25000,
        p_concepto: 'Abono mensual Plan Base',
        p_created_by: superAdminUserId,
      })

      expect(error).toBeNull()
      expect(cargoId).toBeDefined()

      const { data: cargo, error: fetchErr } = await serviceRole
        .from('tenant_cargo')
        .select('*')
        .eq('id', cargoId)
        .single()

      expect(fetchErr).toBeNull()
      expect(cargo).toBeDefined()
      expect(cargo.id_tenant).toBe(tenantA)
      expect(cargo.periodo).toBe('2026-11-01')
      expect(Number(cargo.monto)).toBe(25000)
      expect(cargo.concepto).toBe('Abono mensual Plan Base')
      expect(cargo.created_by).toBe(superAdminUserId)
      expect(cargo.anulado_at).toBeNull()
      expect(cargo.anulado_por).toBeNull()
    })

    test('REQ-SA-05: Registrar pago de tenant', async () => {
      const { data: pagoId, error } = await serviceRole.rpc('sp_registrar_pago_tenant', {
        p_id_tenant: tenantA,
        p_fecha: '2026-10-28',
        p_monto: 25000,
        p_medio: 'transferencia',
        p_nota: 'Comprobante 44912',
        p_created_by: superAdminUserId,
      })

      expect(error).toBeNull()
      expect(pagoId).toBeDefined()

      const { data: pago, error: fetchErr } = await serviceRole
        .from('tenant_pago')
        .select('*')
        .eq('id', pagoId)
        .single()

      expect(fetchErr).toBeNull()
      expect(pago).toBeDefined()
      expect(pago.id_tenant).toBe(tenantA)
      expect(pago.fecha).toBe('2026-10-28')
      expect(Number(pago.monto)).toBe(25000)
      expect(pago.medio).toBe('transferencia')
      expect(pago.nota).toBe('Comprobante 44912')
      expect(pago.created_by).toBe(superAdminUserId)
      expect(pago.anulado_at).toBeNull()
      expect(pago.anulado_por).toBeNull()
    })

    test('REQ-SA-06: Anulación de movimiento (cargo y pago)', async () => {
      // 1. Cargo
      const { data: cargoId } = await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tenantA,
        p_periodo: '2026-12-01',
        p_monto: 10000,
        p_concepto: 'Cargo a anular',
        p_created_by: superAdminUserId,
      })

      const { error: errAnularCargo } = await serviceRole.rpc('sp_anular_movimiento_tenant', {
        p_tipo: 'cargo',
        p_id_movimiento: cargoId,
        p_anulado_por: superAdminUserId,
      })
      expect(errAnularCargo).toBeNull()

      const { data: cargoAnulado } = await serviceRole
        .from('tenant_cargo')
        .select('anulado_at, anulado_por')
        .eq('id', cargoId)
        .single()
      expect(cargoAnulado?.anulado_at).not.toBeNull()
      expect(cargoAnulado?.anulado_por).toBe(superAdminUserId)

      // 2. Pago
      const { data: pagoId } = await serviceRole.rpc('sp_registrar_pago_tenant', {
        p_id_tenant: tenantA,
        p_fecha: '2026-10-28',
        p_monto: 10000,
        p_medio: 'efectivo',
        p_nota: 'Pago a anular',
        p_created_by: superAdminUserId,
      })

      const { error: errAnularPago } = await serviceRole.rpc('sp_anular_movimiento_tenant', {
        p_tipo: 'pago',
        p_id_movimiento: pagoId,
        p_anulado_por: superAdminUserId,
      })
      expect(errAnularPago).toBeNull()

      const { data: pagoAnulado } = await serviceRole
        .from('tenant_pago')
        .select('anulado_at, anulado_por')
        .eq('id', pagoId)
        .single()
      expect(pagoAnulado?.anulado_at).not.toBeNull()
      expect(pagoAnulado?.anulado_por).toBe(superAdminUserId)
    })

    test('REQ-SA-07: Vista tenant_saldo y cálculo neto (escenario de $5.000)', async () => {
      // Crear un tenant nuevo dedicado para probar el escenario de REQ-SA-07
      const tSaldo = await createTenantWithUser('TenantSaldoTest')
      tenantsToClean.push(tSaldo.tenantId)

      // 1. Cargo vigente de $20.000
      await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tSaldo.tenantId,
        p_periodo: '2026-10-01',
        p_monto: 20000,
        p_concepto: 'Abono vigente',
        p_created_by: superAdminUserId,
      })

      // 2. Cargo de $5.000 anulado
      const { data: cargoAnularId } = await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tSaldo.tenantId,
        p_periodo: '2026-10-01',
        p_monto: 5000,
        p_concepto: 'Abono erróneo anulado',
        p_created_by: superAdminUserId,
      })
      await serviceRole.rpc('sp_anular_movimiento_tenant', {
        p_tipo: 'cargo',
        p_id_movimiento: cargoAnularId,
        p_anulado_por: superAdminUserId,
      })

      // 3. Pago vigente de $15.000
      await serviceRole.rpc('sp_registrar_pago_tenant', {
        p_id_tenant: tSaldo.tenantId,
        p_fecha: '2026-10-28',
        p_monto: 15000,
        p_medio: 'transferencia',
        p_nota: 'Pago parcial',
        p_created_by: superAdminUserId,
      })

      // 4. Consultar vista tenant_saldo
      const { data: saldoRow, error: saldoErr } = await serviceRole
        .from('tenant_saldo')
        .select('*')
        .eq('id_tenant', tSaldo.tenantId)
        .single()

      expect(saldoErr).toBeNull()
      expect(saldoRow).toBeDefined()
      expect(Number(saldoRow.total_cargos)).toBe(20000)
      expect(Number(saldoRow.total_pagos)).toBe(15000)
      expect(Number(saldoRow.saldo)).toBe(5000)
    })

    test('REQ-SA-03: Toggle de módulo admin por paquete funcional', async () => {
      const tToggle = await createTenantWithUser('TenantToggleTest')
      tenantsToClean.push(tToggle.tenantId)

      // 1. Activar paquete 'revendedoras'
      const { error: errRev } = await serviceRole.rpc('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: tToggle.tenantId,
        p_paquete: 'revendedoras',
        p_habilitado: true,
        p_actor: superAdminUserId,
        p_ip: '127.0.0.1',
      })
      expect(errRev).toBeNull()

      // Verificar tenant_modulo
      const { data: mRev } = await serviceRole.from('modulo').select('id_modulo').eq('codigo', 'revendedoras').single()
      const { data: tmRev } = await serviceRole
        .from('tenant_modulo')
        .select('habilitado')
        .eq('id_tenant', tToggle.tenantId)
        .eq('id_modulo', mRev!.id_modulo)
        .single()
      expect(tmRev?.habilitado).toBe(true)

      // Verificar semilla de comisión creada por el trigger
      const { data: reglaLocal } = await serviceRole
        .from('regla_comision')
        .select('*, escala_comision(*)')
        .eq('id_tenant', tToggle.tenantId)
        .eq('ambito', 'local')
        .is('id_revendedora', null)
        .single()
      expect(reglaLocal).toBeDefined()
      expect(reglaLocal.activo).toBe(true)
      expect(reglaLocal.escala_comision).toHaveLength(1)
      expect(Number(reglaLocal.escala_comision[0].porcentaje)).toBe(0)

      // Verificar auditoría
      const { data: auditRev } = await serviceRole
        .from('auditoria')
        .select('*')
        .eq('id_tenant', tToggle.tenantId)
        .eq('entidad', 'tenant_modulo')
        .eq('id_usuario', superAdminUserId)
      expect(auditRev && auditRev.length > 0).toBe(true)

      // 2. Activar paquete 'consignacionProveedor'
      const { error: errConsign } = await serviceRole.rpc('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: tToggle.tenantId,
        p_paquete: 'consignacionProveedor',
        p_habilitado: true,
        p_actor: superAdminUserId,
        p_ip: null,
      })
      expect(errConsign).toBeNull()

      const { data: modulosConsign } = await serviceRole
        .from('modulo')
        .select('id_modulo, codigo')
        .in('codigo', ['consignaciones', 'rendiciones'])

      for (const m of modulosConsign!) {
        const { data: row } = await serviceRole
          .from('tenant_modulo')
          .select('habilitado')
          .eq('id_tenant', tToggle.tenantId)
          .eq('id_modulo', m.id_modulo)
          .single()
        expect(row?.habilitado).toBe(true)
      }

      // 3. Desactivar paquete 'consignacionProveedor' (sin estado vivo)
      const { error: errConsignOff } = await serviceRole.rpc('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: tToggle.tenantId,
        p_paquete: 'consignacionProveedor',
        p_habilitado: false,
        p_actor: superAdminUserId,
        p_ip: null,
      })
      expect(errConsignOff).toBeNull()

      for (const m of modulosConsign!) {
        const { data: row } = await serviceRole
          .from('tenant_modulo')
          .select('habilitado')
          .eq('id_tenant', tToggle.tenantId)
          .eq('id_modulo', m.id_modulo)
          .single()
        expect(row?.habilitado).toBe(false)
      }
    })
  })

  // ─── NEGATIVOS REQ-SA-03 ───────────────────────────────────────────
  describe('REQ-SA-03 Negativos: Toggle de módulos admin', () => {
    test('N1: Actor p_actor no pertenece a superadmin -> no-permission', async () => {
      const { error } = await serviceRole.rpc('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: tenantA,
        p_paquete: 'revendedoras',
        p_habilitado: true,
        p_actor: nonAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/no-permission/)
    })

    test('N2: Tenant inexistente -> tenant-inexistente', async () => {
      const { error } = await serviceRole.rpc('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: randomUUID(),
        p_paquete: 'revendedoras',
        p_habilitado: true,
        p_actor: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/tenant-inexistente/)
    })

    test('N3: Paquete inexistente -> paquete-invalido', async () => {
      const { error } = await serviceRole.rpc('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: tenantA,
        p_paquete: 'paquete_fantasma',
        p_habilitado: true,
        p_actor: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/paquete-invalido/)
    })

    test('N4: Intento de alterar módulo del núcleo -> rechazado', async () => {
      // Como paquete invalido
      const { error: errPaquete } = await serviceRole.rpc('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: tenantA,
        p_paquete: 'ventas',
        p_habilitado: false,
        p_actor: superAdminUserId,
      })
      expect(errPaquete).not.toBeNull()
      expect(errPaquete?.message).toMatch(/paquete-invalido/)

      // O intento directo en tenant_modulo para núcleo deshabilitado
      const { data: mVentas } = await serviceRole.from('modulo').select('id_modulo').eq('codigo', 'ventas').single()
      const { error: errNucleo } = await serviceRole.from('tenant_modulo').upsert({
        id_tenant: tenantA,
        id_modulo: mVentas!.id_modulo,
        habilitado: false,
      })
      expect(errNucleo).not.toBeNull()
      expect(errNucleo?.message).toMatch(/modulo-nucleo/)
    })

    test('N5: Intento de apagar paquete con estado vivo -> modulo-con-estado-vivo', async () => {
      // 1. Activar paquete consignacionProveedor para tenant A
      await serviceRole.rpc('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: tenantA,
        p_paquete: 'consignacionProveedor',
        p_habilitado: true,
        p_actor: superAdminUserId,
      })

      // 2. Crear proveedor y consignacion activa
      const { data: prov, error: provErr } = await serviceRole
        .from('proveedor')
        .insert({ id_tenant: tenantA, nombre: `Prov Vivo ${Date.now()}` })
        .select('id_proveedor')
        .single()
      if (provErr || !prov) throw provErr ?? new Error('Failed to create proveedor')

      const { error: consErr } = await serviceRole.from('consignacion').insert({
        id_tenant: tenantA,
        id_proveedor: prov.id_proveedor,
        fecha: new Date().toISOString(),
        estado: 'activa',
      })
      if (consErr) throw consErr

      // 3. Intentar apagar el paquete consignacionProveedor
      const { error } = await serviceRole.rpc('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: tenantA,
        p_paquete: 'consignacionProveedor',
        p_habilitado: false,
        p_actor: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/modulo-con-estado-vivo/)
    })
  })

  // ─── NEGATIVOS REQ-SA-04 (CARGO) ───────────────────────────────────
  describe('REQ-SA-04 Negativos: Registro de cargo a tenant', () => {
    test('N1: Monto menor o igual a cero o null -> monto-invalido', async () => {
      const { error: errZero } = await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tenantA,
        p_periodo: '2026-11-01',
        p_monto: 0,
        p_concepto: 'Abono',
        p_created_by: superAdminUserId,
      })
      expect(errZero).not.toBeNull()
      expect(errZero?.message).toMatch(/monto-invalido/)

      const { error: errNeg } = await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tenantA,
        p_periodo: '2026-11-01',
        p_monto: -500,
        p_concepto: 'Abono',
        p_created_by: superAdminUserId,
      })
      expect(errNeg).not.toBeNull()
      expect(errNeg?.message).toMatch(/monto-invalido/)
    })

    test('N2: Tenant inexistente -> tenant-inexistente', async () => {
      const { error } = await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: randomUUID(),
        p_periodo: '2026-11-01',
        p_monto: 1500,
        p_concepto: 'Abono',
        p_created_by: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/tenant-inexistente/)
    })

    test('N3: Concepto vacío o whitespace -> concepto-invalido', async () => {
      const { error: errEmpty } = await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tenantA,
        p_periodo: '2026-11-01',
        p_monto: 1500,
        p_concepto: '   ',
        p_created_by: superAdminUserId,
      })
      expect(errEmpty).not.toBeNull()
      expect(errEmpty?.message).toMatch(/concepto-invalido/)
    })

    test('N4: Período no coincide con primer día de mes -> periodo-invalido', async () => {
      const { error } = await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tenantA,
        p_periodo: '2026-11-15',
        p_monto: 1500,
        p_concepto: 'Abono',
        p_created_by: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/periodo-invalido/)
    })

    test('N5: Actor p_created_by ausente en superadmin -> no-permission', async () => {
      const { error } = await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tenantA,
        p_periodo: '2026-11-01',
        p_monto: 1500,
        p_concepto: 'Abono',
        p_created_by: nonAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/no-permission/)
    })
  })

  // ─── NEGATIVOS REQ-SA-05 (PAGO) ────────────────────────────────────
  describe('REQ-SA-05 Negativos: Registro de pago de tenant', () => {
    test('N1: Monto menor o igual a cero -> monto-invalido', async () => {
      const { error: errZero } = await serviceRole.rpc('sp_registrar_pago_tenant', {
        p_id_tenant: tenantA,
        p_fecha: '2026-10-28',
        p_monto: 0,
        p_medio: 'transferencia',
        p_nota: 'Pago',
        p_created_by: superAdminUserId,
      })
      expect(errZero).not.toBeNull()
      expect(errZero?.message).toMatch(/monto-invalido/)

      const { error: errNeg } = await serviceRole.rpc('sp_registrar_pago_tenant', {
        p_id_tenant: tenantA,
        p_fecha: '2026-10-28',
        p_monto: -100,
        p_medio: 'transferencia',
        p_nota: 'Pago',
        p_created_by: superAdminUserId,
      })
      expect(errNeg).not.toBeNull()
      expect(errNeg?.message).toMatch(/monto-invalido/)
    })

    test('N2: Tenant inexistente -> tenant-inexistente', async () => {
      const { error } = await serviceRole.rpc('sp_registrar_pago_tenant', {
        p_id_tenant: randomUUID(),
        p_fecha: '2026-10-28',
        p_monto: 1000,
        p_medio: 'transferencia',
        p_nota: 'Pago',
        p_created_by: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/tenant-inexistente/)
    })

    test('N3: Medio fuera de catálogo -> medio-pago-invalido', async () => {
      const { error } = await serviceRole.rpc('sp_registrar_pago_tenant', {
        p_id_tenant: tenantA,
        p_fecha: '2026-10-28',
        p_monto: 1000,
        p_medio: 'criptomoneda',
        p_nota: 'Pago',
        p_created_by: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/medio-pago-invalido/)
    })

    test('N4: Fecha futura -> fecha-invalida', async () => {
      const { error } = await serviceRole.rpc('sp_registrar_pago_tenant', {
        p_id_tenant: tenantA,
        p_fecha: '2099-01-01',
        p_monto: 1000,
        p_medio: 'transferencia',
        p_nota: 'Pago futuro',
        p_created_by: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/fecha-invalida/)
    })

    test('N5: Actor p_created_by ausente en superadmin -> no-permission', async () => {
      const { error } = await serviceRole.rpc('sp_registrar_pago_tenant', {
        p_id_tenant: tenantA,
        p_fecha: '2026-10-28',
        p_monto: 1000,
        p_medio: 'transferencia',
        p_nota: 'Pago',
        p_created_by: nonAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/no-permission/)
    })
  })

  // ─── NEGATIVOS REQ-SA-06 (ANULACIÓN) ───────────────────────────────
  describe('REQ-SA-06 Negativos: Anulación de movimiento', () => {
    test('N1: Movimiento inexistente -> movimiento-inexistente', async () => {
      const { error: errCargo } = await serviceRole.rpc('sp_anular_movimiento_tenant', {
        p_tipo: 'cargo',
        p_id_movimiento: randomUUID(),
        p_anulado_por: superAdminUserId,
      })
      expect(errCargo).not.toBeNull()
      expect(errCargo?.message).toMatch(/movimiento-inexistente/)

      const { error: errPago } = await serviceRole.rpc('sp_anular_movimiento_tenant', {
        p_tipo: 'pago',
        p_id_movimiento: randomUUID(),
        p_anulado_por: superAdminUserId,
      })
      expect(errPago).not.toBeNull()
      expect(errPago?.message).toMatch(/movimiento-inexistente/)
    })

    test('Doble anulación seguida (pago) -> la segunda da movimiento-ya-anulado', async () => {
      const { data: pagoId } = await serviceRole.rpc('sp_registrar_pago_tenant', {
        p_id_tenant: tenantA,
        p_fecha: '2026-10-28',
        p_monto: 3000,
        p_medio: 'transferencia',
        p_nota: 'Pago doble anulación',
        p_created_by: superAdminUserId,
      })

      // Primera anulación
      const { error: err1 } = await serviceRole.rpc('sp_anular_movimiento_tenant', {
        p_tipo: 'pago',
        p_id_movimiento: pagoId,
        p_anulado_por: superAdminUserId,
      })
      expect(err1).toBeNull()

      // Segunda anulación seguida
      const { error: err2 } = await serviceRole.rpc('sp_anular_movimiento_tenant', {
        p_tipo: 'pago',
        p_id_movimiento: pagoId,
        p_anulado_por: superAdminUserId,
      })
      expect(err2).not.toBeNull()
      expect(err2?.message).toMatch(/movimiento-ya-anulado/)
    })

    test('N2: Movimiento ya anulado -> movimiento-ya-anulado', async () => {
      const { data: cargoId } = await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tenantA,
        p_periodo: '2026-10-01',
        p_monto: 3000,
        p_concepto: 'Cargo doble anulación',
        p_created_by: superAdminUserId,
      })

      // Primera anulación
      await serviceRole.rpc('sp_anular_movimiento_tenant', {
        p_tipo: 'cargo',
        p_id_movimiento: cargoId,
        p_anulado_por: superAdminUserId,
      })

      // Segunda anulación
      const { error } = await serviceRole.rpc('sp_anular_movimiento_tenant', {
        p_tipo: 'cargo',
        p_id_movimiento: cargoId,
        p_anulado_por: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/movimiento-ya-anulado/)
    })

    test('N3: Tipo no admitido -> tipo-movimiento-invalido', async () => {
      const { error } = await serviceRole.rpc('sp_anular_movimiento_tenant', {
        p_tipo: 'prestamo',
        p_id_movimiento: randomUUID(),
        p_anulado_por: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/tipo-movimiento-invalido/)
    })

    test('N4: Actor p_anulado_por ausente en superadmin -> no-permission', async () => {
      const { data: cargoId } = await serviceRole.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tenantA,
        p_periodo: '2026-10-01',
        p_monto: 3000,
        p_concepto: 'Cargo anulación actor ilegítimo',
        p_created_by: superAdminUserId,
      })

      const { error } = await serviceRole.rpc('sp_anular_movimiento_tenant', {
        p_tipo: 'cargo',
        p_id_movimiento: cargoId,
        p_anulado_por: nonAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/no-permission/)
    })
  })

  // ─── AISLAMIENTO ESTRICTO REQ-SA-08 ────────────────────────────────
  describe('REQ-SA-08: Aislamiento estricto de plataforma', () => {
    test('N1: Usuario autenticado de tenant intenta SELECT o INSERT en tenant_cargo -> denegado', async () => {
      const { data, error: selectErr } = await authAdminA.from('tenant_cargo').select('*')
      // RLS sin policies devuelve 0 filas o PostgREST responde permission denied por REVOKE
      if (!selectErr) {
        expect(data).toHaveLength(0)
      } else {
        expect(selectErr.message).toMatch(/permission denied|violates row-level security policy/i)
      }

      const { error: insertErr } = await authAdminA.from('tenant_cargo').insert({
        id_tenant: tenantA,
        periodo: '2026-11-01',
        monto: 5000,
        concepto: 'Intento ilegítimo',
        created_by: superAdminUserId,
      })
      expect(insertErr).not.toBeNull()
      expect(insertErr?.message).toMatch(/permission denied|violates row-level security policy/i)
    })

    test('N2: Usuario autenticado intenta RPC sp_registrar_cargo_tenant -> permission denied', async () => {
      const { error } = await authAdminA.rpc('sp_registrar_cargo_tenant', {
        p_id_tenant: tenantA,
        p_periodo: '2026-11-01',
        p_monto: 5000,
        p_concepto: 'RPC ilegítimo',
        p_created_by: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/permission denied/i)
    })

    test('N3: Usuario anónimo intenta consultar superadmin o tenant_saldo -> denegado', async () => {
      const { data: saData, error: saErr } = await anonClient.from('superadmin').select('*')
      if (!saErr) {
        expect(saData).toHaveLength(0)
      } else {
        expect(saErr.message).toMatch(/permission denied|violates row-level security policy/i)
      }

      const { data: saldoData, error: saldoErr } = await anonClient.from('tenant_saldo').select('*')
      if (!saldoErr) {
        expect(saldoData).toHaveLength(0)
      } else {
        expect(saldoErr.message).toMatch(/permission denied|violates row-level security policy/i)
      }
    })

    test('N4: Revendedora intenta acceder a tablas, vista o SPs -> denegado', async () => {
      // 1. Lectura tenant_pago
      const { data: pagoData, error: pagoErr } = await authRev.from('tenant_pago').select('*')
      if (!pagoErr) {
        expect(pagoData).toHaveLength(0)
      } else {
        expect(pagoErr.message).toMatch(/permission denied|violates row-level security policy/i)
      }

      // 2. Lectura vista tenant_saldo
      const { data: saldoData, error: saldoErr } = await authRev.from('tenant_saldo').select('*')
      if (!saldoErr) {
        expect(saldoData).toHaveLength(0)
      } else {
        expect(saldoErr.message).toMatch(/permission denied|violates row-level security policy/i)
      }

      // 3. Ejecución RPC
      const { error: rpcErr } = await authRev.rpc('sp_registrar_pago_tenant', {
        p_id_tenant: tenantA,
        p_fecha: '2026-10-28',
        p_monto: 1000,
        p_medio: 'transferencia',
        p_nota: 'Pago rev',
        p_created_by: superAdminUserId,
      })
      expect(rpcErr).not.toBeNull()
      expect(rpcErr?.message).toMatch(/permission denied/i)
    })
  })

  describe('REQ-SA-09 — Alta de tenant (sp_alta_tenant)', () => {
    test('N1: Actor no superadmin -> rechazo no-permission', async () => {
      const emailAdmin = `admin_reject_${Date.now()}_${randomUUID().slice(0, 8)}@utopia.test`
      const { data: authUser } = await serviceRole.auth.admin.createUser({
        email: emailAdmin,
        password: 'Password123!',
        email_confirm: true,
      })
      usersToClean.push(authUser!.user!.id)

      const { error } = await serviceRole.rpc('sp_alta_tenant', {
        p_nombre: 'Comercio Rechazado',
        p_subdominio: `sub-${randomUUID().slice(0, 8)}`,
        p_paquetes: [],
        p_id_auth_user: authUser!.user!.id,
        p_email: emailAdmin,
        p_nombre_admin: 'Admin Test',
        p_permisos: {},
        p_actor: nonAdminUserId,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toContain('no-permission')
    })

    test('N2: Subdominio duplicado -> rechazo subdominio-en-uso', async () => {
      const { data: tenantARow, error: tErr } = await serviceRole.from('tenant').select('subdominio').eq('id_tenant', tenantA).single()
      expect(tErr).toBeNull()
      expect(tenantARow).toBeDefined()

      const emailAdmin = `admin_dup_${Date.now()}_${randomUUID().slice(0, 8)}@utopia.test`
      const { data: authUser } = await serviceRole.auth.admin.createUser({
        email: emailAdmin,
        password: 'Password123!',
        email_confirm: true,
      })
      usersToClean.push(authUser!.user!.id)

      const { data: resData, error } = await serviceRole.rpc('sp_alta_tenant', {
        p_nombre: 'Comercio Duplicado',
        p_subdominio: tenantARow!.subdominio,
        p_paquetes: [],
        p_id_auth_user: authUser!.user!.id,
        p_email: emailAdmin,
        p_nombre_admin: 'Admin Test',
        p_permisos: {},
        p_actor: superAdminUserId,
      })
      if (resData) tenantsToClean.push(resData as string)

      expect(error).not.toBeNull()
      expect(error?.message).toContain('subdominio-en-uso')
    })

    test('Feliz: Crea tenant + rol + usuario + módulos núcleo y siembra semilla de comisión al incluir revendedoras', async () => {
      const emailAdmin = `admin_success_${Date.now()}_${randomUUID().slice(0, 8)}@utopia.test`
      const { data: authUser } = await serviceRole.auth.admin.createUser({
        email: emailAdmin,
        password: 'Password123!',
        email_confirm: true,
      })
      const authId = authUser!.user!.id
      usersToClean.push(authId)

      const subdominio = `alta-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`
      const { data: idTenantCreado, error } = await serviceRole.rpc('sp_alta_tenant', {
        p_nombre: 'Boutique Alta Test',
        p_subdominio: subdominio,
        p_paquetes: ['revendedoras'],
        p_id_auth_user: authId,
        p_email: emailAdmin,
        p_nombre_admin: 'Administradora Alta',
        p_permisos: { ventas: ['ver', 'crear'] },
        p_actor: superAdminUserId,
      })

      expect(error).toBeNull()
      expect(idTenantCreado).toBeDefined()
      tenantsToClean.push(idTenantCreado as string)

      // 1. Verificar tenant creado con estado 'activo'
      const { data: tRow } = await serviceRole.from('tenant').select('*').eq('id_tenant', idTenantCreado).single()
      expect(tRow).toBeDefined()
      expect(tRow.nombre_comercial).toBe('Boutique Alta Test')
      expect(tRow.subdominio).toBe(subdominio)
      expect(tRow.estado_tenant).toBe('activo')

      // 2. Verificar rol 'Administrador'
      const { data: rRow, error: rErr } = await serviceRole
        .from('rol')
        .select('*')
        .eq('id_tenant', idTenantCreado)
        .eq('nombre', 'Administrador')
        .single()
      expect(rErr).toBeNull()
      expect(rRow).toBeDefined()
      expect(rRow!.nombre).toBe('Administrador')
      expect(rRow!.permisos).toEqual({ ventas: ['ver', 'crear'] })

      // 3. Verificar usuario perfil creado con rol 'Administrador' y estado 'invitado'
      const { data: uRow } = await serviceRole.from('usuario').select('*').eq('id_usuario', authId).single()
      expect(uRow).toBeDefined()
      expect(uRow.id_tenant).toBe(idTenantCreado)
      expect(uRow.id_rol).toBe(rRow.id_rol)
      expect(uRow.email).toBe(emailAdmin)
      expect(uRow.nombre_completo).toBe('Administradora Alta')
      expect(uRow.estado_usuario).toBe('invitado')

      // 4. Verificar módulos núcleo habilitados
      const { data: modulos } = await serviceRole
        .from('tenant_modulo')
        .select('habilitado, modulo(codigo)')
        .eq('id_tenant', idTenantCreado)

      const codigosHabilitados = modulos?.filter((m) => m.habilitado && m.modulo).map((m) => (m.modulo as unknown as { codigo: string }).codigo) ?? []
      for (const nucleo of ['administracion', 'inventario', 'ventas', 'precios', 'gastos', 'reportes']) {
        expect(codigosHabilitados).toContain(nucleo)
      }
      expect(codigosHabilitados).toContain('revendedoras')

      // 5. Verificar semilla de comisión 0% disparada por tr_semilla_comision_revendedoras
      const { data: regla } = await serviceRole
        .from('regla_comision')
        .select('*, escala_comision(*)')
        .eq('id_tenant', idTenantCreado)
        .eq('ambito', 'local')
        .single()

      expect(regla).toBeDefined()
      expect(regla.nombre).toContain('Semilla 0%')
      expect(regla.escala_comision?.[0]?.porcentaje).toBe(0)
    })
  })

  describe('REQ-SA-10 — Suspensión y reactivación de tenant (sp_cambiar_estado_tenant y hook)', () => {
    test('N1: Actor no superadmin -> rechazo no-permission', async () => {
      const { error } = await serviceRole.rpc('sp_cambiar_estado_tenant', {
        p_id_tenant: tenantA,
        p_estado: 'suspendido',
        p_actor: nonAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toContain('no-permission')
    })

    test('N2: Tenant inexistente -> rechazo tenant-inexistente', async () => {
      const { error } = await serviceRole.rpc('sp_cambiar_estado_tenant', {
        p_id_tenant: randomUUID(),
        p_estado: 'suspendido',
        p_actor: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toContain('tenant-inexistente')
    })

    test('N3: Estado inválido (ej: archivado) -> rechazo estado-invalido', async () => {
      const { error } = await serviceRole.rpc('sp_cambiar_estado_tenant', {
        p_id_tenant: tenantA,
        p_estado: 'archivado',
        p_actor: superAdminUserId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toContain('estado-invalido')
    })

    test('Feliz: sp_cambiar_estado_tenant cambia estado y custom_access_token_hook responde acordemente', async () => {
      // 1. Obtener usuario de tenant A
      const { data: usuarioA } = await serviceRole.from('usuario').select('id_usuario').eq('id_tenant', tenantA).limit(1).single()
      expect(usuarioA).toBeDefined()

      // Verificar que con tenant activo el hook inyecta tenant_id
      const { data: hookActivo } = await serviceRole.rpc('custom_access_token_hook', {
        event: { user_id: usuarioA!.id_usuario, claims: { app_metadata: {} } },
      })
      expect(hookActivo?.claims?.tenant_id).toBe(tenantA)

      // 2. Suspender tenant A
      const { error: errSuspender } = await serviceRole.rpc('sp_cambiar_estado_tenant', {
        p_id_tenant: tenantA,
        p_estado: 'suspendido',
        p_actor: superAdminUserId,
      })
      expect(errSuspender).toBeNull()

      const { data: tSusp } = await serviceRole.from('tenant').select('estado_tenant').eq('id_tenant', tenantA).single()
      expect(tSusp).toBeDefined()
      expect(tSusp!.estado_tenant).toBe('suspendido')

      // 3. Probar hook con tenant suspendido: NO inyecta tenant_id ni id_revendedora
      const { data: hookSuspendido } = await serviceRole.rpc('custom_access_token_hook', {
        event: { user_id: usuarioA!.id_usuario, claims: { app_metadata: {} } },
      })
      expect(hookSuspendido?.claims?.tenant_id).toBeUndefined()
      expect(hookSuspendido?.claims?.id_revendedora).toBeUndefined()

      // Para revendedora en tenant suspendido: tampoco inyecta tenant_id ni id_revendedora
      const { data: hookRevSusp } = await serviceRole.rpc('custom_access_token_hook', {
        event: { user_id: revendedoraUserId, claims: { app_metadata: {} } },
      })
      expect(hookRevSusp?.claims?.tenant_id).toBeUndefined()
      expect(hookRevSusp?.claims?.id_revendedora).toBeUndefined()

      // 4. Reactivar tenant A
      const { error: errReactivar } = await serviceRole.rpc('sp_cambiar_estado_tenant', {
        p_id_tenant: tenantA,
        p_estado: 'activo',
        p_actor: superAdminUserId,
      })
      expect(errReactivar).toBeNull()

      const { data: tActivo } = await serviceRole.from('tenant').select('estado_tenant').eq('id_tenant', tenantA).single()
      expect(tActivo).toBeDefined()
      expect(tActivo!.estado_tenant).toBe('activo')

      // 5. Probar hook con tenant reactivado: vuelve a inyectar tenant_id
      const { data: hookReactivado } = await serviceRole.rpc('custom_access_token_hook', {
        event: { user_id: usuarioA!.id_usuario, claims: { app_metadata: {} } },
      })
      expect(hookReactivado?.claims?.tenant_id).toBe(tenantA)
    })
  })

})
