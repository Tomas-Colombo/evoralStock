import { expect, test, unique } from '../fixtures/test'

test.describe('Gastos', () => {
  test('registra un gasto y lo suma al total del mes', async ({
    page,
    gastos,
    shell,
    seed,
  }) => {
    const descripcion = unique('Gasto E2E')

    await gastos.registrar({
      categoria: seed.categoriaGasto.nombre,
      monto: '12345',
      descripcion,
    })

    await shell.expectSuccessToast('Gasto registrado')
    await page.waitForURL(/\/gastos(\?|$)/)
    await expect(gastos.fila(descripcion)).toBeVisible()
    await expect(gastos.fila(descripcion).getByText('$ 12.345')).toBeVisible()
  })

  test('rechaza un monto de cero', async ({ page, gastos, seed }) => {
    await gastos.abrirNuevo()
    await gastos.categoria.selectOption({ label: seed.categoriaGasto.nombre })
    await gastos.monto.fill('0')
    await gastos.guardar.click()

    await expect(gastos.error).toHaveText('Monto inválido')
    await expect(gastos.modalNuevo).toBeVisible()
  })

  test('rechaza un monto vacío', async ({ gastos, seed }) => {
    await gastos.abrirNuevo()
    await gastos.categoria.selectOption({ label: seed.categoriaGasto.nombre })
    await gastos.guardar.click()

    await expect(gastos.error).toHaveText('Monto inválido')
  })

  test('ajusta el presupuesto mensual de una categoría', async ({ page, shell, seed }) => {
    await page.goto('/gastos/presupuestos')
    await expect(shell.titulo).toHaveText('Presupuestos por categoría')

    // Names and budgets are editable inputs, not text — the row is addressed
    // through the input's aria-label.
    const presupuesto = page.getByLabel(`Presupuesto ${seed.categoriaGasto.nombre}`)
    await presupuesto.fill('250000')
    await presupuesto.blur()

    await shell.expectSuccessToast('Presupuesto actualizado')

    await page.reload()
    await expect(page.getByLabel(`Presupuesto ${seed.categoriaGasto.nombre}`)).toHaveValue(
      '250.000',
    )
  })

  test('rechaza un presupuesto negativo', async ({ page, shell, seed }) => {
    await page.goto('/gastos/presupuestos')

    const presupuesto = page.getByLabel(`Presupuesto ${seed.categoriaGasto.nombre}`)
    await presupuesto.fill('-5000')
    await presupuesto.blur()

    await shell.expectErrorToast('Valor inválido')
  })
})
