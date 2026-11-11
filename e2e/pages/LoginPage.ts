import { expect, type Locator, type Page } from '@playwright/test'
import { alerta } from './AppShell'

/** `/login` — the only unauthenticated surface the suite drives. */
export class LoginPage {
  constructor(readonly page: Page) {}

  get email(): Locator {
    return this.page.getByLabel('Correo electrónico')
  }

  get password(): Locator {
    return this.page.getByLabel('Contraseña')
  }

  get submit(): Locator {
    return this.page.getByRole('button', { name: /Ingresar|Ingresando/ })
  }

  /** The action's generic failure message, rendered as `role="alert"`. */
  get error(): Locator {
    return alerta(this.page)
  }

  async abrir(): Promise<void> {
    await this.page.goto('/login')
    await expect(this.page.getByRole('heading', { name: 'EvoralStock' })).toBeVisible()
  }

  async ingresar(email: string, password: string): Promise<void> {
    await this.email.fill(email)
    await this.password.fill(password)
    await this.submit.click()
  }
}
