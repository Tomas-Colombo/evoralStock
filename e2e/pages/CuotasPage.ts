import { expect, type Locator, type Page } from '@playwright/test'
import { AppShell, contenido } from './AppShell'

/**
 * `/cuotas` — the debt control panel.
 *
 * One row per CLIENT, not per instalment. Collecting and writing off live in
 * the client's file (`/clientes/[id]`), because both need to pick WHICH
 * instalment, and that decision needs the full plan on screen.
 */
export class CuotasPage {
  readonly shell: AppShell

  constructor(readonly page: Page) {
    this.shell = new AppShell(page)
  }

  async abrir(): Promise<void> {
    await this.page.goto('/cuotas')
    await expect(this.shell.titulo).toHaveText('Cuotas')
  }

  get buscador(): Locator {
    return contenido(this.page).getByRole('searchbox')
  }

  get filtroEstado(): Locator {
    return contenido(this.page).getByLabel('Estado')
  }

  fila(cliente: string): Locator {
    return this.page.getByRole('row').filter({ hasText: cliente })
  }

  async buscar(q: string): Promise<void> {
    await this.buscador.fill(q)
    await this.page.getByRole('button', { name: 'Aplicar' }).click()
    await this.page.waitForURL(/\/cuotas(\?|$)/)
  }

  async aplicarFiltro(estado: string): Promise<void> {
    await this.filtroEstado.selectOption({ label: estado })
    await this.page.waitForURL(/\/cuotas(\?|$)/)
  }

  /** Opens the client's file. Its back link returns here, not to Clientes. */
  async abrirCliente(cliente: string): Promise<void> {
    await this.fila(cliente).getByRole('link', { name: cliente }).click()
    await this.page.waitForURL(/\/clientes\/[^/?]+\?from=cuotas/)
  }
}

/** `/clientes/[id]` — the client's file, where instalments are collected. */
export class ClienteDetallePage {
  readonly shell: AppShell

  constructor(readonly page: Page) {
    this.shell = new AppShell(page)
  }

  get dialogo(): Locator {
    return this.page.getByRole('dialog')
  }

  /** Row of one instalment inside the Cuotas table, by its number ("#3"). */
  cuota(numero: number): Locator {
    return this.page.getByRole('row').filter({ hasText: `#${numero}` })
  }

  /**
   * Switches the debt table between "by due date" (flat) and "by purchase"
   * (one table per sale, newest first). The label reflects what the click
   * WILL do, so it flips after pressing.
   */
  get toggleAgrupar(): Locator {
    return this.page.getByRole('button', { name: /Agrupar por compra|Por vencimiento/ })
  }

  async agruparPorCompra(): Promise<void> {
    await this.page.getByRole('button', { name: 'Agrupar por compra' }).click()
    await expect(this.toggleAgrupar).toHaveAttribute('aria-pressed', 'true')
  }

  /** Header of one purchase group, e.g. "Compra del 12/09/2026". */
  grupoCompra(fecha: string): Locator {
    return this.page.getByRole('link', { name: new RegExp(`Compra del ${fecha}`) })
  }

  get montoCobro(): Locator {
    return this.dialogo.getByLabel(/^Monto/)
  }

  get motivo(): Locator {
    return this.dialogo.getByLabel(/^Motivo/)
  }

  /** Leaving `monto` unset keeps the prefilled balance: the full-payment path. */
  async cobrar(numero: number, monto?: string): Promise<void> {
    await this.cuota(numero).getByRole('button', { name: 'Cobrar' }).click()
    await expect(this.dialogo).toBeVisible()
    if (monto) await this.montoCobro.fill(monto)
    await this.dialogo.getByRole('button', { name: /Registrar cobro|Registrando/ }).click()
  }

  async marcarIncobrable(numero: number, motivo: string): Promise<void> {
    await this.cuota(numero).getByRole('button', { name: 'Incobrable' }).click()
    await expect(this.dialogo).toBeVisible()
    await this.motivo.fill(motivo)
    await this.dialogo.getByRole('button', { name: /Dar por perdida|Registrando/ }).click()
  }

  async editar(patch: { nombre?: string; apellido?: string; telefono?: string }): Promise<void> {
    await this.page.getByRole('button', { name: 'Editar cliente' }).click()
    await expect(this.dialogo).toBeVisible()
    if (patch.apellido) await this.dialogo.getByLabel(/^Apellido/).fill(patch.apellido)
    if (patch.nombre) await this.dialogo.getByLabel(/^Nombre/).fill(patch.nombre)
    if (patch.telefono) await this.dialogo.getByLabel('Teléfono').fill(patch.telefono)
    await this.dialogo.getByRole('button', { name: /Guardar cambios|Guardando/ }).click()
  }
}
