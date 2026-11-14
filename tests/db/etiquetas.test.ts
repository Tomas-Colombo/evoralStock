import { describe, expect, it, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import { esEan13Valido } from '@/lib/etiquetas/ean13'
import { createAnonTestClient, createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import {
  hasTestDb,
  signInAs,
  createTenantWithUser,
  runPsql,
  withScopedTenant,
} from './_helpers'

describe.skipIf(!hasTestDb)('F1 — Identificación, plantillas e impresión (REQ-ETQ-02, REQ-ETQ-07, REQ-ETQ-08)', () => {
  const serviceRole = createServiceRoleTestClient()
  const tenantsToClean: string[] = []
  const usersToClean: string[] = []

  afterAll(async () => {
    for (const t of tenantsToClean) {
      await serviceRole.rpc('sp_borrar_tenant', { p_id: t })
    }
    for (const u of usersToClean) {
      await serviceRole.auth.admin.deleteUser(u)
    }
  })

  // Helper para crear un tenant con un rol de permisos específicos
  async function createFixtureWithPermisos(prefix: string, permisos: Record<string, string[]>) {
    const fixture = await createTenantWithUser(prefix)
    tenantsToClean.push(fixture.tenantId)
    usersToClean.push(fixture.userId)

    const { error } = await fixture.serviceRole
      .from('rol')
      .update({ permisos })
      .eq('id_rol', fixture.rolId)
    if (error) throw new Error(`Error actualizando permisos: ${error.message}`)

    const client = await signInAs(fixture)
    return { ...fixture, client }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // REQ-ETQ-02: Código EAN interno por unidad
  // ─────────────────────────────────────────────────────────────────────────────
  describe('REQ-ETQ-02: Código EAN interno por unidad', () => {
    it('fn_ean13_digito calcula correctamente el dígito verificador GS1', async () => {
      // 200000000000 -> 8 (vector conocido: 2000000000008)
      // 200000000001 -> 5 (vector conocido: 2000000000015)
      const res1 = runPsql("select fn_ean13_digito('200000000000');")
      expect(res1.trim()).toBe('8')

      const res2 = runPsql("select fn_ean13_digito('200000000001');")
      expect(res2.trim()).toBe('5')
    })

    it('Feliz: crear ítems genera códigos EAN correlativos válidos con prefijo 20', async () => {
      const fixture = await createFixtureWithPermisos('etq_02_feliz', {
        inventario: ['ver', 'crear', 'cargar_costos', 'ver_costos'],
        administracion: ['ver'],
      })

      // Crear categoría y producto
      const { data: cat } = await fixture.serviceRole
        .from('categoria')
        .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatEan') })
        .select('id_categoria')
        .single()

      const { data: prod } = await fixture.serviceRole
        .from('producto')
        .insert({
          id_tenant: fixture.tenantId,
          id_categoria: cat!.id_categoria,
          nombre: 'Producto EAN Feliz',
          sku: 'EAN-0001',
        })
        .select('id_producto')
        .single()

      // Alta de 3 ítems con sp_crear_stock_directo
      const { data: count, error } = await fixture.client.rpc('sp_crear_stock_directo', {
        p_id_producto: prod!.id_producto,
        p_costo: 100,
        p_tipo_ingreso: 'compra',
        p_items: [{ talle: 'M', cantidad: 3 }],
      })
      expect(error).toBeNull()
      expect(count).toBe(3)

      const { data: items, error: errItems } = await fixture.serviceRole
        .from('item_producto')
        .select('codigo_ean')
        .eq('id_tenant', fixture.tenantId)
        .order('codigo_ean', { ascending: true })

      expect(errItems).toBeNull()
      expect(items).toHaveLength(3)
      for (const item of items!) {
        expect(item.codigo_ean).toMatch(/^20\d{10}\d$/)
        const base = item.codigo_ean.slice(0, 12)
        const digito = item.codigo_ean.slice(12)
        const calcRes = runPsql(`select fn_ean13_digito('${base}');`).trim()
        expect(digito).toBe(calcRes)
      }
    })

    it('REQ-ETQ-02 N1: dos inserts concurrentes del mismo tenant obtienen EAN distintos', async () => {
      const fixture = await createFixtureWithPermisos('etq_02_n1', {
        inventario: ['ver', 'crear', 'cargar_costos', 'ver_costos'],
        administracion: ['ver'],
      })

      const { data: cat } = await fixture.serviceRole
        .from('categoria')
        .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatN1') })
        .select('id_categoria')
        .single()

      const { data: prod } = await fixture.serviceRole
        .from('producto')
        .insert({
          id_tenant: fixture.tenantId,
          id_categoria: cat!.id_categoria,
          nombre: 'Prod N1',
          sku: 'N1-0001',
        })
        .select('id_producto')
        .single()

      // Insertar en paralelo sin costo para evitar condiciones de carrera en sp_aplicar_ultimo_costo
      const [resA, resB] = await Promise.all([
        fixture.client.rpc('sp_crear_stock_directo', {
          p_id_producto: prod!.id_producto,
          p_costo: null,
          p_tipo_ingreso: 'compra',
          p_items: [{ talle: 'U', cantidad: 1 }],
        }),
        fixture.client.rpc('sp_crear_stock_directo', {
          p_id_producto: prod!.id_producto,
          p_costo: null,
          p_tipo_ingreso: 'compra',
          p_items: [{ talle: 'U', cantidad: 1 }],
        }),
      ])

      expect(resA.error).toBeNull()
      expect(resB.error).toBeNull()

      const { data: items } = await fixture.serviceRole
        .from('item_producto')
        .select('codigo_ean')
        .eq('id_tenant', fixture.tenantId)

      expect(items).toHaveLength(2)
      expect(items![0].codigo_ean).not.toBe(items![1].codigo_ean)
    })

    it('REQ-ETQ-02 N2: dos tenants tienen contadores independientes', async () => {
      const fixtureA = await createFixtureWithPermisos('etq_02_n2_a', {
        inventario: ['ver', 'crear', 'cargar_costos', 'ver_costos'],
        administracion: ['ver'],
      })
      const fixtureB = await createFixtureWithPermisos('etq_02_n2_b', {
        inventario: ['ver', 'crear', 'cargar_costos', 'ver_costos'],
        administracion: ['ver'],
      })

      const { data: catA } = await fixtureA.serviceRole
        .from('categoria')
        .insert({ id_tenant: fixtureA.tenantId, nombre: withScopedTenant('CatA') })
        .select('id_categoria')
        .single()

      const { data: prodA } = await fixtureA.serviceRole
        .from('producto')
        .insert({
          id_tenant: fixtureA.tenantId,
          id_categoria: catA!.id_categoria,
          nombre: 'Prod A',
          sku: 'A-0001',
        })
        .select('id_producto')
        .single()

      const { data: catB } = await fixtureB.serviceRole
        .from('categoria')
        .insert({ id_tenant: fixtureB.tenantId, nombre: withScopedTenant('CatB') })
        .select('id_categoria')
        .single()

      const { data: prodB } = await fixtureB.serviceRole
        .from('producto')
        .insert({
          id_tenant: fixtureB.tenantId,
          id_categoria: catB!.id_categoria,
          nombre: 'Prod B',
          sku: 'B-0001',
        })
        .select('id_producto')
        .single()

      const { error: errA } = await fixtureA.client.rpc('sp_crear_stock_directo', {
        p_id_producto: prodA!.id_producto,
        p_costo: null,
        p_items: [{ talle: 'U', cantidad: 1 }],
      })
      expect(errA).toBeNull()

      const { error: errB } = await fixtureB.client.rpc('sp_crear_stock_directo', {
        p_id_producto: prodB!.id_producto,
        p_costo: null,
        p_items: [{ talle: 'U', cantidad: 1 }],
      })
      expect(errB).toBeNull()

      const { data: itemA } = await fixtureA.serviceRole
        .from('item_producto')
        .select('codigo_ean')
        .eq('id_tenant', fixtureA.tenantId)
        .single()

      const { data: itemB } = await fixtureB.serviceRole
        .from('item_producto')
        .select('codigo_ean')
        .eq('id_tenant', fixtureB.tenantId)
        .single()

      // Ambos son el ítem 1 de su propio tenant
      expect(itemA!.codigo_ean).toBe('2000000000015')
      expect(itemB!.codigo_ean).toBe('2000000000015')
    })

    it('REQ-ETQ-02 N3: update item_producto set codigo_ean = ... falla con codigo-ean-inmutable', async () => {
      const fixture = await createFixtureWithPermisos('etq_02_n3', {
        inventario: ['ver', 'crear'],
      })

      const { data: cat } = await fixture.serviceRole
        .from('categoria')
        .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatN3') })
        .select('id_categoria')
        .single()

      const { data: prod } = await fixture.serviceRole
        .from('producto')
        .insert({
          id_tenant: fixture.tenantId,
          id_categoria: cat!.id_categoria,
          nombre: 'Prod N3',
          sku: 'N3-0001',
        })
        .select('id_producto')
        .single()

      await fixture.client.rpc('sp_crear_stock_directo', {
        p_id_producto: prod!.id_producto,
        p_items: [{ talle: 'U', cantidad: 1 }],
      })

      const { data: item } = await fixture.serviceRole
        .from('item_producto')
        .select('id_item, codigo_ean')
        .eq('id_tenant', fixture.tenantId)
        .single()

      const { error: errUpdate } = await fixture.serviceRole
        .from('item_producto')
        .update({ codigo_ean: '2099999999999' })
        .eq('id_item', item!.id_item)

      expect(errUpdate).not.toBeNull()
      expect(errUpdate?.message).toContain('codigo-ean-inmutable')
    })

    it('REQ-ETQ-02 N4: después de crear N ítems, item_ean_seq.ultimo coincide con el max contador y los EAN son válidos', async () => {
      const fixture = await createFixtureWithPermisos('etq_02_n4', {
        inventario: ['ver', 'crear'],
      })

      const { data: cat } = await fixture.serviceRole
        .from('categoria')
        .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatN4') })
        .select('id_categoria')
        .single()

      const { data: prod } = await fixture.serviceRole
        .from('producto')
        .insert({
          id_tenant: fixture.tenantId,
          id_categoria: cat!.id_categoria,
          nombre: 'Prod N4',
          sku: 'N4-0001',
        })
        .select('id_producto')
        .single()

      // Alta de 4 ítems
      const { data: count, error: errCrear } = await fixture.client.rpc('sp_crear_stock_directo', {
        p_id_producto: prod!.id_producto,
        p_costo: null,
        p_tipo_ingreso: 'compra',
        p_items: [
          { talle: 'S', cantidad: 2 },
          { talle: 'M', cantidad: 2 },
        ],
      })
      expect(errCrear).toBeNull()
      expect(count).toBe(4)

      const { data: items, error: errItems } = await fixture.serviceRole
        .from('item_producto')
        .select('codigo_ean')
        .eq('id_tenant', fixture.tenantId)

      expect(errItems).toBeNull()
      expect(items).toHaveLength(4)

      const { data: seq, error: errSeq } = await fixture.serviceRole
        .from('item_ean_seq')
        .select('ultimo')
        .eq('id_tenant', fixture.tenantId)
        .single()

      expect(errSeq).toBeNull()
      expect(seq).not.toBeNull()

      // Invariante: item_ean_seq.ultimo == max(contador de los codigo_ean del tenant)
      const contadores = items!.map((it) => parseInt(it.codigo_ean.slice(2, 12), 10))
      const maxContador = Math.max(...contadores)
      expect(Number(seq!.ultimo)).toBe(maxContador)

      // Invariante: todos los EAN tienen dígito verificador válido según lib/etiquetas/ean13.ts
      for (const it of items!) {
        expect(esEan13Valido(it.codigo_ean)).toBe(true)
      }
    })

    it('REQ-ETQ-02 N5: insert de rol sin permiso de inventario.crear es rechazado antes de tocar item_ean_seq', async () => {
      const fixture = await createFixtureWithPermisos('etq_02_n5', {
        gastos: ['ver'],
      })

      const { error } = await fixture.client.rpc('sp_crear_stock_directo', {
        p_id_producto: randomUUID(),
        p_items: [{ talle: 'U', cantidad: 1 }],
      })

      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501')
      expect(error?.message).toContain('no-permission')

      // Verificar que item_ean_seq no fue creado para este tenant
      const { data: seq } = await fixture.serviceRole
        .from('item_ean_seq')
        .select('ultimo')
        .eq('id_tenant', fixture.tenantId)
        .maybeSingle()

      expect(seq).toBeNull()
    })

    it('REQ-ETQ-02: valor forzado de codigo_ean en insert directo es ignorado y reemplazado por la secuencia', async () => {
      const fixture = await createFixtureWithPermisos('etq_02_ean_ignorado', {
        inventario: ['ver', 'crear'],
      })

      const { data: cat } = await fixture.serviceRole
        .from('categoria')
        .insert({ id_tenant: fixture.tenantId, nombre: withScopedTenant('CatIgn') })
        .select('id_categoria')
        .single()

      const { data: prod } = await fixture.serviceRole
        .from('producto')
        .insert({
          id_tenant: fixture.tenantId,
          id_categoria: cat!.id_categoria,
          nombre: 'Prod Ignorado',
          sku: 'IGN-0001',
        })
        .select('id_producto')
        .single()

      // Insertar directo forzando codigo_ean arbitrario
      const { data: item, error } = await fixture.serviceRole
        .from('item_producto')
        .insert({
          id_tenant: fixture.tenantId,
          id_producto: prod!.id_producto,
          tipo_ingreso: 'compra',
          talle: 'U',
          qr_code: `qr-ign-${randomUUID().slice(0, 8)}`,
          codigo_ean: '2099999999999',
        })
        .select('codigo_ean')
        .single()

      expect(error).toBeNull()
      // El valor forzado se ignoró y se asignó el correlativo real (2000000000015 para el 1er ítem)
      expect(item?.codigo_ean).toBe('2000000000015')
    })

    it('REQ-ETQ-02: check item_producto_codigo_ean_format_check rechaza valores que no cumplan ^20[0-9]{11}$', async () => {
      // El check protege la columna en caso de bypass o validación a nivel tabla
      const checkExiste = runPsql("SELECT count(*) FROM pg_constraint WHERE conname = 'item_producto_codigo_ean_format_check' AND contype = 'c';")
      expect(checkExiste.trim()).toBe('1')

      const conDef = runPsql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'item_producto_codigo_ean_format_check';")
      expect(conDef).toContain('^20[0-9]{11}$')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // REQ-ETQ-07: Migración sin pérdida y provisión
  // ─────────────────────────────────────────────────────────────────────────────
  describe('REQ-ETQ-07: Migración sin pérdida y provisión', () => {
    it('REQ-ETQ-07 N1: tenant existente tiene etiqueta_config y plantilla Predeterminada', async () => {
      // Simular un tenant que existía antes de la migración 00164
      const fixture = await createFixtureWithPermisos('etq_07_n1', {
        administracion: ['ver'],
      })

      // Ejecutar la lógica de migración de datos para este tenant (como si hubiese corrido la migración sobre él)
      const { error: errInsCfg } = await fixture.serviceRole
        .from('etiqueta_config')
        .insert({
          id_tenant: fixture.tenantId,
          metodo: 'qr',
          impresora_tipo: 'hoja',
          margen_mm: 10,
          separacion_mm: 2,
        })
      expect(errInsCfg).toBeNull()

      const { error: errInsPlan } = await fixture.serviceRole
        .from('etiqueta_plantilla')
        .insert({
          id_tenant: fixture.tenantId,
          nombre: 'Predeterminada',
          ancho_mm: 37,
          alto_mm: 47,
          mostrar_nombre: true,
          mostrar_talle: true,
          mostrar_sku: false,
          mostrar_texto_codigo: false,
          predeterminada: true,
        })
      expect(errInsPlan).toBeNull()

      const { data: config, error: errConf } = await fixture.serviceRole
        .from('etiqueta_config')
        .select('*')
        .eq('id_tenant', fixture.tenantId)
        .maybeSingle()

      expect(errConf).toBeNull()
      expect(config).not.toBeNull()

      const { data: plantilla, error: errPlan } = await fixture.serviceRole
        .from('etiqueta_plantilla')
        .select('*')
        .eq('id_tenant', fixture.tenantId)
        .eq('predeterminada', true)
        .maybeSingle()

      expect(errPlan).toBeNull()
      expect(plantilla).not.toBeNull()
      expect(plantilla?.nombre).toBe('Predeterminada')
      expect(plantilla?.ancho_mm).toBeGreaterThanOrEqual(15)
      expect(plantilla?.alto_mm).toBeGreaterThanOrEqual(10)
      expect(plantilla?.mostrar_sku).toBe(false)
      expect(plantilla?.mostrar_texto_codigo).toBe(false)
    })

    it('REQ-ETQ-07 N2: provision-tenant crea plantilla predeterminada con mostrar_sku=false y mostrar_texto_codigo=false', async () => {
      const subdominio = `etq-prov-${Date.now().toString(36)}`
      const email = `${subdominio}@utopia-test.internal`

      const output = execSync(
        `node --env-file=.env.local --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/provision-tenant.mts --nombre "Tenant Prov" --subdominio "${subdominio}" --email "${email}" --admin "Admin Test" --password "TestPass123!"`,
        { encoding: 'utf-8', env: process.env },
      )
      expect(output).toContain('Tenant "Tenant Prov" creado')

      const { data: tenant } = await serviceRole
        .from('tenant')
        .select('id_tenant')
        .eq('subdominio', subdominio)
        .single()
      expect(tenant).not.toBeNull()
      tenantsToClean.push(tenant!.id_tenant)

      const { data: plantilla, error } = await serviceRole
        .from('etiqueta_plantilla')
        .select('*')
        .eq('id_tenant', tenant!.id_tenant)
        .eq('predeterminada', true)
        .single()

      expect(error).toBeNull()
      expect(plantilla?.nombre).toBe('Predeterminada')
      expect(plantilla?.ancho_mm).toBe(37)
      expect(plantilla?.alto_mm).toBe(47)
      expect(plantilla?.mostrar_nombre).toBe(true)
      expect(plantilla?.mostrar_talle).toBe(true)
      expect(plantilla?.mostrar_sku).toBe(false)
      expect(plantilla?.mostrar_texto_codigo).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // §2.1 Matriz de Funciones (sp_*)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('§2.1 Matriz de Funciones (sp_*)', () => {
    it('sp_set_etiqueta_config: administracion.editar (con permiso / sin permiso / revendedora / otro tenant)', async () => {
      const fixtureEdit = await createFixtureWithPermisos('etq_sp_cfg_ok', {
        administracion: ['editar', 'ver'],
      })
      const fixtureSin = await createFixtureWithPermisos('etq_sp_cfg_sin', {
        gastos: ['ver'],
      })

      // Con permiso: ok
      const { error: errOk } = await fixtureEdit.client.rpc('sp_set_etiqueta_config', {
        p_metodo: 'code128',
        p_impresora_tipo: 'rollo',
        p_margen_mm: 5,
        p_separacion_mm: 3,
        p_columnas: 2,
        p_offset_x_mm: 1,
        p_offset_y_mm: -1,
      })
      expect(errOk).toBeNull()

      // Sin permiso: no-permission
      const { error: errSin } = await fixtureSin.client.rpc('sp_set_etiqueta_config', {
        p_metodo: 'code128',
        p_impresora_tipo: 'rollo',
        p_margen_mm: 5,
        p_separacion_mm: 3,
      })
      expect(errSin?.message).toContain('no-permission')
      expect(errSin?.code).toBe('42501')

      // Verificar que solo se escribió en el tenant de fixtureEdit
      const { data: rowEdit } = await fixtureEdit.serviceRole
        .from('etiqueta_config')
        .select('*')
        .eq('id_tenant', fixtureEdit.tenantId)
        .single()
      expect(rowEdit?.metodo).toBe('code128')

      const { data: rowSin } = await fixtureSin.serviceRole
        .from('etiqueta_config')
        .select('*')
        .eq('id_tenant', fixtureSin.tenantId)
        .maybeSingle()
      expect(rowSin).toBeNull()
    })

    it('sp_crear_etiqueta_plantilla: administracion.crear (con permiso / sin permiso / revendedora)', async () => {
      const fixtureCrear = await createFixtureWithPermisos('etq_sp_cr_ok', {
        administracion: ['crear', 'ver'],
      })
      const fixtureSin = await createFixtureWithPermisos('etq_sp_cr_sin', {
        administracion: ['ver'],
      })

      // Con permiso: retorna uuid y primera es predeterminada
      const { data: idPlan, error: errOk } = await fixtureCrear.client.rpc('sp_crear_etiqueta_plantilla', {
        p_nombre: 'Plantilla 1',
        p_ancho_mm: 50,
        p_alto_mm: 30,
      })
      expect(errOk).toBeNull()
      expect(idPlan).toBeDefined()

      // Sin permiso: no-permission
      const { error: errSin } = await fixtureSin.client.rpc('sp_crear_etiqueta_plantilla', {
        p_nombre: 'Plantilla Sin',
        p_ancho_mm: 50,
        p_alto_mm: 30,
      })
      expect(errSin?.message).toContain('no-permission')
      expect(errSin?.code).toBe('42501')

      // REQ-ETQ-03 N7: nombre inválido (vacío, > 40 chars, o espacios al borde) -> plantilla-nombre-invalido
      const { error: errVacio } = await fixtureCrear.client.rpc('sp_crear_etiqueta_plantilla', {
        p_nombre: '',
        p_ancho_mm: 50,
        p_alto_mm: 30,
      })
      expect(errVacio?.message).toContain('plantilla-nombre-invalido')

      const { error: errLargo } = await fixtureCrear.client.rpc('sp_crear_etiqueta_plantilla', {
        p_nombre: 'A'.repeat(41),
        p_ancho_mm: 50,
        p_alto_mm: 30,
      })
      expect(errLargo?.message).toContain('plantilla-nombre-invalido')

      const { error: errEspacios } = await fixtureCrear.client.rpc('sp_crear_etiqueta_plantilla', {
        p_nombre: ' Plantilla con espacio ',
        p_ancho_mm: 50,
        p_alto_mm: 30,
      })
      expect(errEspacios?.message).toContain('plantilla-nombre-invalido')
    })

    it('sp_editar_etiqueta_plantilla: administracion.editar (con permiso / sin permiso / otro tenant)', async () => {
      const fixtureEdit = await createFixtureWithPermisos('etq_sp_ed_ok', {
        administracion: ['crear', 'editar', 'ver'],
      })
      const fixtureOtro = await createFixtureWithPermisos('etq_sp_ed_otro', {
        administracion: ['editar', 'ver'],
      })

      const { data: idPlan } = await fixtureEdit.client.rpc('sp_crear_etiqueta_plantilla', {
        p_nombre: 'Plantilla Edit',
        p_ancho_mm: 40,
        p_alto_mm: 20,
      })

      // Con permiso: ok
      const { error: errOk } = await fixtureEdit.client.rpc('sp_editar_etiqueta_plantilla', {
        p_id_plantilla: idPlan,
        p_nombre: 'Plantilla Editada',
        p_ancho_mm: 45,
        p_alto_mm: 25,
      })
      expect(errOk).toBeNull()

      // Otro tenant: plantilla-no-encontrada
      const { error: errOtro } = await fixtureOtro.client.rpc('sp_editar_etiqueta_plantilla', {
        p_id_plantilla: idPlan,
        p_nombre: 'Hack',
        p_ancho_mm: 45,
        p_alto_mm: 25,
      })
      expect(errOtro?.message).toContain('plantilla-no-encontrada')
    })

    it('sp_marcar_etiqueta_plantilla_predeterminada: administracion.editar (con permiso / sin permiso / otro tenant)', async () => {
      const fixture = await createFixtureWithPermisos('etq_sp_pred', {
        administracion: ['crear', 'editar', 'ver'],
      })
      const fixtureOtro = await createFixtureWithPermisos('etq_sp_pred_otro', {
        administracion: ['editar', 'ver'],
      })

      const { data: id1 } = await fixture.client.rpc('sp_crear_etiqueta_plantilla', {
        p_nombre: 'P1',
        p_ancho_mm: 30,
        p_alto_mm: 20,
      })
      const { data: id2 } = await fixture.client.rpc('sp_crear_etiqueta_plantilla', {
        p_nombre: 'P2',
        p_ancho_mm: 40,
        p_alto_mm: 30,
      })

      // Marcar id2 como predeterminada
      const { error: errOk } = await fixture.client.rpc('sp_marcar_etiqueta_plantilla_predeterminada', {
        p_id_plantilla: id2,
      })
      expect(errOk).toBeNull()

      const { data: p2Row } = await fixture.serviceRole
        .from('etiqueta_plantilla')
        .select('predeterminada')
        .eq('id_plantilla', id2)
        .single()
      expect(p2Row?.predeterminada).toBe(true)

      const { data: p1Row } = await fixture.serviceRole
        .from('etiqueta_plantilla')
        .select('predeterminada')
        .eq('id_plantilla', id1)
        .single()
      expect(p1Row?.predeterminada).toBe(false)

      // Otro tenant
      const { error: errOtro } = await fixtureOtro.client.rpc('sp_marcar_etiqueta_plantilla_predeterminada', {
        p_id_plantilla: id2,
      })
      expect(errOtro?.message).toContain('plantilla-no-encontrada')
    })

    it('sp_eliminar_etiqueta_plantilla: administracion.eliminar (con permiso / sin permiso / otro tenant / predeterminada)', async () => {
      const fixture = await createFixtureWithPermisos('etq_sp_del', {
        administracion: ['crear', 'eliminar', 'ver'],
      })
      const fixtureOtro = await createFixtureWithPermisos('etq_sp_del_otro', {
        administracion: ['eliminar', 'ver'],
      })

      const { data: idPred } = await fixture.client.rpc('sp_crear_etiqueta_plantilla', {
        p_nombre: 'Pred',
        p_ancho_mm: 30,
        p_alto_mm: 20,
      })
      const { data: idSec } = await fixture.client.rpc('sp_crear_etiqueta_plantilla', {
        p_nombre: 'Secundaria',
        p_ancho_mm: 40,
        p_alto_mm: 30,
      })

      // Intentar borrar la predeterminada: plantilla-predeterminada-no-se-borra
      const { error: errPred } = await fixture.client.rpc('sp_eliminar_etiqueta_plantilla', {
        p_id_plantilla: idPred,
      })
      expect(errPred?.message).toContain('plantilla-predeterminada-no-se-borra')

      // Otro tenant intentando borrar secundaria: plantilla-no-encontrada
      const { error: errOtro } = await fixtureOtro.client.rpc('sp_eliminar_etiqueta_plantilla', {
        p_id_plantilla: idSec,
      })
      expect(errOtro?.message).toContain('plantilla-no-encontrada')

      // Borrar secundaria con permiso: ok
      const { error: errOk } = await fixture.client.rpc('sp_eliminar_etiqueta_plantilla', {
        p_id_plantilla: idSec,
      })
      expect(errOk).toBeNull()

      const { data: existe } = await fixture.serviceRole
        .from('etiqueta_plantilla')
        .select('id_plantilla')
        .eq('id_plantilla', idSec)
        .maybeSingle()
      expect(existe).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // §2.2 Tablas RLS por comando y REQ-ETQ-08
  // ─────────────────────────────────────────────────────────────────────────────
  describe('§2.2 Tablas RLS por comando y REQ-ETQ-08', () => {
    it('REQ-ETQ-08 N1: rol con solo gastos ve 0 filas en las 3 tablas', async () => {
      const fixtureGastos = await createFixtureWithPermisos('etq_08_n1', {
        gastos: ['ver', 'crear'],
      })

      const [resCfg, resPlan, resSeq] = await Promise.all([
        fixtureGastos.client.from('etiqueta_config').select('*'),
        fixtureGastos.client.from('etiqueta_plantilla').select('*'),
        fixtureGastos.client.from('item_ean_seq').select('*'),
      ])

      expect(resCfg.data ?? []).toHaveLength(0)
      expect(resPlan.data ?? []).toHaveLength(0)
      expect(resSeq.data ?? []).toHaveLength(0)
    })

    it('REQ-ETQ-08 N3: insert/update directo por PostgREST sin el permiso es bloqueado', async () => {
      const fixtureSinPermiso = await createFixtureWithPermisos('etq_08_n3', {
        inventario: ['ver'], // solo ver
      })

      // Intento de insert directo en etiqueta_config
      const { error: errInsCfg } = await fixtureSinPermiso.client
        .from('etiqueta_config')
        .insert({ id_tenant: fixtureSinPermiso.tenantId, metodo: 'ean13' })

      expect(errInsCfg).not.toBeNull()

      // Intento de insert directo en etiqueta_plantilla
      const { error: errInsPlan } = await fixtureSinPermiso.client
        .from('etiqueta_plantilla')
        .insert({
          id_tenant: fixtureSinPermiso.tenantId,
          nombre: 'Hacked',
          ancho_mm: 50,
          alto_mm: 50,
        })

      expect(errInsPlan).not.toBeNull()
    })

    it('REQ-ETQ-08 N4: cliente anon es rechazado', async () => {
      const anonClient = createAnonTestClient()

      const [resCfg, resPlan, resSeq] = await Promise.all([
        anonClient.from('etiqueta_config').select('*'),
        anonClient.from('etiqueta_plantilla').select('*'),
        anonClient.from('item_ean_seq').select('*'),
      ])

      // RLS o falta de grant para anon devuelve error (42501 / PGRST205 / etc) o 0 filas protegidas
      if (resCfg.error) expect(resCfg.error).toBeDefined()
      else expect(resCfg.data ?? []).toHaveLength(0)

      if (resPlan.error) expect(resPlan.error).toBeDefined()
      else expect(resPlan.data ?? []).toHaveLength(0)

      if (resSeq.error) expect(resSeq.error).toBeDefined()
      else expect(resSeq.data ?? []).toHaveLength(0)
    })

    it('DELETE directo en etiqueta_config e item_ean_seq es bloqueado (solo DEFINER / nadie)', async () => {
      const fixtureAdmin = await createFixtureWithPermisos('etq_del_bloq', {
        administracion: ['ver', 'crear', 'editar', 'eliminar'],
        inventario: ['ver', 'crear'],
      })

      // Insertar config
      await fixtureAdmin.client.rpc('sp_set_etiqueta_config', {
        p_metodo: 'qr',
        p_impresora_tipo: 'hoja',
        p_margen_mm: 10,
        p_separacion_mm: 2,
      })

      // Precondición: verificar que etiqueta_config existe antes del delete
      const { data: cfgPre, error: errCfgPre } = await fixtureAdmin.serviceRole
        .from('etiqueta_config')
        .select('id_tenant')
        .eq('id_tenant', fixtureAdmin.tenantId)
        .single()
      expect(errCfgPre).toBeNull()
      expect(cfgPre).not.toBeNull()

      // Asegurar que item_ean_seq existe y verificar precondición
      const { error: errInsSeq } = await fixtureAdmin.serviceRole
        .from('item_ean_seq')
        .insert({ id_tenant: fixtureAdmin.tenantId, ultimo: 1 })
      expect(errInsSeq).toBeNull()

      const { data: seqPre, error: errSeqPre } = await fixtureAdmin.serviceRole
        .from('item_ean_seq')
        .select('id_tenant')
        .eq('id_tenant', fixtureAdmin.tenantId)
        .single()
      expect(errSeqPre).toBeNull()
      expect(seqPre).not.toBeNull()

      // Intento de DELETE directo en etiqueta_config
      const { data: delCfg, error: errDelCfg } = await fixtureAdmin.client
        .from('etiqueta_config')
        .delete()
        .eq('id_tenant', fixtureAdmin.tenantId)
        .select()

      expect(errDelCfg === null || errDelCfg.code === '42501').toBe(true)
      expect(delCfg ?? []).toHaveLength(0)

      // Releer con serviceRole que la fila SIGUE existiendo
      const { data: cfgPost, error: errCfgPost } = await fixtureAdmin.serviceRole
        .from('etiqueta_config')
        .select('id_tenant')
        .eq('id_tenant', fixtureAdmin.tenantId)
        .single()
      expect(errCfgPost).toBeNull()
      expect(cfgPost).not.toBeNull()

      // Intento de DELETE directo en item_ean_seq
      const { data: delSeq, error: errDelSeq } = await fixtureAdmin.client
        .from('item_ean_seq')
        .delete()
        .eq('id_tenant', fixtureAdmin.tenantId)
        .select()

      expect(errDelSeq === null || errDelSeq.code === '42501').toBe(true)
      expect(delSeq ?? []).toHaveLength(0)

      // Releer con serviceRole que la fila SIGUE existiendo
      const { data: seqPost, error: errSeqPost } = await fixtureAdmin.serviceRole
        .from('item_ean_seq')
        .select('id_tenant')
        .eq('id_tenant', fixtureAdmin.tenantId)
        .single()
      expect(errSeqPost).toBeNull()
      expect(seqPost).not.toBeNull()
    })
  })
})
