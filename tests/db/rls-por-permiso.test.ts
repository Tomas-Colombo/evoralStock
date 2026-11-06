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
  withScopedTenant,
  type TenantFixture,
} from './_helpers'
import {
  habilitarPaqueteConsignacion,
  ventaFixture,
  venderContado,
} from './_fixtures-ventas'

const ultima = (s: string) => s.split(/\r?\n/).at(-1)?.trim()

describe.skipIf(!hasTestDb)('REQ-RLSP-01 - Helper auth_tiene_permiso', () => {
  it('REQ-RLSP-01 Feliz: rol con el permiso retorna true', async () => {
    const fixture = await createTenantWithUser('rlsp_feliz')
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

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
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: permisosAdmin })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const { error: errUsr } = await fixture.serviceRole
      .from('usuario')
      .update({ estado_usuario: 'invitado' })
      .eq('id_usuario', fixture.userId)
    expect(errUsr).toBeNull()

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
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

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
    const { error: errRolA } = await tA.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['ver'] } })
      .eq('id_rol', tA.rolId)
    expect(errRolA).toBeNull()

    const tB = await createTenantWithUser('rlsp_n2_b')

    // Con sub de A y tenant_id de B
    const outCrossTenant = runPsql([
      'SET role authenticated',
      `SELECT set_config('request.jwt.claims', json_build_object('sub', '${tA.userId}', 'tenant_id', '${tB.tenantId}')::text, false)`,
      "SELECT auth_tiene_permiso('gastos', 'ver')",
    ].join('; '))

    expect(ultima(outCrossTenant)).toBe('f')

    // Verificación de sanidad: con sub de A y tenant_id de A debe retornar true
    const outSameTenant = runPsql([
      'SET role authenticated',
      `SELECT set_config('request.jwt.claims', json_build_object('sub', '${tA.userId}', 'tenant_id', '${tA.tenantId}')::text, false)`,
      "SELECT auth_tiene_permiso('gastos', 'ver')",
    ].join('; '))

    expect(ultima(outSameTenant)).toBe('t')
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

    expect(ultima(outSinTenantPsql)).toBe('f')
  })

  it('REQ-RLSP-01 N4: revendedora retorna false (oculta por RLS restrictiva 00078)', async () => {
    const fixture = await createTenantWithUser('rlsp_n4')

    // Habilitar módulo revendedoras
    const { data: modRev, error: errModRev } = await fixture.serviceRole
      .from('modulo')
      .select('id_modulo')
      .eq('codigo', 'revendedoras')
      .single()
    expect(errModRev).toBeNull()

    const { error: errTM } = await fixture.serviceRole
      .from('tenant_modulo')
      .insert({ id_tenant: fixture.tenantId, id_modulo: modRev!.id_modulo, habilitado: true })
    expect(errTM).toBeNull()

    const { data: rolRev, error: errRolRev } = await fixture.serviceRole
      .from('rol')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'Revendedora',
        permisos: { revendedoras: ['ver_propio', 'declarar'], gastos: ['ver'] },
      })
      .select('id_rol')
      .single()
    expect(errRolRev).toBeNull()
    if (!rolRev) throw new Error('fixture rol creation returned no rol')

    const adminClient = await signInAs(fixture)
    const { data: idRev, error: errIdRev } = await adminClient.rpc('sp_crear_revendedora', {
      p_nombre: 'Reven',
      p_apellido: 'Dedora',
      p_email: 'rev_rlsp_n4@test.com',
    })
    expect(errIdRev).toBeNull()

    const emailRev = `rev_rlsp_${randomUUID()}@example.com`
    const passwordRev = 'Fixture-Password-1!'
    const { data: authUser } = await fixture.serviceRole.auth.admin.createUser({
      email: emailRev,
      password: passwordRev,
      email_confirm: true,
    })
    if (!authUser?.user) throw new Error('fixture auth user creation returned no user')

    const { error: errEnlazar } = await fixture.serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRev,
      p_id_usuario: authUser.user.id,
      p_id_tenant: fixture.tenantId,
      p_email: emailRev,
      p_nombre: 'Reven Dedora',
      p_id_rol: rolRev.id_rol,
    })
    expect(errEnlazar).toBeNull()

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
    expect(ultima(outRevPsql)).toBe('f')
  })

  it('REQ-RLSP-01 N5: modulo o accion inexistente o null retorna false', async () => {
    const fixture = await createTenantWithUser('rlsp_n5')
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

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
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    // Estado inicial: 'invitado' -> true
    const { data: resInvitado } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })
    expect(resInvitado).toBe(true)

    // Cambiar a 'inactivo' -> false
    const { error: errInactivo } = await fixture.serviceRole
      .from('usuario')
      .update({ estado_usuario: 'inactivo' })
      .eq('id_usuario', fixture.userId)
    expect(errInactivo).toBeNull()

    const { data: resInactivo } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })
    expect(resInactivo).toBe(false)

    // Cambiar a 'activo' -> true
    const { error: errActivo } = await fixture.serviceRole
      .from('usuario')
      .update({ estado_usuario: 'activo' })
      .eq('id_usuario', fixture.userId)
    expect(errActivo).toBeNull()

    const { data: resActivo } = await client.rpc('auth_tiene_permiso', {
      p_modulo: 'gastos',
      p_accion: 'ver',
    })
    expect(resActivo).toBe(true)
  })
})

// Helpers para suites de RLS por permiso
async function createClientWithPermisos(
  fixture: TenantFixture,
  nombreRol: string,
  permisos: Record<string, string[]>,
) {
  const { data: rol, error: rolErr } = await fixture.serviceRole
    .from('rol')
    .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant(nombreRol), permisos })
    .select('id_rol')
    .single()
  if (rolErr || !rol) throw new Error(`createClientWithPermisos rol failed: ${rolErr?.message}`)

  const email = `${withScopedTenant(nombreRol)}@example.com`
  const password = 'Fixture-Password-1!'
  const { data: authUser, error: authErr } = await fixture.serviceRole.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authErr || !authUser?.user) throw new Error(`createClientWithPermisos auth failed: ${authErr?.message}`)

  const { error: usrErr } = await fixture.serviceRole.from('usuario').insert({
    id_usuario: authUser.user.id,
    id_tenant: fixture.tenantId,
    email,
    nombre_completo: `Usuario ${nombreRol}`,
    id_rol: rol.id_rol,
    estado_usuario: 'activo',
  })
  if (usrErr) throw new Error(`createClientWithPermisos usuario failed: ${usrErr.message}`)

  return signInAs({ email, password })
}

async function createRevendedoraClient(fixture: TenantFixture) {
  const { data: modRev } = await fixture.serviceRole
    .from('modulo')
    .select('id_modulo')
    .eq('codigo', 'revendedoras')
    .single()
  if (modRev) {
    await fixture.serviceRole
      .from('tenant_modulo')
      .upsert({ id_tenant: fixture.tenantId, id_modulo: modRev.id_modulo, habilitado: true })
  }

  const { data: rolRev, error: rolErr } = await fixture.serviceRole
    .from('rol')
    .insert({
      id_tenant: fixture.tenantId,
      nombre: 'Revendedora',
      permisos: {
        revendedoras: ['ver_propio', 'declarar'],
        gastos: ['ver', 'crear', 'editar'],
        inventario: ['ver', 'crear', 'editar', 'eliminar'],
        rendiciones: ['ver', 'crear', 'editar'],
        reportes: ['ver'],
      },
    })
    .select('id_rol')
    .single()
  if (rolErr || !rolRev) throw new Error(`createRevendedoraClient rol failed: ${rolErr?.message}`)

  const adminClient = await signInAs(fixture)
  const { data: idRev, error: errIdRev } = await adminClient.rpc('sp_crear_revendedora', {
    p_nombre: 'Reven',
    p_apellido: 'Dedora',
    p_email: `${withScopedTenant('rev')}@test.com`,
  })
  if (errIdRev) throw errIdRev

  const emailRev = `${withScopedTenant('rev-auth')}@example.com`
  const passwordRev = 'Fixture-Password-1!'
  const { data: authUser, error: authErr } = await fixture.serviceRole.auth.admin.createUser({
    email: emailRev,
    password: passwordRev,
    email_confirm: true,
  })
  if (authErr || !authUser?.user) throw new Error(`createRevendedoraClient auth failed: ${authErr?.message}`)

  const { error: enlazarErr } = await fixture.serviceRole.rpc('sp_enlazar_revendedora_usuario', {
    p_id_revendedora: idRev,
    p_id_usuario: authUser.user.id,
    p_id_tenant: fixture.tenantId,
    p_email: emailRev,
    p_nombre: 'Reven Dedora',
    p_id_rol: rolRev.id_rol,
  })
  if (enlazarErr) throw new Error(`createRevendedoraClient enlazar: ${enlazarErr.message}`)

  return signInAs({ email: emailRev, password: passwordRev })
}

describe.skipIf(!hasTestDb)('REQ-RLSP-02 - gasto_negocio', () => {
  it('Feliz: SELECT con gastos.ver o reportes.ver lee gastos; INSERT con gastos.crear; DELETE con gastos.editar; SPs reales', async () => {
    const fixture = await createTenantWithUser('rlsp_gasto_f')
    const { data: cat } = await fixture.serviceRole
      .from('categoria_gasto')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Servicios' })
      .select('id_categoria_gasto')
      .single()

    const { data: gastoPrevio } = await fixture.serviceRole
      .from('gasto_negocio')
      .insert({
        id_tenant: fixture.tenantId,
        id_categoria_gasto: cat!.id_categoria_gasto,
        id_usuario_alta: fixture.userId,
        monto: 15000,
        fecha: new Date().toISOString(),
      })
      .select('id_gasto')
      .single()

    // 1. SELECT con gastos.ver
    const clientGastosVer = await createClientWithPermisos(fixture, 'GastoVer', { gastos: ['ver'] })
    const { data: dataGV, error: errGV } = await clientGastosVer.from('gasto_negocio').select('*')
    expect(errGV).toBeNull()
    expect(dataGV?.some((g) => g.id_gasto === gastoPrevio!.id_gasto)).toBe(true)

    // 2. SELECT con reportes.ver (B1)
    const clientRepVer = await createClientWithPermisos(fixture, 'RepVer', { reportes: ['ver'] })
    const { data: dataRV, error: errRV } = await clientRepVer.from('gasto_negocio').select('*')
    expect(errRV).toBeNull()
    expect(dataRV?.some((g) => g.id_gasto === gastoPrevio!.id_gasto)).toBe(true)

    // 3. INSERT vía PostgREST con gastos.crear
    const clientGastosCrear = await createClientWithPermisos(fixture, 'GastoCrear', { gastos: ['crear'] })
    const { error: insErr } = await clientGastosCrear.from('gasto_negocio').insert({
      id_tenant: fixture.tenantId,
      id_categoria_gasto: cat!.id_categoria_gasto,
      id_usuario_alta: fixture.userId,
      monto: 5000,
      fecha: new Date().toISOString(),
    })
    expect(insErr).toBeNull()

    // 4. SP real: sp_registrar_gasto con gastos.crear (+ gastos.ver por el RETURNING id_gasto)
    const clientGastosVerCrear = await createClientWithPermisos(fixture, 'GastoVerCrear', { gastos: ['ver', 'crear'] })
    const { data: spGastoId, error: spErr } = await clientGastosVerCrear.rpc('sp_registrar_gasto', {
      p_id_categoria_gasto: cat!.id_categoria_gasto,
      p_monto: 8500,
      p_descripcion: 'Insumos de oficina',
    })
    expect(spErr).toBeNull()
    expect(spGastoId).toBeDefined()

    // 5. DELETE vía PostgREST con gastos.ver + gastos.editar
    const clientGastosEditar = await createClientWithPermisos(fixture, 'GastoEditar', { gastos: ['ver', 'editar'] })
    const { error: delErr } = await clientGastosEditar
      .from('gasto_negocio')
      .delete()
      .eq('id_gasto', gastoPrevio!.id_gasto)
    expect(delErr).toBeNull()
    const { data: checkDel } = await fixture.serviceRole
      .from('gasto_negocio')
      .select('id_gasto')
      .eq('id_gasto', gastoPrevio!.id_gasto)
    expect(checkDel?.length).toBe(0)

    // 6. SP real: sp_eliminar_gasto con rol gastos.ver + gastos.editar
    const clientGastosVerEditar = await createClientWithPermisos(fixture, 'GastoVerEd', { gastos: ['ver', 'editar'] })
    const { error: spDelErr } = await clientGastosVerEditar.rpc('sp_eliminar_gasto', {
      p_id_gasto: spGastoId,
    })
    expect(spDelErr).toBeNull()
    const { data: checkSpDel } = await fixture.serviceRole
      .from('gasto_negocio')
      .select('id_gasto')
      .eq('id_gasto', spGastoId)
    expect(checkSpDel?.length).toBe(0)
  })

  it('B1: rol con solo reportes.ver → rf_finanzas_flujo devuelve gastos > 0, no $0', async () => {
    const fixture = await createTenantWithUser('rlsp_gasto_b1')
    const { data: cat } = await fixture.serviceRole
      .from('categoria_gasto')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Alquiler' })
      .select('id_categoria_gasto')
      .single()

    await fixture.serviceRole.from('gasto_negocio').insert({
      id_tenant: fixture.tenantId,
      id_categoria_gasto: cat!.id_categoria_gasto,
      id_usuario_alta: fixture.userId,
      monto: 25000,
      fecha: new Date().toISOString(),
    })

    const clientRep = await createClientWithPermisos(fixture, 'RepFlujo', { reportes: ['ver'] })
    const { data: flujo, error: errFlujo } = await clientRep
      .rpc('rf_finanzas_flujo', {
        p_desde: '2020-01-01',
        p_hasta: '2030-12-31',
      })
      .single()

    expect(errFlujo).toBeNull()
    expect(Number(flujo.gastos)).toBe(25000)
    expect(Number(flujo.gastos)).toBeGreaterThan(0)
  })

  it('N1..N5: sin permiso SELECT da 0 filas; INSERT da 42501; UPDATE bloqueado (false); DELETE 0 filas; otro tenant y revendedora 0 filas', async () => {
    const fixture = await createTenantWithUser('rlsp_gasto_neg')
    const { data: cat } = await fixture.serviceRole
      .from('categoria_gasto')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Seguridad' })
      .select('id_categoria_gasto')
      .single()

    const { data: gasto } = await fixture.serviceRole
      .from('gasto_negocio')
      .insert({
        id_tenant: fixture.tenantId,
        id_categoria_gasto: cat!.id_categoria_gasto,
        id_usuario_alta: fixture.userId,
        monto: 10000,
        fecha: new Date().toISOString(),
      })
      .select('id_gasto')
      .single()

    // N1: SELECT sin gastos.ver ni reportes.ver
    const clientSinVer = await createClientWithPermisos(fixture, 'SinVerGasto', { inventario: ['ver'] })
    const { data: dataSinVer } = await clientSinVer.from('gasto_negocio').select('*')
    expect(dataSinVer).toEqual([])

    // N2: INSERT sin gastos.crear da 42501
    const { error: errInsSinPerm } = await clientSinVer.from('gasto_negocio').insert({
      id_tenant: fixture.tenantId,
      id_categoria_gasto: cat!.id_categoria_gasto,
      id_usuario_alta: fixture.userId,
      monto: 3000,
    })
    expect(errInsSinPerm).not.toBeNull()
    expect(errInsSinPerm?.code).toBe('42501')

    // N2: UPDATE policy es false: incluso con gastos.editar afecta 0 filas (comprobado con service role)
    const clientGastosEditar = await createClientWithPermisos(fixture, 'GastoEdOnly', { gastos: ['ver', 'editar'] })
    const { error: errUpd, count: countUpd } = await clientGastosEditar
      .from('gasto_negocio')
      .update({ monto: 99999 }, { count: 'exact' })
      .eq('id_gasto', gasto!.id_gasto)
    expect(errUpd).toBeNull()
    expect(countUpd).toBe(0)

    const { data: gastoInmutable } = await fixture.serviceRole
      .from('gasto_negocio')
      .select('monto')
      .eq('id_gasto', gasto!.id_gasto)
      .single()
    expect(Number(gastoInmutable!.monto)).toBe(10000)

    // N2: DELETE sin gastos.editar afecta 0 filas (la fila no cambia)
    const { error: errDelSinPerm, count: countDel } = await clientSinVer
      .from('gasto_negocio')
      .delete({ count: 'exact' })
      .eq('id_gasto', gasto!.id_gasto)
    expect(errDelSinPerm).toBeNull()
    expect(countDel).toBe(0)

    const { data: gastoExiste } = await fixture.serviceRole
      .from('gasto_negocio')
      .select('id_gasto')
      .eq('id_gasto', gasto!.id_gasto)
      .single()
    expect(gastoExiste).toBeDefined()

    // N3: Otro tenant -> 0 filas
    const fixtureOtro = await createTenantWithUser('rlsp_gasto_otro')
    const clientOtro = await signInAs(fixtureOtro)
    const { data: dataOtro } = await clientOtro.from('gasto_negocio').select('*')
    expect(dataOtro).toEqual([])

    // N4: Anon -> 0 filas
    const { data: dataAnon } = await anonClient().from('gasto_negocio').select('*')
    expect(dataAnon).toEqual([])

    // N5: Revendedora -> 0 filas
    const clientRev = await createRevendedoraClient(fixture)
    const { data: dataRev } = await clientRev.from('gasto_negocio').select('*')
    expect(dataRev).toEqual([])
  })
})

describe.skipIf(!hasTestDb)('REQ-RLSP-03 - categoria_gasto', () => {
  it('Feliz: SELECT con gastos.ver o reportes.ver; INSERT con gastos.crear; UPDATE/DELETE con gastos.editar', async () => {
    const fixture = await createTenantWithUser('rlsp_cat_f')
    const { data: catIni } = await fixture.serviceRole
      .from('categoria_gasto')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Honorarios' })
      .select('id_categoria_gasto')
      .single()

    // 1. SELECT con gastos.ver
    const clientGastosVer = await createClientWithPermisos(fixture, 'CatGV', { gastos: ['ver'] })
    const { data: dataGV, error: errGV } = await clientGastosVer.from('categoria_gasto').select('*')
    expect(errGV).toBeNull()
    expect(dataGV?.some((c) => c.id_categoria_gasto === catIni!.id_categoria_gasto)).toBe(true)

    // 2. SELECT con reportes.ver
    const clientRepVer = await createClientWithPermisos(fixture, 'CatRV', { reportes: ['ver'] })
    const { data: dataRV, error: errRV } = await clientRepVer.from('categoria_gasto').select('*')
    expect(errRV).toBeNull()
    expect(dataRV?.some((c) => c.id_categoria_gasto === catIni!.id_categoria_gasto)).toBe(true)

    // 3. INSERT con gastos.crear
    const clientGastosCrear = await createClientWithPermisos(fixture, 'CatGC', { gastos: ['crear'] })
    const { error: insErr } = await clientGastosCrear.from('categoria_gasto').insert({
      id_tenant: fixture.tenantId,
      nombre: 'Mantenimiento',
    })
    expect(insErr).toBeNull()

    // 4. UPDATE con gastos.ver + gastos.editar
    const clientGastosEditar = await createClientWithPermisos(fixture, 'CatGE', { gastos: ['ver', 'editar'] })
    const { error: updErr } = await clientGastosEditar
      .from('categoria_gasto')
      .update({ nombre: 'Honorarios Profesionales' })
      .eq('id_categoria_gasto', catIni!.id_categoria_gasto)
    expect(updErr).toBeNull()

    const { data: catUpd } = await fixture.serviceRole
      .from('categoria_gasto')
      .select('nombre')
      .eq('id_categoria_gasto', catIni!.id_categoria_gasto)
      .single()
    expect(catUpd?.nombre).toBe('Honorarios Profesionales')

    // 5. DELETE con gastos.editar
    const { error: delErr } = await clientGastosEditar
      .from('categoria_gasto')
      .delete()
      .eq('id_categoria_gasto', catIni!.id_categoria_gasto)
    expect(delErr).toBeNull()

    const { data: checkDel } = await fixture.serviceRole
      .from('categoria_gasto')
      .select('id_categoria_gasto')
      .eq('id_categoria_gasto', catIni!.id_categoria_gasto)
    expect(checkDel?.length).toBe(0)
  })

  it('N1..N5: sin permiso SELECT 0 filas; INSERT 42501; UPDATE/DELETE 0 filas (comprobado en BD); otro tenant y revendedora 0 filas', async () => {
    const fixture = await createTenantWithUser('rlsp_cat_neg')
    const { data: cat } = await fixture.serviceRole
      .from('categoria_gasto')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Impuestos' })
      .select('id_categoria_gasto')
      .single()

    // N1: SELECT sin permiso -> 0 filas
    const clientSinVer = await createClientWithPermisos(fixture, 'SinVerCat', { inventario: ['ver'] })
    const { data: dataSinVer } = await clientSinVer.from('categoria_gasto').select('*')
    expect(dataSinVer).toEqual([])

    // N2: INSERT sin gastos.crear -> 42501
    const { error: errIns } = await clientSinVer.from('categoria_gasto').insert({
      id_tenant: fixture.tenantId,
      nombre: 'Nueva Categoria Ilegal',
    })
    expect(errIns).not.toBeNull()
    expect(errIns?.code).toBe('42501')

    // N2: UPDATE sin gastos.editar -> 0 filas afectadas, nombre inalterado
    const { error: errUpd, count: countUpd } = await clientSinVer
      .from('categoria_gasto')
      .update({ nombre: 'Hackeado' }, { count: 'exact' })
      .eq('id_categoria_gasto', cat!.id_categoria_gasto)
    expect(errUpd).toBeNull()
    expect(countUpd).toBe(0)

    const { data: catOriginal } = await fixture.serviceRole
      .from('categoria_gasto')
      .select('nombre')
      .eq('id_categoria_gasto', cat!.id_categoria_gasto)
      .single()
    expect(catOriginal?.nombre).toBe('Impuestos')

    // N2: DELETE sin gastos.editar -> 0 filas afectadas, fila no borrada
    const { error: errDel, count: countDel } = await clientSinVer
      .from('categoria_gasto')
      .delete({ count: 'exact' })
      .eq('id_categoria_gasto', cat!.id_categoria_gasto)
    expect(errDel).toBeNull()
    expect(countDel).toBe(0)

    const { data: catCheck } = await fixture.serviceRole
      .from('categoria_gasto')
      .select('id_categoria_gasto')
      .eq('id_categoria_gasto', cat!.id_categoria_gasto)
      .single()
    expect(catCheck).toBeDefined()

    // N3: Otro tenant -> 0 filas
    const fixtureOtro = await createTenantWithUser('rlsp_cat_otro')
    const clientOtro = await signInAs(fixtureOtro)
    const { data: dataOtro } = await clientOtro.from('categoria_gasto').select('*')
    expect(dataOtro).toEqual([])

    // N4: Anon -> 0 filas
    const { data: dataAnon } = await anonClient().from('categoria_gasto').select('*')
    expect(dataAnon).toEqual([])

    // N5: Revendedora -> 0 filas
    const clientRev = await createRevendedoraClient(fixture)
    const { data: dataRev } = await clientRev.from('categoria_gasto').select('*')
    expect(dataRev).toEqual([])
  })
})

describe.skipIf(!hasTestDb)('REQ-RLSP-04 - rendicion_proveedor', () => {
  it('Feliz: SELECT con rendiciones.ver, inventario.ver (perfil proveedor) o reportes.ver; INSERT con rendiciones.crear; UPDATE con rendiciones.crear o rendiciones.editar; SPs reales', async () => {
    const fixture = await createTenantWithUser('rlsp_rend_f')
    await habilitarPaqueteConsignacion(fixture.tenantId, fixture.serviceRole)

    const { data: prov } = await fixture.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Proveedor Textil' })
      .select('id_proveedor')
      .single()

    const { data: rendIni } = await fixture.serviceRole
      .from('rendicion_proveedor')
      .insert({
        id_tenant: fixture.tenantId,
        id_proveedor: prov!.id_proveedor,
        id_usuario_alta: fixture.userId,
        periodo_desde: new Date().toISOString(),
        periodo_hasta: new Date().toISOString(),
        monto_total: 10000,
        cantidad_lineas: 1,
      })
      .select('id_rendicion')
      .single()

    // 1. SELECT con rendiciones.ver
    const clientRendVer = await createClientWithPermisos(fixture, 'RendVer', { rendiciones: ['ver'] })
    const { data: dataRV, error: errRV } = await clientRendVer.from('rendicion_proveedor').select('*')
    expect(errRV).toBeNull()
    expect(dataRV?.some((r) => r.id_rendicion === rendIni!.id_rendicion)).toBe(true)

    // 2. Perfil de proveedor: SELECT con solo inventario.ver lee rendicion_proveedor
    const clientInvVer = await createClientWithPermisos(fixture, 'InvVerProv', { inventario: ['ver'] })
    const { data: dataIV, error: errIV } = await clientInvVer
      .from('rendicion_proveedor')
      .select('*')
      .eq('id_proveedor', prov!.id_proveedor)
    expect(errIV).toBeNull()
    expect(dataIV?.some((r) => r.id_rendicion === rendIni!.id_rendicion)).toBe(true)

    // 3. SELECT con reportes.ver
    const clientRepVer = await createClientWithPermisos(fixture, 'RepRendVer', { reportes: ['ver'] })
    const { data: dataRepV, error: errRepV } = await clientRepVer.from('rendicion_proveedor').select('*')
    expect(errRepV).toBeNull()
    expect(dataRepV?.some((r) => r.id_rendicion === rendIni!.id_rendicion)).toBe(true)

    // 4. INSERT con rendiciones.crear (+ rendiciones.ver)
    const clientRendCrear = await createClientWithPermisos(fixture, 'RendCrear', { rendiciones: ['ver', 'crear'] })
    const { error: insErr } = await clientRendCrear.from('rendicion_proveedor').insert({
      id_tenant: fixture.tenantId,
      id_proveedor: prov!.id_proveedor,
      id_usuario_alta: fixture.userId,
      periodo_desde: new Date().toISOString(),
      periodo_hasta: new Date().toISOString(),
      monto_total: 20000,
      cantidad_lineas: 2,
    })
    expect(insErr).toBeNull()

    // 5. UPDATE con rendiciones.crear (SIN rendiciones.editar) vía PostgREST
    const { error: updCrearErr } = await clientRendCrear
      .from('rendicion_proveedor')
      .update({ monto_total: 25000 })
      .eq('id_rendicion', rendIni!.id_rendicion)
    expect(updCrearErr).toBeNull()

    const { data: rendUpdCrear } = await fixture.serviceRole
      .from('rendicion_proveedor')
      .select('monto_total')
      .eq('id_rendicion', rendIni!.id_rendicion)
      .single()
    expect(Number(rendUpdCrear?.monto_total)).toBe(25000)

    // 6. UPDATE con rendiciones.editar vía PostgREST
    const clientRendEditar = await createClientWithPermisos(fixture, 'RendEditar', { rendiciones: ['ver', 'editar'] })
    const { error: updEditErr } = await clientRendEditar
      .from('rendicion_proveedor')
      .update({ estado: 'pagada', fecha_pago: new Date().toISOString() })
      .eq('id_rendicion', rendIni!.id_rendicion)
    expect(updEditErr).toBeNull()

    // 7. SP real: sp_generar_rendicion con rendiciones.crear SIN editar
    const fVenta = await ventaFixture('rlsp_sp_gen_rend', 1, { tipoIngreso: 'consignacion' })

    const { data: provVenta } = await fVenta.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fVenta.tenantId, nombre: 'Proveedor Consignacion' })
      .select('id_proveedor')
      .single()

    const { data: ingVenta } = await fVenta.serviceRole
      .from('ingreso_mercaderia')
      .insert({
        id_tenant: fVenta.tenantId,
        id_proveedor: provVenta!.id_proveedor,
        tipo_ingreso: 'consignacion',
        confirmado: true,
      })
      .select('id_ingreso')
      .single()

    await fVenta.serviceRole
      .from('item_producto')
      .update({
        id_ingreso: ingVenta!.id_ingreso,
        tipo_ingreso: 'consignacion',
        costo_ingreso: 20000,
      })
      .eq('id_item', fVenta.items[0])

    const { data: idVenta, error: errVenta } = await venderContado(fVenta)
    expect(errVenta).toBeNull()

    // Requiere rendiciones.crear (+ rendiciones.ver por el RETURNING id_rendicion). Crucial: NO tiene rendiciones.editar
    const clientSoloCrearRend = await createClientWithPermisos(fVenta, 'SoloCrearRend', {
      rendiciones: ['ver', 'crear'],
    })
    const { data: idRendGenerada, error: errGenRend } = await clientSoloCrearRend.rpc('sp_generar_rendicion', {
      p_id_proveedor: provVenta!.id_proveedor,
      p_observaciones: 'Rendición consignación test',
    })
    expect(errGenRend).toBeNull()
    expect(idRendGenerada).toBeDefined()

    // 8. SP real: sp_marcar_rendicion_pagada con rendiciones.editar (+ rendiciones.ver para SELECT previo)
    const clientSoloEditRend = await createClientWithPermisos(fVenta, 'SoloEditRend', {
      rendiciones: ['ver', 'editar'],
    })
    const { error: errMarcarPagada } = await clientSoloEditRend.rpc('sp_marcar_rendicion_pagada', {
      p_id_rendicion: idRendGenerada,
    })
    expect(errMarcarPagada).toBeNull()

    const { data: rendPagada } = await fVenta.serviceRole
      .from('rendicion_proveedor')
      .select('estado')
      .eq('id_rendicion', idRendGenerada)
      .single()
    expect(rendPagada?.estado).toBe('pagada')
  })

  it('N1..N5: sin permiso SELECT 0 filas; INSERT 42501; UPDATE 0 filas; DELETE siempre bloqueado (false); otro tenant y revendedora 0 filas', async () => {
    const fixture = await createTenantWithUser('rlsp_rend_neg')
    const { data: prov } = await fixture.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Proveedor Inmutable' })
      .select('id_proveedor')
      .single()

    const { data: rend } = await fixture.serviceRole
      .from('rendicion_proveedor')
      .insert({
        id_tenant: fixture.tenantId,
        id_proveedor: prov!.id_proveedor,
        id_usuario_alta: fixture.userId,
        periodo_desde: new Date().toISOString(),
        periodo_hasta: new Date().toISOString(),
        monto_total: 50000,
        cantidad_lineas: 5,
      })
      .select('id_rendicion')
      .single()

    // N1: SELECT sin permiso -> 0 filas
    const clientSinVer = await createClientWithPermisos(fixture, 'SinVerRend', { gastos: ['ver'] })
    const { data: dataSinVer } = await clientSinVer.from('rendicion_proveedor').select('*')
    expect(dataSinVer).toEqual([])

    // N2: INSERT sin rendiciones.crear -> 42501
    const { error: errIns } = await clientSinVer.from('rendicion_proveedor').insert({
      id_tenant: fixture.tenantId,
      id_proveedor: prov!.id_proveedor,
      id_usuario_alta: fixture.userId,
      periodo_desde: new Date().toISOString(),
      periodo_hasta: new Date().toISOString(),
      monto_total: 1000,
      cantidad_lineas: 1,
    })
    expect(errIns).not.toBeNull()
    expect(errIns?.code).toBe('42501')

    // N2: UPDATE sin rendiciones.crear ni rendiciones.editar -> 0 filas afectadas
    const { error: errUpd, count: countUpd } = await clientSinVer
      .from('rendicion_proveedor')
      .update({ monto_total: 1 }, { count: 'exact' })
      .eq('id_rendicion', rend!.id_rendicion)
    expect(errUpd).toBeNull()
    expect(countUpd).toBe(0)

    const { data: rendInalterada } = await fixture.serviceRole
      .from('rendicion_proveedor')
      .select('monto_total')
      .eq('id_rendicion', rend!.id_rendicion)
      .single()
    expect(Number(rendInalterada?.monto_total)).toBe(50000)

    // N2: DELETE siempre bloqueado (policy delete false): incluso con rendiciones.editar y rendiciones.crear afecta 0 filas
    const clientAdminRend = await createClientWithPermisos(fixture, 'FullRend', {
      rendiciones: ['ver', 'crear', 'editar'],
    })
    const { error: errDel, count: countDel } = await clientAdminRend
      .from('rendicion_proveedor')
      .delete({ count: 'exact' })
      .eq('id_rendicion', rend!.id_rendicion)
    expect(errDel).toBeNull()
    expect(countDel).toBe(0)

    const { data: rendExiste } = await fixture.serviceRole
      .from('rendicion_proveedor')
      .select('id_rendicion')
      .eq('id_rendicion', rend!.id_rendicion)
      .single()
    expect(rendExiste).toBeDefined()

    // N3: Otro tenant -> 0 filas
    const fixtureOtro = await createTenantWithUser('rlsp_rend_otro')
    const clientOtro = await signInAs(fixtureOtro)
    const { data: dataOtro } = await clientOtro.from('rendicion_proveedor').select('*')
    expect(dataOtro).toEqual([])

    // N4: Anon -> 0 filas
    const { data: dataAnon } = await anonClient().from('rendicion_proveedor').select('*')
    expect(dataAnon).toEqual([])

    // N5: Revendedora -> 0 filas
    const clientRev = await createRevendedoraClient(fixture)
    const { data: dataRev } = await clientRev.from('rendicion_proveedor').select('*')
    expect(dataRev).toEqual([])
  })
})

describe.skipIf(!hasTestDb)('REQ-RLSP-05 - ingreso_mercaderia_detalle', () => {
  it('Feliz: SELECT con inventario.ver o reportes.ver; INSERT con inventario.crear; DELETE con inventario.editar o inventario.eliminar; SPs reales', async () => {
    const fixture = await createTenantWithUser('rlsp_ing_f')
    const { data: prov } = await fixture.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Proveedor Indumentaria' })
      .select('id_proveedor')
      .single()

    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatIng') })
      .select('id_categoria')
      .single()

    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({
        id_tenant: fixture.tenantId,
        id_categoria: cat!.id_categoria,
        nombre: withScopedTenant('ProdIng'),
      })
      .select('id_producto')
      .single()

    const { data: ing } = await fixture.serviceRole
      .from('ingreso_mercaderia')
      .insert({
        id_tenant: fixture.tenantId,
        id_proveedor: prov!.id_proveedor,
        tipo_ingreso: 'compra',
        confirmado: false,
      })
      .select('id_ingreso')
      .single()

    const { data: detIni } = await fixture.serviceRole
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: fixture.tenantId,
        id_ingreso: ing!.id_ingreso,
        id_producto: prod!.id_producto,
        cantidad: 10,
        costo_unitario: 1200,
        talle: 'M',
      })
      .select('id_detalle')
      .single()

    // 1. SELECT con inventario.ver
    const clientInvVer = await createClientWithPermisos(fixture, 'InvVerDet', { inventario: ['ver'] })
    const { data: dataIV, error: errIV } = await clientInvVer.from('ingreso_mercaderia_detalle').select('*')
    expect(errIV).toBeNull()
    expect(dataIV?.some((d) => d.id_detalle === detIni!.id_detalle)).toBe(true)

    // 2. SELECT con reportes.ver
    const clientRepVer = await createClientWithPermisos(fixture, 'RepVerDet', { reportes: ['ver'] })
    const { data: dataRV, error: errRV } = await clientRepVer.from('ingreso_mercaderia_detalle').select('*')
    expect(errRV).toBeNull()
    expect(dataRV?.some((d) => d.id_detalle === detIni!.id_detalle)).toBe(true)

    // 3. INSERT con inventario.crear
    const clientInvCrear = await createClientWithPermisos(fixture, 'InvCrearDet', { inventario: ['crear'] })
    const { error: insErr } = await clientInvCrear.from('ingreso_mercaderia_detalle').insert({
      id_tenant: fixture.tenantId,
      id_ingreso: ing!.id_ingreso,
      id_producto: prod!.id_producto,
      cantidad: 5,
      costo_unitario: 1500,
      talle: 'L',
    })
    expect(insErr).toBeNull()

    // 4. DELETE con inventario.ver + inventario.editar
    const clientInvEditar = await createClientWithPermisos(fixture, 'InvEditDet', { inventario: ['ver', 'editar'] })
    const { error: delEditErr } = await clientInvEditar
      .from('ingreso_mercaderia_detalle')
      .delete()
      .eq('id_detalle', detIni!.id_detalle)
    expect(delEditErr).toBeNull()

    const { data: checkDelEdit } = await fixture.serviceRole
      .from('ingreso_mercaderia_detalle')
      .select('id_detalle')
      .eq('id_detalle', detIni!.id_detalle)
    expect(checkDelEdit?.length).toBe(0)

    // 5. DELETE con inventario.eliminar
    const { data: det2 } = await fixture.serviceRole
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: fixture.tenantId,
        id_ingreso: ing!.id_ingreso,
        id_producto: prod!.id_producto,
        cantidad: 3,
        costo_unitario: 800,
        talle: 'S',
      })
      .select('id_detalle')
      .single()

    const clientInvEliminar = await createClientWithPermisos(fixture, 'InvElimDet', { inventario: ['ver', 'eliminar'] })
    const { error: delElimErr } = await clientInvEliminar
      .from('ingreso_mercaderia_detalle')
      .delete()
      .eq('id_detalle', det2!.id_detalle)
    expect(delElimErr).toBeNull()

    const { data: checkDelElim } = await fixture.serviceRole
      .from('ingreso_mercaderia_detalle')
      .select('id_detalle')
      .eq('id_detalle', det2!.id_detalle)
    expect(checkDelElim?.length).toBe(0)

    // 6. SP real: sp_importar_remito con inventario.crear (+ inventario.ver por el RETURNING del detalle)
    const clientInvVerCrear = await createClientWithPermisos(fixture, 'InvVerCrear', {
      inventario: ['ver', 'crear'],
    })
    const { data: remitoRes, error: remitoErr } = await clientInvVerCrear.rpc('sp_importar_remito', {
      p_id_ingreso: ing!.id_ingreso,
      p_moneda: 'ARS',
      p_lineas: [
        {
          esNuevo: false,
          nombre: 'Producto Remito',
          idProducto: prod!.id_producto,
          costoUnitario: 950,
          partes: [{ talle: 'XL', cantidad: 4 }],
        },
      ],
    })
    expect(remitoErr).toBeNull()
    expect(remitoRes?.vinculados).toBe(1)

    // 7. SP real: sp_cancelar_ingreso con rol inventario.ver + inventario.eliminar
    const clientCancela = await createClientWithPermisos(fixture, 'InvCancela', {
      inventario: ['ver', 'eliminar'],
    })
    const { error: errCancela } = await clientCancela.rpc('sp_cancelar_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
      p_motivo: 'Cancelación prueba RLS',
    })
    expect(errCancela).toBeNull()

    const { data: checkDetallesBorrados } = await fixture.serviceRole
      .from('ingreso_mercaderia_detalle')
      .select('id_detalle')
      .eq('id_ingreso', ing!.id_ingreso)
    expect(checkDetallesBorrados?.length).toBe(0)
  })

  it('Documentación de comportamiento: rol inventario.crear sin inventario.ver en .insert().select()', async () => {
    const fixture = await createTenantWithUser('rlsp_ing_doc')
    const { data: prov } = await fixture.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Prov Doc' })
      .select('id_proveedor')
      .single()

    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatDoc') })
      .select('id_categoria')
      .single()

    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdDoc') })
      .select('id_producto')
      .single()

    const { data: ing } = await fixture.serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: fixture.tenantId, id_proveedor: prov!.id_proveedor, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    // Rol con SOLO inventario.crear (carece de inventario.ver y reportes.ver)
    const clientSoloCrear = await createClientWithPermisos(fixture, 'SoloCrearInv', { inventario: ['crear'] })

    // Ejecuta .insert().select()
    const { data, error } = await clientSoloCrear
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: fixture.tenantId,
        id_ingreso: ing!.id_ingreso,
        id_producto: prod!.id_producto,
        cantidad: 7,
        costo_unitario: 500,
        talle: 'U',
      })
      .select()

    // Documentación del comportamiento: En PostgreSQL, la cláusula RETURNING que genera `.select()`
    // evalúa la policy restrictiva de SELECT sobre la fila insertada.
    // Al carecer de `inventario.ver` y `reportes.ver`, PostgreSQL rechaza la operación completa con
    // error 42501 (violación de policy rlsp_ingreso_mercaderia_detalle_select), abortando el INSERT.
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    expect(error?.message).toContain('rlsp_ingreso_mercaderia_detalle_select')

    // En contraste, una inserción pura SIN .select() pasa exitosamente con solo `inventario.crear`:
    const { error: errPuro } = await clientSoloCrear
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: fixture.tenantId,
        id_ingreso: ing!.id_ingreso,
        id_producto: prod!.id_producto,
        cantidad: 7,
        costo_unitario: 500,
        talle: 'U',
      })
    expect(errPuro).toBeNull()

    // Comprobación con serviceRole: el registro insertado sin .select() SÍ está en la BD
    const { data: enBd } = await fixture.serviceRole
      .from('ingreso_mercaderia_detalle')
      .select('*')
      .eq('id_ingreso', ing!.id_ingreso)
      .eq('cantidad', 7)
    expect(enBd?.length).toBe(1)
  })

  it('N1..N5: sin permiso SELECT 0 filas; INSERT 42501; UPDATE bloqueado (false); DELETE 0 filas; otro tenant y revendedora 0 filas', async () => {
    const fixture = await createTenantWithUser('rlsp_ing_neg')
    const { data: prov } = await fixture.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Prov Neg' })
      .select('id_proveedor')
      .single()

    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatNeg') })
      .select('id_categoria')
      .single()

    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdNeg') })
      .select('id_producto')
      .single()

    const { data: ing } = await fixture.serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: fixture.tenantId, id_proveedor: prov!.id_proveedor, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    const { data: det } = await fixture.serviceRole
      .from('ingreso_mercaderia_detalle')
      .insert({
        id_tenant: fixture.tenantId,
        id_ingreso: ing!.id_ingreso,
        id_producto: prod!.id_producto,
        cantidad: 15,
        costo_unitario: 700,
        talle: 'M',
      })
      .select('id_detalle')
      .single()

    // N1: SELECT sin inventario.ver ni reportes.ver
    const clientSinVer = await createClientWithPermisos(fixture, 'SinVerInv', { gastos: ['ver'] })
    const { data: dataSinVer } = await clientSinVer.from('ingreso_mercaderia_detalle').select('*')
    expect(dataSinVer).toEqual([])

    // N2: INSERT sin inventario.crear -> 42501
    const { error: errIns } = await clientSinVer.from('ingreso_mercaderia_detalle').insert({
      id_tenant: fixture.tenantId,
      id_ingreso: ing!.id_ingreso,
      id_producto: prod!.id_producto,
      cantidad: 1,
      costo_unitario: 100,
    })
    expect(errIns).not.toBeNull()
    expect(errIns?.code).toBe('42501')

    // N2: UPDATE siempre bloqueado (policy update false): incluso con inventario.editar afecta 0 filas
    const clientInvEditar = await createClientWithPermisos(fixture, 'InvEditOnly', {
      inventario: ['ver', 'editar'],
    })
    const { error: errUpd, count: countUpd } = await clientInvEditar
      .from('ingreso_mercaderia_detalle')
      .update({ cantidad: 999 }, { count: 'exact' })
      .eq('id_detalle', det!.id_detalle)
    expect(errUpd).toBeNull()
    expect(countUpd).toBe(0)

    const { data: detInalterado } = await fixture.serviceRole
      .from('ingreso_mercaderia_detalle')
      .select('cantidad')
      .eq('id_detalle', det!.id_detalle)
      .single()
    expect(detInalterado?.cantidad).toBe(15)

    // N2: DELETE sin inventario.editar ni inventario.eliminar afecta 0 filas
    const { error: errDel, count: countDel } = await clientSinVer
      .from('ingreso_mercaderia_detalle')
      .delete({ count: 'exact' })
      .eq('id_detalle', det!.id_detalle)
    expect(errDel).toBeNull()
    expect(countDel).toBe(0)

    const { data: detExiste } = await fixture.serviceRole
      .from('ingreso_mercaderia_detalle')
      .select('id_detalle')
      .eq('id_detalle', det!.id_detalle)
      .single()
    expect(detExiste).toBeDefined()

    // N3: Otro tenant -> 0 filas
    const fixtureOtro = await createTenantWithUser('rlsp_ing_otro')
    const clientOtro = await signInAs(fixtureOtro)
    const { data: dataOtro } = await clientOtro.from('ingreso_mercaderia_detalle').select('*')
    expect(dataOtro).toEqual([])

    // N4: Anon -> 0 filas
    const { data: dataAnon } = await anonClient().from('ingreso_mercaderia_detalle').select('*')
    expect(dataAnon).toEqual([])

    // N5: Revendedora -> 0 filas
    const clientRev = await createRevendedoraClient(fixture)
    const { data: dataRev } = await clientRev.from('ingreso_mercaderia_detalle').select('*')
    expect(dataRev).toEqual([])
  })
})

describe.skipIf(!hasTestDb)('Aislamiento transversal revendedora y otro tenant en las 4 tablas de Fase 4', () => {
  it('Revendedora y usuario de otro tenant obtienen 0 filas en SELECT en las 4 tablas', async () => {
    const fixtureA = await createTenantWithUser('rlsp_trans_a')
    const fixtureB = await createTenantWithUser('rlsp_trans_b')

    const { data: catG } = await fixtureA.serviceRole
      .from('categoria_gasto')
      .insert({ id_tenant: fixtureA.tenantId, nombre: 'Cat Trans' })
      .select('id_categoria_gasto')
      .single()

    await fixtureA.serviceRole.from('gasto_negocio').insert({
      id_tenant: fixtureA.tenantId,
      id_categoria_gasto: catG!.id_categoria_gasto,
      id_usuario_alta: fixtureA.userId,
      monto: 1000,
    })

    const { data: prov } = await fixtureA.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixtureA.tenantId, nombre: 'Prov Trans' })
      .select('id_proveedor')
      .single()

    await fixtureA.serviceRole.from('rendicion_proveedor').insert({
      id_tenant: fixtureA.tenantId,
      id_proveedor: prov!.id_proveedor,
      id_usuario_alta: fixtureA.userId,
      periodo_desde: new Date().toISOString(),
      periodo_hasta: new Date().toISOString(),
      monto_total: 5000,
      cantidad_lineas: 1,
    })

    const { data: catP } = await fixtureA.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixtureA.tenantId, nombre: withScopedTenant('CatP') })
      .select('id_categoria')
      .single()

    const { data: prod } = await fixtureA.serviceRole
      .from('producto')
      .insert({ id_tenant: fixtureA.tenantId, id_categoria: catP!.id_categoria, nombre: withScopedTenant('ProdP') })
      .select('id_producto')
      .single()

    const { data: ing } = await fixtureA.serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: fixtureA.tenantId, id_proveedor: prov!.id_proveedor, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    await fixtureA.serviceRole.from('ingreso_mercaderia_detalle').insert({
      id_tenant: fixtureA.tenantId,
      id_ingreso: ing!.id_ingreso,
      id_producto: prod!.id_producto,
      cantidad: 2,
      costo_unitario: 500,
    })

    // 1. Revendedora en tenant A
    const revClient = await createRevendedoraClient(fixtureA)
    const { data: r1 } = await revClient.from('gasto_negocio').select('*')
    const { data: r2 } = await revClient.from('categoria_gasto').select('*')
    const { data: r3 } = await revClient.from('rendicion_proveedor').select('*')
    const { data: r4 } = await revClient.from('ingreso_mercaderia_detalle').select('*')
    expect(r1).toEqual([])
    expect(r2).toEqual([])
    expect(r3).toEqual([])
    expect(r4).toEqual([])

    // 2. Usuario de tenant B
    const clientB = await signInAs(fixtureB)
    const { data: b1 } = await clientB.from('gasto_negocio').select('*')
    const { data: b2 } = await clientB.from('categoria_gasto').select('*')
    const { data: b3 } = await clientB.from('rendicion_proveedor').select('*')
    const { data: b4 } = await clientB.from('ingreso_mercaderia_detalle').select('*')
    expect(b1).toEqual([])
    expect(b2).toEqual([])
    expect(b3).toEqual([])
    expect(b4).toEqual([])
  })
})
