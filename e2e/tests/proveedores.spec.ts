import { expect, test, unique } from '../fixtures/test'

test.describe('Proveedores', () => {
  test('crea un proveedor y lo muestra en el listado', async ({
    page,
    proveedores,
    shell,
  }) => {
    const nombre = unique('Proveedor E2E')

    await proveedores.abrir()
    await proveedores.crear(nombre, {
      tipo: 'Mayorista',
      dias: '25',
      telefono: '+54 9 11 4444 3333',
    })

    await shell.expectSuccessToast('Proveedor creado')
    await page.waitForURL(/\/proveedores$/)

    const fila = proveedores.fila(nombre)
    await expect(fila).toBeVisible()
    await expect(fila.getByText('25 días')).toBeVisible()
    await expect(fila.getByText('Activo')).toBeVisible()
  })

  test('rechaza un nombre de un solo carácter', async ({ proveedores }) => {
    await proveedores.abrir()
    await proveedores.abrirNuevo()
    await proveedores.nombre.fill('X')
    await proveedores.guardar.click()

    await expect(proveedores.errorNombre).toHaveText('Mínimo 2 caracteres')
    await expect(proveedores.modalNuevo).toBeVisible()
  })

  test('el detalle del proveedor se abre desde el listado', async ({
    page,
    proveedores,
    seed,
  }) => {
    await proveedores.abrir()
    await proveedores.fila(seed.proveedorMayorista.nombre).getByRole('link', { name: 'Ver' }).click()

    await expect(page).toHaveURL(/\/proveedores\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      seed.proveedorMayorista.nombre,
    )
  })
})
