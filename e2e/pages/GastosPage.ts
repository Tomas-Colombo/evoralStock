import { expect, type Locator, type Page } from '@playwright/test'
import { alerta, AppShell } from './AppShell'

/** `/gastos` list + `NuevoGastoModal` popup. */
export class GastosPage {
  readonly shell: AppShell

  constructor(readonly page: Page) {
    this.shell = new AppShell(page)
  }

  async abrir(): Promise<void> {
    await this.page.goto('/gastos')
    await expect(this.shell.titulo).toHaveText('Gastos')
  }

  /** The form lives in a modal over the list, opened from the band action button. */
  async abrirNuevo(): Promise<void> {
    await this.abrir()
    await this.page.getByRole('button', { name: 'Nuevo gasto' }).first().click()
    await expect(this.modalNuevo).toBeVisible()
  }

  /** `Modal` portals to `document.body`, so fields are scoped here, not to `main`. */
  get modalNuevo(): Locator {
    return this.page.getByRole('dialog')
  }

  get categoria(): Locator {
    return this.modalNuevo.getByLabel(/^Categoría/)
  }

  get monto(): Locator {
    return this.modalNuevo.getByLabel(/^Monto/)
  }

  get fecha(): Locator {
    return this.modalNuevo.getByLabel(/^Fecha/)
  }

  get descripcion(): Locator {
    return this.modalNuevo.getByLabel(/^Descripción/)
  }

  get guardar(): Locator {
    return this.page.getByRole('button', { name: /Registrar gasto|Guardando/ })
  }

  /** Form-level banner (`role="alert"`) used for monto/categoría failures. */
  get error(): Locator {
    return alerta(this.page)
  }

  fila(texto: string): Locator {
    return this.page.getByRole('row').filter({ hasText: texto })
  }

  async registrar(input: {
    categoria: string
    monto: string
    descripcion?: string
  }): Promise<void> {
    await this.abrirNuevo()
    await this.categoria.selectOption({ label: input.categoria })
    await this.monto.fill(input.monto)
    if (input.descripcion) await this.descripcion.fill(input.descripcion)
    await this.guardar.click()
  }
}
