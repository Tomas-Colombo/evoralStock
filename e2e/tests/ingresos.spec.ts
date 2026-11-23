import { contenido } from '../pages/AppShell'
import { expect, test, unique } from '../fixtures/test'

/**
 * Goods receipt (`/inventario/ingresos/nuevo`). Confirming an entry is what
 * generates the physical items with their unique QR, so this is the other
 * path (besides product creation) that puts stock in the system.
 */
test.describe('Ingresos de mercadería', () => {
  test('registra un ingreso de compra y genera los ítems', async ({
    page,
    shell,
    inventario,
    seed,
  }) => {
    const producto = unique('Ingresado E2E')

    await page.goto('/inventario/ingresos/nuevo')
    await expect(shell.titulo).toHaveText('Nuevo ingreso')

    await contenido(page).getByLabel(/^Proveedor/)
      .selectOption({ label: `${seed.proveedorMayorista.nombre} · mayorista` })
    await contenido(page).getByLabel(/^Tipo de ingreso/).selectOption({ label: 'Compra (paga al ingresar)' })
    await contenido(page).getByLabel(/^Número de remito/).fill(unique('R').replace(/\s/g, '-'))

    await page.getByRole('button', { name: '+ Agregar producto' }).click()
    await page.getByPlaceholder('Producto').fill(producto)
    await contenido(page).getByLabel('Categoría del producto nuevo')
      .selectOption({ label: seed.categoriaSimple.nombre })
    await contenido(page).getByLabel('Cantidad').fill('4')
    await contenido(page).getByLabel('Precio unitario').fill('2500')

    await page.getByRole('button', { name: /^(Guardar|Guardando)/ }).click()

    // Generating the physical items is irreversible, so the view gates it
    // behind a confirmation dialog.
    const confirmacion = page.getByRole('dialog').filter({ hasText: 'Confirmar ingreso' })
    await expect(confirmacion).toBeVisible()
    await confirmacion.getByRole('button', { name: 'Confirmar' }).click()

    await shell.expectSuccessToast('Ingreso confirmado')
    await page.waitForURL(/\/inventario\/ingresos/)

    await inventario.abrir()
    await inventario.filtrar(producto)
    await expect(inventario.fila(producto)).toBeVisible()
  })

  test('no deja guardar un ingreso sin líneas', async ({ page, shell }) => {
    await page.goto('/inventario/ingresos/nuevo')
    await expect(shell.titulo).toHaveText('Nuevo ingreso')

    await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    await expect(
      page.getByText('Todavía no cargaste productos. Importá un PDF o agregá uno a mano.'),
    ).toBeVisible()
  })

  // Emptied, not zeroed: the quantity field declares `min={1}`, and since
  // `NumberInput` started dropping out-of-range keystrokes a literal "0" never
  // reaches the form state — the field just keeps its previous value and the
  // line stays valid. Clearing it is the one way left to reach the guard,
  // which reads `Number(cantidad || 0) <= 0` and so treats empty as zero.
  test('rechaza una línea sin cantidad', async ({ page, shell, seed }) => {
    await page.goto('/inventario/ingresos/nuevo')
    await contenido(page).getByLabel(/^Tipo de ingreso/).selectOption({ label: 'Compra (paga al ingresar)' })

    await page.getByRole('button', { name: '+ Agregar producto' }).click()
    await page.getByPlaceholder('Producto').fill(unique('Cantidad cero'))
    await contenido(page).getByLabel('Categoría del producto nuevo')
      .selectOption({ label: seed.categoriaSimple.nombre })
    await contenido(page).getByLabel('Cantidad').fill('')

    await page.getByRole('button', { name: /^(Guardar|Guardando)/ }).click()

    await shell.expectErrorToast('Cantidad inválida')
  })

  test('un nombre que ya existe engancha la línea al producto en vez de duplicarlo', async ({
    page,
    nuevoProducto,
    seed,
  }) => {
    const nombre = unique('Nombre tomado')

    await nuevoProducto.crear({ nombre, categoria: seed.categoriaSimple.nombre, costo: '1000' })
    await page.waitForURL(/\/inventario(\?|$)/)

    await page.goto('/inventario/ingresos/nuevo')
    await contenido(page)
      .getByLabel(/^Tipo de ingreso/)
      .selectOption({ label: 'Compra (paga al ingresar)' })
    await page.getByRole('button', { name: '+ Agregar producto' }).click()
    await page.getByPlaceholder('Producto').fill(nombre)

    // The line flips to «Reestock» with the existing product selected: a
    // restock, not a second product with the same name.
    const existente = contenido(page).getByLabel('Producto existente')
    await expect(existente).toBeVisible()
    await expect(existente).toHaveValue(/[0-9a-f-]{36}/)
    await expect(existente.locator('option:checked')).toContainText(nombre)
  })

  test('rechaza una línea vinculada sin producto elegido', async ({ page, shell }) => {
    await page.goto('/inventario/ingresos/nuevo')
    await contenido(page)
      .getByLabel(/^Tipo de ingreso/)
      .selectOption({ label: 'Compra (paga al ingresar)' })

    await page.getByRole('button', { name: '+ Agregar producto' }).click()
    await page.getByRole('button', { name: 'Reestock', exact: true }).click()
    await page.getByRole('button', { name: /^(Guardar|Guardando)/ }).click()

    await shell.expectErrorToast('Elegí un producto en todas las líneas')
  })

  test('el listado de ingresos muestra el historial', async ({ page, shell }) => {
    await page.goto('/inventario/ingresos')

    await expect(shell.titulo).toHaveText('Ingresos de mercadería')
  })
})
