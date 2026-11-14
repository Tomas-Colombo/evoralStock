import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlDePreciosView } from './ControlDePreciosView'
import type { ProductoConPrecioStatus } from '@/lib/types/precios'

const mockRefresh = vi.fn()
const mockSuccess = vi.fn()
const mockError = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: mockSuccess, error: mockError }),
}))

const mockRevaluarCostosUsdAction = vi.fn()
const mockAplicarReglaAction = vi.fn()

vi.mock('../cotizacion/actions', () => ({
  revaluarCostosUsdAction: (input: unknown) => mockRevaluarCostosUsdAction(input),
}))

vi.mock('../actions', () => ({
  recalcularPrecioAction: vi.fn(),
  recalcularBatchAction: vi.fn(),
  aplicarReglaAction: (input: unknown) => mockAplicarReglaAction(input),
}))

describe('ControlDePreciosView — Revaluación USD', () => {
  const rows: ProductoConPrecioStatus[] = [
    {
      id_producto: 'p-1',
      nombre: 'Remera Lisa',
      sku: 'REM-001',
      categoria_nombre: 'Remeras',
      costo_vigente: 15000,
      precio_venta: 25000,
      precio_venta_resuelto_at: null,
      precio_venta_desactualizado: false,
      regla_margen_nombre: 'Margen 50%',
      precio_proyectado: 25000,
      diferencia_pct: 0,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockRevaluarCostosUsdAction.mockResolvedValue({
      ok: true,
      data: { revaluados: 3, sin_cambios: 1, omitidos_sin_original: 2 },
    })
  })

  it('oculta el botón de revaluación si canRevaluar es false', () => {
    render(<ControlDePreciosView initial={rows} canRevaluar={false} cantidadUsd={5} puedeVerCostos={true} />)
    expect(
      screen.queryByRole('button', { name: /revaluar costos usd/i }),
    ).not.toBeInTheDocument()
  })

  it('muestra el botón si canRevaluar es true y abre el diálogo con la cantidad afectada', async () => {
    render(<ControlDePreciosView initial={rows} canRevaluar={true} cantidadUsd={5} puedeVerCostos={true} />)

    const btn = screen.getByRole('button', { name: /revaluar costos usd/i })
    expect(btn).toBeInTheDocument()

    fireEvent.click(btn)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/afecta a 5 producto\(s\) con costo en usd/i)).toBeInTheDocument()
  })

  it('muestra las filas omitidas aparte en el diálogo de confirmación cuando existen', async () => {
    render(
      <ControlDePreciosView
        initial={rows}
        canRevaluar={true}
        cantidadUsd={{ revaluables: 5, omitidas: 2 }}
        puedeVerCostos={true}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /revaluar costos usd/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/afecta a 5 producto\(s\) con costo en usd/i)).toBeInTheDocument()
    expect(
      screen.getByText(/2 omitido\(s\) por no tener costo original en usd registrado/i),
    ).toBeInTheDocument()
  })

  it('ejecuta la revaluación al confirmar y muestra el desglose del resultado con explicación de omitidos', async () => {
    render(<ControlDePreciosView initial={rows} canRevaluar={true} cantidadUsd={5} puedeVerCostos={true} />)

    fireEvent.click(screen.getByRole('button', { name: /revaluar costos usd/i }))

    const btnConfirmar = screen.getByRole('button', { name: 'Revaluar costos' })
    fireEvent.click(btnConfirmar)

    await waitFor(() => {
      expect(mockRevaluarCostosUsdAction).toHaveBeenCalled()
    })

    // Desglose del resultado
    expect(screen.getByText('Resultado de la revaluación de costos USD')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument() // revaluados
    expect(screen.getByText('1')).toBeInTheDocument() // sin cambios
    expect(screen.getByText('2')).toBeInTheDocument() // omitidos

    // Explicación de los omitidos
    expect(
      screen.getByText(/los productos omitidos corresponden a costos cargados en usd antes de este cambio/i),
    ).toBeInTheDocument()
  })

  it('oculta la columna de costo si puedeVerCostos es false', () => {
    render(<ControlDePreciosView initial={rows} puedeVerCostos={false} />)
    expect(screen.queryByRole('columnheader', { name: 'Costo' })).not.toBeInTheDocument()
    expect(screen.queryByText('$ 15.000')).not.toBeInTheDocument()
  })

  it('oculta las columnas de regla, precio proyectado y margen si puedeVerMargenes es false', () => {
    render(<ControlDePreciosView initial={rows} puedeVerCostos={true} puedeVerMargenes={false} />)
    expect(screen.queryByRole('columnheader', { name: 'Regla margen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Precio proyectado' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Δ%' })).not.toBeInTheDocument()
    expect(screen.queryByText('Margen 50%')).not.toBeInTheDocument()
    expect(screen.queryByText('Sin regla de margen')).not.toBeInTheDocument()
  })
})

describe('ControlDePreciosView — Agrupado por categoría y regla (REQ-CIR-04)', () => {
  const rowsAgrupadas: ProductoConPrecioStatus[] = [
    {
      id_producto: 'p-1',
      id_categoria: 'cat-remeras',
      categoria_nombre: 'Remeras',
      nombre: 'Remera Lisa',
      sku: 'REM-001',
      costo_vigente: 10000,
      precio_venta: 15000,
      precio_venta_resuelto_at: null,
      precio_venta_desactualizado: true,
      regla_margen_nombre: 'Margen 50%',
      id_regla_margen_resuelta: 'regla-1',
      precio_proyectado: 15000,
      diferencia_pct: 0,
    },
    {
      id_producto: 'p-2',
      id_categoria: 'cat-pantalones',
      categoria_nombre: 'Pantalones',
      nombre: 'Jean Clásico',
      sku: 'PAN-001',
      costo_vigente: 20000,
      precio_venta: 30000,
      precio_venta_resuelto_at: null,
      precio_venta_desactualizado: true,
      regla_margen_nombre: 'Margen 50%',
      id_regla_margen_resuelta: 'regla-1',
      precio_proyectado: 30000,
      diferencia_pct: 0,
    },
    {
      id_producto: 'p-3',
      id_categoria: null,
      categoria_nombre: null,
      nombre: 'Accesorio Genérico',
      sku: 'ACC-001',
      costo_vigente: 5000,
      precio_venta: 7500,
      precio_venta_resuelto_at: null,
      precio_venta_desactualizado: true,
      regla_margen_nombre: 'Margen 50%',
      id_regla_margen_resuelta: 'regla-1',
      precio_proyectado: 7500,
      diferencia_pct: 0,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockAplicarReglaAction.mockResolvedValue({
      ok: true,
      data: { recalculados: 3 },
    })
  })

  it('renderiza grupos con encabezado Nombre (N) y "Sin categoría" al final', () => {
    render(
      <ControlDePreciosView
        initial={rowsAgrupadas}
        puedeVerCostos={true}
        puedeVerMargenes={true}
      />,
    )

    const encabezados = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(encabezados).toEqual(['Pantalones (1)', 'Remeras (1)', 'Sin categoría (1)'])

    expect(screen.getByText('Jean Clásico')).toBeInTheDocument()
    expect(screen.getByText('Remera Lisa')).toBeInTheDocument()
    expect(screen.getByText('Accesorio Genérico')).toBeInTheDocument()
  })

  it('muestra el aviso contextual de la regla cuando se pasa la prop regla', () => {
    render(
      <ControlDePreciosView
        initial={rowsAgrupadas}
        puedeVerCostos={true}
        puedeVerMargenes={true}
        regla={{ id: 'regla-1', nombre: 'Margen Verano' }}
      />,
    )

    expect(screen.getByText('Productos de la regla Margen Verano')).toBeInTheDocument()
  })

  it('muestra el aviso cuando se pasa la prop aviso', () => {
    render(
      <ControlDePreciosView
        initial={[]}
        puedeVerCostos={true}
        puedeVerMargenes={true}
        aviso="Esa regla ya no existe."
      />,
    )

    expect(screen.getByText('Esa regla ya no existe.')).toBeInTheDocument()
    expect(screen.getByText('Nada para mostrar con los filtros actuales.')).toBeInTheDocument()
  })

  it('"Aplicar a todos" está oculto sin puedeAplicar o sin filas', () => {
    // Caso 1: con regla y filas, pero sin puedeAplicar
    const { rerender } = render(
      <ControlDePreciosView
        initial={rowsAgrupadas}
        puedeVerCostos={true}
        puedeVerMargenes={true}
        puedeAplicar={false}
        regla={{ id: 'regla-1', nombre: 'Margen Verano' }}
      />,
    )
    expect(screen.queryByRole('button', { name: /aplicar a todos/i })).not.toBeInTheDocument()

    // Caso 2: con regla y puedeAplicar, pero sin filas
    rerender(
      <ControlDePreciosView
        initial={[]}
        puedeVerCostos={true}
        puedeVerMargenes={true}
        puedeAplicar={true}
        regla={{ id: 'regla-1', nombre: 'Margen Verano' }}
      />,
    )
    expect(screen.queryByRole('button', { name: /aplicar a todos/i })).not.toBeInTheDocument()

    // Caso 3: sin regla, aunque haya filas y puedeAplicar
    rerender(
      <ControlDePreciosView
        initial={rowsAgrupadas}
        puedeVerCostos={true}
        puedeVerMargenes={true}
        puedeAplicar={true}
      />,
    )
    expect(screen.queryByRole('button', { name: /aplicar a todos/i })).not.toBeInTheDocument()
  })

  it('"Aplicar a todos" se deshabilita mientras corre (un solo llamado) y muestra toast con el total', async () => {
    let resolverAccion!: (val: unknown) => void
    const promesaPendiente = new Promise((resolve) => {
      resolverAccion = resolve
    })
    mockAplicarReglaAction.mockReturnValue(promesaPendiente)

    render(
      <ControlDePreciosView
        initial={rowsAgrupadas}
        puedeVerCostos={true}
        puedeVerMargenes={true}
        puedeAplicar={true}
        regla={{ id: 'regla-1', nombre: 'Margen Verano' }}
      />,
    )

    const btnAplicar = screen.getByRole('button', { name: /aplicar a todos/i })
    expect(btnAplicar).toBeInTheDocument()
    expect(btnAplicar).not.toBeDisabled()

    // Clic en aplicar
    fireEvent.click(btnAplicar)

    // Inmediatamente queda deshabilitado mientras corre
    expect(btnAplicar).toBeDisabled()
    expect(mockAplicarReglaAction).toHaveBeenCalledTimes(1)
    expect(mockAplicarReglaAction).toHaveBeenCalledWith('regla-1')

    // Intento de segundo clic mientras está en progreso: no debe disparar otro llamado
    fireEvent.click(btnAplicar)
    expect(mockAplicarReglaAction).toHaveBeenCalledTimes(1)

    // Resolvemos la acción con el total de recalculados
    resolverAccion({ ok: true, data: { recalculados: 8 } })

    await waitFor(() => {
      expect(mockSuccess).toHaveBeenCalledWith('8 productos recalculados')
    })
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('muestra error cuando aplicarReglaAction falla', async () => {
    mockAplicarReglaAction.mockResolvedValue({
      ok: false,
      reason: 'regla-not-found',
    })

    render(
      <ControlDePreciosView
        initial={rowsAgrupadas}
        puedeVerCostos={true}
        puedeVerMargenes={true}
        puedeAplicar={true}
        regla={{ id: 'regla-1', nombre: 'Margen Verano' }}
      />,
    )

    const btnAplicar = screen.getByRole('button', { name: /aplicar a todos/i })
    fireEvent.click(btnAplicar)

    await waitFor(() => {
      expect(mockError).toHaveBeenCalled()
    })
  })

  it('sincroniza rows cuando initial cambia de referencia', () => {
    const { rerender } = render(
      <ControlDePreciosView
        initial={rowsAgrupadas}
        puedeVerCostos={true}
        puedeVerMargenes={true}
      />,
    )

    expect(screen.getByText('Jean Clásico')).toBeInTheDocument()

    const nuevosProductos: ProductoConPrecioStatus[] = [
      {
        id_producto: 'p-99',
        id_categoria: 'cat-remeras',
        categoria_nombre: 'Remeras',
        nombre: 'Musculosa Deportiva',
        sku: 'MUS-001',
        costo_vigente: 8000,
        precio_venta: 12000,
        precio_venta_resuelto_at: null,
        precio_venta_desactualizado: true,
        regla_margen_nombre: 'Margen 50%',
        id_regla_margen_resuelta: 'regla-1',
        precio_proyectado: 12000,
        diferencia_pct: 0,
      },
    ]

    rerender(
      <ControlDePreciosView
        initial={nuevosProductos}
        puedeVerCostos={true}
        puedeVerMargenes={true}
      />,
    )

    expect(screen.queryByText('Jean Clásico')).not.toBeInTheDocument()
    expect(screen.getByText('Musculosa Deportiva')).toBeInTheDocument()
  })
})
