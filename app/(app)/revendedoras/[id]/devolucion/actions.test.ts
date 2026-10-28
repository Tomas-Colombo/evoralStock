import { describe, expect, it, vi, beforeEach } from 'vitest'
import { devolverItemsRevendedoraAction } from './actions'
import * as dal from '@/lib/dal/revendedoras'
import * as guard from '@/lib/dal/guard'
import * as sessionModule from '@/lib/dal/session'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: vi.fn(),
}))

vi.mock('@/lib/dal/guard', () => ({
  requireModuleRole: vi.fn(),
  classifyAuthError: vi.fn(),
}))

vi.mock('@/lib/dal/revendedoras', () => ({
  devolverItemsRevendedora: vi.fn(),
}))

const revendedoraId = '123e4567-e89b-12d3-a456-426614174000'
const itemId = '323e4567-e89b-12d3-a456-426614174000'

describe('devolverItemsRevendedoraAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sessionModule.verifySession).mockResolvedValue({} as unknown as sessionModule.Session)
  })

  it('exige revendedoras/editar y pasa el payload validado al DAL', async () => {
    vi.mocked(dal.devolverItemsRevendedora).mockResolvedValue({ ok: true, itemsDevueltos: 1 })

    const res = await devolverItemsRevendedoraAction({
      id_revendedora: revendedoraId,
      items: [itemId, itemId],
      estado_destino: 'disponible',
      motivo: '  Fin de temporada  ',
    })

    expect(guard.requireModuleRole).toHaveBeenCalledWith(expect.anything(), 'revendedoras', 'editar')
    expect(dal.devolverItemsRevendedora).toHaveBeenCalledWith({
      id_revendedora: revendedoraId,
      items: [itemId],
      estado_destino: 'disponible',
      motivo: 'Fin de temporada',
    })
    expect(res.ok).toBe(true)
  })

  it('rechaza un destino que no es de devolución sin tocar el DAL', async () => {
    const res = await devolverItemsRevendedoraAction({
      id_revendedora: revendedoraId,
      items: [itemId],
      estado_destino: 'vendido',
    })

    expect(dal.devolverItemsRevendedora).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
  })

  it('rechaza una devolución sin ítems', async () => {
    const res = await devolverItemsRevendedoraAction({
      id_revendedora: revendedoraId,
      items: [],
      estado_destino: 'disponible',
    })

    expect(dal.devolverItemsRevendedora).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: false, reason: 'payload-invalido' })
  })
})
