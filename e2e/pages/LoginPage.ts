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

  /**
   * First login of an account created with a temporary password (users and
   * revendedoras): proxy.ts forces /cambiar-clave until a new one is set, and
   * only then lets the person into the app.
   */
  async ingresarConClaveTemporal(email: string, temporal: string, nueva: string): Promise<void> {
    await this.page.goto('/login')
    await this.ingresar(email, temporal)
    // The proxy redirect happens during the login action's soft navigation:
    // the form renders while the URL still says /ventas, so wait for the form.
    await expect(this.page.locator('#current_password')).toBeVisible()
    await this.page.locator('#current_password').fill(temporal)
    await this.page.locator('#new_password').fill(nueva)
    await this.page.locator('#confirm_new_password').fill(nueva)
    await this.page.getByRole('button', { name: /Update password|Updating/ }).click()
  }
}
