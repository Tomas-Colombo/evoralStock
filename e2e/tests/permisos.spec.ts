import { contenido } from '../pages/AppShell'
import { VENDEDOR } from '../config/env'
import { expect, test } from '../fixtures/test'

/**
 * Authorization gates, driven by the `Vendedor` role (ventas: ver + crear).
 *
 * A denied module redirects to `/?e=<reason>`, and the root route redirects on
 * to `/ventas` — so "bounced back to Ventas without ever rendering the module"
 * is the observable outcome, and that is what these specs assert.
 */
test.use({ storageState: VENDEDOR.storageState })

test.describe('Permisos por rol', () => {
  test('la barra lateral sólo muestra los módulos que el rol puede ver', async ({
    page,
    shell,
  }) => {
    await page.goto('/ventas')

    await expect(shell.navLink('Ventas')).toBeVisible()
    await expect(shell.navLink('Clientes')).toBeVisible()

    await expect(shell.navLink('Inventario')).toHaveCount(0)
    await expect(shell.navLink('Configuración')).toHaveCount(0)
    await expect(shell.navLink('Gastos')).toHaveCount(0)
  })

  test('el acceso directo a Inventario queda bloqueado', async ({ page, shell }) => {
    await page.goto('/inventario')

    await expect(page).toHaveURL(/\/ventas$/)
    await expect(shell.titulo).toHaveText('Ventas')
  })

  test('el acceso directo a Administración queda bloqueado', async ({ page, shell }) => {
    await page.goto('/administracion/usuarios')

    await expect(page).toHaveURL(/\/ventas$/)
    await expect(shell.titulo).toHaveText('Ventas')
  })

  test('el módulo permitido sigue accesible', async ({ page, shell }) => {
    await page.goto('/ventas/nueva')

    await expect(shell.titulo).toHaveText('Nueva venta')
    await expect(contenido(page).getByLabel(/^Escanear, tipear código/)).toBeVisible()
    await expect(page.getByLabel('Canal de venta')).toHaveCount(0)
  })
})
