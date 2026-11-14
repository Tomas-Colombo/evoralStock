import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SelectorPlantilla } from './SelectorPlantilla'
import type { EtiquetaPlantilla } from '@/lib/dal/etiquetas/etiquetas'

const replaceMock = vi.fn()
const pathnameMock = vi.fn().mockReturnValue('/inventario/imprimir-etiquetas')
const searchParamsMock = vi.fn().mockReturnValue(new URLSearchParams('qrs=QR1,QR2'))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  usePathname: () => pathnameMock(),
  useSearchParams: () => searchParamsMock(),
}))

const mockPlantillas: EtiquetaPlantilla[] = [
  {
    id_plantilla: 'plan-1',
    id_tenant: 'tenant-1',
    nombre: 'Predeterminada',
    ancho_mm: 50,
    alto_mm: 30,
    mostrar_nombre: true,
    mostrar_talle: true,
    mostrar_sku: false,
    mostrar_texto_codigo: false,
    predeterminada: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
  {
    id_plantilla: 'plan-2',
    id_tenant: 'tenant-1',
    nombre: 'Bijou',
    ancho_mm: 25,
    alto_mm: 15,
    mostrar_nombre: false,
    mostrar_talle: true,
    mostrar_sku: true,
    mostrar_texto_codigo: false,
    predeterminada: false,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
]

describe('SelectorPlantilla', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza las plantillas en el Select con la predeterminada señalizada', () => {
    render(<SelectorPlantilla plantillas={mockPlantillas} selectedId="plan-1" />)

    const select = screen.getByRole('combobox', { name: 'Seleccionar plantilla' }) as HTMLSelectElement
    expect(select.value).toBe('plan-1')
    expect(screen.getByText('Predeterminada (50×30 mm) — Predeterminada')).toBeInTheDocument()
    expect(screen.getByText('Bijou (25×15 mm)')).toBeInTheDocument()
  })

  it('al cambiar de opción llama a router.replace con ?plantilla=<uuid> preservando otros params', () => {
    render(<SelectorPlantilla plantillas={mockPlantillas} selectedId="plan-1" />)

    const select = screen.getByRole('combobox', { name: 'Seleccionar plantilla' })
    fireEvent.change(select, { target: { value: 'plan-2' } })

    expect(replaceMock).toHaveBeenCalledWith(
      '/inventario/imprimir-etiquetas?qrs=QR1%2CQR2&plantilla=plan-2',
    )
  })
})
