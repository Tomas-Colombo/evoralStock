import { expect, type Locator, type Page } from '@playwright/test'
import { AppShell } from './AppShell'

/** `/clientes` list + its "Nuevo cliente" modal. */
export class ClientesPage {
  readonly shell: AppShell

  constructor(readonly page: Page) {
    this.shell = new AppShell(page)
  }

  async abrir(): Promise<void> {
    await this.page.goto('/clientes')
    await expect(this.shell.titulo).toHaveText('Clientes')
  }

  /** The form lives in a modal over the list, not on its own route. */
  async abrirNuevo(): Promise<void> {
    await this.page.getByRole('button', { name: 'Nuevo cliente' }).first().click()
    await expect(this.modalNuevo).toBeVisible()
  }

  get modalNuevo(): Locator {
    return this.page.getByRole('dialog')
  }

  /**
   * Form fields are scoped to the modal, NOT to `main`: `Modal` portals to
   * `document.body`, so a `main`-scoped locator finds nothing once the form
   * moved out of its own route.
   *
   * `<Field required>` appends a `*` marker inside the `<label>`, so the label
   * text is never exactly "Nombre". Anchored regexes match either shape.
   */
  get nombre(): Locator {
    return this.modalNuevo.getByLabel(/^Nombre/)
  }

  /** Required since 00058: the book is ordered and searched by it. */
  get apellido(): Locator {
    return this.modalNuevo.getByLabel(/^Apellido/)
  }

  get telefono(): Locator {
    return this.modalNuevo.getByLabel('Teléfono')
  }

  get email(): Locator {
    return this.modalNuevo.getByLabel('Email')
  }

  get guardar(): Locator {
    return this.modalNuevo.getByRole('button', { name: /Crear cliente|Guardando/ })
  }

  /**
   * Inline validation message for the NAME field, rendered by `<Field error>`.
   *
   * Anchored to `#nc-nombre-error` on purpose: since 00058 the form also validates
   * `apellido`, so a modal-wide `[role="alert"]` query matches two elements and
   * Playwright rejects it under strict mode.
   */
  get errorNombre(): Locator {
    return this.modalNuevo.locator('#nc-nombre-error')
  }

  get buscador(): Locator {
    return this.page.getByRole('searchbox')
  }

  fila(nombre: string): Locator {
    return this.page.getByRole('row').filter({ hasText: nombre })
  }

  async crear(
    nombre: string,
    extra: { apellido?: string; telefono?: string; email?: string } = {},
  ): Promise<void> {
    await this.abrirNuevo()
    await this.nombre.fill(nombre)
    // Required field: specs that do not care about it still need a value, or
    // the form fails client-side validation before reaching the server.
    await this.apellido.fill(extra.apellido ?? 'Apellido')
    if (extra.telefono) await this.telefono.fill(extra.telefono)
    if (extra.email) await this.email.fill(extra.email)
    await this.guardar.click()
  }

  async buscar(termino: string): Promise<void> {
    await this.buscador.fill(termino)
    await this.page.getByRole('button', { name: 'Aplicar' }).click()
    await this.page.waitForURL(/\/clientes(\?|$)/)
  }
}
