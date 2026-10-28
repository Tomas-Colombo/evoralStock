import { expect, test, unique } from '../fixtures/test'

test.describe('Consignaciones a revendedora', () => {
  test('entregar mercadería descuenta stock central y devolver la restaura', async ({
    page,
    shell,
    nuevoProducto,
    inventario,
    seed,
  }) => {
    // 1. Crear producto con 1 unidad de stock inicial
    const nombreProducto = unique('Producto Consig')
    await nuevoProducto.crear({
      nombre: nombreProducto,
      categoria: seed.categoriaSimple.nombre,
      costo: '12000',
      stock: 1,
      stockMinimo: '0',
    })
    await shell.expectSuccessToast('Producto creado')
    await page.waitForURL(/\/inventario(\?|$)/)

    // Verificar que inicialmente está disponible en el inventario central
    await inventario.filtrar(nombreProducto)
    const filaInicial = inventario.fila(nombreProducto)
    await expect(filaInicial).toBeVisible()
    await expect(filaInicial.getByText('1', { exact: true })).toBeVisible()

    // 2. Dar de alta una revendedora para la prueba
    await page.goto('/revendedoras/nuevo')
    const nombreRev = unique('Ana')
    const apellidoRev = 'Prueba'
    await page.getByLabel(/^Nombre/).fill(nombreRev)
    await page.getByLabel(/^Apellido/).fill(apellidoRev)
    await page.getByRole('button', { name: 'Guardar' }).click()
    await page.waitForURL(/\/revendedoras(\?|$)/)

    // Encontrar el ID de la revendedora creada
    const filaRev = page.getByRole('row', { name: new RegExp(`${nombreRev} ${apellidoRev}`) })
    await expect(filaRev).toBeVisible()
    await filaRev.getByRole('link', { name: new RegExp(`${nombreRev} ${apellidoRev}`) }).click()
    await page.waitForURL(/\/revendedoras\/[0-9a-f-]+/)
    const revendedoraUrl = page.url()
    const idRevendedora = revendedoraUrl.split('/revendedoras/')[1]?.split('?')[0]?.split('/')[0]

    // 3. Asignar desde la fila del panel, sin pasar por el perfil
    await page.goto('/revendedoras')
    await page
      .getByRole('row', { name: new RegExp(`${nombreRev} ${apellidoRev}`) })
      .getByRole('link', { name: 'Asignación' })
      .click()
    await page.waitForURL(`**/revendedoras/${idRevendedora}/consignaciones/nueva`)
    await page.getByLabel(/Escanear o ingresar código/i).fill(nombreProducto)
    await page.getByRole('button', { name: 'Agregar ítem' }).click()

    // El ítem aparece en la tabla
    await expect(page.getByText(nombreProducto)).toBeVisible()

    // 4. Guardar pide confirmación y, al confirmar, entrega sin borrador intermedio
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    const dialogConfirmar = page.getByRole('dialog')
    await expect(dialogConfirmar).toBeVisible()
    await dialogConfirmar.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await shell.expectSuccessToast('Consignación guardada')
    await page.waitForURL(/\/revendedoras\/[0-9a-f-]+\/consignaciones$/)
    await page.getByRole('link', { name: 'Ver detalle' }).first().click()
    await page.waitForURL(/\/revendedoras\/[0-9a-f-]+\/consignaciones\/[0-9a-f-]+/)
    await expect(page.locator('span[data-variant]').filter({ hasText: 'Abierta' })).toBeVisible()
    await expect(page.locator('span[data-variant]').filter({ hasText: 'En poder' })).toBeVisible()

    // 5. Verificar que desaparece del stock central disponible
    await page.goto('/inventario')
    await inventario.filtrar(nombreProducto)
    const filaPostEntrega = inventario.fila(nombreProducto)
    await expect(filaPostEntrega).toBeVisible()
    // Stock central disponible es 0 y tenencia muestra "Central: 0"
    await expect(filaPostEntrega.getByText('Central: 0')).toBeVisible()
    await expect(filaPostEntrega.getByText('En rev.: 1')).toBeVisible()

    // 6. Devolver desde la fila del panel: escanear lo que vuelve y confirmar
    await page.goto('/revendedoras')
    await page
      .getByRole('row', { name: new RegExp(`${nombreRev} ${apellidoRev}`) })
      .getByRole('link', { name: 'Devolución' })
      .click()
    await page.waitForURL(`**/revendedoras/${idRevendedora}/devolucion`)
    await page.getByLabel(/Escanear lo que vuelve/i).fill(nombreProducto)
    await page.getByRole('button', { name: 'Marcar', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: `Marcar ${nombreProducto}` })).toBeChecked()
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    const dialogDevolucion = page.getByRole('dialog')
    await expect(dialogDevolucion).toBeVisible()
    await dialogDevolucion.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await shell.expectSuccessToast('1 pieza de vuelta en el local')
    await page.waitForURL(`**/revendedoras/${idRevendedora}/en-poder`)
    await expect(page.getByText('Sin prendas en su poder')).toBeVisible()

    // 7. Verificar que el ítem vuelve a disponibilidad central
    await page.goto('/inventario')
    await inventario.filtrar(nombreProducto)
    const filaPostDevolucion = inventario.fila(nombreProducto)
    await expect(filaPostDevolucion).toBeVisible()
    await expect(filaPostDevolucion.getByText('Central: 1')).toBeVisible()
  })
})
