import { expect, test, unique } from '../fixtures/test'

test.describe('Cuotas', () => {
  test('flujo de cobro y gestión de cuotas de una venta financiada', async ({
    nuevoProducto,
    controlPrecios,
    clientes,
    nuevaVenta,
    cuotas,
    clienteDetalle,
    shell,
    seed,
    page,
  }) => {
    // Preparación de datos (vía UI)
    const nombreProd = unique('Vestido Cuotas E2E')
    await nuevoProducto.crear({
      nombre: nombreProd,
      categoria: seed.categoriaSimple.nombre,
      costo: '15000',
      stock: 2,
    })
    await page.waitForURL(/\/inventario(\?|$)/)
    await controlPrecios.recalcular(nombreProd)

    const nombreCli = unique('ClienteCuotas')
    await clientes.abrir()
    await clientes.crear(nombreCli)
    await shell.expectSuccessToast('Cliente creado')
    await page.waitForURL(/\/clientes(\?|$)/)

    await nuevaVenta.abrir()
    await nuevaVenta.agregarPorSugerencia(nombreProd)
    await nuevaVenta.venderEnCuotas(nombreCli, 3)
    await shell.expectSuccessToast('Venta registrada')
    await page.waitForURL(/\/ventas\/[0-9a-f-]{36}$/)

    // Caso 1: Venta en 3 cuotas → el cliente aparece en /cuotas; el buscador lo filtra
    await test.step('1. Venta en 3 cuotas y filtrado en /cuotas', async () => {
      await cuotas.abrir()
      await expect(cuotas.fila(nombreCli)).toBeVisible()
      await expect(cuotas.fila(nombreCli)).toContainText('$ 24.000')

      await cuotas.buscar(nombreCli)
      await expect(cuotas.fila(nombreCli)).toBeVisible()

      await cuotas.buscar('zzz-no-existe-e2e')
      await expect(cuotas.fila(nombreCli)).toBeHidden()
      await expect(page.getByText('Sin deuda pendiente. Nadie te debe nada.')).toBeVisible()

      // Limpiar filtro de búsqueda (cadena vacía)
      await cuotas.buscar('')
      await expect(cuotas.fila(nombreCli)).toBeVisible()
    })

    // Caso 2: abrirCliente → la URL lleva ?from=cuotas y el link de volver regresa a /cuotas
    await test.step('2. Navegación a la ficha con ?from=cuotas y retorno', async () => {
      await cuotas.abrirCliente(nombreCli)
      await expect(page).toHaveURL(/\/clientes\/[^/?]+\?from=cuotas/)

      const linkVolver = page.getByRole('link', { name: 'Volver' })
      await expect(linkVolver).toBeVisible()
      await linkVolver.click()
      await page.waitForURL(/\/cuotas(\?|$)/)
      await expect(shell.titulo).toHaveText('Cuotas')

      // Regresar a la ficha del cliente para continuar
      await cuotas.abrirCliente(nombreCli)
    })

    // Caso 6: agruparPorCompra → aparece "Compra del <fecha>" y aria-pressed=true
    await test.step('6. Agrupación por compra', async () => {
      await clienteDetalle.agruparPorCompra()
      await expect(clienteDetalle.toggleAgrupar).toHaveAttribute('aria-pressed', 'true')
      const fechaHoy = new Date().toLocaleDateString('es-AR')
      await expect(clienteDetalle.grupoCompra(fechaHoy)).toBeVisible()
    })

    // Caso 3: Cobro total de la cuota #1 → queda saldada y baja el saldo
    await test.step('3. Cobro total de la cuota #1 y reducción de saldo', async () => {
      const kpiAdeuda = page.getByText('Adeuda', { exact: true }).locator('..')
      await expect(kpiAdeuda).toContainText('$ 24.000')

      await clienteDetalle.cobrar(1)
      await shell.expectSuccessToast('Cuota cobrada')

      await expect(clienteDetalle.cuota(1).getByText('Pagada')).toBeVisible()
      await expect(clienteDetalle.cuota(1).getByRole('button', { name: 'Cobrar' })).toBeHidden()

      // Verificación real de la baja del saldo: de 24.000 a 16.000 y 2 pendientes
      await expect(kpiAdeuda).toContainText('$ 16.000')
      await expect(kpiAdeuda).toContainText('2 cuotas pendientes')
    })

    // Caso 4: Cobro parcial de la #2 → sigue pendiente con el saldo restante
    await test.step('4. Cobro parcial de la cuota #2', async () => {
      await clienteDetalle.cobrar(2, '3000')
      await shell.expectSuccessToast('Cobro parcial registrado')

      await expect(clienteDetalle.cuota(2).getByText('Parcial')).toBeVisible()
      await expect(clienteDetalle.cuota(2).getByText('$ 5.000')).toBeVisible()
      await expect(clienteDetalle.cuota(2).getByText('pagó $ 3.000')).toBeVisible()
      await expect(clienteDetalle.cuota(2).getByRole('button', { name: 'Cobrar' })).toBeVisible()
    })

    // Caso 5: marcarIncobrable en la #3 con motivo → cambia el estado y el filtro Estado lo refleja
    await test.step('5. Marcar incobrable cuota #3 y reflejo en filtros de estado', async () => {
      const motivoIncobrable = 'Inubicable en domicilio y teléfono'
      await clienteDetalle.marcarIncobrable(3, motivoIncobrable)
      await shell.expectSuccessToast('Cuota dada por perdida')

      await expect(clienteDetalle.cuota(3).getByText('Incobrable')).toBeVisible()
      await expect(clienteDetalle.cuota(3).getByText(motivoIncobrable)).toBeVisible()
      await expect(clienteDetalle.cuota(3).getByRole('button', { name: 'Cobrar' })).toBeHidden()

      // En la ficha, el filtro Estado ("Mostrar") refleja el nuevo estado
      const filtroFicha = page.getByLabel('Mostrar')
      await filtroFicha.selectOption({ label: 'Incobrables' })
      await expect(clienteDetalle.cuota(3)).toBeVisible()
      await expect(clienteDetalle.cuota(1)).toBeHidden()
      await expect(clienteDetalle.cuota(2)).toBeHidden()

      await filtroFicha.selectOption({ label: 'Parciales' })
      await expect(clienteDetalle.cuota(2)).toBeVisible()
      await expect(clienteDetalle.cuota(3)).toBeHidden()

      // En /cuotas, el filtro Estado refleja al deudor con cuota incobrable
      await cuotas.abrir()
      await cuotas.aplicarFiltro('Incobrables')
      await expect(cuotas.fila(nombreCli)).toBeVisible()
    })
  })
})
