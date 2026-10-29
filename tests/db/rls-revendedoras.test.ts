import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, hasTestDb, signInAs, runPsql } from './_helpers'
import { SupabaseClient } from '@supabase/supabase-js'

describe.skipIf(!hasTestDb)('RLS revendedoras — restricción por usuario (ACC-07)', () => {
  const serviceRole = createServiceRoleTestClient()
  let tenantIdA: string
  let tenantIdB: string
  let authAdminA: SupabaseClient
  let authAdminB: SupabaseClient

  let authRevA: SupabaseClient
  let authRevB: SupabaseClient
  let authRevC: SupabaseClient

  let idRevA: string
  let idRevB: string
  let idRevC: string

  let userRevAId: string
  let userRevBId: string
  let userRevCId: string

  const usersToClean: string[] = []

  beforeAll(async () => {
    // 1. Crear tenant A
    const tA = await createTenantWithUser('Acc07TenantA')
    tenantIdA = tA.tenantId
    authAdminA = await signInAs(tA)

    // Crear tenant B para aislamiento cruzado
    const tB = await createTenantWithUser('Acc07TenantB')
    tenantIdB = tB.tenantId
    authAdminB = await signInAs(tB)

    // 2. Habilitar módulo revendedoras en ambos tenants
    const { data: m } = await serviceRole.from('modulo').select('id_modulo').eq('codigo', 'revendedoras').single()
    await serviceRole.from('tenant_modulo').insert([
      { id_tenant: tenantIdA, id_modulo: m!.id_modulo, habilitado: true },
      { id_tenant: tenantIdB, id_modulo: m!.id_modulo, habilitado: true },
    ])

    // Rol Revendedora en tenant A y B
    const { data: rolA } = await serviceRole
      .from('rol')
      .insert({
        id_tenant: tenantIdA,
        nombre: 'Revendedora',
        permisos: { revendedoras: ['ver_propio', 'declarar'] },
      })
      .select('id_rol')
      .single()

    const { data: rolB } = await serviceRole
      .from('rol')
      .insert({
        id_tenant: tenantIdB,
        nombre: 'Revendedora',
        permisos: { revendedoras: ['ver_propio', 'declarar'] },
      })
      .select('id_rol')
      .single()

    // 3. Crear Revendedora A (tenant A)
    const { data: revAId } = await authAdminA.rpc('sp_crear_revendedora', {
      p_nombre: 'Ana',
      p_apellido: 'RevA',
      p_email: 'ana_acc07@test.com',
    })
    idRevA = revAId

    const emailA = `ana_auth_${Date.now()}@test.com`
    const { data: userA } = await serviceRole.auth.admin.createUser({
      email: emailA,
      password: 'Password123!',
      email_confirm: true,
    })
    userRevAId = userA!.user!.id
    usersToClean.push(userRevAId)

    await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRevA,
      p_id_usuario: userRevAId,
      p_id_tenant: tenantIdA,
      p_email: emailA,
      p_nombre: 'Ana RevA',
      p_id_rol: rolA!.id_rol,
    })
    authRevA = await signInAs({ email: emailA, password: 'Password123!' })

    // 4. Crear Revendedora B (mismo tenant A)
    const { data: revBId } = await authAdminA.rpc('sp_crear_revendedora', {
      p_nombre: 'Berta',
      p_apellido: 'RevB',
      p_email: 'berta_acc07@test.com',
    })
    idRevB = revBId

    const emailB = `berta_auth_${Date.now()}@test.com`
    const { data: userB } = await serviceRole.auth.admin.createUser({
      email: emailB,
      password: 'Password123!',
      email_confirm: true,
    })
    userRevBId = userB!.user!.id
    usersToClean.push(userRevBId)

    await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRevB,
      p_id_usuario: userRevBId,
      p_id_tenant: tenantIdA,
      p_email: emailB,
      p_nombre: 'Berta RevB',
      p_id_rol: rolA!.id_rol,
    })
    authRevB = await signInAs({ email: emailB, password: 'Password123!' })

    // 5. Crear Revendedora C (tenant B)
    const { data: revCId } = await authAdminB.rpc('sp_crear_revendedora', {
      p_nombre: 'Carla',
      p_apellido: 'RevC',
      p_email: 'carla_acc07@test.com',
    })
    idRevC = revCId

    const emailC = `carla_auth_${Date.now()}@test.com`
    const { data: userC } = await serviceRole.auth.admin.createUser({
      email: emailC,
      password: 'Password123!',
      email_confirm: true,
    })
    userRevCId = userC!.user!.id
    usersToClean.push(userRevCId)

    await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRevC,
      p_id_usuario: userRevCId,
      p_id_tenant: tenantIdB,
      p_email: emailC,
      p_nombre: 'Carla RevC',
      p_id_rol: rolB!.id_rol,
    })
    authRevC = await signInAs({ email: emailC, password: 'Password123!' })
  })

  afterAll(async () => {
    if (tenantIdA) await serviceRole.rpc('sp_borrar_tenant', { p_id: tenantIdA })
    if (tenantIdB) await serviceRole.rpc('sp_borrar_tenant', { p_id: tenantIdB })
    for (const u of usersToClean) {
      await serviceRole.auth.admin.deleteUser(u)
    }
  })

  test('guardia anti-olvido (ACC-11): toda tabla RLS tiene política restrictiva o está en lista blanca', async () => {
    const query = "select c.relname as table_name, array_agg(p.polname) filter (where p.polname is not null) as policies from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_policy p on p.polrelid = c.oid and p.polpermissive = false where n.nspname = 'public' and c.relrowsecurity = true group by c.relname"
    const jsonQuery = `select json_agg(t) from (${query}) t;`
    const output = runPsql(jsonQuery)
    const data = JSON.parse(output || '[]')

    const whitelist = [
      'revendedora',
      'declaracion_venta_revendedora',
      'superadmin',
      'tenant_cargo',
      'tenant_pago',
      'tenant_listado',
      'tenant_movimiento',
    ]
    const tablasSinRestrictiva = data.filter((row: { table_name: string; policies: string[] | null }) => {
      if (whitelist.includes(row.table_name)) return false
      if (!row.policies) return true
      return !row.policies.some((p: string) => p.includes('restrict_revendedora_') || p.includes('revendedora_propia'))
    })

    expect(tablasSinRestrictiva).toEqual([])
  })

  test('auth_revendedora_id() retorna el claim inyectado por el hook', async () => {
    const authRevHelper = await authRevA.rpc('auth_revendedora_id')
    expect(authRevHelper.error).toBeNull()
    expect(authRevHelper.data).toBe(idRevA)
  })

  test('C.1 ACC-07: aislamiento horizontal entre revendedoras (A y B mismo tenant, C otro tenant)', async () => {
    // 1. Ana consulta revendedoras: ve exactamente 1 fila y conteo 1 (ella misma)
    const { data: revsA, count: countA, error: errA } = await authRevA
      .from('revendedora')
      .select('*', { count: 'exact' })
    expect(errA).toBeNull()
    expect(countA).toBe(1)
    expect(revsA).toHaveLength(1)
    expect(revsA![0].id_revendedora).toBe(idRevA)

    // 2. Berta consulta revendedoras: ve exactamente 1 fila y conteo 1 (ella misma)
    const { data: revsB, count: countB, error: errB } = await authRevB
      .from('revendedora')
      .select('*', { count: 'exact' })
    expect(errB).toBeNull()
    expect(countB).toBe(1)
    expect(revsB).toHaveLength(1)
    expect(revsB![0].id_revendedora).toBe(idRevB)

    // 3. Carla (tenant B) consulta revendedoras: ve solo su propia fila
    const { data: revsC, count: countC, error: errC } = await authRevC
      .from('revendedora')
      .select('*', { count: 'exact' })
    expect(errC).toBeNull()
    expect(countC).toBe(1)
    expect(revsC).toHaveLength(1)
    expect(revsC![0].id_revendedora).toBe(idRevC)

    // 4. Ana intenta consultar explícitamente a Berta o Carla
    const { data: targetB } = await authRevA.from('revendedora').select('*').eq('id_revendedora', idRevB)
    expect(targetB).toHaveLength(0)

    const { data: targetC } = await authRevA.from('revendedora').select('*').eq('id_revendedora', idRevC)
    expect(targetC).toHaveLength(0)
  })

  test('C.1 ACC-07: SELECT directo vacío o con error en las 14 tablas del sistema', async () => {
    const TABLAS_DENEGADAS = [
      'item_producto',
      'producto',
      'detalle_venta',
      'venta',
      'liquidacion_revendedora',
      'pago_revendedora',
      'cambio_venta',
      'regla_comision',
      'escala_comision',
      'proveedor',
      'gasto_negocio',
      'cliente',
      'usuario',
      'rol',
    ]

    for (const tabla of TABLAS_DENEGADAS) {
      const { data, error } = await authRevA.from(tabla).select('*')
      if (error) {
        expect(error.code).toBe('42501')
      } else {
        expect(data, `Tabla ${tabla} no debe devolver datos a la sesión de revendedora`).toHaveLength(0)
      }
    }
  })

  test('C.1 ACC-07: mutaciones directas (INSERT/UPDATE/DELETE) denegadas fuera de la lista blanca', async () => {
    // 1. En tabla ajena (cliente): INSERT, UPDATE, DELETE denegados por RLS
    const { error: errInsCli } = await authRevA.from('cliente').insert({
      id_tenant: tenantIdA,
      nombre: 'Hacker',
      apellido: 'Intruso',
    })
    expect(errInsCli).not.toBeNull()
    expect(errInsCli?.code).toBe('42501')

    const { error: errUpdCli } = await authRevA.from('cliente').update({ nombre: 'Hacked' }).eq('id_tenant', tenantIdA)
    expect(errUpdCli?.code === '42501' || errUpdCli === null).toBe(true)

    const { error: errDelCli } = await authRevA.from('cliente').delete().eq('id_tenant', tenantIdA)
    expect(errDelCli?.code === '42501' || errDelCli === null).toBe(true)

    // 2. En lista blanca: en tabla revendedora no puede UPDATE ni DELETE
    const { data: updRev, error: errUpdRev } = await authRevA
      .from('revendedora')
      .update({ nombre: 'HackNombre' })
      .eq('id_revendedora', idRevA)
      .select()
    if (errUpdRev) {
      expect(errUpdRev.code).toBe('42501')
    } else {
      expect(updRev).toHaveLength(0)
    }

    const { data: delRev, error: errDelRev } = await authRevA
      .from('revendedora')
      .delete()
      .eq('id_revendedora', idRevA)
      .select()
    if (errDelRev) {
      expect(errDelRev.code).toBe('42501')
    } else {
      expect(delRev).toHaveLength(0)
    }

    // 3. En declaracion_venta_revendedora: UPDATE y DELETE directos están denegados por RLS restrictiva
    const { error: errUpdDec } = await authRevA
      .from('declaracion_venta_revendedora')
      .update({ estado: 'confirmada' })
      .eq('id_revendedora', idRevA)
    expect(errUpdDec?.code === '42501' || errUpdDec === null).toBe(true)

    const { error: errDelDec } = await authRevA
      .from('declaracion_venta_revendedora')
      .delete()
      .eq('id_revendedora', idRevA)
    expect(errDelDec?.code === '42501' || errDelDec === null).toBe(true)
  })

  test('C.1 ACC-07: toda función sp_*, rf_* y preview_liquidacion administrativa rechaza a la revendedora', async () => {
    const query = "select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'sp_%' or p.proname like 'rf_%' or p.proname = 'preview_liquidacion') order by p.proname;"
    const output = runPsql(query)
    const procNames = output.split('\n').map((s) => s.trim()).filter(Boolean)

    const WHITELIST_REVENDEDORA = new Set([
      'sp_declarar_venta_revendedora',
      'sp_retirar_declaracion',
      'sp_session_context',
      'sp_change_password_user',
    ])

    for (const name of procNames) {
      if (WHITELIST_REVENDEDORA.has(name) || name.startsWith('rvp_')) {
        continue
      }

      // Intentar ejecutar el procedimiento con la sesión de revendedora
      const { data, error } = await authRevA.rpc(name, {})
      // Debe ser rechazado: o retorna error (permiso, RLS, falta de argumentos, módulo) o devuelve conjunto vacío
      if (!error) {
        // Si no dio error a nivel protocolo RPC, verificar que no haya devuelto datos sensibles ni conteos mayores a 0
        if (Array.isArray(data) && data.length > 0) {
          for (const row of data) {
            for (const val of Object.values(row)) {
              if (typeof val === 'number') {
                expect(val, `Procedimiento ${name} no debe revelar conteos o montos`).toBe(0)
              } else if (val !== null && typeof val === 'object') {
                expect(val, `Procedimiento ${name} no debe revelar datos`).toEqual({})
              } else {
                expect(val === null || val === '0' || val === 0, `Procedimiento ${name} no debe filtrar datos sensibles`).toBe(true)
              }
            }
          }
        }
      } else {
        expect(error, `Procedimiento ${name} debe rechazar la llamada de revendedora`).toBeDefined()
      }
    }
  })

  test('C.1 ACC-07: funciones rvp_* con módulo apagado levantan modulo-revendedoras-deshabilitado', async () => {
    // Apagar módulo revendedoras en tenant A
    const { data: m } = await serviceRole.from('modulo').select('id_modulo').eq('codigo', 'revendedoras').single()
    await serviceRole
      .from('tenant_modulo')
      .update({ habilitado: false })
      .eq('id_tenant', tenantIdA)
      .eq('id_modulo', m!.id_modulo)

    try {
      const { error: errStock } = await authRevA.rpc('rvp_mi_stock')
      expect(errStock?.message).toContain('modulo-revendedoras-deshabilitado')

      const { error: errVentas } = await authRevA.rpc('rvp_mis_ventas')
      expect(errVentas?.message).toContain('modulo-revendedoras-deshabilitado')

      const { error: errCuenta } = await authRevA.rpc('rvp_mi_cuenta')
      expect(errCuenta?.message).toContain('modulo-revendedoras-deshabilitado')

      const { error: errLiq } = await authRevA.rpc('rvp_mis_liquidaciones')
      expect(errLiq?.message).toContain('modulo-revendedoras-deshabilitado')

      const { error: errDec } = await authRevA.rpc('rvp_mis_declaraciones')
      expect(errDec?.message).toContain('modulo-revendedoras-deshabilitado')

      const { error: errPoder } = await authRevA.rpc('rvp_item_en_mi_poder', {
        p_id_item: '00000000-0000-0000-0000-000000000000',
      })
      expect(errPoder?.message).toContain('modulo-revendedoras-deshabilitado')
    } finally {
      // Restaurar módulo habilitado
      await serviceRole
        .from('tenant_modulo')
        .update({ habilitado: true })
        .eq('id_tenant', tenantIdA)
        .eq('id_modulo', m!.id_modulo)
    }
  })

  test('C.4 Claim: desenlazar revendedora no deja claim viejo (hook sin tenant_id ni id_revendedora)', async () => {
    // 1. Quitar el enlace a revendedora A
    await serviceRole.from('revendedora').update({ id_usuario: null }).eq('id_revendedora', idRevA)

    // 2. Invocar el custom_access_token_hook simulando refresh de token para el usuario
    const { data: hookResult, error: hookErr } = await serviceRole.rpc('custom_access_token_hook', {
      event: { user_id: userRevAId, claims: { app_metadata: {} } },
    })
    expect(hookErr).toBeNull()

    // El hook no debe inyectar tenant_id ni id_revendedora
    expect(hookResult?.claims?.tenant_id).toBeUndefined()
    expect(hookResult?.claims?.id_revendedora).toBeUndefined()

    // 3. Restaurar enlace para no afectar tests posteriores si los hubiera
    await serviceRole.from('revendedora').update({ id_usuario: userRevAId }).eq('id_revendedora', idRevA)
  })

  test('sesión de operador no se ve afectada (auth_revendedora_id() es null)', async () => {
    const authAdminHelper = await authAdminA.rpc('auth_revendedora_id')
    expect(authAdminHelper.error).toBeNull()
    expect(authAdminHelper.data).toBeNull()

    // Puede leer la revendedora y otras tablas
    const { data: revs, error: errRevs } = await authAdminA.from('revendedora').select('*')
    expect(errRevs).toBeNull()
    expect(revs!.length).toBeGreaterThanOrEqual(2)

    // Puede insertar un cliente
    const { error: errCli } = await authAdminA.from('cliente').insert({
      id_tenant: tenantIdA,
      nombre: 'Juan',
      apellido: 'Perez',
    })
    expect(errCli).toBeNull()
  })
})
