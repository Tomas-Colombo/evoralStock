import { describe, expect, it, afterAll } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import {
  createTenantWithUser,
  hasTestDb,
  signInAs,
  unwrapFixture,
  withScopedTenant,
  type TenantFixture,
} from './_helpers'

describe.skipIf(!hasTestDb)('confirmar-impacto-regla — Capa de datos (REQ-CIR-01…04, DR-CIR-01…06)', () => {
  const serviceRole = createServiceRoleTestClient()
  const tenantsToClean: string[] = []
  const usersToClean: string[] = []

  afterAll(async () => {
    for (const t of tenantsToClean) {
      await serviceRole.rpc('sp_borrar_tenant', { p_id: t })
    }
    for (const u of usersToClean) {
      await serviceRole.auth.admin.deleteUser(u).catch(() => {})
    }
  }, 30000)

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
    usersToClean.push(authUser.user.id)

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

  async function createRevendedoraClient(
    adminClient: Awaited<ReturnType<typeof signInAs>>,
    fixture: TenantFixture,
    prefix: string,
  ) {
    const mod = unwrapFixture(
      'modulo revendedoras lookup',
      await serviceRole.from('modulo').select('id_modulo').eq('codigo', 'revendedoras').single(),
    )
    const { error: tmErr } = await serviceRole
      .from('tenant_modulo')
      .upsert({ id_tenant: fixture.tenantId, id_modulo: mod.id_modulo, habilitado: true })
    if (tmErr) throw new Error(`createRevendedoraClient tenant_modulo failed: ${tmErr.message}`)

    const idRev = unwrapFixture(
      'sp_crear_revendedora',
      await adminClient.rpc('sp_crear_revendedora', {
        p_nombre: 'Revendedora',
        p_apellido: prefix,
        p_email: `${withScopedTenant(prefix)}@rev.test`,
      }),
    )

    const rolRev = unwrapFixture(
      'rol revendedora insert',
      await serviceRole
        .from('rol')
        .insert({
          id_tenant: fixture.tenantId,
          nombre: withScopedTenant(`RolRev-${prefix}`),
          permisos: { revendedoras: ['ver_propio', 'vender'] },
        })
        .select('id_rol')
        .single(),
    )

    const emailRev = `${withScopedTenant(prefix)}_auth@rev.test`
    const passwordRev = 'Password123!'
    const { data: userRev, error: userErr } = await serviceRole.auth.admin.createUser({
      email: emailRev,
      password: passwordRev,
      email_confirm: true,
    })
    if (userErr || !userRev?.user) {
      throw new Error(`createRevendedoraClient createUser failed: ${userErr?.message ?? 'no user'}`)
    }
    usersToClean.push(userRev.user.id)

    const { error: enlErr } = await serviceRole.rpc('sp_enlazar_revendedora_usuario', {
      p_id_revendedora: idRev,
      p_id_usuario: userRev.user.id,
      p_id_tenant: fixture.tenantId,
      p_email: emailRev,
      p_nombre: 'Revendedora User',
      p_id_rol: rolRev.id_rol,
    })
    if (enlErr) throw new Error(`createRevendedoraClient enlazar failed: ${enlErr.message}`)

    return signInAs({ email: emailRev, password: passwordRev })
  }

  async function setupFixture() {
    const fixtureA = await createTenantWithUser(withScopedTenant('cir-a'))
    tenantsToClean.push(fixtureA.tenantId)
    const clientAdminA = await signInAs(fixtureA)

    const fixtureB = await createTenantWithUser(withScopedTenant('cir-b'))
    tenantsToClean.push(fixtureB.tenantId)

    // Categoría Remeras y Pantalones en A
    const catRemeras = unwrapFixture(
      'categoria Remeras insert',
      await serviceRole
        .from('categoria')
        .insert({ id_tenant: fixtureA.tenantId, nombre: 'Remeras' })
        .select('id_categoria')
        .single(),
    )

    const catPantalones = unwrapFixture(
      'categoria Pantalones insert',
      await serviceRole
        .from('categoria')
        .insert({ id_tenant: fixtureA.tenantId, nombre: 'Pantalones' })
        .select('id_categoria')
        .single(),
    )

    // 4 productos en Remeras con costo, 1 sin costo
    const prodsRemerasConCosto: string[] = []
    for (let i = 1; i <= 4; i++) {
      const p = unwrapFixture(
        `prod remera ${i}`,
        await serviceRole
          .from('producto')
          .insert({
            id_tenant: fixtureA.tenantId,
            id_categoria: catRemeras.id_categoria,
            nombre: `Remera ${i}`,
            sku: `REM-0${i}-${withScopedTenant('x').slice(-4)}`,
            precio_venta: 1000 * i,
            activo: true,
          })
          .select('id_producto')
          .single(),
      )
      prodsRemerasConCosto.push(p.id_producto)
      // costo vigente
      await serviceRole.from('costo_producto').insert({
        id_tenant: fixtureA.tenantId,
        id_producto: p.id_producto,
        costo: 500 * i,
      })
    }

    const prodRemeraSinCosto = unwrapFixture(
      'prod remera sin costo',
      await serviceRole
        .from('producto')
        .insert({
          id_tenant: fixtureA.tenantId,
          id_categoria: catRemeras.id_categoria,
          nombre: 'Remera Sin Costo',
          sku: `REM-SC-${withScopedTenant('x').slice(-4)}`,
          precio_venta: 999,
          activo: true,
        })
        .select('id_producto, precio_venta')
        .single(),
    )

    // 1 producto en Pantalones con costo
    const prodPantalon = unwrapFixture(
      'prod pantalon',
      await serviceRole
        .from('producto')
        .insert({
          id_tenant: fixtureA.tenantId,
          id_categoria: catPantalones.id_categoria,
          nombre: 'Pantalon Cargo',
          sku: `PAN-01-${withScopedTenant('x').slice(-4)}`,
          precio_venta: 5000,
          activo: true,
        })
        .select('id_producto, precio_venta')
        .single(),
    )
    await serviceRole.from('costo_producto').insert({
      id_tenant: fixtureA.tenantId,
      id_producto: prodPantalon.id_producto,
      costo: 3000,
    })

    // Regla de margen 50% en categoría Remeras (50% = 0.50)
    const reglaMargenRemeras = unwrapFixture(
      'regla margen remeras insert',
      await serviceRole
        .from('regla_precio')
        .insert({
          id_tenant: fixtureA.tenantId,
          nombre: 'Margen 50% Remeras',
          tipo_regla: 'margen',
          tipo_valor: 'porcentaje',
          valor: 0.5,
          alcance: 'categoria',
          id_categoria: catRemeras.id_categoria,
          prioridad: 10,
        })
        .select('id_regla')
        .single(),
    )

    // Regla de descuento en Tenant A
    const reglaDescuento = unwrapFixture(
      'regla descuento insert',
      await serviceRole
        .from('regla_precio')
        .insert({
          id_tenant: fixtureA.tenantId,
          nombre: 'Descuento 10%',
          tipo_regla: 'descuento',
          tipo_valor: 'porcentaje',
          valor: 0.1,
          alcance: 'global',
        })
        .select('id_regla')
        .single(),
    )

    // Regla en Tenant B
    const reglaTenantB = unwrapFixture(
      'regla margen tenant B',
      await serviceRole
        .from('regla_precio')
        .insert({
          id_tenant: fixtureB.tenantId,
          nombre: 'Margen B',
          tipo_regla: 'margen',
          tipo_valor: 'porcentaje',
          valor: 0.3,
          alcance: 'global',
        })
        .select('id_regla')
        .single(),
    )

    // Usuarios con permisos específicos en Tenant A:
    // 1. Operador completo
    const clientOperadorCompleto = await createClientWithPermisos(fixtureA, 'op-completo', {
      precios: ['ver', 'editar', 'ver_margenes'],
      inventario: ['ver', 'ver_costos'],
    })

    // 2. Encargada: tiene precios.editar pero NO precios.ver_margenes
    const clientEncargada = await createClientWithPermisos(fixtureA, 'Encargada', {
      precios: ['ver', 'editar'],
      inventario: ['ver', 'ver_costos'],
    })

    // 3. Sin inventario.ver_costos
    const clientSinCostos = await createClientWithPermisos(fixtureA, 'sin-costos', {
      precios: ['ver', 'editar', 'ver_margenes'],
      inventario: ['ver'],
    })

    // 4. Sin precios.editar
    const clientSinEditar = await createClientWithPermisos(fixtureA, 'sin-editar', {
      precios: ['ver', 'ver_margenes'],
      inventario: ['ver', 'ver_costos'],
    })

    // 5. Sin precios.ver
    const clientSinVer = await createClientWithPermisos(fixtureA, 'sin-ver', {
      precios: ['editar', 'ver_margenes'],
      inventario: ['ver', 'ver_costos'],
    })

    return {
      fixtureA,
      fixtureB,
      clientAdminA,
      clientOperadorCompleto,
      clientEncargada,
      clientSinCostos,
      clientSinEditar,
      clientSinVer,
      catRemeras,
      catPantalones,
      prodsRemerasConCosto,
      prodRemeraSinCosto,
      prodPantalon,
      reglaMargenRemeras,
      reglaDescuento,
      reglaTenantB,
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // SECCIÓN 2: MATRIZ DE PERMISOS
  // ─────────────────────────────────────────────────────────────────

  describe('Sección 2: Matriz de permisos', () => {
    it('sp_impacto_regla_margen - Operador con permiso devuelve filas por categoría', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientOperadorCompleto.rpc('sp_impacto_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data![0].categoria_nombre).toBe('Remeras')
      expect(data![0].productos).toBe(5)
    })

    it('sp_impacto_regla_margen - Operador sin ver_margenes levanta no-permission', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientEncargada.rpc('sp_impacto_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('no-permission')
      expect(data).toBeNull()
    })

    it('sp_impacto_regla_margen - Operador sin ver_costos devuelve contadores en null', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientSinCostos.rpc('sp_impacto_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data![0].productos).toBe(5)
      expect(data![0].cambian).toBeNull()
      expect(data![0].suben).toBeNull()
      expect(data![0].bajan).toBeNull()
      expect(data![0].sin_costo).toBeNull()
    })

    it('sp_impacto_regla_margen - Revendedora levanta no-permission', async () => {
      const f = await setupFixture()
      const clientRevendedora = await createRevendedoraClient(f.clientAdminA, f.fixtureA, 'rev-imp')
      const { data, error } = await clientRevendedora.rpc('sp_impacto_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('no-permission')
      expect(data).toBeNull()
    })

    it('sp_impacto_regla_margen - Regla de otro tenant levanta regla-not-found', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientOperadorCompleto.rpc('sp_impacto_regla_margen', {
        p_id_regla: f.reglaTenantB.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('regla-not-found')
      expect(data).toBeNull()
    })

    it('sp_aplicar_regla_margen - Operador con permiso devuelve n recalculados', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientOperadorCompleto.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).toBeNull()
      // 4 remeras tienen costo; 1 no tiene costo y no se recalcula
      expect(data).toBe(4)
    })

    it('sp_aplicar_regla_margen - Operador sin precios.editar levanta no-permission', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientSinEditar.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('no-permission')
      expect(data).toBeNull()
    })

    it('sp_aplicar_regla_margen - Operador sin inventario.ver_costos levanta no-permission', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientSinCostos.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('no-permission')
      expect(data).toBeNull()
    })

    it('sp_aplicar_regla_margen - Operador sin precios.ver_margenes (rol Encargada) levanta no-permission', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientEncargada.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('no-permission')
      expect(data).toBeNull()
    })

    it('sp_aplicar_regla_margen - Revendedora levanta no-permission', async () => {
      const f = await setupFixture()
      const clientRevendedora = await createRevendedoraClient(f.clientAdminA, f.fixtureA, 'rev-apl')
      const { data, error } = await clientRevendedora.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('no-permission')
      expect(data).toBeNull()
    }, 15000)

    it('sp_aplicar_regla_margen - Regla de otro tenant levanta regla-not-found y 0 cambios', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientOperadorCompleto.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaTenantB.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('regla-not-found')
      expect(data).toBeNull()
    })

    it('sp_control_de_precios - Operador con permiso devuelve columnas id_categoria e id_regla_margen_resuelta', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientOperadorCompleto.rpc('sp_control_de_precios')
      expect(error).toBeNull()
      expect(data).not.toBeNull()
      expect(data!.length).toBeGreaterThan(0)
      const primeraFila = data![0]
      expect(primeraFila).toHaveProperty('id_categoria')
      expect(primeraFila).toHaveProperty('id_regla_margen_resuelta')
    })

    it('sp_control_de_precios - Operador sin precios.ver devuelve 0 filas', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientSinVer.rpc('sp_control_de_precios')
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('sp_control_de_precios - Revendedora devuelve 0 filas', async () => {
      const f = await setupFixture()
      const clientRevendedora = await createRevendedoraClient(f.clientAdminA, f.fixtureA, 'rev-ctl')
      const { data, error } = await clientRevendedora.rpc('sp_control_de_precios')
      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  })

  // ─────────────────────────────────────────────────────────────────
  // REQ-CIR-01: Impacto de una regla de margen
  // ─────────────────────────────────────────────────────────────────

  describe('REQ-CIR-01 — Impacto de una regla de margen', () => {
    it('REQ-CIR-01 Feliz: regla 50% sobre categoría con 4 con costo y 1 sin costo → productos=5, cambian=4, sin_costo=1', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientOperadorCompleto.rpc('sp_impacto_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      const fila = data![0]
      expect(fila.categoria_nombre).toBe('Remeras')
      expect(fila.productos).toBe(5)
      expect(fila.cambian).toBe(4)
      expect(fila.sin_costo).toBe(1)
      // No debe devolver costos ni montos
      expect(fila).not.toHaveProperty('costo')
      expect(fila).not.toHaveProperty('precio_venta')
      expect(fila).not.toHaveProperty('precio_proyectado')
    })

    it('REQ-CIR-01 N1: sin precios.ver_margenes → no-permission', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientEncargada.rpc('sp_impacto_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('no-permission')
      expect(data).toBeNull()
    })

    it('REQ-CIR-01 N2: sin inventario.ver_costos → productos correcto y cambian/suben/bajan/sin_costo en null', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientSinCostos.rpc('sp_impacto_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data![0].productos).toBe(5)
      expect(data![0].cambian).toBeNull()
      expect(data![0].suben).toBeNull()
      expect(data![0].bajan).toBeNull()
      expect(data![0].sin_costo).toBeNull()
    })

    it('REQ-CIR-01 N3: regla de otro tenant o inexistente → regla-not-found', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientOperadorCompleto.rpc('sp_impacto_regla_margen', {
        p_id_regla: '00000000-0000-0000-0000-000000000000',
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('regla-not-found')
      expect(data).toBeNull()
    })

    it('REQ-CIR-01 N4: regla de descuento o recargo → regla-no-es-margen', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientOperadorCompleto.rpc('sp_impacto_regla_margen', {
        p_id_regla: f.reglaDescuento.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('regla-no-es-margen')
      expect(data).toBeNull()
    })

    it('REQ-CIR-01 N5: regla dada de baja, o con fecha_inicio futura → 0 filas', async () => {
      const f = await setupFixture()

      // Regla de margen con fecha_inicio futura
      const { data: reglaFutura } = await serviceRole
        .from('regla_precio')
        .insert({
          id_tenant: f.fixtureA.tenantId,
          nombre: 'Margen Futuro',
          tipo_regla: 'margen',
          tipo_valor: 'porcentaje',
          valor: 0.8,
          alcance: 'categoria',
          id_categoria: f.catPantalones.id_categoria,
          fecha_inicio: new Date(Date.now() + 86400000 * 30).toISOString(),
        })
        .select('id_regla')
        .single()

      const { data: resFutura, error: errFutura } = await f.clientOperadorCompleto.rpc(
        'sp_impacto_regla_margen',
        { p_id_regla: reglaFutura!.id_regla },
      )
      expect(errFutura).toBeNull()
      expect(resFutura).toEqual([])

      // Regla dada de baja
      const { data: reglaBaja } = await serviceRole
        .from('regla_precio')
        .insert({
          id_tenant: f.fixtureA.tenantId,
          nombre: 'Margen Dado de Baja',
          tipo_regla: 'margen',
          tipo_valor: 'porcentaje',
          valor: 0.8,
          alcance: 'categoria',
          id_categoria: f.catPantalones.id_categoria,
          fecha_baja: new Date().toISOString(),
        })
        .select('id_regla')
        .single()

      const { data: resBaja, error: errBaja } = await f.clientOperadorCompleto.rpc(
        'sp_impacto_regla_margen',
        { p_id_regla: reglaBaja!.id_regla },
      )
      expect(errBaja).toBeNull()
      expect(resBaja).toEqual([])
    })

    it('REQ-CIR-01 N6: regla tapada por una regla de producto más específica → ese producto no cuenta', async () => {
      const f = await setupFixture()
      const prodTapado = f.prodsRemerasConCosto[0]

      // Creamos regla más específica por producto para prodTapado
      await serviceRole.from('regla_precio').insert({
        id_tenant: f.fixtureA.tenantId,
        nombre: 'Margen Producto Especifico',
        tipo_regla: 'margen',
        tipo_valor: 'porcentaje',
        valor: 0.25,
        alcance: 'producto',
        id_producto: prodTapado,
        prioridad: 100,
      })

      // Ahora el producto tapado ya no resuelve a la regla de categoría
      const { data, error } = await f.clientOperadorCompleto.rpc('sp_impacto_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      // Eran 5 productos, ahora 4
      expect(data![0].productos).toBe(4)
      expect(data![0].cambian).toBe(3)
    })
  })

  // ─────────────────────────────────────────────────────────────────
  // REQ-CIR-02: Aplicar una regla de margen
  // ─────────────────────────────────────────────────────────────────

  describe('REQ-CIR-02 — Aplicar una regla de margen', () => {
    it('REQ-CIR-02 Feliz con costo 1234.5 y margen 0.35: después de aplicar, cambian = 0', async () => {
      const f = await setupFixture()

      const catPrueba = unwrapFixture(
        'cat prueba',
        await serviceRole
          .from('categoria')
          .insert({ id_tenant: f.fixtureA.tenantId, nombre: 'Prueba Margen Dec' })
          .select('id_categoria')
          .single(),
      )

      const prod = unwrapFixture(
        'prod decimal',
        await serviceRole
          .from('producto')
          .insert({
            id_tenant: f.fixtureA.tenantId,
            id_categoria: catPrueba.id_categoria,
            nombre: 'Prenda Decimal',
            sku: `DEC-01-${withScopedTenant('x').slice(-4)}`,
            precio_venta: 1000,
            activo: true,
          })
          .select('id_producto, precio_venta')
          .single(),
      )

      await serviceRole.from('costo_producto').insert({
        id_tenant: f.fixtureA.tenantId,
        id_producto: prod.id_producto,
        costo: 1234.5,
      })

      const regla35 = unwrapFixture(
        'regla 35%',
        await serviceRole
          .from('regla_precio')
          .insert({
            id_tenant: f.fixtureA.tenantId,
            nombre: 'Margen 35% Prueba',
            tipo_regla: 'margen',
            tipo_valor: 'porcentaje',
            valor: 0.35,
            alcance: 'categoria',
            id_categoria: catPrueba.id_categoria,
          })
          .select('id_regla')
          .single(),
      )

      const { data: impAntes } = await f.clientOperadorCompleto.rpc('sp_impacto_regla_margen', {
        p_id_regla: regla35.id_regla,
      })
      expect(impAntes![0].cambian).toBe(1)

      const { data: nRecalc, error: errRecalc } = await f.clientOperadorCompleto.rpc(
        'sp_aplicar_regla_margen',
        { p_id_regla: regla35.id_regla },
      )
      expect(errRecalc).toBeNull()
      expect(nRecalc).toBe(1)

      const { data: impactoPost } = await f.clientOperadorCompleto.rpc('sp_impacto_regla_margen', {
        p_id_regla: regla35.id_regla,
      })
      expect(impactoPost![0].cambian).toBe(0)

      const { data: prodPost } = await serviceRole
        .from('producto')
        .select('id_producto, precio_venta_desactualizado, precio_venta')
        .eq('id_producto', prod.id_producto)
        .single()

      expect(prodPost!.precio_venta_desactualizado).toBe(false)
      // producto.precio_venta es numeric(14, 2); 1234.5 * 1.35 = 1666.575 se redondea a 1666.58 en base
      expect(Number(prodPost!.precio_venta)).toBe(1666.58)
    })

    it('REQ-CIR-02 Feliz: recalcula productos con costo, cambian pasa a 0 y precio_venta_desactualizado queda false', async () => {
      const f = await setupFixture()
      const { data: nRecalc, error: errRecalc } = await f.clientOperadorCompleto.rpc(
        'sp_aplicar_regla_margen',
        { p_id_regla: f.reglaMargenRemeras.id_regla },
      )
      expect(errRecalc).toBeNull()
      expect(nRecalc).toBe(4)

      // Después de aplicar, el impacto devuelve cambian = 0
      const { data: impactoPost } = await f.clientOperadorCompleto.rpc('sp_impacto_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(impactoPost![0].cambian).toBe(0)

      // Los productos quedan con precio_venta_desactualizado = false
      const { data: prods } = await serviceRole
        .from('producto')
        .select('id_producto, precio_venta_desactualizado')
        .in('id_producto', f.prodsRemerasConCosto)

      for (const p of prods!) {
        expect(p.precio_venta_desactualizado).toBe(false)
      }
    })

    it('REQ-CIR-02 N1 (falta precios.editar) → no-permission antes de leer', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientSinEditar.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('no-permission')
      expect(data).toBeNull()
    })

    it('REQ-CIR-02 N1 (falta inventario.ver_costos) → no-permission antes de leer', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientSinCostos.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('no-permission')
      expect(data).toBeNull()
    })

    it('REQ-CIR-02 N1 (falta precios.ver_margenes - rol Encargada) → no-permission antes de leer', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientEncargada.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('no-permission')
      expect(data).toBeNull()
    })

    it('REQ-CIR-02 N2: otro tenant o inexistente → regla-not-found y no modifica nada', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientOperadorCompleto.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaTenantB.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('regla-not-found')
      expect(data).toBeNull()
    })

    it('REQ-CIR-02 N3: regla no es de margen → regla-no-es-margen', async () => {
      const f = await setupFixture()
      const { data, error } = await f.clientOperadorCompleto.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaDescuento.id_regla,
      })
      expect(error).not.toBeNull()
      expect(error!.message).toContain('regla-no-es-margen')
      expect(data).toBeNull()
    })

    it('REQ-CIR-02 N4: la segunda ejecución devuelve 0 y no agrega filas de auditoría "recalcular_precio"', async () => {
      const f = await setupFixture()
      // Primera ejecución
      const { data: n1 } = await f.clientOperadorCompleto.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(n1).toBe(4)

      const { count: auditCount1 } = await serviceRole
        .from('auditoria')
        .select('*', { count: 'exact', head: true })
        .eq('id_tenant', f.fixtureA.tenantId)
        .eq('accion', 'recalcular_precio')

      // Segunda ejecución
      const { data: n2, error: err2 } = await f.clientOperadorCompleto.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(err2).toBeNull()
      expect(n2).toBe(0)

      const { count: auditCount2 } = await serviceRole
        .from('auditoria')
        .select('*', { count: 'exact', head: true })
        .eq('id_tenant', f.fixtureA.tenantId)
        .eq('accion', 'recalcular_precio')

      expect(auditCount2).toBe(auditCount1)
    })

    it('REQ-CIR-02 N5: productos de otras reglas o de otro tenant no se tocan', async () => {
      const f = await setupFixture()
      const precioAntesPantalon = f.prodPantalon.precio_venta

      await f.clientOperadorCompleto.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })

      const { data: pantalonDespues } = await serviceRole
        .from('producto')
        .select('precio_venta')
        .eq('id_producto', f.prodPantalon.id_producto)
        .single()

      expect(pantalonDespues!.precio_venta).toBe(precioAntesPantalon)
    })

    it('REQ-CIR-02 N6: producto sin costo dentro de la regla conserva su precio anterior y no cuenta en el total', async () => {
      const f = await setupFixture()
      const precioAntesSinCosto = f.prodRemeraSinCosto.precio_venta

      const { data: nRecalc } = await f.clientOperadorCompleto.rpc('sp_aplicar_regla_margen', {
        p_id_regla: f.reglaMargenRemeras.id_regla,
      })
      expect(nRecalc).toBe(4)

      const { data: prodSinCostoDespues } = await serviceRole
        .from('producto')
        .select('precio_venta')
        .eq('id_producto', f.prodRemeraSinCosto.id_producto)
        .single()

      expect(prodSinCostoDespues!.precio_venta).toBe(precioAntesSinCosto)
    })
  })
})
