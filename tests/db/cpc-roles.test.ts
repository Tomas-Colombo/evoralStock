import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createServiceRoleTestClient } from '@/lib/dal/supabase-test'
import { createTenantWithUser, hasTestDb, runPsql } from './_helpers'

describe.skipIf(!hasTestDb)('CPC Fase 3B — migración de roles (00152)', () => {
  const serviceRole = createServiceRoleTestClient()

  it('UP de 00152 agrega ver_costos, cargar_costos y ver_margenes solo al Administrador de forma idempotente', async () => {
    const tenant = await createTenantWithUser('cpc-roles-perm')

    // 1. Configuramos el rol Administrador sin las 3 acciones nuevas
    await serviceRole
      .from('rol')
      .update({
        permisos: {
          inventario: ['ver', 'crear', 'editar', 'eliminar'],
          precios: ['ver', 'crear', 'editar', 'eliminar', 'editar_cotizacion'],
        },
      })
      .eq('id_tenant', tenant.tenantId)
      .eq('nombre', 'Administrador')

    // 2. Creamos un rol limitado ("Vendedora-Local", §9)
    await serviceRole.from('rol').insert({
      id_tenant: tenant.tenantId,
      nombre: 'Vendedora-Local',
      permisos: {
        gastos: ['ver', 'crear'],
        ventas: ['crear', 'editar'],
        precios: ['ver'],
        inventario: ['ver', 'crear', 'editar'],
        revendedoras: ['ver'],
      },
    })

    // 3. Leemos supabase/migrations/00152_cpc_roles_seed.sql y extraemos su UP (sin comentarios)
    const rutaMigracion = path.join(process.cwd(), 'supabase', 'migrations', '00152_cpc_roles_seed.sql')
    const contenido = fs.readFileSync(rutaMigracion, 'utf8')
    const upSql = contenido
      .split(/\r?\n/)
      .filter((linea) => !linea.trim().startsWith('--'))
      // Una sola línea: runPsql pasa el SQL por `psql -c` y en Windows el
      // shell corta el comando en el primer salto de línea.
      .join(' ')
      .trim()

    // 4. Ejecutar UP con runPsql
    runPsql(upSql)

    // Verificar Administrador
    const { data: adminUp } = await serviceRole
      .from('rol')
      .select('permisos')
      .eq('id_tenant', tenant.tenantId)
      .eq('nombre', 'Administrador')
      .single()

    const permisosAdminUp = adminUp!.permisos as Record<string, string[]>
    expect(permisosAdminUp.inventario).toContain('ver_costos')
    expect(permisosAdminUp.inventario).toContain('cargar_costos')
    expect(permisosAdminUp.precios).toContain('ver_margenes')

    // Verificar rol limitado (Vendedora-Local NO debe recibir nada)
    const { data: vendedoraUp } = await serviceRole
      .from('rol')
      .select('permisos')
      .eq('id_tenant', tenant.tenantId)
      .eq('nombre', 'Vendedora-Local')
      .single()

    const permisosVendedora = vendedoraUp!.permisos as Record<string, string[]>
    expect(permisosVendedora.inventario).not.toContain('ver_costos')
    expect(permisosVendedora.inventario).not.toContain('cargar_costos')
    expect(permisosVendedora.precios).not.toContain('ver_margenes')

    // 5. Idempotencia: correr UP por segunda vez no debe duplicar las acciones
    runPsql(upSql)

    const { data: adminIdem } = await serviceRole
      .from('rol')
      .select('permisos')
      .eq('id_tenant', tenant.tenantId)
      .eq('nombre', 'Administrador')
      .single()

    const permisosAdminIdem = adminIdem!.permisos as Record<string, string[]>
    expect(permisosAdminIdem.inventario.filter((a) => a === 'ver_costos').length).toBe(1)
    expect(permisosAdminIdem.inventario.filter((a) => a === 'cargar_costos').length).toBe(1)
    expect(permisosAdminIdem.precios.filter((a) => a === 'ver_margenes').length).toBe(1)
  })
})
