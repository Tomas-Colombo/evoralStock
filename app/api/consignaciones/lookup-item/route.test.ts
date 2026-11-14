import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  verifySessionMock,
  requireModuleRoleMock,
  resolverCodigoMock,
  createServerClientMock,
} = vi.hoisted(() => ({
  verifySessionMock: vi.fn(),
  requireModuleRoleMock: vi.fn(),
  resolverCodigoMock: vi.fn(),
  createServerClientMock: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: verifySessionMock,
}))

vi.mock('@/lib/dal/guard', () => ({
  requireModuleRole: requireModuleRoleMock,
  hasModuleAccess: vi.fn(() => true),
}))

vi.mock('@/lib/dal/inventario/codigo', () => ({
  resolverCodigo: resolverCodigoMock,
}))

vi.mock('@/lib/dal/supabase', () => ({
  createServerClient: createServerClientMock,
}))

describe('GET /api/consignaciones/lookup-item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifySessionMock.mockResolvedValue({ tenantId: 't-1', idRevendedora: null })
    requireModuleRoleMock.mockResolvedValue(undefined)
  })

  it('devuelve qr-vacio si no viene qr ni code', async () => {
    const { GET } = await import('./route')
    const req = new NextRequest('http://localhost:3000/api/consignaciones/lookup-item?id_proveedor=prov-1')
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.reason).toBe('qr-vacio')
  })

  it('devuelve proveedor-vacio si no viene id_proveedor', async () => {
    const { GET } = await import('./route')
    const req = new NextRequest('http://localhost:3000/api/consignaciones/lookup-item?qr=QR-1')
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.reason).toBe('proveedor-vacio')
  })

  it('resuelve item por EAN a través de resolverCodigo', async () => {
    resolverCodigoMock.mockResolvedValue({
      tipo: 'item',
      item: {
        id_item: 'item-1',
        id_producto: 'prod-1',
        id_ingreso: 'ing-1',
        qr_code: 'QR-1',
        codigo_ean: '2000000000015',
        estado_item: 'disponible',
        tipo_ingreso: 'consignacion',
        costo_ingreso: 5000,
        fecha_ingreso: '2026-10-01',
      },
    })

    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({
        data: { id_proveedor: 'prov-1' },
        error: null,
      }),
    }

    createServerClientMock.mockResolvedValue({
      from: (table: string) => {
        if (table === 'ingreso_mercaderia') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id_proveedor: 'prov-1' }, error: null }),
              }),
            }),
          }
        }
        if (table === 'consignacion_detalle' || table === 'detalle_reserva') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'producto') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id_producto: 'prod-1',
                    nombre: 'Camisa Lino',
                    sku: 'CAM-1',
                    categoria: { id_categoria: 'c-1', nombre: 'Camisas' },
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        return builder
      },
    })

    const { GET } = await import('./route')
    const req = new NextRequest(
      'http://localhost:3000/api/consignaciones/lookup-item?code=2000000000015&id_proveedor=prov-1',
    )
    const res = await GET(req)
    const json = await res.json()

    expect(resolverCodigoMock).toHaveBeenCalledWith('2000000000015')
    expect(json.ok).toBe(true)
    expect(json.item.id_item).toBe('item-1')
    expect(json.item.producto_nombre).toBe('Camisa Lino')
  })

  it('devuelve item-not-found si resolverCodigo no encuentra o resuelve producto', async () => {
    resolverCodigoMock.mockResolvedValue(null)

    const { GET } = await import('./route')
    const req = new NextRequest(
      'http://localhost:3000/api/consignaciones/lookup-item?code=NOEXISTE&id_proveedor=prov-1',
    )
    const res = await GET(req)
    const json = await res.json()

    expect(json.ok).toBe(false)
    expect(json.reason).toBe('item-not-found')
  })
})
