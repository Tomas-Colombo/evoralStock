import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import FichaItemPage from './page'
import * as sessionModule from '@/lib/dal/session'
import * as codigoDal from '@/lib/dal/inventario/codigo'
import * as itemDal from '@/lib/dal/inventario/item'
import * as etiquetasDal from '@/lib/dal/etiquetas/etiquetas'
import * as guardModule from '@/lib/dal/guard'
import * as proyeccionModule from '@/lib/inventario/proyeccion-costos'
import type { ItemConProducto } from '@/lib/types/inventario'
import { redirect } from 'next/navigation'

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: vi.fn(), dismiss: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/inventario/ficha',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn(),
}))

vi.mock('@/lib/dal/inventario/codigo', () => ({
  resolverCodigo: vi.fn(),
}))

vi.mock('@/lib/dal/inventario/item', () => ({
  getItemConDetalle: vi.fn(),
}))

vi.mock('@/lib/dal/etiquetas/etiquetas', () => ({
  getEtiquetaConfig: vi.fn(),
}))

vi.mock('@/lib/dal/guard', () => ({
  hasModuleAccess: vi.fn(),
}))

vi.mock('@/lib/dal/revendedoras', () => ({
  quienTieneItem: vi.fn().mockResolvedValue({ ok: true, data: null }),
}))

vi.mock('@/lib/inventario/proyeccion-costos', () => ({
  proyectarItemConDetalle: vi.fn(),
}))

vi.mock('@/components/etiquetas/CodigoEtiqueta', () => ({
  CodigoEtiqueta: (props: { simbologia?: string; qrCode?: string; codigoEan?: string }) => (
    <div
      data-testid="codigo-etiqueta-mock"
      data-simbologia={props.simbologia}
      data-qr={props.qrCode}
      data-ean={props.codigoEan}
    />
  ),
}))

const mockItem = {
  id_item: 'item-1',
  qr_code: 'abcdef1234567890abcdef12',
  codigo_ean: '2000000000015',
  producto: {
    nombre: 'Remera Algodón',
    sku: 'REM-01',
    descripcion: null,
  },
  talle: 'M',
  estado_item: 'disponible',
  movimientos: [],
}

describe('FichaItemPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue({
      tenantId: 'tenant-1',
      user: { id: 'user-1' },
      modulosHabilitados: ['inventario'],
    } as unknown as sessionModule.Session)
    vi.mocked(guardModule.hasModuleAccess).mockReturnValue(false)
    vi.mocked(itemDal.getItemConDetalle).mockResolvedValue(mockItem as unknown as ItemConProducto)
    vi.mocked(proyeccionModule.proyectarItemConDetalle).mockReturnValue(mockItem as unknown as ItemConProducto)
  })

  it('muestra textoCodigo con qr_code cuando la simbología activa es 2D (qr)', async () => {
    vi.mocked(codigoDal.resolverCodigo).mockResolvedValue({
      tipo: 'item',
      item: mockItem as unknown as ItemConProducto,
    })
    vi.mocked(etiquetasDal.getEtiquetaConfig).mockResolvedValue({
      metodo: 'qr',
      impresora_tipo: 'hoja',
      margen_mm: 10,
      separacion_mm: 2,
      columnas: null,
      offset_x_mm: 0,
      offset_y_mm: 0,
    })

    const jsx = await FichaItemPage({
      params: Promise.resolve({ qr: 'abcdef1234567890abcdef12' }),
    })

    render(jsx!)

    expect(screen.getByText('abcdef1234567890abcdef12')).toBeInTheDocument()
    expect(screen.queryByText('2000000000015')).not.toBeInTheDocument()

    const mockCodigo = screen.getByTestId('codigo-etiqueta-mock')
    expect(mockCodigo).toHaveAttribute('data-simbologia', 'qr')
  })

  it('muestra textoCodigo con codigo_ean cuando la simbología activa es 1D (code128)', async () => {
    vi.mocked(codigoDal.resolverCodigo).mockResolvedValue({
      tipo: 'item',
      item: mockItem as unknown as ItemConProducto,
    })
    vi.mocked(etiquetasDal.getEtiquetaConfig).mockResolvedValue({
      metodo: 'code128',
      impresora_tipo: 'rollo',
      margen_mm: 0,
      separacion_mm: 0,
      columnas: null,
      offset_x_mm: 0,
      offset_y_mm: 0,
    })

    const jsx = await FichaItemPage({
      params: Promise.resolve({ qr: 'abcdef1234567890abcdef12' }),
    })

    render(jsx!)

    expect(screen.getByText('2000000000015')).toBeInTheDocument()
    expect(screen.queryByText('abcdef1234567890abcdef12')).not.toBeInTheDocument()

    const mockCodigo = screen.getByTestId('codigo-etiqueta-mock')
    expect(mockCodigo).toHaveAttribute('data-simbologia', 'code128')
  })

  it('redirige a la URL canónica si el qr_code resuelto difiere del parámetro', async () => {
    vi.mocked(codigoDal.resolverCodigo).mockResolvedValue({
      tipo: 'item',
      item: mockItem as unknown as ItemConProducto,
    })

    await expect(
      FichaItemPage({
        params: Promise.resolve({ qr: '2000000000015' }),
      }),
    ).rejects.toThrow('REDIRECT:/inventario/ficha/abcdef1234567890abcdef12')

    expect(redirectMock).toHaveBeenCalledWith('/inventario/ficha/abcdef1234567890abcdef12')
  })
})
