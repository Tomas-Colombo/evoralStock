import { expect, type Locator, type Page } from '@playwright/test'
import { alerta, AppShell, contenido } from './AppShell'

/** `/administracion` home, users, roles modal and audit trail. */
export class AdministracionPage {
  readonly shell: AppShell

  constructor(readonly page: Page) {
    this.shell = new AppShell(page)
  }

  async abrir(): Promise<void> {
    await this.page.goto('/administracion')
    await expect(this.shell.titulo).toHaveText('Administración')
  }

  async abrirUsuarios(): Promise<void> {
    await this.page.goto('/administracion/usuarios')
    await expect(this.shell.titulo).toHaveText('Usuarios')
  }

  async abrirInvitar(): Promise<void> {
    await this.page.goto('/administracion/usuarios/nuevo')
    await expect(this.shell.titulo).toHaveText('Invitar usuario')
  }

  async abrirAuditoria(): Promise<void> {
    await this.page.goto('/administracion/auditoria')
    await expect(this.shell.titulo).toHaveText('Auditoría')
  }

  // ─── Invitar usuario ────────────────────────────────────────────────

  get email(): Locator {
    return contenido(this.page).getByLabel(/^Email/)
  }

  get nombreCompleto(): Locator {
    return contenido(this.page).getByLabel(/^Nombre completo/)
  }

  get rol(): Locator {
    return contenido(this.page).getByLabel(/^Rol/)
  }

  get password(): Locator {
    return contenido(this.page).getByLabel(/^Contraseña temporal/)
  }

  get generarPassword(): Locator {
    return this.page.getByRole('button', { name: 'Generar' })
  }

  get invitar(): Locator {
    return this.page.getByRole('button', { name: /Invitar usuario|Invitando/ })
  }

  get error(): Locator {
    return alerta(this.page)
  }

  fila(texto: string): Locator {
    return this.page.getByRole('row').filter({ hasText: texto })
  }
}
