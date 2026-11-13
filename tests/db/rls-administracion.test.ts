import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CATALOGO_PERMISOS } from '@/lib/types/administracion'
import {
  createTenantWithUser,
  hasTestDb,
  signInAs,
  withScopedTenant,
} from './_helpers'

describe.skipIf(!hasTestDb)('RLS restrictivas en rol y usuario (00159)', () => {
  it('JWT con tenant_id y sin permisos: update/insert/delete en rol bloqueados', { timeout: 20_000 }, async () => {
    const fixture = await createTenantWithUser('rls_admin_sin_perm')

    // Crear un rol sin permisos
    const { data: rolSinPermiso, error: errRol } = await fixture.serviceRole
      .from('rol')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'Sin Permisos',
        permisos: {},
      })
      .select('id_rol')
      .single()
    expect(errRol).toBeNull()

    // Asignar ese rol sin permisos al usuario
    const { error: errUsr } = await fixture.serviceRole
      .from('usuario')
      .update({ id_rol: rolSinPermiso!.id_rol })
      .eq('id_usuario', fixture.userId)
    expect(errUsr).toBeNull()

    const client = await signInAs(fixture)

    // 1. UPDATE en rol intentando darse permisos de Administrador
    const { data: updateData, error: updateError } = await client
      .from('rol')
      .update({ permisos: CATALOGO_PERMISOS })
      .eq('id_rol', rolSinPermiso!.id_rol)
      .select()

    // En PostgREST, RLS restrictiva que falla check/using devuelve 0 filas o código 42501
    if (updateError) {
      expect(['42501', 'PGRST116']).toContain(updateError.code)
    } else {
      expect(updateData).toEqual([])
    }

    // Verificar en BD que los permisos NO cambiaron
    const { data: rolDb } = await fixture.serviceRole
      .from('rol')
      .select('permisos')
      .eq('id_rol', rolSinPermiso!.id_rol)
      .single()
    expect(rolDb?.permisos).toEqual({})

    // 2. INSERT en rol bloqueado
    const { error: insertError } = await client.from('rol').insert({
      id_tenant: fixture.tenantId,
      nombre: 'Rol Malicioso',
      permisos: CATALOGO_PERMISOS,
    })
    expect(insertError).not.toBeNull()
    expect(insertError?.code).toBe('42501')

    // 3. DELETE en rol bloqueado (0 filas o 42501)
    const { data: deleteData, error: deleteError } = await client
      .from('rol')
      .delete()
      .eq('id_rol', rolSinPermiso!.id_rol)
      .select()

    if (deleteError) {
      expect(deleteError.code).toBe('42501')
    } else {
      expect(deleteData).toEqual([])
    }
  })

  it('JWT con tenant_id y sin permisos: update del propio usuario.id_rol bloqueado', { timeout: 20_000 }, async () => {
    const fixture = await createTenantWithUser('rls_admin_escalada_usr')

    // Rol administrador original y un nuevo rol 'Vendedor' sin administracion
    const { data: rolVendedor, error: errRol } = await fixture.serviceRole
      .from('rol')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'Vendedor',
        permisos: { ventas: ['ver', 'crear'] },
      })
      .select('id_rol')
      .single()
    expect(errRol).toBeNull()

    // Asignar el rol Vendedor al usuario
    await fixture.serviceRole
      .from('usuario')
      .update({ id_rol: rolVendedor!.id_rol })
      .eq('id_usuario', fixture.userId)

    const client = await signInAs(fixture)

    // Intento de escalada: cambiarse a sí mismo el id_rol al rol Administrador (fixture.rolId)
    const { data: updateData, error: updateError } = await client
      .from('usuario')
      .update({ id_rol: fixture.rolId })
      .eq('id_usuario', fixture.userId)
      .select()

    if (updateError) {
      expect(['42501', 'PGRST116']).toContain(updateError.code)
    } else {
      expect(updateData).toEqual([])
    }

    // Verificar en BD que el rol sigue siendo Vendedor
    const { data: usuarioDb } = await fixture.serviceRole
      .from('usuario')
      .select('id_rol')
      .eq('id_usuario', fixture.userId)
      .single()
    expect(usuarioDb?.id_rol).toBe(rolVendedor!.id_rol)
  })

  it('JWT con tenant_id y sin permisos de administracion: select de rol y usuario ajenos devuelve 0 filas', { timeout: 20_000 }, async () => {
    const fixture = await createTenantWithUser('rls_admin_select_ajeno')

    // Crear un segundo usuario en el mismo tenant
    const segundoEmail = `${withScopedTenant('segundo_usr')}@example.com`
    const { data: authSegundo } = await fixture.serviceRole.auth.admin.createUser({
      email: segundoEmail,
      password: 'Fixture-Password-1!',
      email_confirm: true,
    })

    const { data: rolSegundo } = await fixture.serviceRole
      .from('rol')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'Otro Rol',
        permisos: { inventario: ['ver'] },
      })
      .select('id_rol')
      .single()

    await fixture.serviceRole.from('usuario').insert({
      id_usuario: authSegundo!.user!.id,
      id_tenant: fixture.tenantId,
      email: segundoEmail,
      nombre_completo: 'Segundo Usuario',
      id_rol: rolSegundo!.id_rol,
    })

    // El primer usuario solo tiene rol sin administracion.ver
    const { data: rolEmpleado } = await fixture.serviceRole
      .from('rol')
      .insert({
        id_tenant: fixture.tenantId,
        nombre: 'Empleado',
        permisos: { ventas: ['ver'] },
      })
      .select('id_rol')
      .single()

    await fixture.serviceRole
      .from('usuario')
      .update({ id_rol: rolEmpleado!.id_rol })
      .eq('id_usuario', fixture.userId)

    const client = await signInAs(fixture)

    // SELECT en usuario: debe ver solo su propia fila
    const { data: usuarios, error: errUsuarios } = await client
      .from('usuario')
      .select('id_usuario, email')

    expect(errUsuarios).toBeNull()
    expect(usuarios?.map((u) => u.id_usuario)).toEqual([fixture.userId])
    expect(usuarios?.map((u) => u.id_usuario)).not.toContain(authSegundo!.user!.id)

    // SELECT en rol: debe ver solo su propio rol
    const { data: roles, error: errRoles } = await client
      .from('rol')
      .select('id_rol, nombre')

    expect(errRoles).toBeNull()
    expect(roles?.map((r) => r.id_rol)).toEqual([rolEmpleado!.id_rol])
    expect(roles?.map((r) => r.id_rol)).not.toContain(rolSegundo!.id_rol)
    expect(roles?.map((r) => r.id_rol)).not.toContain(fixture.rolId)
  })

  it('Rol con permiso de administracion: crea, edita y lista roles y usuarios normalmente', { timeout: 20_000 }, async () => {
    const fixture = await createTenantWithUser('rls_admin_con_permisos')

    // Crear un segundo usuario en el mismo tenant para probar edición de usuario sin despojar al admin
    const otroEmail = `${withScopedTenant('otro_admin_sub')}@example.com`
    const { data: authOtro } = await fixture.serviceRole.auth.admin.createUser({
      email: otroEmail,
      password: 'Fixture-Password-1!',
      email_confirm: true,
    })

    await fixture.serviceRole.from('usuario').insert({
      id_usuario: authOtro!.user!.id,
      id_tenant: fixture.tenantId,
      email: otroEmail,
      nombre_completo: 'Otro Empleado',
      id_rol: fixture.rolId,
    })

    // El fixture viene con permisos completos de administrador
    const client = await signInAs(fixture)

    // 1. SELECT lista todos los roles del tenant (al menos el Administrador)
    const { data: roles, error: errRoles } = await client.from('rol').select('id_rol, nombre')
    expect(errRoles).toBeNull()
    expect((roles ?? []).length).toBeGreaterThanOrEqual(1)

    // 2. SELECT lista todos los usuarios del tenant (al menos los 2 creados)
    const { data: usuarios, error: errUsuarios } = await client.from('usuario').select('id_usuario')
    expect(errUsuarios).toBeNull()
    expect((usuarios ?? []).length).toBeGreaterThanOrEqual(2)

    // 3. Crear rol mediante sp_create_rol (INVOKER)
    const { data: nuevoRolId, error: errCreateRol } = await client.rpc('sp_create_rol', {
      p_nombre: 'Rol Desde Test Admin',
      p_permisos: { gastos: ['ver'] },
    })
    expect(errCreateRol).toBeNull()
    expect(nuevoRolId).toBeDefined()

    // 4. Editar rol mediante sp_update_rol_permisos (INVOKER)
    const { error: errUpdateRol } = await client.rpc('sp_update_rol_permisos', {
      p_id_rol: nuevoRolId,
      p_nombre: 'Rol Editado Admin',
      p_permisos: { gastos: ['ver', 'crear'] },
    })
    expect(errUpdateRol).toBeNull()

    // 5. Editar otro usuario mediante sp_update_usuario (INVOKER)
    const { error: errUpdateUsr } = await client.rpc('sp_update_usuario', {
      p_id_usuario: authOtro!.user!.id,
      p_nombre_completo: 'Empleado Renombrado',
      p_id_rol: nuevoRolId,
    })
    expect(errUpdateUsr).toBeNull()

    // 6. Volver a cambiar el rol del otro usuario antes de eliminar nuevoRolId
    const { error: errReasignar } = await client.rpc('sp_update_usuario', {
      p_id_usuario: authOtro!.user!.id,
      p_nombre_completo: 'Empleado Renombrado',
      p_id_rol: fixture.rolId,
    })
    expect(errReasignar).toBeNull()

    // 7. Eliminar rol mediante sp_delete_rol (INVOKER)
    const { error: errDeleteRol } = await client.rpc('sp_delete_rol', {
      p_id_rol: nuevoRolId,
    })
    expect(errDeleteRol).toBeNull()
  })
})
