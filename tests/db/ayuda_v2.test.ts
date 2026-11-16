import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, hasTestDb, signInAs, withScopedTenant } from './_helpers'

describe.skipIf(!hasTestDb)('Módulo ayuda v2 en DB — REQ-AYUDA-V2-11/12 y spec §5', () => {
  const serviceRole = createServiceRoleTestClient()

  async function getModuloAyuda() {
    const { data, error } = await serviceRole
      .from('modulo')
      .select('id_modulo, codigo')
      .eq('codigo', 'ayuda')
      .single()
    expect(error, 'lookup modulo ayuda').toBeNull()
    return data!
  }

  async function habilitarAyuda(tenantId: string) {
    const mod = await getModuloAyuda()
    const { error } = await serviceRole
      .from('tenant_modulo')
      .upsert({ id_tenant: tenantId, id_modulo: mod.id_modulo, habilitado: true })
    expect(error, 'habilitar ayuda').toBeNull()
  }

  async function createUserInTenant(tenantId: string, rolId: string, prefix: string) {
    const email = `${withScopedTenant(prefix)}@example.com`
    const password = 'Fixture-Password-1!'
    const { data: authUser, error: authError } = await serviceRole.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError || !authUser?.user) throw new Error(`auth user creation failed: ${authError?.message}`)

    const { error: userError } = await serviceRole.from('usuario').insert({
      id_usuario: authUser.user.id,
      id_tenant: tenantId,
      email,
      nombre_completo: `Fixture User ${prefix}`,
      id_rol: rolId,
    })
    if (userError) throw new Error(`usuario insert failed: ${userError.message}`)

    return { email, password, userId: authUser.user.id }
  }

  describe('REQ-AYUDA-V2-11 — Control de cuota con SECURITY INVOKER y separación de tablas', () => {
    it('REQ-AYUDA-V2-11 Feliz: sp_reservar_cuota_ayuda incrementa atómicamente el contador en 1', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r11-feliz')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error: errReserva } = await auth.rpc('sp_reservar_cuota_ayuda')
      expect(errReserva).toBeNull()

      const { data: cuotas, error: errSelect } = await auth
        .from('cuota_ayuda_diaria')
        .select('*')
        .eq('id_tenant', tenant.tenantId)

      expect(errSelect).toBeNull()
      expect(cuotas).toHaveLength(1)
      expect(cuotas![0].consultas_realizadas).toBe(1)
    })

    it('REQ-AYUDA-V2-11 N1: consulta lanzada cuando consultas_realizadas = limite_diario arroja cuota-excedida', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r11-n1')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      // Fijar límite diario en 2
      await serviceRole
        .from('limite_ayuda_tenant')
        .upsert({ id_tenant: tenant.tenantId, limite_diario: 2 })

      // Reservar 2 veces con éxito
      const { error: err1 } = await auth.rpc('sp_reservar_cuota_ayuda')
      expect(err1).toBeNull()
      const { error: err2 } = await auth.rpc('sp_reservar_cuota_ayuda')
      expect(err2).toBeNull()

      // Tercera reserva debe fallar por cuota-excedida
      const { error: err3 } = await auth.rpc('sp_reservar_cuota_ayuda')
      expect(err3).not.toBeNull()
      expect(err3?.message).toMatch(/cuota-excedida/)
    })

    it('REQ-AYUDA-V2-11 N2: tenant configurado con limite_diario = 0 arroja cuota-excedida antes del insert', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r11-n2')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      await serviceRole
        .from('limite_ayuda_tenant')
        .upsert({ id_tenant: tenant.tenantId, limite_diario: 0 })

      const { error: errReserva } = await auth.rpc('sp_reservar_cuota_ayuda')
      expect(errReserva).not.toBeNull()
      expect(errReserva?.message).toMatch(/cuota-excedida/)

      // No se debió insertar fila en cuota_ayuda_diaria
      const { data: filas } = await serviceRole
        .from('cuota_ayuda_diaria')
        .select('*')
        .eq('id_tenant', tenant.tenantId)

      expect(filas).toEqual([])
    })

    it('REQ-AYUDA-V2-11 N3: intento directo de INSERT en cuota_ayuda_diaria con contador alto (99) lanza cuota-insert-invalido', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r11-n3')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error } = await auth.from('cuota_ayuda_diaria').insert({
        id_tenant: tenant.tenantId,
        fecha: '2026-11-16',
        consultas_realizadas: 99,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/cuota-insert-invalido/)
    })

    it('REQ-AYUDA-V2-11 N4: intento directo de INSERT con fecha futura es sobrescrito con fn_hoy_tenant()', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r11-n4')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error: errInsert } = await auth.from('cuota_ayuda_diaria').insert({
        id_tenant: tenant.tenantId,
        fecha: '2099-12-31',
        consultas_realizadas: 0,
      })
      expect(errInsert).toBeNull()

      const { data: fila } = await auth
        .from('cuota_ayuda_diaria')
        .select('fecha')
        .eq('id_tenant', tenant.tenantId)
        .single()

      expect(fila?.fecha).not.toBe('2099-12-31')
      expect(fila?.fecha).toBeDefined()
    })

    it('REQ-AYUDA-V2-11 N5: decremento por PostgREST en cuota_ayuda_diaria lanza cuota-decremento-prohibido', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r11-n5')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error: errReserva } = await auth.rpc('sp_reservar_cuota_ayuda')
      expect(errReserva).toBeNull()

      const { error: errUpdate } = await auth
        .from('cuota_ayuda_diaria')
        .update({ consultas_realizadas: 0 })
        .eq('id_tenant', tenant.tenantId)

      expect(errUpdate).not.toBeNull()
      expect(errUpdate?.message).toMatch(/cuota-decremento-prohibido/)
    })

    it('REQ-AYUDA-V2-11 N6: intento de modificar id_tenant o fecha vía UPDATE lanza cuota-modificacion-invalida', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r11-n6')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error: errReserva } = await auth.rpc('sp_reservar_cuota_ayuda')
      expect(errReserva).toBeNull()

      const { error: errUpdate } = await auth
        .from('cuota_ayuda_diaria')
        .update({ fecha: '2020-01-01', consultas_realizadas: 5 } as unknown as Record<string, unknown>)
        .eq('id_tenant', tenant.tenantId)

      expect(errUpdate).not.toBeNull()
      expect(errUpdate?.message).toMatch(/cuota-modificacion-invalida/)
    })

    it('REQ-AYUDA-V2-11 N7: intento de DELETE en cuota_ayuda_diaria es denegado por permisos de PostgreSQL', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r11-n7')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error: errDelete } = await auth
        .from('cuota_ayuda_diaria')
        .delete()
        .eq('id_tenant', tenant.tenantId)

      expect(errDelete).not.toBeNull()
      expect(errDelete?.code).toBe('42501')
    })

    it('REQ-AYUDA-V2-11 N8: intento de INSERT o UPDATE en limite_ayuda_tenant por authenticated es denegado por permisos', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r11-n8')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error: errInsert } = await auth
        .from('limite_ayuda_tenant')
        .insert({ id_tenant: tenant.tenantId, limite_diario: 500 })

      expect(errInsert).not.toBeNull()
      expect(errInsert?.code).toBe('42501')

      const { error: errUpdate } = await auth
        .from('limite_ayuda_tenant')
        .update({ limite_diario: 500 })
        .eq('id_tenant', tenant.tenantId)

      expect(errUpdate).not.toBeNull()
      expect(errUpdate?.code).toBe('42501')
    })

    it('REQ-AYUDA-V2-11 N9: usuario sin permiso ayuda.consultar recibe 0 filas en limite_ayuda_tenant y cuota_ayuda_diaria', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r11-n9')
      await habilitarAyuda(tenant.tenantId)

      // Rol sin permiso ayuda.consultar
      const { data: rolSinAyuda } = await serviceRole
        .from('rol')
        .insert({
          id_tenant: tenant.tenantId,
          nombre: 'Rol Sin Ayuda',
          permisos: { ventas: ['ver'] },
        })
        .select('id_rol')
        .single()

      const userSinPermiso = await createUserInTenant(tenant.tenantId, rolSinAyuda!.id_rol, 'u-sin-ayuda')
      const authSinPermiso = await signInAs(userSinPermiso)

      const { data: limites, error: errLim } = await authSinPermiso
        .from('limite_ayuda_tenant')
        .select('*')
      expect(errLim).toBeNull()
      expect(limites).toEqual([])

      const { data: cuotas, error: errCuota } = await authSinPermiso
        .from('cuota_ayuda_diaria')
        .select('*')
      expect(errCuota).toBeNull()
      expect(cuotas).toEqual([])
    })

    it('REQ-AYUDA-V2-11 N10: revendedora recibe 0 filas en limite_ayuda_tenant y cuota_ayuda_diaria (ACC-11)', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r11-n10')
      await habilitarAyuda(tenant.tenantId)

      const { data: modRev } = await serviceRole
        .from('modulo')
        .select('id_modulo')
        .eq('codigo', 'revendedoras')
        .single()
      await serviceRole
        .from('tenant_modulo')
        .upsert({ id_tenant: tenant.tenantId, id_modulo: modRev!.id_modulo, habilitado: true })

      const { data: idRev } = await serviceRole.rpc('sp_crear_revendedora', {
        p_nombre: 'Reven',
        p_apellido: 'Cuota',
        p_email: 'rev_cuota@test.com',
      })

      const { data: rolRev } = await serviceRole
        .from('rol')
        .insert({
          id_tenant: tenant.tenantId,
          nombre: 'Revendedora',
          permisos: { revendedoras: ['ver_propio'] },
        })
        .select('id_rol')
        .single()

      const emailRev = `${withScopedTenant('rev-cuota')}@test.com`
      const { data: userRev } = await serviceRole.auth.admin.createUser({
        email: emailRev,
        password: 'Password123!',
        email_confirm: true,
      })

      await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
        p_id_revendedora: idRev,
        p_id_usuario: userRev!.user!.id,
        p_id_tenant: tenant.tenantId,
        p_email: emailRev,
        p_nombre: 'Reven Cuota',
        p_id_rol: rolRev!.id_rol,
      })

      const authRev = await signInAs({ email: emailRev, password: 'Password123!' })

      const { data: limites, error: errLim } = await authRev
        .from('limite_ayuda_tenant')
        .select('*')
      expect(errLim).toBeNull()
      expect(limites).toEqual([])

      const { data: cuotas, error: errCuota } = await authRev
        .from('cuota_ayuda_diaria')
        .select('*')
      expect(errCuota).toBeNull()
      expect(cuotas).toEqual([])
    })
  })

  describe('REQ-AYUDA-V2-12 — Telemetría diferida y entradas_citadas', () => {
    it('REQ-AYUDA-V2-12 Feliz: sp_registrar_consulta_ayuda persiste entradas_citadas y campos de telemetría', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r12-feliz')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const idConv = randomUUID()
      const { data: idConsulta, error } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: idConv,
        p_pregunta: '¿Cómo emitir un comprobante?',
        p_respuesta: 'Podés ir a [[ventas-nueva]].',
        p_entradas_citadas: ['ventas-nueva'],
        p_resultado: 'respondida',
        p_tipo_error: null,
        p_latencia_ms: 1450,
        p_modelo: 'gemini-2.5-flash',
        p_tokens_input: 920,
        p_tokens_output: 180,
        p_tokens_cached: 400,
        p_tokens_thinking: 0,
      })

      expect(error).toBeNull()
      expect(idConsulta).toBeDefined()

      const { data: fila, error: errSelect } = await auth
        .from('consulta_ayuda')
        .select('*')
        .eq('id_consulta_ayuda', idConsulta)
        .single()

      expect(errSelect).toBeNull()
      expect(fila).toMatchObject({
        id_consulta_ayuda: idConsulta,
        id_tenant: tenant.tenantId,
        id_usuario: tenant.userId,
        id_conversacion: idConv,
        pregunta: '¿Cómo emitir un comprobante?',
        respuesta: 'Podés ir a [[ventas-nueva]].',
        entradas_citadas: ['ventas-nueva'],
        resultado: 'respondida',
        latencia_ms: 1450,
        modelo: 'gemini-2.5-flash',
        tokens_input: 920,
        tokens_output: 180,
        tokens_cached: 400,
        tokens_thinking: 0,
      })
    })

    it('REQ-AYUDA-V2-12 N1: stream sin citas válidas persiste resultado sin_cita y entradas_citadas vacía', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r12-n1')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const idConv = randomUUID()
      const { data: idConsulta, error } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: idConv,
        p_pregunta: '¿Qué es el stock?',
        p_respuesta: 'El stock representa la mercadería disponible.',
        p_entradas_citadas: [],
        p_resultado: 'sin_cita',
        p_latencia_ms: 1100,
        p_modelo: 'gemini-2.5-flash',
      })

      expect(error).toBeNull()

      const { data: fila } = await auth
        .from('consulta_ayuda')
        .select('resultado, entradas_citadas')
        .eq('id_consulta_ayuda', idConsulta)
        .single()

      expect(fila).toMatchObject({
        resultado: 'sin_cita',
        entradas_citadas: [],
      })
    })

    it('REQ-AYUDA-V2-12 N2: más de 6 citas en entradas_citadas es rechazado por CHECK consulta_ayuda_entradas_citadas_check', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r12-n2')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: randomUUID(),
        p_pregunta: 'Pregunta con exceso de citas',
        p_respuesta: 'Respuesta',
        p_entradas_citadas: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'],
        p_resultado: 'respondida',
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/check|consulta_ayuda_entradas_citadas_check/i)
    })

    it('REQ-AYUDA-V2-12 N3: elemento de entradas_citadas con más de 64 caracteres es rechazado por CHECK', async () => {
      const tenant = await createTenantWithUser('ayuda-v2-r12-n3')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: randomUUID(),
        p_pregunta: 'Pregunta con id de entrada largo',
        p_respuesta: 'Respuesta',
        p_entradas_citadas: ['a'.repeat(65)],
        p_resultado: 'respondida',
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/check|consulta_ayuda_entradas_citadas_check/i)
    })
  })
})
