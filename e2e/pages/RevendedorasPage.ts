import { expect, type Page } from '@playwright/test'

/**
 * `/revendedoras` — panel y alta de revendedoras.
 */
export class RevendedorasPage {
  constructor(readonly page: Page) {}

  /**
   * Da de alta una revendedora con acceso al portal, cierra el modal
   * "Acceso creado" con "Listo" y espera la navegación a `/revendedoras`.
   */
  async crearConAcceso(datos: {
    nombre: string
    apellido: string
    email: string
    password: string
  }): Promise<void> {
    await this.page.goto('/revendedoras/nuevo')
    await this.page.getByLabel(/^Nombre/).fill(datos.nombre)
    await this.page.getByLabel(/^Apellido/).fill(datos.apellido)
    await this.page.getByLabel(/^Email/).fill(datos.email)
    await this.page.getByLabel(/Crear acceso al sistema para la revendedora/i).check()
    await this.page.locator('#nr_password').fill(datos.password)
    await this.page.getByRole('button', { name: 'Guardar' }).click()

    const modalAcceso = this.page.getByRole('dialog', { name: 'Acceso creado' })
    await expect(modalAcceso).toBeVisible()
    await modalAcceso.getByRole('button', { name: 'Listo' }).click()
    await this.page.waitForURL(/\/revendedoras(\?|$)/)
  }
}
