import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import ControlDePreciosPage from './page'
import * as sessionModule from '@/lib/dal/session'
import * as guardModule from '@/lib/dal/guard'
import * as resolucionDal from '@/lib/dal/precios/resolucion'
import * as cotizacionDal from '@/lib/dal/precios/cotizacion'
import * as reglaDal from '@/lib/dal/precios/regla'
import type { ProductoConPrecioStatus, ReglaPrecioRow } from '@/lib/types/precios'

vi.mock('@/components/shell/Topbar', () => ({
  Topbar: () => <div data-testid="topbar" />,
}))

let lastViewProps: Record<string, unknown> | null = null

vi.mock('./ControlDePreciosView', () => ({
  ControlDePreciosView: (props: Record<string, unknown>) => {
    lastViewProps = props
    return <div data-testid="view" />
  },
}))

describe('ControlDePreciosPage (Server Component)', () => {
  const dummySession = {
    tenantId: 't-1',
    user: { id: 'u-1' },
    role: 'dueño',
    permissions: ['precios.ver', 'precios.editar', 'inventario.ver_costos', 'precios.ver_margenes'],
  } as unknown as Awaited<ReturnType<typeof sessionModule.verifySession>>

  const validUuid = '11111111-1111-4111-8111-111111111111'

  const mockRows: ProductoConPrecioStatus[] = [
    {
      id_producto: 'p-1',
      nombre: 'P1',
      sku: 'SKU1',
      categoria_nombre: 'Cat 1',
      costo_vigente: 100,
      precio_venta: 200,
      precio_venta_resuelto_at: null,
      precio_venta_desactualizado: false,
      regla_margen_nombre: 'Regla A',
      id_regla_margen_resuelta: validUuid,
      precio_proyectado: 200,
      diferencia_pct: 0,
    },
    {
      id_producto: 'p-2',
      nombre: 'P2',
      sku: 'SKU2',
      categoria_nombre: 'Cat 1',
      costo_vigente: 100,
      precio_venta: 200,
      precio_venta_resuelto_at: null,
      precio_venta_desactualizado: false,
      regla_margen_nombre: 'Regla B',
      id_regla_margen_resuelta: '22222222-2222-4222-8222-222222222222',
      precio_proyectado: 200,
      diferencia_pct: 0,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    lastViewProps = null
    vi.spyOn(sessionModule, 'verifySession').mockResolvedValue(dummySession)
    vi.spyOn(guardModule, 'hasPermission').mockReturnValue(true)
    vi.spyOn(guardModule, 'hasModuleAccess').mockReturnValue(true)
    vi.spyOn(resolucionDal, 'listControlDePrecios').mockResolvedValue(mockRows)
    vi.spyOn(cotizacionDal, 'countProductosCostoUsdVigentes').mockResolvedValue(null)
    vi.spyOn(reglaDal, 'getReglaPrecio').mockResolvedValue({
      id_regla: validUuid,
      nombre: 'Regla Test',
    } as unknown as ReglaPrecioRow)
  })

  it('vista completa cuando no hay parámetro regla', async () => {
    render(await ControlDePreciosPage({
      searchParams: Promise.resolve({}),
    }))

    expect(lastViewProps?.initial).toHaveLength(2)
    expect(lastViewProps?.regla).toBeUndefined()
    expect(lastViewProps?.aviso).toBeUndefined()
    expect(lastViewProps?.puedeAplicar).toBe(true)
  })

  it('ignora regla si no es un UUID válido (N1) o es un array', async () => {
    render(await ControlDePreciosPage({
      searchParams: Promise.resolve({ regla: 'invalido' }),
    }))
    expect(lastViewProps?.initial).toHaveLength(2)
    expect(lastViewProps?.regla).toBeUndefined()

    render(await ControlDePreciosPage({
      searchParams: Promise.resolve({ regla: [validUuid, 'otro'] }),
    }))
    expect(lastViewProps?.initial).toHaveLength(2)
    expect(lastViewProps?.regla).toBeUndefined()
  })

  it('filtra por regla cuando es válida y el usuario tiene ver_margenes', async () => {
    render(await ControlDePreciosPage({
      searchParams: Promise.resolve({ regla: validUuid }),
    }))

    expect(lastViewProps?.initial).toHaveLength(1)
    expect((lastViewProps?.initial as ProductoConPrecioStatus[])[0].id_producto).toBe('p-1')
    expect(lastViewProps?.regla).toEqual({ id: validUuid, nombre: 'Regla Test' })
    expect(lastViewProps?.aviso).toBeUndefined()
  })

  it('devuelve lista vacía y aviso si el usuario no tiene permiso ver_margenes', async () => {
    vi.spyOn(guardModule, 'hasModuleAccess').mockImplementation((_sess, mod, acc) => {
      if (mod === 'precios' && acc === 'ver_margenes') return false
      return true
    })

    render(await ControlDePreciosPage({
      searchParams: Promise.resolve({ regla: validUuid }),
    }))

    expect(lastViewProps?.initial).toEqual([])
    expect(lastViewProps?.regla).toBeUndefined()
    expect(lastViewProps?.aviso).toBe('No tenés permiso para ver reglas de margen.')
    expect(lastViewProps?.puedeAplicar).toBe(false)
  })

  it('devuelve lista vacía y aviso si la regla no existe en la base (N2)', async () => {
    vi.spyOn(reglaDal, 'getReglaPrecio').mockResolvedValue(null)

    render(await ControlDePreciosPage({
      searchParams: Promise.resolve({ regla: validUuid }),
    }))

    expect(lastViewProps?.initial).toEqual([])
    expect(lastViewProps?.regla).toBeUndefined()
    expect(lastViewProps?.aviso).toBe('Esa regla ya no existe.')
  })
})
