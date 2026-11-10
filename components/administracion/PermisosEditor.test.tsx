import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PermisosEditor } from './PermisosEditor'

describe('PermisosEditor (D-CPC-05)', () => {
  it('tildar cargar_costos tilda automáticamente ver_costos', async () => {
    const user = userEvent.setup()
    let value: Record<string, string[]> = { inventario: ['ver'] }
    const onChange = vi.fn((next) => {
      value = next
    })

    const { rerender } = render(
      <PermisosEditor
        value={value}
        onChange={onChange}
        modulosVisibles={['inventario', 'precios']}
      />,
    )

    // Buscamos el checkbox de cargar_costos
    const checkCargar = screen.getByRole('checkbox', { name: 'inventario cargar_costos' })
    await user.click(checkCargar)

    expect(onChange).toHaveBeenCalledWith({
      inventario: ['ver', 'cargar_costos', 'ver_costos'],
    })

    // Re-renderizamos con el nuevo value
    rerender(
      <PermisosEditor
        value={value}
        onChange={onChange}
        modulosVisibles={['inventario', 'precios']}
      />,
    )

    const checkVerCostos = screen.getByRole('checkbox', { name: 'inventario ver_costos' })
    expect((checkVerCostos as HTMLInputElement).checked).toBe(true)
  })

  it('destildar ver_costos destilda automáticamente cargar_costos', async () => {
    const user = userEvent.setup()
    let value: Record<string, string[]> = {
      inventario: ['ver', 'ver_costos', 'cargar_costos'],
    }
    const onChange = vi.fn((next) => {
      value = next
    })

    render(
      <PermisosEditor
        value={value}
        onChange={onChange}
        modulosVisibles={['inventario', 'precios']}
      />,
    )

    const checkVerCostos = screen.getByRole('checkbox', { name: 'inventario ver_costos' })
    await user.click(checkVerCostos)

    expect(onChange).toHaveBeenCalledWith({
      inventario: ['ver'],
    })
  })

  it('muestra etiquetas en castellano y texto de ayuda para los permisos específicos', () => {
    render(
      <PermisosEditor
        value={{}}
        onChange={vi.fn()}
        modulosVisibles={['inventario', 'precios']}
      />,
    )

    expect(screen.getByText('Ver costos')).toBeDefined()
    expect(screen.getByText('Cargar costos')).toBeDefined()
    expect(screen.getByText('Ver márgenes')).toBeDefined()
    expect(screen.getByText(/Permite ver los costos de compra/)).toBeDefined()
  })

  it('excluye ver_propio y declarar de revendedoras en permisos específicos', () => {
    render(
      <PermisosEditor
        value={{}}
        onChange={vi.fn()}
        modulosVisibles={['revendedoras']}
      />,
    )

    // liquidar sí debe mostrarse
    expect(screen.getByRole('checkbox', { name: 'revendedoras liquidar' })).toBeDefined()
    expect(screen.getByText('Liquidar')).toBeDefined()

    // ver_propio y declarar NO deben mostrarse (son del portal, no de empleados)
    expect(screen.queryByRole('checkbox', { name: 'revendedoras ver_propio' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'revendedoras declarar' })).toBeNull()
  })
})
