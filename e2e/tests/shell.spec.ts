import { expect, test } from '../fixtures/test'

/**
 * The app shell: every module reachable from the rail, and the theme switch
 * that has to work from any route (REQ-DS-06).
 */
const RUTAS: Array<{ link: string; titulo: string }> = [
  { link: 'Ventas', titulo: 'Ventas' },
  { link: 'Inventario', titulo: 'Inventario' },
  { link: 'Ingresos', titulo: 'Ingresos de mercadería' },
  { link: 'Precios y Cuentas', titulo: 'Precios y Cuentas' },
  { link: 'Clientes', titulo: 'Clientes' },
  { link: 'Proveedores', titulo: 'Proveedores' },
  { link: 'Devoluciones prov.', titulo: 'Devoluciones a proveedor' },
  { link: 'Gastos', titulo: 'Gastos' },
  { link: 'Rendiciones', titulo: 'Rendiciones' },
  { link: 'Reportes', titulo: 'Reportes' },
  { link: 'Configuración', titulo: 'Configuración' },
]

test.describe('Shell de la aplicación', () => {
  test('la barra lateral lleva a todos los módulos habilitados', async ({ page, shell }) => {
    await page.goto('/ventas')

    for (const ruta of RUTAS) {
      await shell.irA(ruta.link, ruta.titulo)
    }
  })

  test('el conmutador de tema cambia el tema y lo persiste al recargar', async ({
    page,
    shell,
  }) => {
    await page.goto('/ventas')

    const inicial = await shell.temaActual()
    await shell.themeToggle.click()

    const cambiado = inicial === 'dark' ? 'light' : 'dark'
    await expect(page.locator('html')).toHaveAttribute('data-theme', cambiado)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', cambiado)

    // Leave the tenant as we found it — the theme is stored per user.
    await shell.themeToggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', inicial ?? 'light')
  })

  test('la raíz redirige a Ventas', async ({ page, shell }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/ventas$/)
    await expect(shell.titulo).toHaveText('Ventas')
  })
})
