import { contenido } from '../pages/AppShell'
import { expect, test } from '../fixtures/test'
import { serviceRoleClient } from '../support/supabase'

test.describe('Rendiciones', () => {
  test('el listado muestra el estado vacío del tenant nuevo', async ({ page, shell }) => {
    await page.goto('/rendiciones')

    await expect(shell.titulo).toHaveText('Rendiciones')
    await expect(page.getByText('Sin rendiciones generadas')).toBeVisible()
  })

  test('el alta pide un proveedor antes de mostrar nada', async ({ page, shell }) => {
    await page.goto('/rendiciones/nueva')

    await expect(shell.titulo).toHaveText('Generar rendición')
    await expect(
      page.getByText('Elegí un proveedor para ver las ventas pendientes de rendirle.'),
    ).toBeVisible()
  })

  test('un proveedor sin ventas de consignación no tiene líneas pendientes', async ({
    page,
    seed,
  }) => {
    await page.goto('/rendiciones/nueva')

    await contenido(page).getByLabel(/^Proveedor/)
      .selectOption({ label: `${seed.proveedorConsignatario.nombre} · consignatario` })

    await expect(page).toHaveURL(new RegExp(`prov=${seed.proveedorConsignatario.id}`))
    await expect(page.getByText('No hay líneas pendientes')).toBeVisible()
  })
})

test.describe('Reportes', () => {
  test('la vista consolidada carga con el período por defecto', async ({ page, shell }) => {
    await page.goto('/reportes')

    await expect(shell.titulo).toHaveText('Tablero financiero')
    await expect(page.getByText('Vendiste', { exact: true })).toBeVisible()

    // El gráfico de tendencia debe terminar en el mes actual
    const mesActual = Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit' }).format(new Date())
    await expect(page.locator('svg text.text-muted.font-medium').last()).toHaveText(mesActual)
  })

  test('cambiar el período se refleja en la URL', async ({ page }) => {
    await page.goto('/reportes')

    await page.getByRole('button', { name: 'Mes anterior' }).click()

    await expect(page).toHaveURL(/desde=\d{4}-\d{2}-\d{2}/)
    await expect(page).toHaveURL(/hasta=\d{4}-\d{2}-\d{2}/)
  })

  test('el bloque Canal Revendedor está visible con módulo y permiso activos', async ({ page }) => {
    await page.goto('/reportes')
    await expect(page.getByText('Canal Revendedor')).toBeVisible()
    await expect(page.locator('section').filter({ hasText: 'Canal Revendedor' }).getByRole('button', { name: 'Exportar CSV' })).toBeVisible()
  })

  test('el bloque Canal Revendedor se oculta cuando el módulo está deshabilitado', async ({ page, seed }) => {
    const sr = serviceRoleClient()
    const { data: mod } = await sr
      .from('modulo')
      .select('id_modulo')
      .eq('codigo', 'revendedoras')
      .single()
    expect(mod?.id_modulo).toBeDefined()

    // Apagar módulo revendedoras para el tenant
    await sr
      .from('tenant_modulo')
      .update({ habilitado: false })
      .eq('id_tenant', seed.tenantId)
      .eq('id_modulo', mod!.id_modulo)

    try {
      await page.goto('/reportes')
      await expect(page.getByRole('heading', { name: 'Tablero financiero' })).toBeVisible()
      await expect(page.getByText('Canal Revendedor')).toHaveCount(0)
    } finally {
      // Restaurar módulo revendedoras
      await sr
        .from('tenant_modulo')
        .update({ habilitado: true })
        .eq('id_tenant', seed.tenantId)
        .eq('id_modulo', mod!.id_modulo)
    }
  })

  test('el bloque Canal Revendedor se oculta si el rol no tiene permiso revendedoras:ver', async ({ page, seed }) => {
    const sr = serviceRoleClient()
    // Obtener el rol del usuario admin del seed
    const { data: usuario } = await sr
      .from('usuario')
      .select('id_rol, rol(permisos)')
      .eq('id_tenant', seed.tenantId)
      .limit(1)
      .single()
    expect(usuario?.id_rol).toBeDefined()

    const rolData = usuario?.rol as unknown as { permisos: Record<string, unknown> } | null
    const permisosOriginales = rolData?.permisos || {}
    // Quitar revendedoras de los permisos temporalmente
    const permisosSinRev = { ...permisosOriginales }
    delete permisosSinRev.revendedoras

    await sr
      .from('rol')
      .update({ permisos: permisosSinRev })
      .eq('id_rol', usuario!.id_rol)

    try {
      await page.goto('/reportes')
      await expect(page.getByRole('heading', { name: 'Tablero financiero' })).toBeVisible()
      await expect(page.getByText('Canal Revendedor')).toHaveCount(0)
    } finally {
      // Restaurar permisos originales
      await sr
        .from('rol')
        .update({ permisos: permisosOriginales })
        .eq('id_rol', usuario!.id_rol)
    }
  })
})

