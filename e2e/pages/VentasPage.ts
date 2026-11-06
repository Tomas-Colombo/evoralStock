import { expect, type Locator, type Page } from '@playwright/test'
import { alerta, AppShell, contenido } from './AppShell'

/** `/ventas` — module home: period filter, KPIs and the sales table. */
export class VentasPage {
  readonly shell: AppShell

  constructor(readonly page: Page) {
    this.shell = new AppShell(page)
  }

  async abrir(): Promise<void> {
    await this.page.goto('/ventas')
    await expect(this.shell.titulo).toHaveText('Ventas')
  }

  get tablaPeriodo(): Locator {
    return this.page.getByRole('table')
  }

  fila(texto: string): Locator {
    return this.page.getByRole('row').filter({ hasText: texto })
  }
}

/**
 * `/ventas/nueva` — the cart.
 *
 * Two steps by design: the cart is built on the page, and confirmation only
 * appears once the Cobro panel is expanded. The page object mirrors that
 * split so a spec cannot accidentally "confirm" without going through
 * collection. The panel is inline (it used to be a modal), so it is located
 * by its `aria-label` rather than by the dialog role.
 */
export class NuevaVentaPage {
  readonly shell: AppShell

  constructor(readonly page: Page) {
    this.shell = new AppShell(page)
  }

  async abrir(): Promise<void> {
    await this.page.goto('/ventas/nueva')
    await expect(this.shell.titulo).toHaveText('Nueva venta')
  }

  get canal(): Locator {
    return this.page.getByLabel('Canal de venta')
  }

  get revendedora(): Locator {
    return this.page.getByLabel('Revendedora', { exact: true })
  }

  get buscador(): Locator {
    return contenido(this.page).getByLabel(/^Escanear, tipear código/)
  }

  get agregar(): Locator {
    return this.page.getByRole('button', { name: /^(Agregar|Buscando)/ })
  }

  /** Field-level failure of the lookup (`role="alert"` under the input). */
  get errorBusqueda(): Locator {
    return alerta(this.page)
  }

  get lineas(): Locator {
    return this.page.getByTestId('linea-carrito')
  }

  get total(): Locator {
    return this.page.getByTestId('venta-total')
  }

  get continuarAlCobro(): Locator {
    return this.page.getByRole('button', { name: 'Continuar al cobro' })
  }

  /** The inline collection panel, revealed by `continuarAlCobro`. */
  get panelCobro(): Locator {
    return this.page.getByRole('region', { name: 'Cobro' })
  }

  /**
   * Lives in the sticky action bar, NOT inside the panel: the panel is long
   * and the bar keeps the close-the-sale action reachable. Only rendered once
   * the panel is open, so it still cannot be clicked from the cart step.
   */
  get confirmar(): Locator {
    return this.page.getByRole('button', { name: /^Confirmar venta|Registrando/ })
  }

  /**
   * Adds a unit by free text (QR, SKU or product name).
   *
   * `Escape` closes the live-suggestion list first: with it open the form's
   * submit picks the highlighted suggestion instead of the typed code, which
   * would silently resolve a different product than the spec asked for.
   */
  async agregarPorTexto(codigo: string): Promise<void> {
    await this.buscador.fill(codigo)
    await this.buscador.press('Escape')
    await this.agregar.click()
  }

  /** Picks a product from the live suggestion list by name. */
  async agregarPorSugerencia(nombre: string): Promise<void> {
    await this.buscador.fill(nombre)
    const opcion = this.page.getByRole('option', { name: new RegExp(nombre) }).first()
    await expect(opcion).toBeVisible()
    await opcion.click()
  }

  /**
   * Finances the entire sale with the house in N instalments for the given client.
   */
  async venderEnCuotas(cliente: string, cuotas: number): Promise<void> {
    await this.continuarAlCobro.click()
    await expect(this.panelCobro).toBeVisible()
    await this.panelCobro.getByRole('combobox', { name: /^Cliente/ }).fill(cliente)
    const opcion = this.page.getByRole('option', { name: new RegExp(cliente) }).first()
    await expect(opcion).toBeVisible()
    await opcion.click()
    await this.panelCobro.getByLabel('Monto del pago').fill('0')
    await this.panelCobro.getByLabel('Plan').selectOption({ label: `${cuotas} cuotas` })
    await expect(this.confirmar).toBeEnabled()
    await this.confirmar.click()
  }

  async cobrarYConfirmar(): Promise<void> {
    await this.continuarAlCobro.click()
    await expect(this.panelCobro).toBeVisible()
    await expect(this.confirmar).toBeEnabled()
    await this.confirmar.click()
  }
}
