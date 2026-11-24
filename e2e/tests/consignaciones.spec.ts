import { barraSuperior, contenido } from '../pages/AppShell'
import { expect, test } from '../fixtures/test'

/**
 * Supplier returns. Only units that ENTERED through consignment from that same
 * supplier are eligible, so a fresh tenant has none — which makes the empty
 * and blocked states the meaningful assertions here.
 */
test.describe('Devoluciones a proveedor', () => {
  test('el listado muestra el estado vacío del tenant nuevo', async ({ page, shell }) => {
    await page.goto('/consignaciones')

    await expect(shell.titulo).toHaveText('Devoluciones a proveedor')
    await expect(page.getByText('Sin consignaciones')).toBeVisible()
  })

  test('el alta no permite crear un lote sin ítems', async ({ page, shell }) => {
    await page.goto('/consignaciones/nueva')
    await expect(shell.titulo).toHaveText('Nueva devolución a proveedor')

    await expect(page.getByRole('button', { name: /^Devolver productos/ })).toBeDisabled()
  })

  test('sólo se ofrecen proveedores consignatarios', async ({ page, seed }) => {
    await page.goto('/consignaciones/nueva')

    const proveedor = contenido(page).getByLabel(/^Proveedor/)
    await expect(proveedor).toContainText(seed.proveedorConsignatario.nombre)
    await expect(proveedor).not.toContainText(seed.proveedorMayorista.nombre)
  })

  test('los filtros del listado se reflejan en la URL', async ({ page, seed }) => {
    await page.goto('/consignaciones')

    await barraSuperior(page).getByLabel(/^Proveedor/).selectOption({ label: seed.proveedorConsignatario.nombre })

    await expect(page).toHaveURL(new RegExp(`proveedor=${seed.proveedorConsignatario.id}`))
    await expect(page.getByText('Sin devoluciones con estos filtros')).toBeVisible()
  })
})
