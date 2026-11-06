import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CATALOGO_PERMISOS } from '@/lib/types/administracion'
import {
  anonClient,
  createTenantWithUser,
  createUserWithoutTenant,
  hasTestDb,
  runPsql,
  signInAs,
} from './_helpers'

describe.skipIf(!hasTestDb)('REQ-RLSP-01 - Helper auth_tiene_permiso', () => {
  it('REQ-RLSP-01 Feliz: rol con el permiso retorna true', async () => {
    const fixture = await createTenantWithUser('rlsp_feliz')
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const client = await signInAs(fixture)
    const { data, error } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })

    expect(error).toBeNull()
    expect(data).toBe(true)
  })

  it("REQ-RLSP-01 Feliz: Administrador de provision (estado 'invitado') retorna true en un permiso de cada modulo", async () => {
    const fixture = await createTenantWithUser('rlsp_admin_invitado')

    // Administrador de provisión: permisos completos de CATALOGO_PERMISOS y estado_usuario 'invitado'
    const permisosAdmin = Object.fromEntries(
      Object.entries(CATALOGO_PERMISOS).map(([mod, accs]) => [mod, [...accs]]),
    )
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: permisosAdmin })
      .eq('id_rol', fixture.rolId)

    await fixture.serviceRole
      .from('usuario')
      .update({ estado_usuario: 'invitado' })
      .eq('id_usuario', fixture.userId)

    const client = await signInAs(fixture)

    for (const [modulo, acciones] of Object.entries(CATALOGO_PERMISOS)) {
      const accion = acciones[0]
      const { data, error } = await client.rpc('auth_tiene_permiso', {
        p_modulo: modulo,
        p_accion: accion,
      })
      expect(error).toBeNull()
      expect(data, `Permiso falló para módulo ${modulo} acción ${accion}`).toBe(true)
    }
  })

  it('REQ-RLSP-01 N1: sin el permiso retorna false; revocado con service client sobre rol.permisos retorna false con el mismo token', async () => {
    const fixture = await createTenantWithUser('rlsp_n1')
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const client = await signInAs(fixture)

    // Sin el permiso en el rol
    const { data: sinAccion, error: errSinAccion } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'crear',
    })
    expect(errSinAccion).toBeNull()
    expect(sinAccion).toBe(false)

    const { data: sinModulo, error: errSinModulo } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'inventario',
      p_accion: 'ver',
    })
    expect(errSinModulo).toBeNull()
    expect(sinModulo).toBe(false)

    // Con el permiso vigente
    const { data: inicial, error: errInicial } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })
    expect(errInicial).toBeNull()
    expect(inicial).toBe(true)

    // Revocar con service client directamente en rol.permisos
    const { error: errRevocacion } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: [] } })
      .eq('id_rol', fixture.rolId)
    expect(errRevocacion).toBeNull()

    // Llamada inmediata con el MISMO cliente y MISMO token (sin volver a loguear)
    const { data: postRevocacion, error: errPostRevocacion } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })
    expect(errPostRevocacion).toBeNull()
    expect(postRevocacion).toBe(false)
  })

  it('REQ-RLSP-01 N2: JWT con sub de A y tenant_id de B (runPsql con set local role authenticated + request.jwt.claims) retorna false', async () => {
    const tA = await createTenantWithUser('rlsp_n2_a')
    await tA.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['ver'] } })
      .eq('id_rol', tA.rolId)

    const tB = await createTenantWithUser('rlsp_n2_b')

    // Con sub de A y tenant_id de B
    const outCrossTenant = runPsql([
      'SET role authenticated',
      `SELECT set_config('request.jwt.claims', json_build_object('sub', '${tA.userId}', 'tenant_id', '${tB.tenantId}')::text, false)`,
      "SELECT auth_tiene_permiso('gastos', 'ver')",
    ].join('; '))

    expect(outCrossTenant).toContain('f')

    // Verificación de sanidad: con sub de A y tenant_id de A debe retornar true
    const outSameTenant = runPsql([
      'SET role authenticated',
      `SELECT set_config('request.jwt.claims', json_build_object('sub', '${tA.userId}', 'tenant_id', '${tA.tenantId}')::text, false)`,
      "SELECT auth_tiene_permiso('gastos', 'ver')",
    ].join('; '))

    expect(outSameTenant).toContain('t')
  })

  it('REQ-RLSP-01 N3: anon / sin tenant_id retorna false', async () => {
    // 1. Cliente anónimo sin sesión
    const anon = anonClient()
    const { data: anonRes, error: anonErr } = await anon.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })
    expect(anonErr).toBeNull()
    expect(anonRes).toBe(false)

    // 2. Usuario autenticado sin tenant_id en JWT (vía createUserWithoutTenant)
    const tenantless = await createUserWithoutTenant('rlsp_n3')
    const tenantlessClient = await signInAs(tenantless)
    const { data: sinTenantRes, error: sinTenantErr } = await tenantlessClient.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })
    expect(sinTenantErr).toBeNull()
    expect(sinTenantRes).toBe(false)

    // 3. Vía runPsql con authenticated pero sin claim tenant_id
    const outSinTenantPsql = runPsql([
      'SET role authenticated',
      `SELECT set_config('request.jwt.claims', json_build_object('sub', '${tenantless.userId}')::text, false)`,
      "SELECT auth_tiene_permiso('gastos', 'ver')",
    ].join('; '))

    expect(outSinTenantPsql).toContain('f')
  })

  it('REQ-RLSP-01 N4: revendedora retorna false (oculta por RLS restrictiva 00078)', async () => {
    const fixture = await createTenantWithUser('rlsp_n4')

    // Habilitar módulo revendedoras
    const { data: modRev } = await fixture.serviceRole
      .from('modulo')
      .select('id_modulo')
      .eq('codigo', 'revendedoras')
      .single()
    await fixture.serviceRole
      .from('tenant_modulo')
      .insert({ id_tenant: fixture.tenantId, id_modulo: modRev!.id_modulo, habilitado: true })

    const { data: rolRev } = await fixture.serviceRole
      .from('rol')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'Revendedora',
        permisos: { revendedoras: ['ver_propio', 'declarar'], gastos: ['ver'] },
      })
      .select('id_rol')
      .single()
    if (!rolRev) throw new Error('fixture rol creation returned no rol')

    const adminClient = await signInAs(fixture)
    const { data: idRev } = await adminClient.rpc('sp_crear_revendedora', {
      p_nombre: 'Reven',
      p_apellido: 'Dedora',
      p_email: 'rev_rlsp_n4@test.com',
    })

    const emailRev = `rev_rlsp_${randomUUID()}@example.com`
    const passwordRev = 'Fixture-Password-1!'
    const { data: authUser } = await fixture.serviceRole.auth.admin.createUser({
      email: emailRev,
      password: passwordRev,
      email_confirm: true,
    })
    if (!authUser?.user) throw new Error('fixture auth user creation returned no user')

    await fixture.serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRev,
      p_id_usuario: authUser.user.id,
      p_id_tenant: fixture.tenantId,
      p_email: emailRev,
      p_nombre: 'Reven Dedora',
      p_id_rol: rolRev.id_rol,
    })

    const revClient = await signInAs({ email: emailRev, password: passwordRev })

    // Permiso operativo estándar: false
    const { data: resGastos, error: errGastos } = await revClient.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })
    expect(errGastos).toBeNull()
    expect(resGastos).toBe(false)

    // Permiso asignado en su propio rol: también false porque la restrictiva 00078 oculta usuario y rol
    const { data: resRev, error: errRev } = await revClient.rpc('auth_tiene_permiso', {
      p_modulo: 'revendedoras',
      p_accion: 'ver_propio',
    })
    expect(errRev).toBeNull()
    expect(resRev).toBe(false)

    // Confirmación vía runPsql con claim id_revendedora
    const outRevPsql = runPsql([
      'SET role authenticated',
      `SELECT set_config('request.jwt.claims', json_build_object('sub', '${authUser.user.id}', 'tenant_id', '${fixture.tenantId}', 'id_revendedora', '${idRev}')::text, false)`,
      "SELECT auth_tiene_permiso('gastos', 'ver')",
    ].join('; '))
    expect(outRevPsql).toContain('f')
  })

  it('REQ-RLSP-01 N5: modulo o accion inexistente o null retorna false', async () => {
    const fixture = await createTenantWithUser('rlsp_n5')
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const client = await signInAs(fixture)

    // Módulo inexistente
    const { data: modInexistente } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'modulo_inexistente',
      p_accion: 'ver',
    })
    expect(modInexistente).toBe(false)

    // Acción inexistente
    const { data: accInexistente } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'accion_inexistente',
    })
    expect(accInexistente).toBe(false)

    // Módulo null
    const { data: modNull } = await client.rpc('auth_tiene_permiso', {
      p_modulo: null as unknown as string,
      p_accion: 'ver',
    })
    expect(modNull).toBe(false)

    // Acción null
    const { data: accNull } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: null as unknown as string,
    })
    expect(accNull).toBe(false)

    // Ambos null
    const { data: ambosNull } = await client.rpc('auth_tiene_permiso', {
      p_modulo: null as unknown as string,
      p_accion: null as unknown as string,
    })
    expect(ambosNull).toBe(false)
  })

  it("REQ-RLSP-01 N6: estado_usuario inactivo retorna false; 'invitado' y 'activo' retornan true", async () => {
    const fixture = await createTenantWithUser('rlsp_n6')
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const client = await signInAs(fixture)

    // Estado inicial: 'invitado' -> true
    const { data: resInvitado } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })
    expect(resInvitado).toBe(true)

    // Cambiar a 'inactivo' -> false
    await fixture.serviceRole
      .from('usuario')
      .update({ estado_usuario: 'inactivo' })
      .eq('id_usuario', fixture.userId)

    const { data: resInactivo } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })
    expect(resInactivo).toBe(false)

    // Cambiar a 'activo' -> true
    await fixture.serviceRole
      .from('usuario')
      .update({ estado_usuario: 'activo' })
      .eq('id_usuario', fixture.userId)

    const { data: resActivo } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })
    expect(resActivo).toBe(true)
  })
})
