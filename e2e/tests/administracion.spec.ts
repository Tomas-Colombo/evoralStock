import { ADMIN } from '../config/env'
import { setModuloHabilitado } from '../support/tenant'
import { expect, test, unique, uniqueEmail } from '../fixtures/test'

test.describe('Administración · usuarios', () => {
  test('el listado muestra a los usuarios del tenant con su rol', async ({
    administracion,
    seed,
  }) => {
    await administracion.abrirUsuarios()

    const fila = administracion.fila(ADMIN.email)
    await expect(fila).toBeVisible()
    // The role is a live `<select>`, so the assertion is on its value.
    await expect(fila.getByLabel(`Rol de ${ADMIN.email}`)).toHaveValue(seed.rolAdminId)
    await expect(fila.getByText('Activo')).toBeVisible()
  })

  test('invita a un usuario con contraseña generada', async ({
    page,
    administracion,
    shell,
  }) => {
    const email = uniqueEmail('e2e.invitado')

    await administracion.abrirInvitar()
    await administracion.email.fill(email)
    await administracion.nombreCompleto.fill(unique('Invitado'))
    await administracion.rol.selectOption({ label: 'Vendedor' })
    await administracion.generarPassword.click()
    await administracion.invitar.click()

    await shell.expectSuccessToast('Usuario invitado')
    await page.waitForURL(/\/administracion\/usuarios$/)
    await expect(administracion.fila(email)).toBeVisible()
  })

  test('rechaza una invitación sin rol', async ({ administracion }) => {
    await administracion.abrirInvitar()
    await administracion.email.fill(uniqueEmail('e2e.sinrol'))
    await administracion.nombreCompleto.fill(unique('Sin rol'))
    await administracion.generarPassword.click()
    await administracion.invitar.click()

    await expect(administracion.error.first()).toHaveText('Elegí un rol')
  })

  test('rechaza una invitación con email inválido', async ({ page, administracion }) => {
    await administracion.abrirInvitar()
    await administracion.email.fill('no-es-un-email')
    await administracion.nombreCompleto.fill(unique('Email malo'))
    await administracion.rol.selectOption({ label: 'Vendedor' })
    await administracion.generarPassword.click()
    await administracion.invitar.click()

    // The field is `type="email"`, so native constraint validation rejects it
    // before the Server Action runs. Nothing is created and we stay put.
    const valido = await administracion.email.evaluate((el: HTMLInputElement) =>
      el.checkValidity(),
    )
    expect(valido).toBe(false)
    await expect(page).toHaveURL(/\/administracion\/usuarios\/nuevo$/)
  })
})

test.describe('Administración · módulos', () => {
  /**
   * Disabling a module is tenant-wide state that every other spec sees, so the
   * whole round trip lives in ONE test and an unconditional teardown puts it
   * back even when an assertion in the middle fails. Splitting it across two
   * tests once left the tenant with Reportes disabled and cascaded into
   * unrelated failures.
   */
  test.afterEach(async ({ seed }) => {
    await setModuloHabilitado(seed.tenantId, 'reportes', true)
  })

  test('deshabilitar un módulo corta el acceso y volver a habilitarlo lo restituye', async ({
    page,
    seed,
    shell,
  }) => {
    await setModuloHabilitado(seed.tenantId, 'reportes', false)

    // The route bounces, and the rail no longer offers a link that would.
    await page.goto('/reportes')
    await expect(page).toHaveURL(/\/ventas$/)
    await expect(page.locator('a[href="/reportes"]')).toHaveCount(0)

    await setModuloHabilitado(seed.tenantId, 'reportes', true)

    await page.goto('/reportes')
    await expect(shell.titulo).toHaveText('Reportes')
  })

  test('la administración del tenant no ofrece habilitar módulos', async ({
    page,
    administracion,
  }) => {
    await administracion.abrir()
    await expect(page.locator('a[href="/administracion/modulos"]')).toHaveCount(0)
  })
})

test.describe('Administración · auditoría', () => {
  test('la auditoría registra las acciones del tenant', async ({ page, administracion }) => {
    await administracion.abrirAuditoria()

    // The suite has already written plenty by the time this runs; the point is
    // that the trail renders rows rather than the empty state.
    await expect(page.getByText('Sin registros')).toHaveCount(0)
  })
})

test.describe('Administración · roles', () => {
  test('el modal de roles lista los roles del tenant', async ({ page, administracion }) => {
    await administracion.abrir()
    await page.getByRole('button', { name: /Roles/ }).click()

    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()
    await expect(modal.getByText('Administrador').first()).toBeVisible()
    await expect(modal.getByText('Vendedor').first()).toBeVisible()
  })
})
