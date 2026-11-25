import { expect, test, unique } from '../fixtures/test'
import { BASE_URL } from '../config/env'
import { serviceRoleClient } from '../support/supabase'

test.describe('Portal de revendedora — venta directa (mobile 375x812)', () => {
  test('venta directa con contacto opcional, tarjeta agrupada, anulación en portal, control admin, aislamiento, redirección y módulo deshabilitado', async ({
    page,
    browser,
    shell,
    nuevoProducto,
    controlPrecios,
    seed,
  }) => {
    // -------------------------------------------------------------
    // SETUP: Producto 1 y Producto 2 para consignar
    // -------------------------------------------------------------
    const nombreProd1 = unique('Vestido Portal')
    await nuevoProducto.crear({
      nombre: nombreProd1,
      categoria: seed.categoriaSimple.nombre,
      costo: '15000',
      stock: 1,
    })
    await page.waitForURL(/\/inventario(\?|$)/)
    await controlPrecios.recalcular(nombreProd1)

    const nombreProd2 = unique('Pantalon Portal')
    await nuevoProducto.crear({
      nombre: nombreProd2,
      categoria: seed.categoriaSimple.nombre,
      costo: '18000',
      stock: 1,
    })
    await page.waitForURL(/\/inventario(\?|$)/)
    await controlPrecios.recalcular(nombreProd2)

    // -------------------------------------------------------------
    // ALTA: Revendedora 1 y Revendedora 2 con acceso al portal
    // -------------------------------------------------------------
    await page.goto('/revendedoras/nuevo')
    const nombreRev1 = unique('Valeria')
    const emailRev1 = `${nombreRev1.toLowerCase().replace(/\s+/g, '')}@test.com`

    await page.getByLabel(/^Nombre/).fill(nombreRev1)
    await page.getByLabel(/^Apellido/).fill('Portal')
    await page.getByLabel(/^Email/).fill(emailRev1)
    await page.getByLabel(/Crear acceso al sistema para la revendedora/i).check()
    await page.locator('#nr_password').fill('Password123!')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await page.waitForURL(/\/revendedoras(\?|$)/)

    const filaRev1 = page.getByRole('row', { name: new RegExp(`${nombreRev1} Portal`) })
    await expect(filaRev1).toBeVisible()
    const linkRev1 = filaRev1.getByRole('link', { name: new RegExp(`${nombreRev1} Portal`) })
    const href1 = await linkRev1.getAttribute('href')
    const idRevendedora1 = href1?.split('/revendedoras/')[1]?.split('/')[0]?.split('?')[0]
    expect(idRevendedora1).toBeDefined()

    // Consignar Producto 1 y Producto 2 a Revendedora 1
    await page.goto(`/revendedoras/${idRevendedora1}/consignaciones/nueva`)
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

    // Obtener SKUs de los productos para búsqueda en el modal
    const sr = serviceRoleClient()
    const { data: prods } = await sr
      .from('producto')
      .select('nombre, sku')
      .eq('id_tenant', seed.tenantId)
      .in('nombre', [nombreProd1, nombreProd2])
    const sku1 = prods?.find((p) => p.nombre === nombreProd1)?.sku ?? nombreProd1
    const sku2 = prods?.find((p) => p.nombre === nombreProd2)?.sku ?? nombreProd2

    // Revendedora 2 (para aislamiento)
    await page.goto('/revendedoras/nuevo')
    const nombreRev2 = unique('Sonia')
    const emailRev2 = `${nombreRev2.toLowerCase().replace(/\s+/g, '')}@test.com`

    await page.getByLabel(/^Nombre/).fill(nombreRev2)
    await page.getByLabel(/^Apellido/).fill('Segunda')
    await page.getByLabel(/^Email/).fill(emailRev2)
    await page.getByLabel(/Crear acceso al sistema para la revendedora/i).check()
    await page.locator('#nr_password').fill('Password123!')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await page.waitForURL(/\/revendedoras(\?|$)/)

    // -------------------------------------------------------------
    // PORTAL MÓVIL (375x812)
    // -------------------------------------------------------------
    const rev1Context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 375, height: 812 },
    })
    const rev1Page = await rev1Context.newPage()

    try {
      await rev1Page.goto('/login')
      await rev1Page.getByLabel('Correo electrónico').fill(emailRev1)
      await rev1Page.getByLabel('Contraseña').fill('Password123!')
      await rev1Page.getByRole('button', { name: 'Ingresar' }).click()
      await rev1Page.waitForURL(/\/mi-cuenta(\?|$)/)

      // Resumen: solo botón Vender en PageBand (sin Ver mi stock / Ver declaraciones)
      await expect(rev1Page.getByRole('heading', { name: 'Tu resumen de cuenta' })).toBeVisible()
      await expect(rev1Page.getByRole('button', { name: 'Vender' })).toBeVisible()
      await expect(rev1Page.getByRole('link', { name: 'Ver declaraciones' })).not.toBeVisible()

      // Abrir VenderModal desde Resumen, agregar 2 artículos, quitar 1, agregar de nuevo y cargar contacto opcional
      await rev1Page.getByRole('button', { name: 'Vender' }).click()
      const modal = rev1Page.getByRole('dialog')
      await expect(modal).toBeVisible()

      await modal.getByLabel('Código o SKU del artículo').fill(sku1)
      await modal.getByRole('button', { name: 'Buscar' }).click()
      await expect(modal.getByText(nombreProd1)).toBeVisible()

      await modal.getByLabel('Código o SKU del artículo').fill(sku2)
      await modal.getByRole('button', { name: 'Buscar' }).click()
      await expect(modal.getByText(nombreProd2)).toBeVisible()

      // Quitar Producto 2 y volver a agregarlo
      await modal.getByRole('button', { name: `Quitar ${nombreProd2}` }).click()
      await expect(modal.getByText(nombreProd2)).not.toBeVisible()

      await modal.getByLabel('Código o SKU del artículo').fill(sku2)
      await modal.getByRole('button', { name: 'Buscar' }).click()
      await expect(modal.getByText(nombreProd2)).toBeVisible()

      // Datos del cliente (opcional)
      await modal.getByRole('button', { name: /Datos del cliente \(opcional\)/i }).click()
      await modal.getByLabel('Nombre').fill('Carla Cliente')
      await modal.getByLabel('Teléfono').fill('11 5555-1234')

      await modal.getByRole('button', { name: /Confirmar venta/i }).click()
      await expect(rev1Page.getByText('Venta registrada')).toBeVisible()

      // Mi stock vacío tras vender ambos
      await rev1Page.goto('/mi-cuenta/stock')
      await expect(rev1Page.getByText('No tenés artículos en tu poder en este momento.')).toBeVisible()

      // Mis ventas: tarjeta agrupada con ambos artículos, contacto y estado "No liquidada"
      await rev1Page.goto('/mi-cuenta/ventas')
      await expect(rev1Page.getByText(nombreProd1)).toBeVisible()
      await expect(rev1Page.getByText(nombreProd2)).toBeVisible()
      await expect(rev1Page.getByText('Carla Cliente')).toBeVisible()
      await expect(rev1Page.getByText('No liquidada', { exact: true })).toBeVisible()

      // Anular venta desde el portal
      await rev1Page.getByRole('button', { name: 'Anular venta' }).click()
      const modalAnular = rev1Page.getByRole('dialog')
      await expect(modalAnular).toBeVisible()
      await modalAnular.getByLabel('Motivo (opcional)').fill('Error en talle')
      await modalAnular.getByRole('button', { name: 'Confirmar anulación' }).click()
      await expect(rev1Page.getByText('Venta anulada')).toBeVisible()

      // La tarjeta queda con etiqueta "Anulada" y sin botón "Anular venta"
      await expect(rev1Page.getByText('Anulada', { exact: true })).toBeVisible()
      await expect(rev1Page.getByRole('button', { name: 'Anular venta' })).not.toBeVisible()

      // Los artículos volvieron a Mi stock
      await rev1Page.goto('/mi-cuenta/stock')
      await expect(rev1Page.getByText(nombreProd1)).toBeVisible()

      // Vender Producto 1 con contacto y verificarlo en detalle de venta del admin
      const cardProd1 = rev1Page.getByRole('heading', { name: nombreProd1 }).locator('xpath=ancestor::div[contains(@class, "bg-card")]')
      await cardProd1.getByRole('button', { name: 'Vender' }).click()
      const modal2 = rev1Page.getByRole('dialog')
      await modal2.getByRole('button', { name: /Datos del cliente \(opcional\)/i }).click()
      await modal2.getByLabel('Nombre').fill('Marta AdminCheck')
      await modal2.getByRole('button', { name: /Confirmar venta/i }).click()
      await expect(rev1Page.getByText('Venta registrada')).toBeVisible()

      await page.goto(`/revendedoras/${idRevendedora1}/ventas`)
      const linkDetalle = page.getByRole('link', { name: /Ver/i }).first()
      await linkDetalle.click()
      await page.waitForURL(/\/ventas\/[0-9a-f-]+/)
      await expect(page.getByText('Marta AdminCheck')).toBeVisible()

      // Aislamiento: Revendedora 2 no ve nada de Revendedora 1
      const rev2Context = await browser.newContext({
        baseURL: BASE_URL,
        viewport: { width: 375, height: 812 },
      })
      const rev2Page = await rev2Context.newPage()
      try {
        await rev2Page.goto('/login')
        await rev2Page.getByLabel('Correo electrónico').fill(emailRev2)
        await rev2Page.getByLabel('Contraseña').fill('Password123!')
        await rev2Page.getByRole('button', { name: 'Ingresar' }).click()
        await rev2Page.waitForURL(/\/mi-cuenta(\?|$)/)

        await rev2Page.goto('/mi-cuenta/stock')
        await expect(rev2Page.getByText('No tenés artículos en tu poder en este momento.')).toBeVisible()
        await expect(rev2Page.getByText(nombreProd1)).not.toBeVisible()
      } finally {
        await rev2Context.close()
      }

      // Redirección de URLs del local
      await rev1Page.goto('/ventas')
      await rev1Page.waitForURL(/\/mi-cuenta/)
      await rev1Page.goto('/inventario')
      await rev1Page.waitForURL(/\/mi-cuenta/)
      await rev1Page.goto('/revendedoras')
      await rev1Page.waitForURL(/\/mi-cuenta/)

      // Módulo apagado
      const { data: mod } = await sr
        .from('modulo')
        .select('id_modulo')
        .eq('codigo', 'revendedoras')
        .single()
      expect(mod?.id_modulo).toBeDefined()

      await sr
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', seed.tenantId)
        .eq('id_modulo', mod!.id_modulo)

      try {
        await rev1Page.goto('/mi-cuenta')
        await expect(rev1Page.getByRole('heading', { name: 'Módulo deshabilitado' })).toBeVisible()
      } finally {
        await sr
          .from('tenant_modulo')
          .update({ habilitado: true })
          .eq('id_tenant', seed.tenantId)
          .eq('id_modulo', mod!.id_modulo)
      }
    } finally {
      await rev1Context.close()
    }
  })
})
