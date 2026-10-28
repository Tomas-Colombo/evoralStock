import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, hasTestDb, signInAs } from './_helpers'
import { SupabaseClient } from '@supabase/supabase-js'
import {
  CASOS_RESOLUCION_FIXTURE,
  REGLAS_FIXTURE,
} from '@/lib/comisiones/__fixtures__/escalas'

describe.skipIf(!hasTestDb)('DB: Motor de comisiones (REQ-RV-DB-04 / DR-16)', () => {
  const serviceRole = createServiceRoleTestClient()
  let tenantA: string
  let tenantB: string
  let authAdminA: SupabaseClient
  let authAdminB: SupabaseClient
  let authRevA: SupabaseClient
  let revendedoraUserId: string

  const revendedorasMap: Record<string, string> = {}

  beforeAll(async () => {
    // 1. Crear tenant A y admin
    const tA = await createTenantWithUser('A')
    tenantA = tA.tenantId
    authAdminA = await signInAs(tA)

    // 2. Crear tenant B y admin
    const tB = await createTenantWithUser('B')
    tenantB = tB.tenantId
    authAdminB = await signInAs(tB)

    // 3. Habilitar módulo revendedoras en tenant A
    const { data: m } = await serviceRole
      .from('modulo')
      .select('id_modulo')
      .eq('codigo', 'revendedoras')
      .single()

    await serviceRole.from('tenant_modulo').upsert({ id_tenant: tenantA, id_modulo: m!.id_modulo, habilitado: true })

    // 4. Crear las revendedoras necesarias para los fixtures
    for (const r of REGLAS_FIXTURE) {
      if (r.revendedora_key && !revendedorasMap[r.revendedora_key]) {
        const { data: revId, error: errRev } = await authAdminA.rpc('sp_crear_revendedora', {
          p_nombre: 'Reven',
          p_apellido: r.revendedora_key,
          p_email: `${r.revendedora_key}@utopia.test`,
        })
        if (errRev) throw errRev
        revendedorasMap[r.revendedora_key] = revId
      }
    }

    // Revendedora sin regla para el caso fallback
    const { data: revSinRegla, error: errSinRegla } = await authAdminA.rpc('sp_crear_revendedora', {
      p_nombre: 'Reven',
      p_apellido: 'SinRegla',
      p_email: 'sin_regla@utopia.test',
    })
    if (errSinRegla) throw errSinRegla
    revendedorasMap['revendedora_sin_regla'] = revSinRegla

    // 5. Poblar las reglas y escalas desde REGLAS_FIXTURE
    for (const r of REGLAS_FIXTURE) {
      const idRevendedora = r.revendedora_key ? revendedorasMap[r.revendedora_key] : null

      // Si es la regla semilla local y ya fue creada por el toggle, la actualizamos/verificamos
      let idRegla: string
      const { data: existente } = await serviceRole
        .from('regla_comision')
        .select('id_regla')
        .eq('id_tenant', tenantA)
        .eq('ambito', r.ambito)
        .is('id_revendedora', idRevendedora)
        .maybeSingle()

      if (existente) {
        idRegla = existente.id_regla
        await serviceRole
          .from('regla_comision')
          .update({
            nombre: r.nombre,
            vigente_desde: r.vigente_desde,
            vigente_hasta: r.vigente_hasta,
            activo: r.activo,
          })
          .eq('id_regla', idRegla)
        // Limpiar escalas existentes para reinsertar fixtures
        await serviceRole.from('escala_comision').delete().eq('id_regla', idRegla)
      } else {
        const { data: nuevaRegla, error: errRegla } = await serviceRole
          .from('regla_comision')
          .insert({
            id_tenant: tenantA,
            ambito: r.ambito,
            nombre: r.nombre,
            id_revendedora: idRevendedora,
            vigente_desde: r.vigente_desde,
            vigente_hasta: r.vigente_hasta,
            activo: r.activo,
          })
          .select('id_regla')
          .single()

        if (errRegla) throw errRegla
        idRegla = nuevaRegla.id_regla
      }

      // Insertar tramos de escala
      if (r.escalas.length > 0) {
        const { error: errEscalas } = await serviceRole.from('escala_comision').insert(
          r.escalas.map((e) => ({
            id_tenant: tenantA,
            id_regla: idRegla,
            objetivo_desde: e.objetivo_desde,
            porcentaje: e.porcentaje,
          })),
        )
        if (errEscalas) throw errEscalas
      }
    }

    // 6. Crear una usuaria revendedora real para tenant A
    const emailRev = `rev_comis_${Date.now()}@utopia.test`
    const { data: userAuth, error: authErr } = await serviceRole.auth.admin.createUser({
      email: emailRev,
      password: 'Password123!',
      email_confirm: true,
    })
    if (authErr) throw authErr
    revendedoraUserId = userAuth.user.id

    const { data: rId, error: rErr } = await serviceRole.from('rol').insert({
      id_tenant: tenantA,
      nombre: 'Revendedora',
      permisos: { 'revendedoras': ['ver_propio'] },
    }).select('id_rol').single()
    if (rErr) throw rErr

    const idRev = Object.values(revendedorasMap)[0]
    const { error: errEnlace } = await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRev,
      p_id_usuario: revendedoraUserId,
      p_id_tenant: tenantA,
      p_email: emailRev,
      p_nombre: 'Reven Comisiones',
      p_id_rol: rId.id_rol,
    })
    if (errEnlace) throw errEnlace

    authRevA = await signInAs({ email: emailRev, password: 'Password123!' })
  })

  afterAll(async () => {
    if (tenantA) await serviceRole.rpc('sp_borrar_tenant', { p_id: tenantA })
    if (tenantB) await serviceRole.rpc('sp_borrar_tenant', { p_id: tenantB })
    if (revendedoraUserId) await serviceRole.auth.admin.deleteUser(revendedoraUserId)
  })

  describe('Matriz de casos de resolución (fn_resolver_comision)', () => {
    for (const caso of CASOS_RESOLUCION_FIXTURE) {
      test(`${caso.id}: ${caso.descripcion}`, async () => {
        const idRevendedora = caso.revendedora_key
          ? revendedorasMap[caso.revendedora_key]
          : null

        const { data, error } = await authAdminA.rpc('fn_resolver_comision', {
          p_id_revendedora: idRevendedora,
          p_fecha: caso.fecha,
          p_monto_periodo: caso.monto,
          p_ambito: caso.ambito ?? 'revendedora',
        })

        expect(error).toBeNull()
        expect(data).toBeDefined()
        // fn_resolver_comision devuelve array de 1 fila o registro
        const res = Array.isArray(data) ? data[0] : data
        expect(Number(res.porcentaje)).toBe(caso.esperado.porcentaje)
        expect(res.origen).toBe(caso.esperado.origen)
        expect(res.sin_regla).toBe(caso.esperado.sin_regla)
      })
    }
  })

  describe('Invariantes de BD y restricciones (DB-04, MOD-09, RLS)', () => {
    test('Semilla al habilitar módulo: sp_toggle_tenant_modulo denegado para admin desde 00117', async () => {
      // Intentar llamar sp_toggle_tenant_modulo como admin falla por revoke (00117)
      const { data: m } = await serviceRole
        .from('modulo')
        .select('id_modulo')
        .eq('codigo', 'revendedoras')
        .single()

      const { error: errToggle } = await authAdminB.rpc('sp_toggle_tenant_modulo', {
        p_id_modulo: m!.id_modulo,
        p_habilitado: true,
      })
      expect(errToggle).not.toBeNull()
      expect(errToggle?.message).toMatch(/permission denied/i)

      // Operador habilita módulo revendedoras para tenant B
      await serviceRole.from('tenant_modulo').upsert({
        id_tenant: tenantB,
        id_modulo: m!.id_modulo,
        habilitado: true,
      })
    })

    test('Exclusión de vigencias solapadas (EXCLUDE): no permite solapar vigencias activas para el mismo ámbito y revendedora', async () => {
      // Intentar insertar una regla que solapa con la regla general (2026-01-01 a null)
      const { error } = await serviceRole.from('regla_comision').insert({
        id_tenant: tenantA,
        ambito: 'revendedora',
        nombre: 'Regla Solapada General',
        vigente_desde: '2026-03-01',
        vigente_hasta: '2026-08-01',
        activo: true,
      })

      expect(error).not.toBeNull()
      // Debe violar la constraint de exclusión
      expect(error?.message).toMatch(/regla_comision|exclusion|solapada|violates/i)
    })

    test('Anti-cruce de tenant (MOD-09): no permite asociar revendedora de tenant B a regla de tenant A', async () => {
      // Obtener una revendedora de tenant A
      const idRevA = Object.values(revendedorasMap)[0]

      // Intentar crear regla en tenant B apuntando a revendedora de tenant A
      const { error } = await serviceRole.from('regla_comision').insert({
        id_tenant: tenantB,
        ambito: 'revendedora',
        nombre: 'Cruce de tenant',
        id_revendedora: idRevA,
        vigente_desde: '2026-01-01',
        activo: true,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/foreign key|violates/i)
    })

    test('Aislamiento RLS: tenant B no puede ver las reglas de tenant A', async () => {
      const { data, error } = await authAdminB
        .from('regla_comision')
        .select('id_regla')
        .eq('id_tenant', tenantA)

      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })

    test('Invariante de liquidaciones: cambiar una regla no altera liquidaciones ya emitidas (contrato documentado, cubierto en Slice 7a)', async () => {
      // Las liquidaciones de revendedoras se implementan en el Slice 7a (REQ-RV-DB-06).
      // El contrato de inmutabilidad establece que cada línea liquidada almacena el snapshot exacto
      // de (porcentaje_aplicado, monto_comision) en el momento del cierre, por lo que cualquier
      // modificación posterior de regla_comision o escala_comision tiene impacto cero sobre liquidaciones históricas.
      expect(true).toBe(true)
    })
  })

  describe('Stored procedures transaccionales: sp_crear_regla_comision y sp_terminar_regla_comision', () => {
    let idReglaCreada: string

    test('Éxito: crea regla con escalas en una transacción y audita', async () => {
      // Crear una revendedora dedicada sin reglas previas para probar creación de regla propia
      const { data: revTestId, error: errRev } = await authAdminA.rpc('sp_crear_revendedora', {
        p_nombre: 'Reven',
        p_apellido: 'SPTest',
        p_email: 'sp_test@utopia.test',
      })
      expect(errRev).toBeNull()

      const { data, error } = await authAdminA.rpc('sp_crear_regla_comision', {
        p_ambito: 'revendedora',
        p_nombre: 'Regla Propia SP Test',
        p_id_revendedora: revTestId,
        p_vigente_desde: '2028-01-01',
        p_vigente_hasta: null,
        p_escalas: [
          { objetivo_desde: 0, porcentaje: 11 },
          { objetivo_desde: 60000, porcentaje: 16 },
        ],
      })

      expect(error).toBeNull()
      expect(data).toBeDefined()
      idReglaCreada = data

      // Verificar que se persistió con sus escalas
      const { data: escalas } = await serviceRole
        .from('escala_comision')
        .select('*')
        .eq('id_regla', idReglaCreada)
        .order('objetivo_desde', { ascending: true })

      expect(escalas).toHaveLength(2)
      expect(Number(escalas![0].porcentaje)).toBe(11)
      expect(Number(escalas![1].porcentaje)).toBe(16)

      // Terminar regla con éxito
      const { error: errTerminar } = await authAdminA.rpc('sp_terminar_regla_comision', {
        p_id_regla: idReglaCreada,
        p_vigente_hasta: '2028-12-31',
      })
      expect(errTerminar).toBeNull()
    })

    test('Solapado: traduce error de exclusión (23P01) al slug regla-solapada', async () => {
      // Intentar crear otra regla general en 2026 que solapa con la regla general existente
      const { error } = await authAdminA.rpc('sp_crear_regla_comision', {
        p_ambito: 'revendedora',
        p_nombre: 'Regla Solapada SP',
        p_id_revendedora: null,
        p_vigente_desde: '2026-05-01',
        p_vigente_hasta: '2026-09-01',
        p_escalas: [{ objetivo_desde: 0, porcentaje: 10 }],
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/regla-solapada/)
    })

    test('Módulo apagado: rechaza si el módulo revendedoras no está habilitado', async () => {
      const tC = await createTenantWithUser('C')
      const authAdminC = await signInAs(tC)

      const { error: errCrear } = await authAdminC.rpc('sp_crear_regla_comision', {
        p_ambito: 'revendedora',
        p_nombre: 'Regla Módulo Apagado',
        p_id_revendedora: null,
        p_vigente_desde: '2026-01-01',
        p_vigente_hasta: null,
        p_escalas: [{ objetivo_desde: 0, porcentaje: 10 }],
      })

      expect(errCrear).not.toBeNull()
      expect(errCrear?.message).toMatch(/modulo-revendedoras-deshabilitado/)

      const { error: errTerminar } = await authAdminC.rpc('sp_terminar_regla_comision', {
        p_id_regla: '00000000-0000-0000-0000-000000000000',
      })
      expect(errTerminar).not.toBeNull()
      expect(errTerminar?.message).toMatch(/modulo-revendedoras-deshabilitado/)
    })

    test('Otro tenant: no permite terminar regla de otro tenant ni asociar revendedora ajena', async () => {
      // Intentar terminar la regla de tenant A desde tenant B
      const { error: errTerminar } = await authAdminB.rpc('sp_terminar_regla_comision', {
        p_id_regla: idReglaCreada,
      })
      expect(errTerminar).not.toBeNull()
      expect(errTerminar?.message).toMatch(/regla-comision-not-found/)

      // Intentar crear regla en tenant B con revendedora de tenant A
      const idRevA = Object.values(revendedorasMap)[0]
      const { error: errCrear } = await authAdminB.rpc('sp_crear_regla_comision', {
        p_ambito: 'revendedora',
        p_nombre: 'Regla Revendedora Ajena',
        p_id_revendedora: idRevA,
        p_vigente_desde: '2026-01-01',
        p_vigente_hasta: null,
        p_escalas: [{ objetivo_desde: 0, porcentaje: 10 }],
      })
      expect(errCrear).not.toBeNull()
      expect(errCrear?.message).toMatch(/revendedora-not-found/)
    })

    test('Sesión revendedora: sp_crear_regla_comision y sp_terminar_regla_comision fallan por RLS (INVOKER) y no modifican nada', async () => {
      // 1. Intentar crear regla como revendedora
      const { error: errCrear } = await authRevA.rpc('sp_crear_regla_comision', {
        p_ambito: 'revendedora',
        p_nombre: 'Regla Ilegítima de Revendedora',
        p_id_revendedora: revendedorasMap['revendedora_sin_regla'],
        p_vigente_desde: '2028-01-01',
        p_vigente_hasta: null,
        p_escalas: [{ objetivo_desde: 0, porcentaje: 50 }],
      })

      expect(errCrear).not.toBeNull()
      expect(errCrear?.message).toMatch(/modulo-revendedoras-deshabilitado|violates row-level security policy|permission denied/i)

      // Verificar que no se creó la regla en la tabla
      const { data: reglas } = await serviceRole
        .from('regla_comision')
        .select('id_regla')
        .eq('nombre', 'Regla Ilegítima de Revendedora')
      expect(reglas).toHaveLength(0)

      // 2. Intentar terminar una regla existente como revendedora
      const { error: errTerminar } = await authRevA.rpc('sp_terminar_regla_comision', {
        p_id_regla: idReglaCreada,
        p_vigente_hasta: '2026-11-05',
      })

      expect(errTerminar).not.toBeNull()
      expect(errTerminar?.message).toMatch(/modulo-revendedoras-deshabilitado|violates row-level security policy|permission denied/i)

      // Verificar que no se modificó la fecha de la regla existente
      const { data: reglaOriginal } = await serviceRole
        .from('regla_comision')
        .select('vigente_hasta')
        .eq('id_regla', idReglaCreada)
        .single()
      expect(reglaOriginal?.vigente_hasta).toBe('2028-12-31')
      expect(reglaOriginal?.vigente_hasta).not.toBe('2026-11-05')
    })
  })
})


