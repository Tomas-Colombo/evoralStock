import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, hasTestDb, signInAs, withScopedTenant } from './_helpers'

describe.skipIf(!hasTestDb)('Módulo ayuda en DB — REQ-AYUDA-10/11 y spec §5', () => {
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

  async function deshabilitarAyuda(tenantId: string) {
    const mod = await getModuloAyuda()
    const { error } = await serviceRole
      .from('tenant_modulo')
      .upsert({ id_tenant: tenantId, id_modulo: mod.id_modulo, habilitado: false })
    expect(error, 'deshabilitar ayuda').toBeNull()
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

  describe('Paquete opcional y guardas de tenant_modulo', () => {
    it('el operador (service-role) prende y apaga ayuda sin modulo-con-estado-vivo', async () => {
      const tenant = await createTenantWithUser('ayuda-op-toggle')

      // 1. fn_modulo_tiene_estado_vivo debe devolver false para 'ayuda'
      const { data: tieneEstado, error: errVivo } = await serviceRole.rpc('fn_modulo_tiene_estado_vivo', {
        p_tenant: tenant.tenantId,
        p_codigo: 'ayuda',
      })
      expect(errVivo).toBeNull()
      expect(tieneEstado).toBe(false)

      // 2. Prender ayuda como service-role
      await habilitarAyuda(tenant.tenantId)

      // 3. Apagar ayuda como service-role (no debe fallar con modulo-con-estado-vivo)
      await deshabilitarAyuda(tenant.tenantId)

      // 4. Crear superadmin y verificar que sp_toggle_tenant_modulo_admin también alterna el paquete
      const emailSA = `${withScopedTenant('sa')}@utopia.test`
      const { data: saUser, error: saErr } = await serviceRole.auth.admin.createUser({
        email: emailSA,
        password: 'Password123!',
        email_confirm: true,
      })
      expect(saErr).toBeNull()
      expect(saUser?.user).toBeDefined()
      const saUserId = saUser!.user!.id

      const { error: saInsertErr } = await serviceRole.from('superadmin').insert({ id_auth_user: saUserId })
      expect(saInsertErr).toBeNull()

      const { error: errToggleOn } = await serviceRole.rpc('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: tenant.tenantId,
        p_paquete: 'ayuda',
        p_habilitado: true,
        p_actor: saUserId,
      })
      expect(errToggleOn).toBeNull()

      const { error: errToggleOff } = await serviceRole.rpc('sp_toggle_tenant_modulo_admin', {
        p_id_tenant: tenant.tenantId,
        p_paquete: 'ayuda',
        p_habilitado: false,
        p_actor: saUserId,
      })
      expect(errToggleOff).toBeNull()
    })

    it('authenticated no puede escribir tenant_modulo de ayuda', async () => {
      const tenant = await createTenantWithUser('ayuda-auth-no-write')
      const mod = await getModuloAyuda()
      const auth = await signInAs(tenant)

      const { error: errInsert } = await auth.from('tenant_modulo').insert({
        id_tenant: tenant.tenantId,
        id_modulo: mod.id_modulo,
        habilitado: true,
      })
      expect(errInsert).not.toBeNull()

      // Habilitar ayuda con service-role para que la fila exista en tenant_modulo
      await habilitarAyuda(tenant.tenantId)

      const { error: errUpdate } = await auth
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', tenant.tenantId)
        .eq('id_modulo', mod.id_modulo)
      expect(errUpdate).not.toBeNull()

      const { error: errDelete } = await auth
        .from('tenant_modulo')
        .delete()
        .eq('id_tenant', tenant.tenantId)
        .eq('id_modulo', mod.id_modulo)
      expect(errDelete).not.toBeNull()
    })
  })

  describe('REQ-AYUDA-10 — Registro de cada turno', () => {
    it('REQ-AYUDA-10 feliz: turno respondido registra fila con entrada_id y resultado = respondida', async () => {
      const tenant = await createTenantWithUser('ayuda-r10-feliz')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const idConv = randomUUID()
      const { data: idConsulta, error } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: idConv,
        p_pregunta: '¿Cómo cargo una venta?',
        p_respuesta: 'Hacé clic en Ventas y luego en Nueva Venta.',
        p_entrada_id: 'ventas-nueva',
        p_resultado: 'respondida',
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
        pregunta: '¿Cómo cargo una venta?',
        respuesta: 'Hacé clic en Ventas y luego en Nueva Venta.',
        entrada_id: 'ventas-nueva',
        resultado: 'respondida',
        util: null,
      })
    })

    it('REQ-AYUDA-10 N1: turno con timeout o error registra fila con respuesta null y sin entrada_id', async () => {
      const tenant = await createTenantWithUser('ayuda-r10-n1')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const idConv = randomUUID()
      const { data: idError, error: errError } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: idConv,
        p_pregunta: '¿Dónde veo las comisiones?',
        p_respuesta: null,
        p_entrada_id: null,
        p_resultado: 'error',
      })

      expect(errError).toBeNull()

      const { data: filaError } = await auth
        .from('consulta_ayuda')
        .select('*')
        .eq('id_consulta_ayuda', idError)
        .single()

      expect(filaError).toMatchObject({
        id_consulta_ayuda: idError,
        resultado: 'error',
        respuesta: null,
        entrada_id: null,
      })

      const { data: idFuera, error: errFuera } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: idConv,
        p_pregunta: '¿Cómo se prepara un café?',
        p_respuesta: null,
        p_entrada_id: null,
        p_resultado: 'fuera_de_opciones',
      })

      expect(errFuera).toBeNull()

      const { data: filaFuera } = await auth
        .from('consulta_ayuda')
        .select('*')
        .eq('id_consulta_ayuda', idFuera)
        .single()

      expect(filaFuera).toMatchObject({
        id_consulta_ayuda: idFuera,
        resultado: 'fuera_de_opciones',
        respuesta: null,
        entrada_id: null,
      })
    })

    it('REQ-AYUDA-10 N2: otro tenant ve 0 filas por RLS', async () => {
      const tenantA = await createTenantWithUser('ayuda-r10-n2-a')
      const tenantB = await createTenantWithUser('ayuda-r10-n2-b')
      await habilitarAyuda(tenantA.tenantId)
      await habilitarAyuda(tenantB.tenantId)

      const authA = await signInAs(tenantA)
      const authB = await signInAs(tenantB)

      const { data: idConsultaA, error: errA } = await authA.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: randomUUID(),
        p_pregunta: 'Pregunta privada de A',
        p_respuesta: 'Respuesta privada de A',
        p_entrada_id: 'ayuda-uso',
        p_resultado: 'respondida',
      })
      expect(errA).toBeNull()

      const { data: filasB, error: errB } = await authB
        .from('consulta_ayuda')
        .select('*')
        .eq('id_consulta_ayuda', idConsultaA)

      expect(errB).toBeNull()
      expect(filasB).toEqual([])
    })

    it('REQ-AYUDA-10 N3: módulo ayuda apagado rechaza con module-disabled', async () => {
      const tenant = await createTenantWithUser('ayuda-r10-n3')
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: randomUUID(),
        p_pregunta: 'Pregunta con módulo deshabilitado',
        p_respuesta: 'Respuesta',
        p_entrada_id: 'ayuda-uso',
        p_resultado: 'respondida',
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/module-disabled/)
    })

    it('REQ-AYUDA-10 N4: pregunta de 301 caracteres directo al SP rechazada por CHECK', async () => {
      const tenant = await createTenantWithUser('ayuda-r10-n4')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { error } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: randomUUID(),
        p_pregunta: 'a'.repeat(301),
        p_respuesta: 'Respuesta',
        p_entrada_id: 'ayuda-uso',
        p_resultado: 'respondida',
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/check|consulta_ayuda_pregunta_check/i)
    })
  })

  describe('CHECK de resultado/entrada_id en consulta_ayuda', () => {
    it('resultado = respondida exige entrada_id no nulo', async () => {
      const tenant = await createTenantWithUser('ayuda-chk-resp')

      const { error } = await serviceRole.from('consulta_ayuda').insert({
        id_tenant: tenant.tenantId,
        id_usuario: tenant.userId,
        id_conversacion: randomUUID(),
        pregunta: 'Pregunta válida',
        respuesta: 'Respuesta',
        entrada_id: null,
        resultado: 'respondida',
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/check|consulta_ayuda_resultado_entrada_check/i)
    })

    it('resultado <> respondida exige entrada_id nulo', async () => {
      const tenant = await createTenantWithUser('ayuda-chk-no-resp')

      const { error: errFuera } = await serviceRole.from('consulta_ayuda').insert({
        id_tenant: tenant.tenantId,
        id_usuario: tenant.userId,
        id_conversacion: randomUUID(),
        pregunta: 'Pregunta válida',
        respuesta: null,
        entrada_id: 'entrada-invalida',
        resultado: 'fuera_de_opciones',
      })
      expect(errFuera).not.toBeNull()
      expect(errFuera?.message).toMatch(/check|consulta_ayuda_resultado_entrada_check/i)

      const { error: errError } = await serviceRole.from('consulta_ayuda').insert({
        id_tenant: tenant.tenantId,
        id_usuario: tenant.userId,
        id_conversacion: randomUUID(),
        pregunta: 'Pregunta válida',
        respuesta: null,
        entrada_id: 'entrada-invalida',
        resultado: 'error',
      })
      expect(errError).not.toBeNull()
      expect(errError?.message).toMatch(/check|consulta_ayuda_resultado_entrada_check/i)
    })

    it('resultado rechaza valores fuera del enum permitido', async () => {
      const tenant = await createTenantWithUser('ayuda-chk-enum')

      const { error } = await serviceRole.from('consulta_ayuda').insert({
        id_tenant: tenant.tenantId,
        id_usuario: tenant.userId,
        id_conversacion: randomUUID(),
        pregunta: 'Pregunta válida',
        respuesta: null,
        entrada_id: null,
        resultado: 'desconocido',
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/check|consulta_ayuda_resultado_check/i)
    })

    it('pregunta vacía es rechazada por char_length between 1 and 300', async () => {
      const tenant = await createTenantWithUser('ayuda-chk-preg-vacia')

      const { error } = await serviceRole.from('consulta_ayuda').insert({
        id_tenant: tenant.tenantId,
        id_usuario: tenant.userId,
        id_conversacion: randomUUID(),
        pregunta: '',
        respuesta: null,
        entrada_id: null,
        resultado: 'fuera_de_opciones',
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/check|consulta_ayuda_pregunta_check/i)
    })

    it('respuesta > 2000 caracteres es rechazada por CHECK', async () => {
      const tenant = await createTenantWithUser('ayuda-chk-resp-len')

      const { error } = await serviceRole.from('consulta_ayuda').insert({
        id_tenant: tenant.tenantId,
        id_usuario: tenant.userId,
        id_conversacion: randomUUID(),
        pregunta: 'Pregunta válida',
        respuesta: 'x'.repeat(2001),
        entrada_id: 'ayuda-uso',
        resultado: 'respondida',
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/check|consulta_ayuda_respuesta_check/i)
    })

    it('entrada_id > 64 caracteres es rechazada por CHECK', async () => {
      const tenant = await createTenantWithUser('ayuda-chk-ent-len')

      const { error } = await serviceRole.from('consulta_ayuda').insert({
        id_tenant: tenant.tenantId,
        id_usuario: tenant.userId,
        id_conversacion: randomUUID(),
        pregunta: 'Pregunta válida',
        respuesta: 'Respuesta',
        entrada_id: 'x'.repeat(65),
        resultado: 'respondida',
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/check|consulta_ayuda_entrada_id_check/i)
    })
  })

  describe('REQ-AYUDA-11 — Calificar solo la fila propia', () => {
    it('REQ-AYUDA-11 feliz: fila propia actualiza util y permite re-calificar', async () => {
      const tenant = await createTenantWithUser('ayuda-r11-feliz')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { data: idConsulta, error: errReg } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: randomUUID(),
        p_pregunta: '¿Cómo cargo una venta?',
        p_respuesta: 'Hacé clic en...',
        p_entrada_id: 'ventas-nueva',
        p_resultado: 'respondida',
      })
      expect(errReg).toBeNull()

      // 1. Calificar como util = true
      const { error: errCalif1 } = await auth.rpc('sp_calificar_consulta_ayuda', {
        p_id: idConsulta,
        p_util: true,
      })
      expect(errCalif1).toBeNull()

      const { data: fila1 } = await auth
        .from('consulta_ayuda')
        .select('util')
        .eq('id_consulta_ayuda', idConsulta)
        .single()
      expect(fila1?.util).toBe(true)

      // 2. Re-calificar como util = false
      const { error: errCalif2 } = await auth.rpc('sp_calificar_consulta_ayuda', {
        p_id: idConsulta,
        p_util: false,
      })
      expect(errCalif2).toBeNull()

      const { data: fila2 } = await auth
        .from('consulta_ayuda')
        .select('util')
        .eq('id_consulta_ayuda', idConsulta)
        .single()
      expect(fila2?.util).toBe(false)
    })

    it('REQ-AYUDA-11 N1: fila de otro usuario del mismo tenant arroja consulta-no-encontrada', async () => {
      const tenant = await createTenantWithUser('ayuda-r11-n1')
      await habilitarAyuda(tenant.tenantId)
      const auth1 = await signInAs(tenant)

      const user2 = await createUserInTenant(tenant.tenantId, tenant.rolId, 'ayuda-u2')
      const auth2 = await signInAs(user2)

      const { data: idConsulta, error: errReg } = await auth1.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: randomUUID(),
        p_pregunta: 'Pregunta de usuario 1',
        p_respuesta: 'Respuesta',
        p_entrada_id: 'ayuda-uso',
        p_resultado: 'respondida',
      })
      expect(errReg).toBeNull()
      expect(idConsulta).toEqual(expect.any(String))

      const { error } = await auth2.rpc('sp_calificar_consulta_ayuda', {
        p_id: idConsulta,
        p_util: true,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/consulta-no-encontrada/)
    })

    it('REQ-AYUDA-11 N2: fila de otro tenant arroja consulta-no-encontrada', async () => {
      const tenantA = await createTenantWithUser('ayuda-r11-n2-a')
      const tenantB = await createTenantWithUser('ayuda-r11-n2-b')
      await habilitarAyuda(tenantA.tenantId)
      await habilitarAyuda(tenantB.tenantId)

      const authA = await signInAs(tenantA)
      const authB = await signInAs(tenantB)

      const { data: idConsultaA, error: errRegA } = await authA.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: randomUUID(),
        p_pregunta: 'Pregunta tenant A',
        p_respuesta: 'Respuesta',
        p_entrada_id: 'ayuda-uso',
        p_resultado: 'respondida',
      })
      expect(errRegA).toBeNull()
      expect(idConsultaA).toEqual(expect.any(String))

      const { error } = await authB.rpc('sp_calificar_consulta_ayuda', {
        p_id: idConsultaA,
        p_util: true,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/consulta-no-encontrada/)
    })

    it('REQ-AYUDA-11 N3: fila con resultado = error arroja consulta-no-encontrada', async () => {
      const tenant = await createTenantWithUser('ayuda-r11-n3')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { data: idError, error: errRegError } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: randomUUID(),
        p_pregunta: 'Pregunta con fallo',
        p_respuesta: null,
        p_entrada_id: null,
        p_resultado: 'error',
      })
      expect(errRegError).toBeNull()
      expect(idError).toEqual(expect.any(String))

      const { error } = await auth.rpc('sp_calificar_consulta_ayuda', {
        p_id: idError,
        p_util: true,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/consulta-no-encontrada/)
    })

    it('REQ-AYUDA-11 módulo ayuda apagado rechaza calificar con module-disabled', async () => {
      const tenant = await createTenantWithUser('ayuda-r11-off')
      await habilitarAyuda(tenant.tenantId)
      const auth = await signInAs(tenant)

      const { data: idConsulta, error: errReg } = await auth.rpc('sp_registrar_consulta_ayuda', {
        p_id_conversacion: randomUUID(),
        p_pregunta: 'Pregunta',
        p_respuesta: 'Respuesta',
        p_entrada_id: 'ayuda-uso',
        p_resultado: 'respondida',
      })
      expect(errReg).toBeNull()
      expect(idConsulta).toEqual(expect.any(String))

      await deshabilitarAyuda(tenant.tenantId)

      const { error } = await auth.rpc('sp_calificar_consulta_ayuda', {
        p_id: idConsulta,
        p_util: true,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/module-disabled/)
    })
  })
})
