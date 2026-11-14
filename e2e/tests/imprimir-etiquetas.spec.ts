import { expect, test, unique } from '../fixtures/test'
import { alerta, contenido } from '../pages/AppShell'

test.describe('Impresión de etiquetas', () => {
  test('desde un ingreso con N ítems renderiza con plantilla predeterminada, permite cambiar de plantilla y tolera fallback ante plantilla inválida', async ({
    page,
    shell,
    seed,
  }) => {
    const cantidadItems = 3
    const producto = unique('Producto Etiquetas E2E')

    // 1. Cargar y confirmar un ingreso con N ítems
    await page.goto('/inventario/ingresos/nuevo')
    await expect(shell.titulo).toHaveText('Nuevo ingreso')

    await contenido(page)
      .getByLabel(/^Proveedor/)
      .selectOption({ label: `${seed.proveedorMayorista.nombre} · mayorista` })
    await contenido(page)
      .getByLabel(/^Tipo de ingreso/)
      .selectOption({ label: 'Compra (paga al ingresar)' })
    await contenido(page)
      .getByLabel(/^Número de remito/)
      .fill(unique('R').replace(/\s/g, '-'))

    await page.getByRole('button', { name: '+ Agregar producto' }).click()
    await page.getByPlaceholder('Producto').fill(producto)
    await contenido(page)
      .getByLabel('Categoría del producto nuevo')
      .selectOption({ label: seed.categoriaSimple.nombre })
    await contenido(page).getByLabel('Cantidad').fill(String(cantidadItems))
    await contenido(page).getByLabel('Precio unitario').fill('2500')

    await page.getByRole('button', { name: /^(Guardar|Guardando)/ }).click()

    const confirmacion = page.getByRole('dialog').filter({ hasText: 'Confirmar ingreso' })
    await expect(confirmacion).toBeVisible()
    await confirmacion.getByRole('button', { name: 'Confirmar' }).click()

    await shell.expectSuccessToast('Ingreso confirmado')
    await page.waitForURL(/\/inventario\/ingresos\/[0-9a-f-]{36}/)

    // 2. Abrir imprimir-etiquetas desde el ingreso confirmado
    const linkImprimir = page
      .getByRole('link', { name: new RegExp(`Imprimir etiquetas \\(${cantidadItems}\\)`) })
      .first()
    await expect(linkImprimir).toBeVisible()
    await linkImprimir.click()

    await page.waitForURL(/\/inventario\/imprimir-etiquetas\?ingreso=/)

    const etiquetas = page.locator('[data-etiqueta]')
    // Verificar que hay N etiquetas
    await expect(etiquetas).toHaveCount(cantidadItems)

    // Verificar que la plantilla inicial es la predeterminada (50×47 mm)
    const primeraEtiqueta = etiquetas.first()
    await expect(primeraEtiqueta).toHaveAttribute('style', /width:\s*50mm/)
    await expect(primeraEtiqueta).toHaveAttribute('style', /height:\s*47mm/)

    const boxPredeterminada = await primeraEtiqueta.boundingBox()
    expect(boxPredeterminada).not.toBeNull()

    // 3. Cambiar de plantilla mediante el Select
    const selectorPlantilla = page.getByLabel('Seleccionar plantilla')
    await expect(selectorPlantilla).toBeVisible()
    const opcionChica = selectorPlantilla.locator('option').filter({ hasText: 'Chica' })
    const valorChica = await opcionChica.getAttribute('value')
    expect(valorChica).toBeTruthy()
    await selectorPlantilla.selectOption(valorChica!)

    // Verificar que la URL actualiza ?plantilla=
    await expect(page).toHaveURL(/[?&]plantilla=[0-9a-f-]{36}/)

    // Verificar que la cantidad sigue siendo N
    await expect(etiquetas).toHaveCount(cantidadItems)

    // Verificar que cambió la medida de la etiqueta (30×20 mm)
    await expect(primeraEtiqueta).toHaveAttribute('style', /width:\s*30mm/)
    await expect(primeraEtiqueta).toHaveAttribute('style', /height:\s*20mm/)

    const boxChica = await primeraEtiqueta.boundingBox()
    expect(boxChica).not.toBeNull()
    expect(boxChica!.width).toBeLessThan(boxPredeterminada!.width)
    expect(boxChica!.height).toBeLessThan(boxPredeterminada!.height)

    // 4. Caso con ?plantilla=basura cae en la predeterminada sin error
    const urlActual = new URL(page.url())
    urlActual.searchParams.set('plantilla', 'basura')
    await page.goto(urlActual.toString())

    // Verificar que no hay alerta de error ni pantalla de parámetros inválidos
    await expect(page.getByText('Parámetros inválidos')).toHaveCount(0)
    await expect(alerta(page)).toHaveCount(0)

    // Verificar que sigue mostrando N etiquetas con la plantilla predeterminada (50×47 mm)
    await expect(etiquetas).toHaveCount(cantidadItems)
    await expect(primeraEtiqueta).toHaveAttribute('style', /width:\s*50mm/)
    await expect(primeraEtiqueta).toHaveAttribute('style', /height:\s*47mm/)
  })
})
