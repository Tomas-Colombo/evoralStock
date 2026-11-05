import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, createUserWithoutTenant, hasTestDb, runPsql, signInAs, withScopedTenant } from './_helpers'

describe.skipIf(!hasTestDb)('Slice 2 — Cotización USD (DB, RLS restrictiva y SPs)', () => {
  const serviceRole = createServiceRoleTestClient()

  async function createRevendedoraSession(tenantId: string, authAdmin: SupabaseClient) {
    const { data: modRev } = await serviceRole
      .from('modulo')
      .select('id_modulo')
      .eq('codigo', 'revendedoras')
      .single()
    await serviceRole
      .from('tenant_modulo')
      .upsert({ id_tenant: tenantId, id_modulo: modRev!.id_modulo, habilitado: true })

    const { data: rolRev } = await serviceRole
      .from('rol')
      .insert({
        id_tenant: tenantId,
        nombre: 'Revendedora',
        permisos: { revendedoras: ['ver_propio', 'declarar'] },
      })
      .select('id_rol')
      .single()

    const { data: idRev, error: errRev } = await authAdmin.rpc('sp_crear_revendedora', {
      p_nombre: 'Rocío',
      p_apellido: 'Revendedora',
      p_email: `${withScopedTenant('rocio')}@example.com`,
    })
    expect(errRev, 'crear revendedora').toBeNull()

    const emailRev = `${withScopedTenant('rocio-auth')}@example.com`
    const { data: userRev } = await serviceRole.auth.admin.createUser({
      email: emailRev,
      password: 'Password123!',
      email_confirm: true,
    })
    const { error: errEnlace } = await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRev,
      p_id_usuario: userRev!.user!.id,
      p_id_tenant: tenantId,
      p_email: emailRev,
      p_nombre: 'Rocío Revendedora',
      p_id_rol: rolRev!.id_rol,
    })
    expect(errEnlace, 'enlazar revendedora').toBeNull()

    return signInAs({ email: emailRev, password: 'Password123!' })
  }

  describe('1. Flujo feliz: configuración y cotización automática/manual', () => {
    it('sin fila en cotizacion_config: sp_get_cotizacion_vigente retorna modo automatica por defecto', async () => {
      const tenant = await createTenantWithUser('cotiz-fallback')
      const authAdmin = await signInAs(tenant)

      const { data, error } = await authAdmin.rpc('sp_get_cotizacion_vigente')
      expect(error).toBeNull()
      expect(data).toMatchObject({
        modo: 'automatica',
        valor: null,
        desactualizada: true,
      })
    })

    it('registra cotización BCRA y sp_get_cotizacion_vigente la devuelve en modo automático', async () => {
      const tenant = await createTenantWithUser('cotiz-bcra')
      const authAdmin = await signInAs(tenant)

      const hoy = new Date().toISOString().slice(0, 10)
      const { error: errReg } = await authAdmin.rpc('sp_registrar_cotizacion_bcra', {
        p_fecha: hoy,
        p_valor: 1546.5,
        p_fecha_valor: hoy,
        p_desactualizada: false,
      })
      expect(errReg).toBeNull()

      const { data, error } = await authAdmin.rpc('sp_get_cotizacion_vigente')
      expect(error).toBeNull()
      expect(data).toMatchObject({
        modo: 'automatica',
        valor: 1546.5,
        fecha: hoy,
        fecha_valor: hoy,
        origen: 'bcra',
        desactualizada: false,
      })
    })

    it('sp_set_cotizacion_manual conmuta a modo manual, persiste en cotizacion_dolar y audita', async () => {
      const tenant = await createTenantWithUser('cotiz-manual')
      const authAdmin = await signInAs(tenant)

      const { error: errSet } = await authAdmin.rpc('sp_set_cotizacion_manual', {
        p_valor: 1650.0,
        p_ip: '127.0.0.1',
      })
      expect(errSet).toBeNull()

      const { data, error } = await authAdmin.rpc('sp_get_cotizacion_vigente')
      expect(error).toBeNull()
      expect(data).toMatchObject({
        modo: 'manual',
        valor: 1650.0,
        origen: 'manual',
        desactualizada: false,
      })

      // Verificar que se registró auditoría
      const { data: audit, error: errAudit } = await authAdmin
        .from('auditoria')
        .select('*')
        .eq('entidad', 'cotizacion_dolar')
      expect(errAudit).toBeNull()
      expect(audit?.length).toBeGreaterThanOrEqual(1)
      expect(audit?.[0].accion).toBe('actualizar')
    })

    it('sp_set_modo_cotizacion permite alternar modo y audita', async () => {
      const tenant = await createTenantWithUser('cotiz-modo')
      const authAdmin = await signInAs(tenant)

      const { error: errModo } = await authAdmin.rpc('sp_set_modo_cotizacion', {
        p_modo: 'manual',
        p_ip: '192.168.1.1',
      })
      expect(errModo).toBeNull()

      const { data: config } = await authAdmin
        .from('cotizacion_config')
        .select('modo')
        .single()
      expect(config?.modo).toBe('manual')

      const { data: audit } = await authAdmin
        .from('auditoria')
        .select('*')
        .eq('entidad', 'cotizacion_config')
      expect(audit?.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('2. Negativos y validaciones de datos', () => {
    it('sp_set_cotizacion_manual rechaza valor <= 0', async () => {
      const tenant = await createTenantWithUser('cotiz-val-neg')
      const authAdmin = await signInAs(tenant)

      const { error: errCero } = await authAdmin.rpc('sp_set_cotizacion_manual', {
        p_valor: 0,
        p_ip: '127.0.0.1',
      })
      expect(errCero?.message).toMatch(/cotizacion-manual-invalida/)

      const { error: errNeg } = await authAdmin.rpc('sp_set_cotizacion_manual', {
        p_valor: -100,
        p_ip: '127.0.0.1',
      })
      expect(errNeg?.message).toMatch(/cotizacion-manual-invalida/)
    })

    it('sp_set_modo_cotizacion rechaza modo inválido', async () => {
      const tenant = await createTenantWithUser('cotiz-modo-inv')
      const authAdmin = await signInAs(tenant)

      const { error } = await authAdmin.rpc('sp_set_modo_cotizacion', {
        p_modo: 'invalido',
        p_ip: '127.0.0.1',
      })
      expect(error?.message).toMatch(/modo-cotizacion-invalido/)
    })

    it('sp_registrar_cotizacion_bcra rechaza valor <= 0', async () => {
      const tenant = await createTenantWithUser('cotiz-bcra-neg')
      const authAdmin = await signInAs(tenant)
      const hoy = new Date().toISOString().slice(0, 10)

      const { error } = await authAdmin.rpc('sp_registrar_cotizacion_bcra', {
        p_fecha: hoy,
        p_valor: 0,
        p_fecha_valor: hoy,
        p_desactualizada: false,
      })
      expect(error?.message).toMatch(/valor-invalido/)
    })

    it('usuario sin tenant es rechazado con no-tenant', async () => {
      const tenantless = await createUserWithoutTenant('cotiz-notenant')
      const authUser = await signInAs(tenantless)

      const { error: errGet } = await authUser.rpc('sp_get_cotizacion_vigente')
      expect(errGet?.message).toMatch(/no-tenant/)

      const { error: errSet } = await authUser.rpc('sp_set_cotizacion_manual', {
        p_valor: 1500,
        p_ip: '127.0.0.1',
      })
      expect(errSet?.message).toMatch(/no-tenant/)
    })
  })

  describe('3. Aislamiento multitenant (Tenant A vs Tenant B)', () => {
    it('Tenant B no ve ni altera cotizaciones ni configuración de Tenant A', async () => {
      const tenantA = await createTenantWithUser('cotiz-iso-a')
      const tenantB = await createTenantWithUser('cotiz-iso-b')
      const authAdminA = await signInAs(tenantA)
      const authAdminB = await signInAs(tenantB)

      const hoy = new Date().toISOString().slice(0, 10)
      await authAdminA.rpc('sp_registrar_cotizacion_bcra', {
        p_fecha: hoy,
        p_valor: 1500,
        p_fecha_valor: hoy,
        p_desactualizada: false,
      })
      await authAdminA.rpc('sp_set_cotizacion_manual', {
        p_valor: 1600,
        p_ip: '127.0.0.1',
      })

      // Tenant B consulta SP y no ve los valores de Tenant A
      const { data: cotizB } = await authAdminB.rpc('sp_get_cotizacion_vigente')
      expect(cotizB).toMatchObject({
        modo: 'automatica',
        valor: null,
        desactualizada: true,
      })

      // Tenant B consulta cotizacion_dolar por PostgREST y no ve filas de Tenant A
      const { data: filasB } = await authAdminB.from('cotizacion_dolar').select('*')
      expect(filasB).toEqual([])

      // Tenant B consulta cotizacion_config por PostgREST y no ve la config de Tenant A
      const { data: configB } = await authAdminB.from('cotizacion_config').select('*')
      expect(configB).toEqual([])
    })
  })

  describe('4. Seguridad de revendedora (REQ-USD-01 N5 y REQ-USD-02 N4)', () => {
    it('revendedora del mismo tenant no puede leer ni escribir en cotizacion_config ni cotizacion_dolar', async () => {
      const tenant = await createTenantWithUser('cotiz-rev')
      const authAdmin = await signInAs(tenant)
      const authRev = await createRevendedoraSession(tenant.tenantId, authAdmin)

      // Admin inserta config y cotización
      await authAdmin.rpc('sp_set_cotizacion_manual', { p_valor: 1550, p_ip: '127.0.0.1' })

      // Revendedora intenta SELECT en cotizacion_config -> 0 filas
      const { data: confRev, error: errConfRev } = await authRev.from('cotizacion_config').select('*')
      expect(errConfRev).toBeNull()
      expect(confRev).toEqual([])

      // Revendedora intenta SELECT en cotizacion_dolar -> 0 filas
      const { data: dolarRev, error: errDolarRev } = await authRev.from('cotizacion_dolar').select('*')
      expect(errDolarRev).toBeNull()
      expect(dolarRev).toEqual([])

      // Revendedora intenta INSERT en cotizacion_config -> rechazo por RLS restrictiva
      const { error: errInsertConf } = await authRev.from('cotizacion_config').insert({
        id_tenant: tenant.tenantId,
        modo: 'manual',
      })
      expect(errInsertConf).not.toBeNull()

      // Revendedora intenta INSERT en cotizacion_dolar -> rechazo por RLS restrictiva
      const { error: errInsertDolar } = await authRev.from('cotizacion_dolar').insert({
        id_tenant: tenant.tenantId,
        fecha: new Date().toISOString().slice(0, 10),
        valor: 2000,
        origen: 'manual',
        fecha_valor: new Date().toISOString().slice(0, 10),
      })
      expect(errInsertDolar).not.toBeNull()
    })
  })

  describe('5. Manual a Automático el mismo día (REQ-USD-02 N5)', () => {
    it('si se carga valor manual y luego se cambia a modo automático, nunca devuelve el manual', async () => {
      const tenant = await createTenantWithUser('cotiz-switch-day')
      const authAdmin = await signInAs(tenant)

      // 1. Cargar valor manual hoy
      await authAdmin.rpc('sp_set_cotizacion_manual', { p_valor: 1700, p_ip: '127.0.0.1' })
      const { data: dataManual } = await authAdmin.rpc('sp_get_cotizacion_vigente')
      expect(dataManual?.valor).toBe(1700)
      expect(dataManual?.modo).toBe('manual')

      // 2. Conmutar a modo automático el mismo día
      await authAdmin.rpc('sp_set_modo_cotizacion', { p_modo: 'automatica', p_ip: '127.0.0.1' })

      // 3. sp_get_cotizacion_vigente NO debe devolver el valor manual (1700)
      const { data: dataAuto } = await authAdmin.rpc('sp_get_cotizacion_vigente')
      expect(dataAuto?.modo).toBe('automatica')
      expect(dataAuto?.valor).not.toBe(1700)
      expect(dataAuto?.valor).toBeNull()
      expect(dataAuto?.desactualizada).toBe(true)
    })
  })

  describe('6. Verificación de INVOKER en funciones', () => {
    it('todas las funciones del módulo cotización son SECURITY INVOKER', () => {
      const query = "select json_agg(t) from (select proname, prosecdef from pg_proc where proname in ('sp_get_cotizacion_vigente', 'sp_set_cotizacion_manual', 'sp_set_modo_cotizacion', 'sp_registrar_cotizacion_bcra')) t;"
      const output = runPsql(query)
      const procs = JSON.parse(output || '[]') as Array<{ proname: string; prosecdef: boolean }>

      expect(procs.length).toBe(4)
      for (const p of procs) {
        expect(p.prosecdef, `${p.proname} debe ser SECURITY INVOKER (prosecdef=false)`).toBe(false)
      }
    })
  })

  describe('7. Backfill de permiso editar_cotizacion en rol Administrador (00131)', () => {
    it('agrega editar_cotizacion al rol Administrador de forma idempotente y el DOWN lo remueve', async () => {
      const tenant = await createTenantWithUser('cotiz-backfill-perm')

      // Insertamos o actualizamos el rol Administrador con precios sin editar_cotizacion
      await serviceRole
        .from('rol')
        .update({
          permisos: { precios: ['ver', 'crear', 'editar'] },
        })
        .eq('id_tenant', tenant.tenantId)
        .eq('nombre', 'Administrador')

      // 1. Ejecutar UP de 00130
      runPsql(`update rol set permisos = jsonb_set(permisos, '{precios}', (permisos -> 'precios') || '["editar_cotizacion"]'::jsonb) where nombre = 'Administrador' and id_tenant = '${tenant.tenantId}' and jsonb_typeof(permisos -> 'precios') = 'array' and not (permisos -> 'precios') ? 'editar_cotizacion';`)

      const { data: rolUp } = await serviceRole
        .from('rol')
        .select('permisos')
        .eq('id_tenant', tenant.tenantId)
        .eq('nombre', 'Administrador')
        .single()

      const permisosUp = rolUp!.permisos as Record<string, string[]>
      expect(permisosUp.precios).toContain('editar_cotizacion')
      expect(permisosUp.precios).toContain('ver')
      expect(permisosUp.precios.filter((p) => p === 'editar_cotizacion').length).toBe(1)

      // 2. Idempotencia: correr UP de nuevo no debe duplicar
      runPsql(`update rol set permisos = jsonb_set(permisos, '{precios}', (permisos -> 'precios') || '["editar_cotizacion"]'::jsonb) where nombre = 'Administrador' and id_tenant = '${tenant.tenantId}' and jsonb_typeof(permisos -> 'precios') = 'array' and not (permisos -> 'precios') ? 'editar_cotizacion';`)

      const { data: rolIdem } = await serviceRole
        .from('rol')
        .select('permisos')
        .eq('id_tenant', tenant.tenantId)
        .eq('nombre', 'Administrador')
        .single()
      const permisosIdem = rolIdem!.permisos as Record<string, string[]>
      expect(permisosIdem.precios.filter((p) => p === 'editar_cotizacion').length).toBe(1)

      // 3. Ejecutar DOWN de 00130
      runPsql(`update rol set permisos = jsonb_set(permisos, '{precios}', (permisos -> 'precios') - 'editar_cotizacion') where nombre = 'Administrador' and id_tenant = '${tenant.tenantId}' and (permisos -> 'precios') ? 'editar_cotizacion';`)

      const { data: rolDown } = await serviceRole
        .from('rol')
        .select('permisos')
        .eq('id_tenant', tenant.tenantId)
        .eq('nombre', 'Administrador')
        .single()
      const permisosDown = rolDown!.permisos as Record<string, string[]>
      expect(permisosDown.precios).not.toContain('editar_cotizacion')
      expect(permisosDown.precios).toContain('ver')
    })
  })
})
