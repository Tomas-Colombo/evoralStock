import { describe, expect, it, vi, beforeEach } from 'vitest'
import { updateProveedorAction } from './actions'
import * as dalProveedor from '@/lib/dal/inventario/proveedor'
import * as guard from '@/lib/dal/guard'
import * as sessionModule from '@/lib/dal/session'
import { AuthorizationError } from '@/lib/dal/errors'
import { revalidatePath } from 'next/cache'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn(),
}))

vi.mock('@/lib/dal/guard', () => ({
  requireModuleRole: vi.fn(),
}))

vi.mock('@/lib/dal/inventario/proveedor', () => ({
  getProveedor: vi.fn(),
  updateProveedor: vi.fn(),
}))

const UUID_PROVEEDOR = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

describe('updateProveedorAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue({
      tenantId: 'tenant-123',
      user: { id: 'user-456' },
      modulosHabilitados: [],
    } as unknown as sessionModule.Session)
    vi.mocked(guard.requireModuleRole).mockResolvedValue(undefined)
  })

  it('sin permiso: requireModuleRole se llama con (\'inventario\', \'editar\') y devuelve no-permission', async () => {
    vi.mocked(guard.requireModuleRole).mockRejectedValueOnce(
      new AuthorizationError('no-permission'),
    )

    const res = await updateProveedorAction(UUID_PROVEEDOR, {
      nombre: 'Nuevo Nombre',
    })

    expect(guard.requireModuleRole).toHaveBeenCalledWith(
      expect.anything(),
      'inventario',
      'editar',
    )
    expect(dalProveedor.updateProveedor).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'no-permission' })
  })

  it('id inválido -> proveedor-invalido', async () => {
    const res = await updateProveedorAction('id-invalido', {
      nombre: 'Nuevo Nombre',
    })

    expect(dalProveedor.updateProveedor).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'proveedor-invalido' })
  })

  it('REQ-MODOP-06 N1: sin el paquete de consignación, patch con tipo consignatario sobre un proveedor mayorista -> tipo-proveedor-invalido', async () => {
    vi.mocked(dalProveedor.getProveedor).mockResolvedValueOnce({
      id_proveedor: UUID_PROVEEDOR,
      tipo: 'mayorista',
    } as never)

    const res = await updateProveedorAction(UUID_PROVEEDOR, {
      tipo: 'consignatario',
    })

    expect(dalProveedor.updateProveedor).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'tipo-proveedor-invalido' })
  })

  it('REQ-MODOP-06 N3: sin el paquete, patch con tipo consignatario sobre un proveedor que ya es consignatario -> ok', async () => {
    vi.mocked(dalProveedor.getProveedor).mockResolvedValueOnce({
      id_proveedor: UUID_PROVEEDOR,
      tipo: 'consignatario',
    } as never)
    vi.mocked(dalProveedor.updateProveedor).mockResolvedValueOnce(undefined as never)

    const res = await updateProveedorAction(UUID_PROVEEDOR, {
      tipo: 'consignatario',
    })

    expect(dalProveedor.updateProveedor).toHaveBeenCalledWith(UUID_PROVEEDOR, {
      tipo: 'consignatario',
    })
    expect(res).toEqual({ ok: true })
  })

  it('feliz: guarda y revalida /proveedores y /proveedores/<id>', async () => {
    vi.mocked(dalProveedor.updateProveedor).mockResolvedValueOnce(undefined as never)

    const res = await updateProveedorAction(UUID_PROVEEDOR, {
      nombre: 'Proveedor Actualizado',
    })

    expect(dalProveedor.updateProveedor).toHaveBeenCalledWith(UUID_PROVEEDOR, {
      nombre: 'Proveedor Actualizado',
    })
    expect(revalidatePath).toHaveBeenCalledWith('/proveedores')
    expect(revalidatePath).toHaveBeenCalledWith(`/proveedores/${UUID_PROVEEDOR}`)
    expect(res).toEqual({ ok: true })
  })
})
