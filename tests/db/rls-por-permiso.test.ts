import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CATALOGO_PERMISOS } from '@/lib/types/administracion'
import type { FinanzasFlujoRow } from '@/lib/types/reportes'
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
      .single<FinanzasFlujoRow>()

    expect(errFlujo).toBeNull()
    expect(Number(flujo?.gastos)).toBe(25000)
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

describe.skipIf(!hasTestDb)('Fase 5b-M1 - Chequeo de permisos en sp_* de Ventas, Cuotas y Reservas', () => {
  it('un rol con solo ventas.ver recibe no-permission en los 10 sp', async () => {
    const fixture = await createTenantWithUser('rlsp_m1_ver')
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { ventas: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const llamadas: Array<{ sp: string; params: Record<string, unknown> }> = [
      {
        sp: 'sp_registrar_venta',
        params: {
          p_lineas: [{ id_item: randomUUID() }],
        },
      },
      {
        sp: 'sp_anular_venta',
        params: {
          p_id_venta: randomUUID(),
        },
      },
      {
        sp: 'sp_registrar_devolucion_cliente',
        params: {
          p_id_detalle_venta: randomUUID(),
        },
      },
      {
        sp: 'sp_registrar_cambio',
        params: {
          p_id_detalle_original: randomUUID(),
          p_id_item_entregado: randomUUID(),
        },
      },
      {
        sp: 'sp_emitir_comprobante',
        params: {
          p_id_venta: randomUUID(),
          p_tipo: 'factura_b',
          p_numero: '0001-00000001',
        },
      },
      {
        sp: 'sp_cobrar_cuota',
        params: {
          p_id_cuota: randomUUID(),
          p_monto: 100,
          p_medio: 'efectivo',
          p_id_cuenta_destino: randomUUID(),
        },
      },
      {
        sp: 'sp_marcar_cuota_incobrable',
        params: {
          p_id_cuota: randomUUID(),
          p_motivo: 'motivo prueba',
        },
      },
      {
        sp: 'sp_crear_reserva',
        params: {
          p_id_cliente: null,
          p_items: [randomUUID()],
          p_fecha_vencimiento: new Date(Date.now() + 86400000).toISOString(),
        },
      },
      {
        sp: 'sp_cancelar_reserva',
        params: {
          p_id_reserva: randomUUID(),
        },
      },
      {
        sp: 'sp_vencer_reservas',
        params: {},
      },
    ]

    for (const { sp, params } of llamadas) {
      const { error } = await client.rpc(sp, params)
      expect(error, `SP ${sp} debio fallar con no-permission`).not.toBeNull()
      expect(error?.message, `SP ${sp} mensaje`).toContain('no-permission')
      expect(error?.code, `SP ${sp} code`).toBe('42501')
    }
  })

  it('un rol con ventas.crear registra una venta', async () => {
    const f = await ventaFixture('rlsp_m1_crear', 1, { tipoIngreso: 'compra' })
    const { error: errRol } = await f.serviceRole
      .from('rol')
      .update({ permisos: { ventas: ['crear', 'ver'], inventario: ['ver'] } })
      .eq('id_rol', f.rolId)
    expect(errRol).toBeNull()

    const { data: idVenta, error } = await venderContado(f)
    expect(error).toBeNull()
    expect(idVenta).toBeDefined()
  })

  it('un rol con revendedoras.crear SIN ventas.crear sigue confirmando una declaración', async () => {
    const fA = await ventaFixture('rlsp_m1_rev', 1, { tipoIngreso: 'compra' })

    // Habilitar módulo revendedoras
    const { data: mod } = await fA.serviceRole
      .from('modulo')
      .select('id_modulo')
      .eq('codigo', 'revendedoras')
      .single()
    await fA.serviceRole
      .from('tenant_modulo')
      .insert({ id_tenant: fA.tenantId, id_modulo: mod!.id_modulo, habilitado: true })

    // Crear revendedora
    const { data: idRev } = await fA.authenticated.rpc('sp_crear_revendedora', {
      p_nombre: 'Rocío',
      p_apellido: 'Rev',
      p_email: 'rocio_rev@test.com',
    })

    // Entregar 1 ítem a la revendedora
    const hoy = new Date().toISOString().slice(0, 10)
    const { data: idCons, error: errCons } = await fA.authenticated.rpc('sp_crear_consignacion_revendedora_con_items', {
      p_id_revendedora: idRev,
      p_items: [fA.items[0]],
      p_periodo_desde: hoy,
    })
    expect(errCons).toBeNull()
    const { error: errConf } = await fA.authenticated.rpc('sp_confirmar_consignacion_revendedora', {
      p_id_consignacion_revendedora: idCons,
    })
    expect(errConf).toBeNull()

    // Crear declaración de venta
    const { data: dec, error: errDec } = await fA.serviceRole
      .from('declaracion_venta_revendedora')
      .insert({
        id_tenant: fA.tenantId,
        id_revendedora: idRev,
        id_item: fA.items[0],
        estado: 'pendiente',
        fecha: hoy,
      })
      .select('id_declaracion')
      .single()
    expect(errDec).toBeNull()

    // Operador con revendedoras.crear SIN ventas.crear ni revendedoras.editar
    const { error: errRol } = await fA.serviceRole
      .from('rol')
      .update({ permisos: { revendedoras: ['crear', 'ver'], inventario: ['ver'] } })
      .eq('id_rol', fA.rolId)
    expect(errRol).toBeNull()

    const { data: idVenta, error: errConfDec } = await fA.authenticated.rpc('sp_confirmar_declaracion_venta', {
      p_id_declaracion: dec!.id_declaracion,
    })
    expect(errConfDec).toBeNull()
    expect(idVenta).toBeDefined()
  })

  it('el admin fixture no se rompe al registrar venta', async () => {
    const fAdmin = await ventaFixture('rlsp_m1_adm', 1, { tipoIngreso: 'compra' })
    const { data: idVenta, error } = await venderContado(fAdmin)
    expect(error).toBeNull()
    expect(idVenta).toBeDefined()
  })
})

describe.skipIf(!hasTestDb)('Fase 5b-M2 - Chequeo de permisos en sp_* de Inventario', () => {
  it('un rol con solo inventario.ver recibe no-permission en los 10 sp', async () => {
    const fixture = await createTenantWithUser('rlsp_m2_ver')
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { inventario: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const llamadas: Array<{ sp: string; params: Record<string, unknown> }> = [
      {
        sp: 'sp_create_producto',
        params: {
          p_id_categoria: randomUUID(),
          p_nombre: 'Producto Test',
        },
      },
      {
        sp: 'sp_crear_stock_directo',
        params: {
          p_id_producto: randomUUID(),
          p_costo: 100,
        },
      },
      {
        sp: 'sp_set_costo_producto',
        params: {
          p_id_producto: randomUUID(),
          p_costo: 100,
        },
      },
      {
        sp: 'sp_importar_remito',
        params: {
          p_id_ingreso: randomUUID(),
        },
      },
      {
        sp: 'sp_confirmar_ingreso',
        params: {
          p_id_ingreso: randomUUID(),
        },
      },
      {
        sp: 'sp_asignar_talles_a_producto',
        params: {
          p_id_producto: randomUUID(),
          p_distribucion: [],
        },
      },
      {
        sp: 'sp_cancelar_ingreso',
        params: {
          p_id_ingreso: randomUUID(),
        },
      },
      {
        sp: 'sp_aplicar_ultimo_costo',
        params: {
          p_id_producto: randomUUID(),
          p_costo: 100,
        },
      },
      {
        sp: 'sp_marcar_precio_desactualizado_by_producto',
        params: {
          p_id_producto: randomUUID(),
        },
      },
      {
        sp: 'sp_transicion_item_producto',
        params: {
          p_id_item: randomUUID(),
          p_estado_hasta: 'baja',
          p_tipo_movimiento: 'baja',
        },
      },
    ]

    for (const { sp, params } of llamadas) {
      const { error } = await client.rpc(sp, params)
      expect(error, `SP ${sp} debio fallar con no-permission`).not.toBeNull()
      expect(error?.message, `SP ${sp} mensaje`).toContain('no-permission')
      expect(error?.code, `SP ${sp} code`).toBe('42501')
    }
  })

  it('sp_transicion_item_producto: rechazo con solo inventario.ver y aceptacion individual con cada uno de los 7 permisos', async () => {
    const fixture = await createTenantWithUser('rlsp_m2_trans')
    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatTrans'), talles: ['U'] })
      .select('id_categoria')
      .single()
    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdTrans') })
      .select('id_producto')
      .single()

    // Crear 8 items en estado 'disponible'
    const items: string[] = []
    for (let i = 0; i < 8; i++) {
      const { data: item } = await fixture.serviceRole
        .from('item_producto')
        .insert({
          id_tenant: fixture.tenantId,
          id_producto: prod!.id_producto,
          qr_code: `qr_trans_${i}_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
          estado_item: 'disponible',
          costo_ingreso: 100,
          tipo_ingreso: 'compra',
          talle: 'U',
        })
        .select('id_item')
        .single()
      items.push(item!.id_item)
    }

    const client = await signInAs(fixture)

    // 0. Solo inventario.ver -> rechazo con no-permission
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { inventario: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errVer } = await client.rpc('sp_transicion_item_producto', {
      p_id_item: items[0],
      p_estado_hasta: 'baja',
      p_tipo_movimiento: 'baja',
    })
    expect(errVer?.message).toContain('no-permission')
    expect(errVer?.code).toBe('42501')

    // Los 7 permisos en el orden especificado
    const permisosValidos: Array<{ nombre: string; permisos: Record<string, string[]> }> = [
      { nombre: 'ventas.crear', permisos: { ventas: ['crear', 'ver'], inventario: ['ver'] } },
      { nombre: 'ventas.editar', permisos: { ventas: ['editar', 'ver'], inventario: ['ver'] } },
      { nombre: 'inventario.editar', permisos: { inventario: ['editar', 'ver'] } },
      { nombre: 'consignaciones.editar', permisos: { consignaciones: ['editar', 'ver'], inventario: ['ver'] } },
      { nombre: 'consignaciones.eliminar', permisos: { consignaciones: ['eliminar', 'ver'], inventario: ['ver'] } },
      { nombre: 'revendedoras.crear', permisos: { revendedoras: ['crear', 'ver'], inventario: ['ver'] } },
      { nombre: 'revendedoras.editar', permisos: { revendedoras: ['editar', 'ver'], inventario: ['ver'] } },
    ]

    for (let i = 0; i < permisosValidos.length; i++) {
      const { nombre, permisos } = permisosValidos[i]
      await fixture.serviceRole
        .from('rol')
        .update({ permisos })
        .eq('id_rol', fixture.rolId)

      const { error } = await client.rpc('sp_transicion_item_producto', {
        p_id_item: items[i + 1],
        p_estado_hasta: 'baja',
        p_tipo_movimiento: 'baja',
      })
      expect(error, `sp_transicion_item_producto debio pasar con ${nombre}`).toBeNull()
    }
  })

  it('sp_cancelar_ingreso con rol que tiene solo inventario.crear pasa, y con inventario.eliminar pasa', async () => {
    const fixture = await createTenantWithUser('rlsp_m2_canc')
    const { data: prov } = await fixture.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Prov Canc' })
      .select('id_proveedor')
      .single()

    const { data: ing1 } = await fixture.serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: fixture.tenantId, id_proveedor: prov!.id_proveedor, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    const { data: ing2 } = await fixture.serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: fixture.tenantId, id_proveedor: prov!.id_proveedor, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    const client = await signInAs(fixture)

    // Caso A: rol con SOLO inventario.crear (rollback de crearIngresoCompletoAction)
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { inventario: ['crear', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: res1, error: err1 } = await client.rpc('sp_cancelar_ingreso', {
      p_id_ingreso: ing1!.id_ingreso,
      p_motivo: 'rollback creacion',
    })
    expect(err1).toBeNull()
    expect(res1).toBeDefined()

    // Caso B: rol con inventario.eliminar
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { inventario: ['eliminar', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: res2, error: err2 } = await client.rpc('sp_cancelar_ingreso', {
      p_id_ingreso: ing2!.id_ingreso,
      p_motivo: 'baja normal',
    })
    expect(err2).toBeNull()
    expect(res2).toBeDefined()
  })

  it('roles con permiso ejecutan exitosamente los sp de inventario', async () => {
    const fixture = await createTenantWithUser('rlsp_m2_permisos')
    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatInvOk'), talles: ['S', 'M'] })
      .select('id_categoria')
      .single()
    const { data: prov } = await fixture.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixture.tenantId, nombre: 'Prov InvOk' })
      .select('id_proveedor')
      .single()

    const client = await signInAs(fixture)

    // 1. inventario.crear -> sp_create_producto
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { inventario: ['crear', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: idProd, error: errProd } = await client.rpc('sp_create_producto', {
      p_id_categoria: cat!.id_categoria,
      p_nombre: withScopedTenant('ProdInvOk'),
    })
    expect(errProd).toBeNull()
    expect(idProd).toBeDefined()

    // 2. inventario.crear -> sp_set_costo_producto
    const { data: idCosto, error: errCosto } = await client.rpc('sp_set_costo_producto', {
      p_id_producto: idProd,
      p_costo: 1200,
    })
    expect(errCosto).toBeNull()
    expect(idCosto).toBeDefined()

    // 3. inventario.crear -> sp_crear_stock_directo
    const { data: cantDirecto, error: errDirecto } = await client.rpc('sp_crear_stock_directo', {
      p_id_producto: idProd,
      p_costo: 1200,
      p_items: [{ talle: null, cantidad: 2 }],
    })
    expect(errDirecto).toBeNull()
    expect(cantDirecto).toBe(2)

    // 4. inventario.crear -> sp_importar_remito y sp_confirmar_ingreso
    const { data: ing } = await fixture.serviceRole
      .from('ingreso_mercaderia')
      .insert({ id_tenant: fixture.tenantId, id_proveedor: prov!.id_proveedor, tipo_ingreso: 'compra', confirmado: false })
      .select('id_ingreso')
      .single()

    const { data: resRemito, error: errRemito } = await client.rpc('sp_importar_remito', {
      p_id_ingreso: ing!.id_ingreso,
      p_lineas: [
        {
          esNuevo: false,
          idProducto: idProd,
          nombre: 'ProdInvOk',
          costoUnitario: 1200,
          partes: [{ talle: 'M', cantidad: 1 }],
        },
      ],
    })
    expect(errRemito).toBeNull()
    expect(resRemito).toBeDefined()

    const { data: cantConf, error: errConf } = await client.rpc('sp_confirmar_ingreso', {
      p_id_ingreso: ing!.id_ingreso,
    })
    expect(errConf).toBeNull()
    expect(cantConf).toBe(1)

    // 5. inventario.editar -> sp_asignar_talles_a_producto
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { inventario: ['editar', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: cantTalles, error: errTalles } = await client.rpc('sp_asignar_talles_a_producto', {
      p_id_producto: idProd,
      p_distribucion: [{ talle: 'S', cantidad: 1 }],
    })
    expect(errTalles).toBeNull()
    expect(cantTalles).toBe(1)

    // 6. precios.editar_cotizacion -> sp_aplicar_ultimo_costo y sp_marcar_precio_desactualizado_by_producto
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { precios: ['editar_cotizacion', 'ver'], inventario: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: idCostoCot, error: errCostoCot } = await client.rpc('sp_aplicar_ultimo_costo', {
      p_id_producto: idProd,
      p_costo: 1300,
    })
    expect(errCostoCot).toBeNull()
    expect(idCostoCot).toBeDefined()

    const { error: errDesc } = await client.rpc('sp_marcar_precio_desactualizado_by_producto', {
      p_id_producto: idProd,
    })
    expect(errDesc).toBeNull()
  })
})

describe.skipIf(!hasTestDb)('Fase 5b-M3 - Chequeo de permisos en sp_* de Precios', () => {
  it('un rol con solo precios.ver recibe no-permission en los 10 sp', async () => {
    const fixture = await createTenantWithUser('rlsp_m3_ver')
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { precios: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const llamadas: Array<{ sp: string; params: Record<string, unknown> }> = [
      {
        sp: 'sp_create_regla_precio',
        params: {
          p_nombre: 'Regla M3 Test',
          p_tipo_regla: 'margen',
          p_tipo_valor: 'porcentaje',
          p_valor: 0.2,
          p_alcance: 'global',
        },
      },
      {
        sp: 'sp_baja_regla_precio',
        params: {
          p_id_regla: randomUUID(),
        },
      },
      {
        sp: 'sp_extender_vigencia_regla',
        params: {
          p_id_regla: randomUUID(),
          p_fecha_hasta: new Date().toISOString(),
        },
      },
      {
        sp: 'sp_recalcular_precio_venta',
        params: {
          p_id_producto: randomUUID(),
        },
      },
      {
        sp: 'sp_recalcular_precios_batch',
        params: {
          p_ids: [randomUUID()],
        },
      },
      {
        sp: 'sp_set_cotizacion_manual',
        params: {
          p_valor: 1000,
          p_ip: '127.0.0.1',
        },
      },
      {
        sp: 'sp_set_modo_cotizacion',
        params: {
          p_modo: 'manual',
          p_ip: '127.0.0.1',
        },
      },
      {
        sp: 'sp_registrar_cotizacion_bcra',
        params: {
          p_valor: 1000,
          p_fecha_valor: '2026-11-08',
          p_desactualizada: false,
        },
      },
      {
        sp: 'sp_revaluar_costos_usd_vigentes',
        params: {},
      },
      {
        sp: 'sp_marcar_precio_desactualizado_by_regla',
        params: {
          p_id_regla: randomUUID(),
        },
      },
    ]

    for (const { sp, params } of llamadas) {
      const { error } = await client.rpc(sp, params)
      expect(error, `SP ${sp} debio fallar con no-permission`).not.toBeNull()
      expect(error?.message, `SP ${sp} mensaje`).toContain('no-permission')
      expect(error?.code, `SP ${sp} code`).toBe('42501')
    }
  })

  it('sp_marcar_precio_desactualizado_by_regla: pasa con precios.crear y con precios.eliminar por separado', async () => {
    const fixture = await createTenantWithUser('rlsp_m3_desact')
    const { data: regla } = await fixture.serviceRole
      .from('regla_precio')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'Regla Desact Test',
        tipo_regla: 'margen',
        tipo_valor: 'porcentaje',
        valor: 0.3,
        alcance: 'global',
      })
      .select('id_regla')
      .single()
    expect(regla?.id_regla).toBeDefined()

    const client = await signInAs(fixture)

    // 1. Con precios.crear pasa
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { precios: ['crear', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errCrear } = await client.rpc('sp_marcar_precio_desactualizado_by_regla', {
      p_id_regla: regla!.id_regla,
    })
    expect(errCrear).toBeNull()

    // 2. Con precios.eliminar pasa
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { precios: ['eliminar', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errEliminar } = await client.rpc('sp_marcar_precio_desactualizado_by_regla', {
      p_id_regla: regla!.id_regla,
    })
    expect(errEliminar).toBeNull()
  })

  it('sp_registrar_cotizacion_bcra: pasa con inventario.crear y con precios.editar_cotizacion por separado; rechazo con solo precios.ver', async () => {
    const fixture = await createTenantWithUser('rlsp_m3_bcra')
    const client = await signInAs(fixture)

    // 1. Rechazo con solo precios.ver
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { precios: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errVer } = await client.rpc('sp_registrar_cotizacion_bcra', {
      p_valor: 1100,
      p_fecha_valor: '2026-11-08',
      p_desactualizada: false,
    })
    expect(errVer?.message).toContain('no-permission')
    expect(errVer?.code).toBe('42501')

    // 2. Aceptación con inventario.crear
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { inventario: ['crear', 'ver'], precios: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errInv } = await client.rpc('sp_registrar_cotizacion_bcra', {
      p_valor: 1150,
      p_fecha_valor: '2026-11-08',
      p_desactualizada: false,
    })
    expect(errInv).toBeNull()

    // 3. Aceptación con precios.editar_cotizacion
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { precios: ['editar_cotizacion', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errCot } = await client.rpc('sp_registrar_cotizacion_bcra', {
      p_valor: 1200,
      p_fecha_valor: '2026-11-08',
      p_desactualizada: false,
    })
    expect(errCot).toBeNull()
  })

  it('roles con permiso ejecutan exitosamente los sp de precios', async () => {
    const fixture = await createTenantWithUser('rlsp_m3_permisos')
    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatPreciosOk'), talles: ['U'] })
      .select('id_categoria')
      .single()
    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdPreciosOk') })
      .select('id_producto')
      .single()
    await fixture.serviceRole
      .from('costo_producto')
      .insert({ id_tenant: fixture.tenantId, id_producto: prod!.id_producto, costo: 1000, moneda: 'ARS' })

    const client = await signInAs(fixture)

    // 1. precios.crear -> sp_create_regla_precio
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { precios: ['crear', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: idRegla, error: errCreate } = await client.rpc('sp_create_regla_precio', {
      p_nombre: 'Margen Global 50%',
      p_tipo_regla: 'margen',
      p_tipo_valor: 'porcentaje',
      p_valor: 0.5,
      p_alcance: 'global',
    })
    expect(errCreate).toBeNull()
    expect(idRegla).toBeDefined()

    // 2. precios.editar -> sp_extender_vigencia_regla, sp_recalcular_precio_venta, sp_recalcular_precios_batch
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { precios: ['editar', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const nuevaFecha = new Date(Date.now() + 86400000).toISOString()
    const { error: errExtender } = await client.rpc('sp_extender_vigencia_regla', {
      p_id_regla: idRegla,
      p_fecha_hasta: nuevaFecha,
    })
    expect(errExtender).toBeNull()

    const { data: precioVenta, error: errRecalc } = await client.rpc('sp_recalcular_precio_venta', {
      p_id_producto: prod!.id_producto,
    })
    expect(errRecalc).toBeNull()
    expect(precioVenta).toBe(1500)

    const { data: batchResult, error: errBatch } = await client.rpc('sp_recalcular_precios_batch', {
      p_ids: [prod!.id_producto],
    })
    expect(errBatch).toBeNull()
    expect(batchResult).toHaveLength(1)

    // 3. precios.editar_cotizacion -> sp_set_cotizacion_manual, sp_set_modo_cotizacion, sp_revaluar_costos_usd_vigentes
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { precios: ['editar_cotizacion', 'ver'], inventario: ['crear', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errManual } = await client.rpc('sp_set_cotizacion_manual', {
      p_valor: 1400,
      p_ip: '127.0.0.1',
    })
    expect(errManual).toBeNull()

    const { error: errModo } = await client.rpc('sp_set_modo_cotizacion', {
      p_modo: 'manual',
      p_ip: '127.0.0.1',
    })
    expect(errModo).toBeNull()

    const { data: revalResult, error: errReval } = await client.rpc('sp_revaluar_costos_usd_vigentes', {
      p_ip: '127.0.0.1',
    })
    expect(errReval).toBeNull()
    expect(revalResult).toBeDefined()

    // 4. precios.eliminar -> sp_baja_regla_precio
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { precios: ['eliminar', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errBaja } = await client.rpc('sp_baja_regla_precio', {
      p_id_regla: idRegla,
    })
    expect(errBaja).toBeNull()
  })
})

describe.skipIf(!hasTestDb)('Fase 5b-M4 - Chequeo de permisos en sp_* de Consignaciones y Rendiciones', () => {
  it('un rol con solo consignaciones.ver y rendiciones.ver recibe no-permission en los 13 sp', async () => {
    const fixture = await createTenantWithUser('rlsp_m4_ver')
    await habilitarPaqueteConsignacion(fixture.tenantId, fixture.serviceRole)
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { consignaciones: ['ver'], rendiciones: ['ver'], inventario: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const llamadas: Array<{ sp: string; params: Record<string, unknown> }> = [
      {
        sp: 'sp_crear_consignacion_con_items',
        params: {
          p_id_proveedor: randomUUID(),
          p_items: [randomUUID()],
        },
      },
      {
        sp: 'sp_agregar_item_consignacion',
        params: {
          p_id_consignacion: randomUUID(),
          p_id_item: randomUUID(),
        },
      },
      {
        sp: 'sp_editar_consignacion',
        params: {
          p_id_consignacion: randomUUID(),
          p_observaciones: 'edit test',
        },
      },
      {
        sp: 'sp_confirmar_consignacion',
        params: {
          p_id_consignacion: randomUUID(),
        },
      },
      {
        sp: 'sp_cancelar_item_consignacion',
        params: {
          p_id_detalle: randomUUID(),
        },
      },
      {
        sp: 'sp_confirmar_salida_item',
        params: {
          p_id_detalle: randomUUID(),
        },
      },
      {
        sp: 'sp_cerrar_consignacion',
        params: {
          p_id_consignacion: randomUUID(),
        },
      },
      {
        sp: 'sp_eliminar_consignacion',
        params: {
          p_id_consignacion: randomUUID(),
        },
      },
      {
        sp: 'sp_registrar_ajuste_inventario',
        params: {
          p_id_item: randomUUID(),
          p_cantidad_sistema: 1,
          p_cantidad_contada: 1,
          p_observaciones: 'ajuste test',
        },
      },
      {
        sp: 'sp_generar_rendicion',
        params: {
          p_id_proveedor: randomUUID(),
        },
      },
      {
        sp: 'sp_marcar_rendicion_pagada',
        params: {
          p_id_rendicion: randomUUID(),
        },
      },
      {
        sp: 'sp_excluir_detalle_rendicion',
        params: {
          p_id_detalle: randomUUID(),
        },
      },
      {
        sp: 'sp_reincluir_detalle_rendicion',
        params: {
          p_id_detalle: randomUUID(),
        },
      },
    ]

    for (const { sp, params } of llamadas) {
      const { error } = await client.rpc(sp, params)
      expect(error, `SP ${sp} debio fallar con no-permission`).not.toBeNull()
      expect(error?.message, `SP ${sp} mensaje`).toContain('no-permission')
      expect(error?.code, `SP ${sp} code`).toBe('42501')
    }
  })

  it('sp_registrar_ajuste_inventario: rechazo con solo consignaciones.editar; pasa con inventario.editar', async () => {
    const fixture = await createTenantWithUser('rlsp_m4_ajuste')
    await habilitarPaqueteConsignacion(fixture.tenantId, fixture.serviceRole)
    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatAjuste'), talles: ['U'] })
      .select('id_categoria')
      .single()
    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdAjuste') })
      .select('id_producto')
      .single()
    const { data: item } = await fixture.serviceRole
      .from('item_producto')
      .insert({
        id_tenant: fixture.tenantId,
        id_producto: prod!.id_producto,
        estado_item: 'disponible',
        tipo_ingreso: 'compra',
        qr_code: randomUUID(),
      })
      .select('id_item')
      .single()
    expect(item?.id_item).toBeDefined()

    const client = await signInAs(fixture)

    // 1. Rechazo con solo consignaciones.editar
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { consignaciones: ['editar', 'ver'], inventario: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errCons } = await client.rpc('sp_registrar_ajuste_inventario', {
      p_id_item: item!.id_item,
      p_cantidad_sistema: 1,
      p_cantidad_contada: 1,
      p_observaciones: 'ajuste test rechazo',
    })
    expect(errCons?.message).toContain('no-permission')
    expect(errCons?.code).toBe('42501')

    // 2. Aceptación con inventario.editar
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { inventario: ['editar', 'ver'], consignaciones: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: movId, error: errInv } = await client.rpc('sp_registrar_ajuste_inventario', {
      p_id_item: item!.id_item,
      p_cantidad_sistema: 1,
      p_cantidad_contada: 1,
      p_observaciones: 'ajuste test ok',
    })
    expect(errInv).toBeNull()
    expect(movId).toBeDefined()
  })

  it('sp_confirmar_consignacion: pasa con solo consignaciones.editar (cubre sp_confirmar_salida_item y sp_cerrar_consignacion)', async () => {
    const fixture = await createTenantWithUser('rlsp_m4_conf_cons')
    await habilitarPaqueteConsignacion(fixture.tenantId, fixture.serviceRole)
    const { data: prov } = await fixture.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('ProvConf') })
      .select('id_proveedor')
      .single()
    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatConf'), talles: ['U'] })
      .select('id_categoria')
      .single()
    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdConf') })
      .select('id_producto')
      .single()
    const { data: ing } = await fixture.serviceRole
      .from('ingreso_mercaderia')
      .insert({
        id_tenant: fixture.tenantId,
        id_proveedor: prov!.id_proveedor,
        tipo_ingreso: 'consignacion',
        confirmado: true,
      })
      .select('id_ingreso')
      .single()
    const { data: item } = await fixture.serviceRole
      .from('item_producto')
      .insert({
        id_tenant: fixture.tenantId,
        id_producto: prod!.id_producto,
        id_ingreso: ing!.id_ingreso,
        estado_item: 'disponible',
        tipo_ingreso: 'consignacion',
        qr_code: randomUUID(),
      })
      .select('id_item')
      .single()

    const { data: cons } = await fixture.serviceRole
      .from('consignacion')
      .insert({
        id_tenant: fixture.tenantId,
        id_proveedor: prov!.id_proveedor,
        id_usuario_alta: fixture.userId,
        estado: 'activa',
      })
      .select('id_consignacion')
      .single()

    await fixture.serviceRole
      .from('consignacion_detalle')
      .insert({
        id_tenant: fixture.tenantId,
        id_consignacion: cons!.id_consignacion,
        id_item: item!.id_item,
        id_producto: prod!.id_producto,
        estado: 'pendiente',
      })

    const client = await signInAs(fixture)

    // Solo consignaciones.editar (sin consignaciones.crear, consignaciones.eliminar ni inventario.editar)
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { consignaciones: ['editar', 'ver'], inventario: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: confirmados, error: errConf } = await client.rpc('sp_confirmar_consignacion', {
      p_id_consignacion: cons!.id_consignacion,
    })
    expect(errConf).toBeNull()
    expect(confirmados).toBe(1)
  })

  it('sp_crear_consignacion_con_items: pasa con solo consignaciones.crear (cubre sp_agregar_item_consignacion)', async () => {
    const fixture = await createTenantWithUser('rlsp_m4_crear_cons')
    await habilitarPaqueteConsignacion(fixture.tenantId, fixture.serviceRole)
    const { data: prov } = await fixture.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('ProvCons') })
      .select('id_proveedor')
      .single()
    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatCons'), talles: ['U'] })
      .select('id_categoria')
      .single()
    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdCons') })
      .select('id_producto')
      .single()
    const { data: ing } = await fixture.serviceRole
      .from('ingreso_mercaderia')
      .insert({
        id_tenant: fixture.tenantId,
        id_proveedor: prov!.id_proveedor,
        tipo_ingreso: 'consignacion',
        confirmado: true,
      })
      .select('id_ingreso')
      .single()
    const { data: item } = await fixture.serviceRole
      .from('item_producto')
      .insert({
        id_tenant: fixture.tenantId,
        id_producto: prod!.id_producto,
        id_ingreso: ing!.id_ingreso,
        estado_item: 'disponible',
        tipo_ingreso: 'consignacion',
        qr_code: randomUUID(),
      })
      .select('id_item')
      .single()

    const client = await signInAs(fixture)

    // Solo consignaciones.crear (sin consignaciones.editar ni inventario.editar)
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { consignaciones: ['crear', 'ver'], inventario: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: consId, error: errCrear } = await client.rpc('sp_crear_consignacion_con_items', {
      p_id_proveedor: prov!.id_proveedor,
      p_observaciones: 'Lote test crear',
      p_items: [item!.id_item],
    })
    expect(errCrear).toBeNull()
    expect(consId).toBeDefined()
  })

  it('sp_eliminar_consignacion: pasa con solo consignaciones.eliminar (cubre sp_transicion_item_producto)', async () => {
    const fixture = await createTenantWithUser('rlsp_m4_elim_cons')
    await habilitarPaqueteConsignacion(fixture.tenantId, fixture.serviceRole)
    const { data: prov } = await fixture.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('ProvElim') })
      .select('id_proveedor')
      .single()
    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatElim'), talles: ['U'] })
      .select('id_categoria')
      .single()
    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdElim') })
      .select('id_producto')
      .single()
    const { data: ing } = await fixture.serviceRole
      .from('ingreso_mercaderia')
      .insert({
        id_tenant: fixture.tenantId,
        id_proveedor: prov!.id_proveedor,
        tipo_ingreso: 'consignacion',
        confirmado: true,
      })
      .select('id_ingreso')
      .single()
    const { data: item } = await fixture.serviceRole
      .from('item_producto')
      .insert({
        id_tenant: fixture.tenantId,
        id_producto: prod!.id_producto,
        id_ingreso: ing!.id_ingreso,
        estado_item: 'devuelto',
        tipo_ingreso: 'consignacion',
        qr_code: randomUUID(),
      })
      .select('id_item')
      .single()

    const { data: cons } = await fixture.serviceRole
      .from('consignacion')
      .insert({
        id_tenant: fixture.tenantId,
        id_proveedor: prov!.id_proveedor,
        id_usuario_alta: fixture.userId,
        estado: 'cerrada',
      })
      .select('id_consignacion')
      .single()

    await fixture.serviceRole
      .from('consignacion_detalle')
      .insert({
        id_tenant: fixture.tenantId,
        id_consignacion: cons!.id_consignacion,
        id_item: item!.id_item,
        id_producto: prod!.id_producto,
        estado: 'devuelto',
        fecha_devolucion: new Date().toISOString(),
      })

    const client = await signInAs(fixture)

    // Solo consignaciones.eliminar (sin inventario.editar ni consignaciones.editar)
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { consignaciones: ['eliminar', 'ver'], inventario: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: resElim, error: errElim } = await client.rpc('sp_eliminar_consignacion', {
      p_id_consignacion: cons!.id_consignacion,
    })
    expect(errElim).toBeNull()
    expect(resElim).toEqual({
      items_reestockeados: 1,
      detalles_borrados: 1,
    })
  })

  it('roles con permiso ejecutan exitosamente los sp de consignaciones y rendiciones', async () => {
    const fixture = await createTenantWithUser('rlsp_m4_permisos')
    await habilitarPaqueteConsignacion(fixture.tenantId, fixture.serviceRole)
    const { data: prov } = await fixture.serviceRole
      .from('proveedor')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('ProvM4') })
      .select('id_proveedor')
      .single()
    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatM4'), talles: ['U'] })
      .select('id_categoria')
      .single()
    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdM4') })
      .select('id_producto')
      .single()
    const { data: ing } = await fixture.serviceRole
      .from('ingreso_mercaderia')
      .insert({
        id_tenant: fixture.tenantId,
        id_proveedor: prov!.id_proveedor,
        tipo_ingreso: 'consignacion',
        confirmado: true,
      })
      .select('id_ingreso')
      .single()
    const { data: item1 } = await fixture.serviceRole
      .from('item_producto')
      .insert({
        id_tenant: fixture.tenantId,
        id_producto: prod!.id_producto,
        id_ingreso: ing!.id_ingreso,
        estado_item: 'disponible',
        tipo_ingreso: 'consignacion',
        qr_code: randomUUID(),
      })
      .select('id_item')
      .single()
    const { data: item2 } = await fixture.serviceRole
      .from('item_producto')
      .insert({
        id_tenant: fixture.tenantId,
        id_producto: prod!.id_producto,
        id_ingreso: ing!.id_ingreso,
        estado_item: 'disponible',
        tipo_ingreso: 'consignacion',
        qr_code: randomUUID(),
      })
      .select('id_item')
      .single()

    const { data: cons } = await fixture.serviceRole
      .from('consignacion')
      .insert({
        id_tenant: fixture.tenantId,
        id_proveedor: prov!.id_proveedor,
        id_usuario_alta: fixture.userId,
        estado: 'activa',
      })
      .select('id_consignacion')
      .single()

    const { data: det1 } = await fixture.serviceRole
      .from('consignacion_detalle')
      .insert({
        id_tenant: fixture.tenantId,
        id_consignacion: cons!.id_consignacion,
        id_item: item1!.id_item,
        id_producto: prod!.id_producto,
        estado: 'pendiente',
      })
      .select('id_consignacion_detalle')
      .single()

    const { data: det2 } = await fixture.serviceRole
      .from('consignacion_detalle')
      .insert({
        id_tenant: fixture.tenantId,
        id_consignacion: cons!.id_consignacion,
        id_item: item2!.id_item,
        id_producto: prod!.id_producto,
        estado: 'pendiente',
      })
      .select('id_consignacion_detalle')
      .single()

    const client = await signInAs(fixture)

    // 1. consignaciones.editar -> sp_cancelar_item_consignacion, sp_confirmar_salida_item, sp_editar_consignacion, sp_cerrar_consignacion
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { consignaciones: ['editar', 'ver'], rendiciones: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errCanc } = await client.rpc('sp_cancelar_item_consignacion', {
      p_id_detalle: det1!.id_consignacion_detalle,
      p_motivo: 'cancelar test',
    })
    expect(errCanc).toBeNull()

    const { error: errSalida } = await client.rpc('sp_confirmar_salida_item', {
      p_id_detalle: det2!.id_consignacion_detalle,
    })
    expect(errSalida).toBeNull()

    const { error: errEdit } = await client.rpc('sp_editar_consignacion', {
      p_id_consignacion: cons!.id_consignacion,
      p_observaciones: 'observaciones actualizadas',
    })
    expect(errEdit).toBeNull()

    const { error: errCerrar } = await client.rpc('sp_cerrar_consignacion', {
      p_id_consignacion: cons!.id_consignacion,
    })
    expect(errCerrar).toBeNull()

    // 2. Rendiciones: sp_excluir_detalle_rendicion, sp_reincluir_detalle_rendicion, sp_generar_rendicion, sp_marcar_rendicion_pagada
    const { data: vta } = await fixture.serviceRole
      .from('venta')
      .insert({
        id_tenant: fixture.tenantId,
        id_usuario: fixture.userId,
        estado_venta: 'registrada',
        fecha: new Date().toISOString(),
        total_venta: 1000,
        subtotal: 1000,
        descuento: 0,
        recargo: 0,
        monto_cobrado: 1000,
      })
      .select('id_venta')
      .single()

    const { data: detVta } = await fixture.serviceRole
      .from('detalle_venta')
      .insert({
        id_tenant: fixture.tenantId,
        id_venta: vta!.id_venta,
        id_producto: prod!.id_producto,
        id_proveedor: prov!.id_proveedor,
        cantidad: 1,
        precio_unitario: 1000,
        costo_snapshot: 600,
        monto_proveedor: 600,
        excluida_rendicion: false,
      })
      .select('id_detalle_venta')
      .single()

    // rendiciones.editar -> sp_excluir_detalle_rendicion y sp_reincluir_detalle_rendicion
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { rendiciones: ['editar', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errExcl } = await client.rpc('sp_excluir_detalle_rendicion', {
      p_id_detalle: detVta!.id_detalle_venta,
      p_motivo: 'test excluir',
    })
    expect(errExcl).toBeNull()

    const { error: errReinc } = await client.rpc('sp_reincluir_detalle_rendicion', {
      p_id_detalle: detVta!.id_detalle_venta,
    })
    expect(errReinc).toBeNull()

    // rendiciones.crear -> sp_generar_rendicion
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { rendiciones: ['crear', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: idRend, error: errGen } = await client.rpc('sp_generar_rendicion', {
      p_id_proveedor: prov!.id_proveedor,
      p_observaciones: 'Rendicion test',
    })
    expect(errGen).toBeNull()
    expect(idRend).toBeDefined()

    // rendiciones.editar -> sp_marcar_rendicion_pagada
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { rendiciones: ['editar', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errPago } = await client.rpc('sp_marcar_rendicion_pagada', {
      p_id_rendicion: idRend,
    })
    expect(errPago).toBeNull()
  })
})

async function habilitarPaqueteRevendedoras(tenantId: string, sr: TenantFixture['serviceRole']) {
  const { data: mod, error: modErr } = await sr
    .from('modulo')
    .select('id_modulo')
    .eq('codigo', 'revendedoras')
    .single()
  expect(modErr).toBeNull()
  const { error } = await sr
    .from('tenant_modulo')
    .upsert({ id_tenant: tenantId, id_modulo: mod!.id_modulo, habilitado: true })
  expect(error).toBeNull()
}

describe.skipIf(!hasTestDb)('Fase 5b-M5 - Chequeo de permisos en sp_* de Revendedoras (Gestión)', () => {
  it('un rol con solo revendedoras.ver recibe no-permission en los 19 sp', async () => {
    const fixture = await createTenantWithUser('rlsp_m5_ver')
    await habilitarPaqueteRevendedoras(fixture.tenantId, fixture.serviceRole)
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { revendedoras: ['ver'], inventario: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const llamadas: Array<{ sp: string; params: Record<string, unknown> }> = [
      {
        sp: 'sp_crear_revendedora',
        params: {
          p_nombre: 'Test',
          p_apellido: 'Rev',
        },
      },
      {
        sp: 'sp_crear_consignacion_revendedora_con_items',
        params: {
          p_id_revendedora: randomUUID(),
          p_items: [randomUUID()],
        },
      },
      {
        sp: 'sp_entregar_consignacion_revendedora',
        params: {
          p_id_revendedora: randomUUID(),
          p_items: [randomUUID()],
        },
      },
      {
        sp: 'sp_confirmar_consignacion_revendedora',
        params: {
          p_id_consignacion_revendedora: randomUUID(),
        },
      },
      {
        sp: 'sp_confirmar_declaracion_venta',
        params: {
          p_id_declaracion: randomUUID(),
        },
      },
      {
        sp: 'sp_rechazar_declaracion_venta',
        params: {
          p_id_declaracion: randomUUID(),
          p_motivo: 'rechazo test',
        },
      },
      {
        sp: 'sp_editar_revendedora',
        params: {
          p_id: randomUUID(),
          p_nombre: 'Test',
          p_apellido: 'Rev',
        },
      },
      {
        sp: 'sp_crear_regla_comision',
        params: {
          p_ambito: 'general',
          p_nombre: 'Regla test',
          p_escalas: [{ objetivo_desde: 0, porcentaje: 10 }],
        },
      },
      {
        sp: 'sp_terminar_regla_comision',
        params: {
          p_id_regla: randomUUID(),
        },
      },
      {
        sp: 'sp_editar_consignacion_revendedora',
        params: {
          p_id_consignacion_revendedora: randomUUID(),
        },
      },
      {
        sp: 'sp_registrar_devolucion_revendedora',
        params: {
          p_id_consignacion_revendedora: randomUUID(),
          p_items: [randomUUID()],
        },
      },
      {
        sp: 'sp_devolver_items_revendedora',
        params: {
          p_id_revendedora: randomUUID(),
          p_items: [randomUUID()],
        },
      },
      {
        sp: 'sp_cerrar_consignacion_revendedora',
        params: {
          p_id_consignacion_revendedora: randomUUID(),
        },
      },
      {
        sp: 'sp_eliminar_consignacion_revendedora',
        params: {
          p_id_consignacion_revendedora: randomUUID(),
        },
      },
      {
        sp: 'sp_baja_revendedora',
        params: {
          p_id: randomUUID(),
        },
      },
      {
        sp: 'sp_generar_liquidacion',
        params: {
          p_id_revendedora: randomUUID(),
          p_desde: '2026-01-01',
          p_hasta: '2026-01-31',
        },
      },
      {
        sp: 'sp_excluir_detalle_liquidacion',
        params: {
          p_id_detalle: randomUUID(),
        },
      },
      {
        sp: 'sp_reincluir_detalle_liquidacion',
        params: {
          p_id_detalle: randomUUID(),
        },
      },
      {
        sp: 'sp_marcar_liquidacion_pagada',
        params: {
          p_id_liquidacion: randomUUID(),
          p_id_cuenta: randomUUID(),
          p_monto: 100,
        },
      },
    ]

    for (const { sp, params } of llamadas) {
      const { error } = await client.rpc(sp, params)
      expect(error, `SP ${sp} debio fallar con no-permission`).not.toBeNull()
      expect(error?.message, `SP ${sp} mensaje`).toContain('no-permission')
      expect(error?.code, `SP ${sp} code`).toBe('42501')
    }
  })

  it('sp_baja_revendedora: pasa con solo eliminar, pasa con solo crear, falla sin ninguno', async () => {
    const fixture = await createTenantWithUser('rlsp_m5_baja')
    await habilitarPaqueteRevendedoras(fixture.tenantId, fixture.serviceRole)

    // Crear 2 revendedoras activas vía serviceRole
    const { data: rev1 } = await fixture.serviceRole
      .from('revendedora')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'RevBaja1',
        apellido: 'Test',
        activo: true,
      })
      .select('id_revendedora')
      .single()
    expect(rev1?.id_revendedora).toBeDefined()

    const { data: rev2 } = await fixture.serviceRole
      .from('revendedora')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'RevBaja2',
        apellido: 'Test',
        activo: true,
      })
      .select('id_revendedora')
      .single()
    expect(rev2?.id_revendedora).toBeDefined()

    const client = await signInAs(fixture)

    // 1. Falla sin ninguno (solo revendedoras.ver)
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { revendedoras: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errSinPermiso } = await client.rpc('sp_baja_revendedora', {
      p_id: rev1!.id_revendedora,
    })
    expect(errSinPermiso?.message).toContain('no-permission')
    expect(errSinPermiso?.code).toBe('42501')

    // 2. Pasa con solo revendedoras.eliminar
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { revendedoras: ['eliminar', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errEliminar } = await client.rpc('sp_baja_revendedora', {
      p_id: rev1!.id_revendedora,
    })
    expect(errEliminar).toBeNull()

    // 3. Pasa con solo revendedoras.crear
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { revendedoras: ['crear', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    const { error: errCrear } = await client.rpc('sp_baja_revendedora', {
      p_id: rev2!.id_revendedora,
    })
    expect(errCrear).toBeNull()
  })

  it('sp_entregar_consignacion_revendedora: pasa con solo revendedoras.crear (cubre sp_crear_consignacion_revendedora_con_items y sp_confirmar_consignacion_revendedora)', async () => {
    const fixture = await createTenantWithUser('rlsp_m5_entregar')
    await habilitarPaqueteRevendedoras(fixture.tenantId, fixture.serviceRole)

    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatEntregar'), talles: ['U'] })
      .select('id_categoria')
      .single()
    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdEntregar') })
      .select('id_producto')
      .single()
    const { data: item } = await fixture.serviceRole
      .from('item_producto')
      .insert({
        id_tenant: fixture.tenantId,
        id_producto: prod!.id_producto,
        estado_item: 'disponible',
        tipo_ingreso: 'compra',
        qr_code: randomUUID(),
      })
      .select('id_item')
      .single()

    const { data: rev } = await fixture.serviceRole
      .from('revendedora')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'RevEntregar',
        apellido: 'Test',
        activo: true,
      })
      .select('id_revendedora')
      .single()

    const client = await signInAs(fixture)

    // Solo revendedoras.crear (sin revendedoras.editar ni revendedoras.eliminar)
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { revendedoras: ['crear', 'ver'], inventario: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: consId, error: errEntregar } = await client.rpc('sp_entregar_consignacion_revendedora', {
      p_id_revendedora: rev!.id_revendedora,
      p_items: [item!.id_item],
    })
    expect(errEntregar).toBeNull()
    expect(consId).toBeDefined()
  })

  it('sp_devolver_items_revendedora: pasa con solo revendedoras.editar (cubre sp_registrar_devolucion_revendedora)', async () => {
    const fixture = await createTenantWithUser('rlsp_m5_devolver')
    await habilitarPaqueteRevendedoras(fixture.tenantId, fixture.serviceRole)

    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatDevolver'), talles: ['U'] })
      .select('id_categoria')
      .single()
    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdDevolver') })
      .select('id_producto')
      .single()
    const { data: item } = await fixture.serviceRole
      .from('item_producto')
      .insert({
        id_tenant: fixture.tenantId,
        id_producto: prod!.id_producto,
        estado_item: 'en_revendedora',
        tipo_ingreso: 'compra',
        qr_code: randomUUID(),
      })
      .select('id_item')
      .single()

    const { data: rev } = await fixture.serviceRole
      .from('revendedora')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'RevDevolver',
        apellido: 'Test',
        activo: true,
      })
      .select('id_revendedora')
      .single()

    const { data: cons } = await fixture.serviceRole
      .from('consignacion_revendedora')
      .insert({
        id_tenant: fixture.tenantId,
        id_revendedora: rev!.id_revendedora,
        id_usuario_alta: fixture.userId,
        estado: 'abierta',
        confirmada: true,
      })
      .select('id_consignacion_revendedora')
      .single()

    await fixture.serviceRole
      .from('consignacion_revendedora_detalle')
      .insert({
        id_tenant: fixture.tenantId,
        id_consignacion_revendedora: cons!.id_consignacion_revendedora,
        id_item: item!.id_item,
        id_producto: prod!.id_producto,
        estado_detalle: 'en_poder',
      })

    const client = await signInAs(fixture)

    // Solo revendedoras.editar (sin revendedoras.crear ni revendedoras.eliminar)
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { revendedoras: ['editar', 'ver'], inventario: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: devueltos, error: errDev } = await client.rpc('sp_devolver_items_revendedora', {
      p_id_revendedora: rev!.id_revendedora,
      p_items: [item!.id_item],
      p_estado_destino: 'disponible',
    })
    expect(errDev).toBeNull()
    expect(devueltos).toBe(1)
  })

  it('sp_confirmar_declaracion_venta: pasa con solo revendedoras.crear (cubre llamada interna a sp_registrar_venta)', async () => {
    const fixture = await createTenantWithUser('rlsp_m5_conf_dec')
    await habilitarPaqueteRevendedoras(fixture.tenantId, fixture.serviceRole)

    const { data: cat } = await fixture.serviceRole
      .from('categoria')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatDec'), talles: ['U'] })
      .select('id_categoria')
      .single()
    const { data: prod } = await fixture.serviceRole
      .from('producto')
      .insert({ id_tenant: fixture.tenantId, id_categoria: cat!.id_categoria, nombre: withScopedTenant('ProdDec') })
      .select('id_producto')
      .single()
    const { data: item } = await fixture.serviceRole
      .from('item_producto')
      .insert({
        id_tenant: fixture.tenantId,
        id_producto: prod!.id_producto,
        estado_item: 'en_revendedora',
        tipo_ingreso: 'compra',
        qr_code: randomUUID(),
      })
      .select('id_item')
      .single()

    const { data: rev } = await fixture.serviceRole
      .from('revendedora')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'RevDec',
        apellido: 'Test',
        activo: true,
      })
      .select('id_revendedora')
      .single()

    const { data: cons } = await fixture.serviceRole
      .from('consignacion_revendedora')
      .insert({
        id_tenant: fixture.tenantId,
        id_revendedora: rev!.id_revendedora,
        id_usuario_alta: fixture.userId,
        estado: 'abierta',
        confirmada: true,
      })
      .select('id_consignacion_revendedora')
      .single()

    await fixture.serviceRole
      .from('consignacion_revendedora_detalle')
      .insert({
        id_tenant: fixture.tenantId,
        id_consignacion_revendedora: cons!.id_consignacion_revendedora,
        id_item: item!.id_item,
        id_producto: prod!.id_producto,
        estado_detalle: 'en_poder',
      })

    const { data: dec } = await fixture.serviceRole
      .from('declaracion_venta_revendedora')
      .insert({
        id_tenant: fixture.tenantId,
        id_revendedora: rev!.id_revendedora,
        id_item: item!.id_item,
        estado: 'pendiente',
      })
      .select('id_declaracion')
      .single()

    const client = await signInAs(fixture)

    // Solo revendedoras.crear (sin ventas.crear)
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { revendedoras: ['crear', 'ver'], ventas: ['ver'] } })
      .eq('id_rol', fixture.rolId)

    const { data: idVenta, error: errConfDec } = await client.rpc('sp_confirmar_declaracion_venta', {
      p_id_declaracion: dec!.id_declaracion,
    })
    expect(errConfDec).toBeNull()
    expect(idVenta).toBeDefined()
  })
})

describe.skipIf(!hasTestDb)('Fase 5b-M6 - Chequeo de permisos en sp_* de Gastos y Administración', () => {
  it('un rol con solo permisos de lectura recibe no-permission en los 11 sp', async () => {
    const fixture = await createTenantWithUser('rlsp_m6_ver')
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['ver'], administracion: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const llamadas: Array<{ sp: string; params: Record<string, unknown> }> = [
      {
        sp: 'sp_registrar_gasto',
        params: {
          p_id_categoria_gasto: randomUUID(),
          p_monto: 100,
          p_descripcion: 'test',
        },
      },
      {
        sp: 'sp_eliminar_gasto',
        params: {
          p_id_gasto: randomUUID(),
        },
      },
      {
        sp: 'sp_set_presupuesto_categoria_gasto',
        params: {
          p_id_categoria: randomUUID(),
          p_presupuesto: 500,
        },
      },
      {
        sp: 'sp_create_rol',
        params: {
          p_nombre: 'Rol Test',
          p_permisos: {},
        },
      },
      {
        sp: 'sp_toggle_usuario_activo',
        params: {
          p_id_usuario: randomUUID(),
          p_estado: 'activo',
        },
      },
      {
        sp: 'sp_update_usuario',
        params: {
          p_id_usuario: randomUUID(),
          p_nombre_completo: 'Test',
          p_id_rol: randomUUID(),
        },
      },
      {
        sp: 'sp_update_rol_permisos',
        params: {
          p_id_rol: randomUUID(),
          p_nombre: 'Rol Test',
          p_permisos: {},
        },
      },
      {
        sp: 'sp_set_configuracion_qr_lado_mm',
        params: {
          p_lado_mm: 35,
        },
      },
      {
        sp: 'sp_set_configuracion_impresora',
        params: {
          p_ancho_mm: 50,
          p_alto_mm: 30,
        },
      },
      {
        sp: 'sp_set_tenant_logo',
        params: {
          p_logo_url: null,
        },
      },
      {
        sp: 'sp_delete_rol',
        params: {
          p_id_rol: randomUUID(),
        },
      },
    ]

    for (const { sp, params } of llamadas) {
      const { error } = await client.rpc(sp, params)
      expect(error, `SP ${sp} debio fallar con no-permission`).not.toBeNull()
      expect(error?.message, `SP ${sp} mensaje`).toContain('no-permission')
      expect(error?.code, `SP ${sp} code`).toBe('42501')
    }
  })

  it('gastos.crear: sp_registrar_gasto pasa con rol que solo tiene gastos.crear', async () => {
    const fixture = await createTenantWithUser('rlsp_m6_g_crear')

    const { data: cat } = await fixture.serviceRole
      .from('categoria_gasto')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatGastoCrear') })
      .select('id_categoria_gasto')
      .single()
    expect(cat?.id_categoria_gasto).toBeDefined()

    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['crear', 'ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const { data: idGasto, error } = await client.rpc('sp_registrar_gasto', {
      p_id_categoria_gasto: cat!.id_categoria_gasto,
      p_monto: 250,
      p_descripcion: 'Gasto test',
    })
    expect(error).toBeNull()
    expect(idGasto).toBeDefined()
  })

  it('gastos.editar: sp_set_presupuesto_categoria_gasto pasa con rol que solo tiene gastos.editar', async () => {
    const fixture = await createTenantWithUser('rlsp_m6_g_editar')

    const { data: cat } = await fixture.serviceRole
      .from('categoria_gasto')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatGastoEditar') })
      .select('id_categoria_gasto')
      .single()
    expect(cat?.id_categoria_gasto).toBeDefined()

    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { gastos: ['editar', 'ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const { error } = await client.rpc('sp_set_presupuesto_categoria_gasto', {
      p_id_categoria: cat!.id_categoria_gasto,
      p_presupuesto: 1500,
    })
    expect(error).toBeNull()
  })

  it('administracion.crear: sp_create_rol pasa con rol que solo tiene administracion.crear', async () => {
    const fixture = await createTenantWithUser('rlsp_m6_a_crear')

    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { administracion: ['crear', 'ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const { data: idRol, error } = await client.rpc('sp_create_rol', {
      p_nombre: withScopedTenant('RolCrear'),
      p_permisos: {},
    })
    expect(error).toBeNull()
    expect(idRol).toBeDefined()
  })

  it('administracion.editar: sp_set_configuracion_qr_lado_mm pasa con rol que solo tiene administracion.editar', async () => {
    const fixture = await createTenantWithUser('rlsp_m6_a_editar')

    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { administracion: ['editar', 'ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const { data, error } = await client.rpc('sp_set_configuracion_qr_lado_mm', {
      p_lado_mm: 45,
    })
    expect(error).toBeNull()
    expect(data).toBe(45)
  })

  it('administracion.eliminar: sp_delete_rol pasa con rol que solo tiene administracion.eliminar', async () => {
    const fixture = await createTenantWithUser('rlsp_m6_a_eliminar')

    const { data: rol } = await fixture.serviceRole
      .from('rol')
      .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('RolEliminar') })
      .select('id_rol')
      .single()
    expect(rol?.id_rol).toBeDefined()

    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { administracion: ['eliminar', 'ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const { error } = await client.rpc('sp_delete_rol', {
      p_id_rol: rol!.id_rol,
    })
    expect(error).toBeNull()
  })

  it('sp_change_password_user: pasa sobre el propio id sin permisos de administracion; falla sobre otro id aun con administracion.editar', async () => {
    const fixture = await createTenantWithUser('rlsp_m6_pwd')

    // 1. Rol con solo administracion.ver (sin permisos de administracion de escritura)
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { administracion: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    // Pasa sobre su propio id
    const { error: errPropio } = await client.rpc('sp_change_password_user', {
      p_id_usuario: fixture.userId,
    })
    expect(errPropio).toBeNull()

    // 2. Rol con administracion.editar
    await fixture.serviceRole
      .from('rol')
      .update({ permisos: { administracion: ['editar', 'ver'] } })
      .eq('id_rol', fixture.rolId)

    // Falla con no-permission sobre el id de otro usuario
    const otroUsuarioId = randomUUID()
    const { error: errOtro } = await client.rpc('sp_change_password_user', {
      p_id_usuario: otroUsuarioId,
    })
    expect(errOtro).not.toBeNull()
    expect(errOtro?.message).toContain('no-permission')
    expect(errOtro?.code).toBe('42501')
  })
})

describe.skipIf(!hasTestDb)('Fase 5b-M7 - Chequeo de permisos en sp_* de Ayuda', () => {
  it('un rol sin ayuda.consultar recibe no-permission en los 2 sp', async () => {
    const fixture = await createTenantWithUser('rlsp_m7_sin_permiso')
    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { ventas: ['ver'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const llamadas: Array<{ sp: string; params: Record<string, unknown> }> = [
      {
        sp: 'sp_registrar_consulta_ayuda',
        params: {
          p_id_conversacion: randomUUID(),
          p_pregunta: '¿Cómo cargo una venta?',
          p_respuesta: 'Respuesta',
          p_entrada_id: 'ventas-nueva',
          p_resultado: 'respondida',
        },
      },
      {
        sp: 'sp_calificar_consulta_ayuda',
        params: {
          p_id: randomUUID(),
          p_util: true,
        },
      },
    ]

    for (const { sp, params } of llamadas) {
      const { error } = await client.rpc(sp, params)
      expect(error, `SP ${sp} debio fallar con no-permission`).not.toBeNull()
      expect(error?.message, `SP ${sp} mensaje`).toContain('no-permission')
      expect(error?.code, `SP ${sp} code`).toBe('42501')
    }
  })

  it('un rol con solo ayuda.consultar pasa en los 2 sp', async () => {
    const fixture = await createTenantWithUser('rlsp_m7_con_permiso')

    const { data: mod } = await fixture.serviceRole
      .from('modulo')
      .select('id_modulo')
      .eq('codigo', 'ayuda')
      .single()
    expect(mod?.id_modulo).toBeDefined()

    const { error: errMod } = await fixture.serviceRole
      .from('tenant_modulo')
      .upsert({ id_tenant: fixture.tenantId, id_modulo: mod!.id_modulo, habilitado: true })
    expect(errMod).toBeNull()

    const { error: errRol } = await fixture.serviceRole
      .from('rol')
      .update({ permisos: { ayuda: ['consultar'] } })
      .eq('id_rol', fixture.rolId)
    expect(errRol).toBeNull()

    const client = await signInAs(fixture)

    const { data: idConsulta, error: errReg } = await client.rpc('sp_registrar_consulta_ayuda', {
      p_id_conversacion: randomUUID(),
      p_pregunta: '¿Cómo cargo una venta?',
      p_respuesta: 'Hacé clic en...',
      p_entrada_id: 'ventas-nueva',
      p_resultado: 'respondida',
    })
    expect(errReg).toBeNull()
    expect(idConsulta).toBeDefined()

    const { error: errCalif } = await client.rpc('sp_calificar_consulta_ayuda', {
      p_id: idConsulta,
      p_util: true,
    })
    expect(errCalif).toBeNull()
  })
})
