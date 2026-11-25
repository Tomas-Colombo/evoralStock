import { BASE_URL } from '../config/env'
import { expect, test, unique } from '../fixtures/test'

test.describe('Liquidaciones de revendedora', () => {
  test('flujo completo: preview -> excluir línea -> generar -> marcar pagada', async ({
    page,
    shell,
    nuevoProducto,
    controlPrecios,
    revendedoras,
    browser,
    seed,
  }) => {
    // 1. Crear dos productos con stock y precio
    const nombreProd1 = unique('Prod Liq 1')
    await nuevoProducto.crear({
      nombre: nombreProd1,
      categoria: seed.categoriaSimple.nombre,
      costo: '10000',
      stock: 1,
    })
    await page.waitForURL(/\/inventario(\?|$)/)
    await controlPrecios.recalcular(nombreProd1)

    const nombreProd2 = unique('Prod Liq 2')
    await nuevoProducto.crear({
      nombre: nombreProd2,
      categoria: seed.categoriaSimple.nombre,
      costo: '20000',
      stock: 1,
    })
    await page.waitForURL(/\/inventario(\?|$)/)
    await controlPrecios.recalcular(nombreProd2)

    // 2. Dar de alta revendedora con acceso al portal
    const nombreRev = unique('Laura')
    const apellidoRev = 'Liquidada'
    const emailRev = `${nombreRev.toLowerCase().replace(/\s+/g, '')}@test.com`
    await revendedoras.crearConAcceso({
      nombre: nombreRev,
      apellido: apellidoRev,
      email: emailRev,
      password: 'Password123!',
    })

    const filaRev = page.getByRole('row', { name: new RegExp(`${nombreRev} ${apellidoRev}`) })
    await expect(filaRev).toBeVisible()
    const linkRev = filaRev.getByRole('link', { name: new RegExp(`${nombreRev} ${apellidoRev}`) })
    const href = await linkRev.getAttribute('href')
    const idRevendedora = href?.split('/revendedoras/')[1]?.split('/')[0]?.split('?')[0]
    await linkRev.click()
    await page.waitForURL(new RegExp(`/revendedoras/${idRevendedora}(\\?|$)`))

    // 3. Crear consignación para ambos productos y confirmar entrega
    await page.goto(`/revendedoras/${idRevendedora}/consignaciones/nueva`)
    await page.getByLabel(/Escanear o ingresar código/i).fill(nombreProd1)
    await page.getByRole('button', { name: 'Agregar ítem' }).click()
    await expect(page.getByText(nombreProd1)).toBeVisible()

    await page.getByLabel(/Escanear o ingresar código/i).fill(nombreProd2)
    await page.getByRole('button', { name: 'Agregar ítem' }).click()
    await expect(page.getByText(nombreProd2)).toBeVisible()

    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    const dialogConfirmar = page.getByRole('dialog')
    await expect(dialogConfirmar).toBeVisible()
    await dialogConfirmar.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await shell.expectSuccessToast('Consignación guardada')
    await page.waitForURL(/\/revendedoras\/[0-9a-f-]+\/consignaciones$/)

    // 4. Registrar ventas desde el portal de revendedora para ambos productos
    const revContext = await browser.newContext({ baseURL: BASE_URL })
    const revPage = await revContext.newPage()
    try {
      await revPage.goto('/login')
      await revPage.getByLabel('Correo electrónico').fill(emailRev)
      await revPage.getByLabel('Contraseña').fill('Password123!')
      await revPage.getByRole('button', { name: 'Ingresar' }).click()
      await revPage.waitForURL(/\/mi-cuenta(\?|$)/)

      await revPage.goto('/mi-cuenta/stock')

      // Venta 1
      const cardProd1 = revPage
        .getByRole('heading', { name: nombreProd1 })
        .locator('xpath=ancestor::div[contains(@class, "bg-card")]')
      await cardProd1.getByRole('button', { name: 'Vender' }).click()
      const modal1 = revPage.getByRole('dialog')
      await modal1.getByRole('button', { name: /Confirmar venta/i }).click()
      await expect(revPage.getByText('Venta registrada')).toBeVisible()

      // Venta 2
      const cardProd2 = revPage
        .getByRole('heading', { name: nombreProd2 })
        .locator('xpath=ancestor::div[contains(@class, "bg-card")]')
      await cardProd2.getByRole('button', { name: 'Vender' }).click()
      const modal2 = revPage.getByRole('dialog')
      await modal2.getByRole('button', { name: /Confirmar venta/i }).click()
      await expect(revPage.getByText('Venta registrada')).toBeVisible()
    } finally {
      await revContext.close()
    }

    // 5. Ir a Liquidaciones de la revendedora
    await page.goto(`/revendedoras/${idRevendedora}/liquidaciones`)
    await expect(page.getByRole('link', { name: /Nueva liquidación/i })).toBeVisible()
    await page.getByRole('link', { name: /Nueva liquidación/i }).click()
    await page.waitForURL(/\/revendedoras\/[0-9a-f-]+\/liquidaciones\/nueva/)

    // 6. Preview: verificar que ambas líneas aparecen
    await expect(page.getByText(nombreProd1)).toBeVisible()
    await expect(page.getByText(nombreProd2)).toBeVisible()
    await expect(page.getByText('2 ventas registradas')).toBeVisible()

    // 7. Excluir línea de prod2
    const filaProd2 = page.getByRole('row').filter({ hasText: nombreProd2 })
    await filaProd2.getByRole('button', { name: 'Excluir' }).click()
    await expect(page.getByText('Línea excluida')).toBeVisible()

    // Verificar que prod2 pasó a excluidas
    await expect(page.getByText('Líneas excluidas de este período')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reincluir' })).toBeVisible()

    // 8. Generar liquidación (solo con prod1)
    await page.getByRole('button', { name: 'Generar liquidación' }).click()
    const dialogLiq = page.getByRole('dialog')
    await expect(dialogLiq).toBeVisible()
    await dialogLiq.getByRole('button', { name: 'Confirmar liquidación' }).click()
    await shell.expectSuccessToast('Liquidación generada')

    // 9. Redirige a detalle de liquidación
    await page.waitForURL(/\/revendedoras\/[0-9a-f-]+\/liquidaciones\/[0-9a-f-]+/)
    await expect(page.locator('span[data-variant]').filter({ hasText: 'Pendiente' })).toBeVisible()
    await expect(page.getByText(nombreProd1)).toBeVisible()

    // 10. Marcar pagada
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    const modalPago = page.getByRole('dialog')
    await expect(modalPago).toBeVisible()
    await modalPago.getByRole('button', { name: 'Confirmar pago' }).click()
    await shell.expectSuccessToast('Pago registrado')

    // 11. Estado terminal pagada
    await expect(page.locator('span[data-variant]').filter({ hasText: 'Pagada' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0)

    // 12. Verificar pestaña Cuenta Corriente
    await page.goto(`/revendedoras/${idRevendedora}/cuenta`)
    await expect(page.getByText('Saldo adeudado')).toBeVisible()
    await expect(page.getByText('Total pagado', { exact: true })).toBeVisible()
  })
})
