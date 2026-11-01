import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { resumenKpis } from './BloqueResumen'
import { BloqueGanancia } from './BloqueGanancia'
import { BloqueMovimientoPlata } from './BloqueMovimientoPlata'
import { GraficoTendencia } from './GraficoTendencia'
import { BloqueCobrar } from './BloqueCobrar'
import { BloqueError } from './BloqueError'

import { BloqueRevendedoras } from './BloqueRevendedoras'
import { fireEvent } from '@testing-library/react'
import {
  crearCuentasPorCobrar,
  crearCumplimientoObjetivos,
  crearFinanzasFlujo,
  crearFinanzasPosicion,
  crearFinanzasPresupuesto,
  crearFinanzasRanking,
  crearFinanzasResultados,
  crearFinanzasSerieMensual,
  crearPerfilRevendedora,
  crearResumenCanal,
} from '@/tests/factories/reportes'

describe('Componentes de Reportes (Bloques 1-5)', () => {
  const mockResultados = crearFinanzasResultados()
  const mockFlujo = crearFinanzasFlujo({ por_acreditar: { MercadoPago: 500 } })
  const mockPorCobrar = crearCuentasPorCobrar({ vencido: 1000 })
  const mockPosicion = crearFinanzasPosicion({ por_cobrar: mockPorCobrar })

  it('arma los KPIs del resumen', () => {
    const kpis = resumenKpis({
      resultados: mockResultados,
      resultadosPrev: null,
      flujo: mockFlujo,
      flujoPrev: null,
      posicion: mockPosicion,
      tieneGastos: true,
    })
    expect(kpis.map((k) => k.label)).toEqual([
      'Vendiste',
      'Te quedó de ganancia',
      'Entró a caja',
      'Te deben',
    ])
  })

  it('renderiza BloqueGanancia', () => {
    render(<BloqueGanancia resultados={mockResultados} tieneGastos={true} />)
    expect(screen.getByText('Cómo se arma tu ganancia')).toBeDefined()
    expect(screen.getByText('Vendiste (neto)')).toBeDefined()
    expect(screen.getByText('Menos costo de mercadería')).toBeDefined()
  })

  it('renderiza BloqueMovimientoPlata', () => {
    const { rerender } = render(<BloqueMovimientoPlata flujo={mockFlujo} tieneGastos={true} tieneConsignacion={false} />)
    expect(screen.getByText('Movimiento de plata')).toBeDefined()
    expect(screen.getByText('MercadoPago')).toBeDefined()
    expect(screen.queryByText('Pagos a proveedores')).toBeNull()

    rerender(<BloqueMovimientoPlata flujo={mockFlujo} tieneGastos={true} tieneConsignacion={true} />)
    expect(screen.getByText('Pagos a proveedores')).toBeDefined()
  })

  it('renderiza GraficoTendencia (estado vacío si no hay serie)', () => {
    render(<GraficoTendencia serie={[]} tieneGastos={true} />)
    expect(screen.getByText('No hay datos para la tendencia.')).toBeDefined()
  })

  it('renderiza GraficoTendencia con serie', () => {
    const serieMock = [crearFinanzasSerieMensual()]
    render(<GraficoTendencia serie={serieMock} tieneGastos={true} />)
    expect(screen.getByRole('img')).toBeDefined()
  })

  it('renderiza BloqueCobrar', () => {
    render(<BloqueCobrar porCobrar={mockPorCobrar} puedeVerVentas={true} />)
    expect(screen.getByText('Lo que te deben')).toBeDefined()
    expect(screen.getByText('Ya vencido')).toBeDefined()
    expect(screen.getByRole('link')).toBeDefined()
  })

  it('renderiza BloqueError aislado sin onRetry', () => {
    render(<BloqueError />)
    expect(screen.getByText('No pudimos cargar esto. Probá de nuevo en un momento.')).toBeDefined()
    expect(screen.queryByText('Reintentar')).toBeNull()
  })

  it('renderiza BloqueError con onRetry y ejecuta callback al hacer clic', () => {
    const retryFn = vi.fn()
    render(<BloqueError onRetry={retryFn} />)
    const btn = screen.getByText('Reintentar')
    expect(btn).toBeDefined()
    fireEvent.click(btn)
    expect(retryFn).toHaveBeenCalledTimes(1)
  })
})


import { BloqueMercaderia } from './BloqueMercaderia'
import { BloqueProveedores } from './BloqueProveedores'
import { BloqueGastos } from './BloqueGastos'
import { BloqueRanking } from './BloqueRanking'

// mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/reportes'
}))

describe('Componentes de Reportes (Bloques 6-9)', () => {
  const mockPosicion = crearFinanzasPosicion({
    mercaderia_terceros: 200,
    productos_sin_precio: 3,
    deuda_proveedores: 400,
    por_cobrar: null,
  })

  it('renderiza BloqueMercaderia', () => {
    const { rerender } = render(<BloqueMercaderia posicion={mockPosicion} tieneConsignacion={false} />)
    expect(screen.getByText('Tu stock hoy')).toBeDefined()
    expect(screen.getByText('3 productos sin precio')).toBeDefined()
    expect(screen.queryByText('Mercadería de terceros')).toBeNull()

    rerender(<BloqueMercaderia posicion={mockPosicion} tieneConsignacion={true} />)
    expect(screen.getByText('Mercadería de terceros')).toBeDefined()
  })

  it('renderiza BloqueProveedores', () => {
    render(<BloqueProveedores posicion={mockPosicion} />)
    expect(screen.getByText('Lo que debés')).toBeDefined()
    expect(screen.getByText('A proveedores')).toBeDefined()
    expect(screen.getByText('Ver rendiciones pendientes →')).toBeDefined()
  })

  it('renderiza BloqueGastos', () => {
    const presupuestos = [crearFinanzasPresupuesto({ nombre: 'Alquiler' })]
    render(<BloqueGastos presupuestos={presupuestos} mesHasta="2026-10-31" />)
    expect(screen.getByText('Gastos vs. Presupuesto')).toBeDefined()
    expect(screen.getByText('Alquiler')).toBeDefined()
  })

  it('renderiza BloqueGastos vacío', () => {
    render(<BloqueGastos presupuestos={[]} mesHasta="2026-10-31" />)
    expect(screen.getByText('No hay gastos ni presupuestos cargados en este mes.')).toBeDefined()
  })

  it('renderiza BloqueRanking', () => {
    const ranking = [crearFinanzasRanking({ nombre: 'Remera' })]
    render(<BloqueRanking ranking={ranking} ordenActual="ganancia" />)
    expect(screen.getByText('Los que más rinden')).toBeDefined()
    expect(screen.getByText('Remera')).toBeDefined()
    expect(screen.getByText('Exportar CSV')).toBeDefined()
  })
})

describe('BloqueRevendedoras (Reportes)', () => {
  const mockResumenCanal = crearResumenCanal()

  const mockPerfiles = [
    crearPerfilRevendedora({ id_revendedora: 'rev-1', nombre: 'Lucía', apellido: 'Gómez', adeudado: 8000 }),
    crearPerfilRevendedora({
      id_revendedora: 'rev-2',
      nombre: 'Ana',
      apellido: 'Pérez',
      telefono: '11223355',
      email: 'ana@example.com',
      adeudado: 0,
      piezas_entregadas_historico: 12,
      rotacion_pct: 50,
    }),
  ]

  const mockObjetivos = [crearCumplimientoObjetivos({ id_revendedora: 'rev-1', nombre: 'Lucía', apellido: 'Gómez' })]

  it('renderiza resumen del canal y tabla de perfiles', () => {
    render(
      <BloqueRevendedoras
        resumenCanal={mockResumenCanal}
        perfiles={mockPerfiles}
        objetivos={mockObjetivos}
        desde="2026-10-01"
        hasta="2026-10-31"
      />
    )
    expect(screen.getByText('Canal Revendedoras')).toBeDefined()
    expect(screen.getByText('Gómez, Lucía')).toBeDefined()
    expect(screen.getByText('Pérez, Ana')).toBeDefined()
    expect(screen.getByText('Exportar CSV')).toBeDefined()
  })

  it('exporta CSV aplicando csvNegative a saldos adeudados mayores a cero', () => {
    let capturedContent = ''
    const createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/csv-123')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    class MockBlob {
      constructor(content: BlobPart[]) {
        capturedContent = content.join('')
      }
    }
    vi.stubGlobal('Blob', MockBlob)

    const clickMock = vi.fn()
    const origCreateElement = document.createElement.bind(document)
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'a') {
        return { click: clickMock, setAttribute: vi.fn(), href: '', download: '' } as unknown as HTMLElement
      }
      return origCreateElement(tagName)
    }) as unknown as typeof document.createElement)

    render(
      <BloqueRevendedoras
        resumenCanal={mockResumenCanal}
        perfiles={mockPerfiles}
        objetivos={mockObjetivos}
        desde="2026-10-01"
        hasta="2026-10-31"
      />
    )

    const exportBtn = screen.getByText('Exportar CSV')
    fireEvent.click(exportBtn)

    expect(clickMock).toHaveBeenCalled()
    expect(capturedContent).toContain('"Gómez, Lucía"')
    // Con adeudado 8000 > 0, csvNegative(8000) genera "-8000" y escapeCsvField lo sanitiza a "'-8000"
    expect(capturedContent).toContain(`"'-8000"`)
    // Con adeudado 0, no aplica csvNegative y queda "0" sin signo negativo
    expect(capturedContent).toContain(',"0",')


    createElementSpy.mockRestore()
    vi.unstubAllGlobals()
  })

})

