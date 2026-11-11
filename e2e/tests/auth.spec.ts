import { ADMIN } from '../config/env'
import { expect, test } from '../fixtures/test'

/**
 * Authentication. Runs logged OUT — an empty storage state overrides the
 * project default, which is the admin session.
 */
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Autenticación', () => {
  test('una ruta protegida redirige al login cuando no hay sesión', async ({ page }) => {
    await page.goto('/ventas')

    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'EvoralStock' })).toBeVisible()
  })

  test('ingresa con credenciales válidas y aterriza en Ventas', async ({
    page,
    login,
    shell,
  }) => {
    await login.abrir()
    await login.ingresar(ADMIN.email, ADMIN.password)

    await page.waitForURL('**/ventas')
    await expect(shell.titulo).toHaveText('Ventas')
    // The sidebar renders the session email — proof the shell resolved a real
    // session, not just that the URL changed.
    await expect(page.getByText(ADMIN.email).first()).toBeVisible()
  })

  test('rechaza una contraseña incorrecta sin revelar si el email existe', async ({
    page,
    login,
  }) => {
    await login.abrir()
    await login.ingresar(ADMIN.email, 'contraseña-incorrecta')

    await expect(login.error).toHaveText('Credenciales inválidas')
    await expect(page).toHaveURL(/\/login/)
  })

  test('rechaza un email inexistente con el mismo mensaje genérico', async ({ login }) => {
    await login.abrir()
    await login.ingresar('no.existe.e2e@example.com', 'loQueSea123')

    await expect(login.error).toHaveText('Credenciales inválidas')
  })

  test('no envía el formulario con campos vacíos', async ({ page, login }) => {
    await login.abrir()
    await login.submit.click()

    const emailValido = await login.email.evaluate((el: HTMLInputElement) => el.checkValidity())
    expect(emailValido).toBe(false)
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('Cierre de sesión', () => {
  test('cerrar sesión vuelve al login y revoca el acceso', async ({ page, login, shell }) => {
    await login.abrir()
    await login.ingresar(ADMIN.email, ADMIN.password)
    await page.waitForURL('**/ventas')

    await shell.cerrarSesion()
    await expect(page.getByRole('heading', { name: 'EvoralStock' })).toBeVisible()

    await page.goto('/ventas')
    await expect(page).toHaveURL(/\/login/)
  })
})
