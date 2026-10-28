import { expect, test, unique } from '../fixtures/test'
import { BASE_URL } from '../config/env'
import { serviceRoleClient } from '../support/supabase'

test.describe('Portal de revendedora y declaraciones (Slice 9d)', () => {
  test('flujo completo de 5 escenarios: ciclo declaración-confirmación, aislamiento entre revendedoras, redirección de URLs del local, módulo deshabilitado y rechazo con motivo', async ({
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
    // ALTA: Revendedora 1 con acceso al sistema
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

    // -------------------------------------------------------------
    // CONSIGNACIÓN: Consignar Producto 1 y 2 a Revendedora 1
    // -------------------------------------------------------------
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

    // -------------------------------------------------------------
    // ALTA: Revendedora 2 con acceso al sistema (para aislamiento)
    // -------------------------------------------------------------
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

    // =============================================================
    // ESCENARIO 1: Ella declara -> ve 'pendiente de confirmar' ->
    // el local confirma -> ella ve la venta y la deuda actualizada
    // =============================================================
    const rev1Context = await browser.newContext({ baseURL: BASE_URL })
    const rev1Page = await rev1Context.newPage()

    try {
      // 1. Revendedora 1 ingresa a su portal
      await rev1Page.goto('/login')
      await rev1Page.getByLabel('Correo electrónico').fill(emailRev1)
      await rev1Page.getByLabel('Contraseña').fill('Password123!')
      await rev1Page.getByRole('button', { name: 'Ingresar' }).click()
      await rev1Page.waitForURL(/\/mi-cuenta(\?|$)/)

      // Verificación en Resumen de portal
      await expect(rev1Page.getByRole('heading', { name: 'Tu resumen de cuenta' })).toBeVisible()
      await expect(rev1Page.getByText('Mercadería en tu poder')).toBeVisible()

      // 2. Va a Mi stock y declara venta de Producto 1
      await rev1Page.getByRole('link', { name: 'Mi stock', exact: true }).click()
      await rev1Page.waitForURL(/\/mi-cuenta\/stock/)
      await expect(rev1Page.getByText(nombreProd1)).toBeVisible()
      await expect(rev1Page.getByText(nombreProd2)).toBeVisible()

      const cardProd1 = rev1Page.getByRole('heading', { name: nombreProd1 }).locator('xpath=ancestor::div[contains(@class, "bg-card")]')
      await cardProd1.getByRole('button', { name: 'Declarar venta' }).click()

      // Modal de declaración
      await expect(rev1Page.getByText('Declarar venta de prenda')).toBeVisible()
      await rev1Page.locator('#nota-declaracion').fill('Vendida en feria fin de semana')
      await rev1Page.getByRole('button', { name: 'Confirmar declaración' }).click()

      // Queda visible la etiqueta "Pendiente de confirmar"
      await expect(rev1Page.getByText('Pendiente de confirmar')).toBeVisible()

      // En la solapa Declaraciones se ve el registro pendiente
      await rev1Page.getByRole('link', { name: 'Declaraciones', exact: true }).click()
      await rev1Page.waitForURL(/\/mi-cuenta\/declaraciones/)
      await expect(rev1Page.getByText(nombreProd1)).toBeVisible()
      await expect(rev1Page.getByText('Pendiente', { exact: true })).toBeVisible()

      // 3. El local entra a la bandeja y confirma la declaración
      await page.goto('/revendedoras/declaraciones')
      await expect(page.getByRole('heading', { name: 'Declaraciones de venta' })).toBeVisible()
      const filaDec1 = page.getByRole('row', { name: new RegExp(nombreProd1) })
      await expect(filaDec1).toBeVisible()
      await filaDec1.getByRole('button', { name: 'Confirmar' }).click()

      const modalConfirmarLocal = page.getByRole('dialog')
      await expect(modalConfirmarLocal).toBeVisible()
      await modalConfirmarLocal.getByRole('button', { name: 'Confirmar venta' }).click()
      await expect(page.getByText('Declaración confirmada')).toBeVisible()

      // 4. Revendedora 1 ve la venta confirmada y su deuda actualizada
      await rev1Page.getByRole('link', { name: 'Mis ventas', exact: true }).click()
      await rev1Page.waitForURL(/\/mi-cuenta\/ventas/)
      await expect(rev1Page.getByText(nombreProd1)).toBeVisible()

      await rev1Page.getByRole('link', { name: 'Resumen', exact: true }).click()
      await rev1Page.waitForURL(/\/mi-cuenta(\?|$)/)
      await expect(rev1Page.getByText('Total vendido')).toBeVisible()

      // =============================================================
      // ESCENARIO 2: Una segunda revendedora no ve nada de la primera
      // =============================================================
      const rev2Context = await browser.newContext({ baseURL: BASE_URL })
      const rev2Page = await rev2Context.newPage()

      try {
        await rev2Page.goto('/login')
        await rev2Page.getByLabel('Correo electrónico').fill(emailRev2)
        await rev2Page.getByLabel('Contraseña').fill('Password123!')
        await rev2Page.getByRole('button', { name: 'Ingresar' }).click()
        await rev2Page.waitForURL(/\/mi-cuenta(\?|$)/)

        // Resumen limpio para revendedora 2
        await expect(rev2Page.getByRole('heading', { name: 'Tu resumen de cuenta' })).toBeVisible()

        // Stock vacío
        await rev2Page.getByRole('link', { name: 'Mi stock', exact: true }).click()
        await rev2Page.waitForURL(/\/mi-cuenta\/stock/)
        await expect(rev2Page.getByText('No tenés prendas en tu poder en este momento.')).toBeVisible()
        await expect(rev2Page.getByText(nombreProd1)).not.toBeVisible()
        await expect(rev2Page.getByText(nombreProd2)).not.toBeVisible()

        // Ventas vacías
        await rev2Page.getByRole('link', { name: 'Mis ventas', exact: true }).click()
        await rev2Page.waitForURL(/\/mi-cuenta\/ventas/)
        await expect(rev2Page.getByText(nombreProd1)).not.toBeVisible()

        // Declaraciones vacías
        await rev2Page.getByRole('link', { name: 'Declaraciones', exact: true }).click()
        await rev2Page.waitForURL(/\/mi-cuenta\/declaraciones/)
        await expect(rev2Page.getByText(nombreProd1)).not.toBeVisible()
      } finally {
        await rev2Context.close()
      }

      // =============================================================
      // ESCENARIO 3: Revendedora que entra a una URL del local es redirigida a /mi-cuenta
      // =============================================================
      await rev1Page.goto('/ventas')
      await rev1Page.waitForURL(/\/mi-cuenta/)
      expect(rev1Page.url()).toContain('/mi-cuenta')

      await rev1Page.goto('/inventario')
      await rev1Page.waitForURL(/\/mi-cuenta/)
      expect(rev1Page.url()).toContain('/mi-cuenta')

      await rev1Page.goto('/revendedoras')
      await rev1Page.waitForURL(/\/mi-cuenta/)
      expect(rev1Page.url()).toContain('/mi-cuenta')

      // =============================================================
      // ESCENARIO 5: Rechazo con motivo se refleja en su lista
      // =============================================================
      // Revendedora 1 declara Producto 2
      await rev1Page.goto('/mi-cuenta/stock')
      const cardProd2 = rev1Page.getByRole('heading', { name: nombreProd2 }).locator('xpath=ancestor::div[contains(@class, "bg-card")]')
      await cardProd2.getByRole('button', { name: 'Declarar venta' }).click()
      await rev1Page.locator('#nota-declaracion').fill('Declarada por error de código')
      await rev1Page.getByRole('button', { name: 'Confirmar declaración' }).click()
      await expect(rev1Page.getByText('Pendiente de confirmar')).toBeVisible()

      // El local rechaza la declaración de Producto 2 indicando motivo
      await page.goto('/revendedoras/declaraciones')
      const filaDec2 = page.getByRole('row', { name: new RegExp(nombreProd2) })
      await expect(filaDec2).toBeVisible()
      await filaDec2.getByRole('button', { name: 'Rechazar' }).click()

      const modalRechazarLocal = page.getByRole('dialog')
      await expect(modalRechazarLocal).toBeVisible()
      const motivoTexto = 'El precio pactado no corresponde al artículo'
      await modalRechazarLocal.locator('#motivo-rechazo').fill(motivoTexto)
      await modalRechazarLocal.getByRole('button', { name: 'Rechazar declaración' }).click()
      await expect(page.getByText('Declaración rechazada')).toBeVisible()

      // Revendedora 1 comprueba el rechazo con motivo en su lista de declaraciones
      await rev1Page.goto('/mi-cuenta/declaraciones')
      await expect(rev1Page.getByText(nombreProd2)).toBeVisible()
      await expect(rev1Page.getByText('Rechazada')).toBeVisible()
      await expect(rev1Page.getByText(motivoTexto)).toBeVisible()

      // =============================================================
      // ESCENARIO 4: Con el módulo apagado /mi-cuenta muestra el aviso
      // =============================================================
      const sr = serviceRoleClient()
      const { data: mod } = await sr
        .from('modulo')
        .select('id_modulo')
        .eq('codigo', 'revendedoras')
        .single()
      expect(mod?.id_modulo).toBeDefined()

      // Apagar módulo revendedoras para el tenant de prueba
      await sr
        .from('tenant_modulo')
        .update({ habilitado: false })
        .eq('id_tenant', seed.tenantId)
        .eq('id_modulo', mod!.id_modulo)

      try {
        await rev1Page.goto('/mi-cuenta')
        await expect(rev1Page.getByRole('heading', { name: 'Módulo deshabilitado' })).toBeVisible()
        await expect(
          rev1Page.getByText(/El módulo de revendedoras no está habilitado/i),
        ).toBeVisible()
      } finally {
        // Restaurar módulo revendedoras para no dejar el tenant roto
        await sr
          .from('tenant_modulo')
          .update({ habilitado: true })
          .eq('id_tenant', seed.tenantId)
          .eq('id_modulo', mod!.id_modulo)
      }

      // Al reactivar, vuelve a renderizar el portal
      await rev1Page.goto('/mi-cuenta')
      await expect(rev1Page.getByRole('heading', { name: 'Tu resumen de cuenta' })).toBeVisible()
    } finally {
      await rev1Context.close()
    }
  })
})
