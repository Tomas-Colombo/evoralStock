import { expect, type Locator, type Page } from '@playwright/test'
import { alerta, AppShell } from './AppShell'

/** `/proveedores` list + its "Nuevo proveedor" modal. */
export class ProveedoresPage {
  readonly shell: AppShell

  constructor(readonly page: Page) {
    this.shell = new AppShell(page)
  }

  async abrir(): Promise<void> {
    await this.page.goto('/proveedores')
    await expect(this.shell.titulo).toHaveText('Proveedores')
  }

  /** The form lives in a modal over the list, not on its own route. */
  async abrirNuevo(): Promise<void> {
    await this.page.getByRole('button', { name: 'Nuevo proveedor' }).first().click()
    await expect(this.modalNuevo).toBeVisible()
  }

  /** `Modal` portals to `document.body`, so fields are scoped here, not to `main`. */
  get modalNuevo(): Locator {
    return this.page.getByRole('dialog')
  }

  get nombre(): Locator {
    return this.modalNuevo.getByLabel(/^Nombre/)
  }

  get tipo(): Locator {
    return this.modalNuevo.getByLabel(/^Tipo/)
  }

  get diasRotacion(): Locator {
    return this.modalNuevo.getByLabel(/^Días de rotación/)
  }

  get telefono(): Locator {
    return this.modalNuevo.getByLabel(/^Teléfono/)
  }

  get guardar(): Locator {
    return this.page.getByRole('button', { name: /Crear proveedor|Guardando/ })
  }

  get errorNombre(): Locator {
    return alerta(this.page)
  }

  fila(nombre: string): Locator {
    return this.page.getByRole('row').filter({ hasText: nombre })
  }

  async crear(
    nombre: string,
    opciones: { tipo?: string; dias?: string; telefono?: string } = {},
  ): Promise<void> {
    await this.abrirNuevo()
    await this.nombre.fill(nombre)
    if (opciones.tipo) await this.tipo.selectOption({ label: opciones.tipo })
    if (opciones.dias) await this.diasRotacion.fill(opciones.dias)
    if (opciones.telefono) await this.telefono.fill(opciones.telefono)
    await this.guardar.click()
  }
}
