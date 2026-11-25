import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError } from '@/lib/dal/errors'

const { redirectMock, verifySessionMock, requireModuleRoleMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  verifySessionMock: vi.fn(),
  requireModuleRoleMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: verifySessionMock,
}))

vi.mock('@/lib/dal/guard', () => ({
  requireModuleRole: requireModuleRoleMock,
}))

const SESSION_BASE = {
  user: { id: 'user-1', email: 'admin@tenant.com' },
  tenantId: 'tenant-1',
  idRevendedora: null,
  rolId: 'rol-1',
  rolNombre: 'Administrador',
  permisos: { revendedoras: ['ver'] },
  modulosHabilitados: ['revendedoras'],
  subdominioOk: true,
  marca: { nombre: 'Tenant', logoUrl: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  verifySessionMock.mockResolvedValue(SESSION_BASE)
})

describe('RevendedorasLayout', () => {
  it('redirige a /no-autorizado?e=module-disabled si el módulo está apagado', async () => {
    requireModuleRoleMock.mockRejectedValue(new AuthorizationError('module-disabled'))

    const { default: RevendedorasLayout } = await import('./layout')

    await expect(
      RevendedorasLayout({ children: <div>Contenido</div> }),
    ).rejects.toThrow('REDIRECT:/no-autorizado?e=module-disabled')

    expect(requireModuleRoleMock).toHaveBeenCalledWith(SESSION_BASE, 'revendedoras', 'ver')
    expect(redirectMock).toHaveBeenCalledWith('/no-autorizado?e=module-disabled')
  })

  it('redirige a /no-autorizado?e=no-permission si no tiene permiso', async () => {
    requireModuleRoleMock.mockRejectedValue(new AuthorizationError('no-permission'))

    const { default: RevendedorasLayout } = await import('./layout')

    await expect(
      RevendedorasLayout({ children: <div>Contenido</div> }),
    ).rejects.toThrow('REDIRECT:/no-autorizado?e=no-permission')

    expect(redirectMock).toHaveBeenCalledWith('/no-autorizado?e=no-permission')
  })

  it('propaga errores que no son AuthorizationError sin redirigir', async () => {
    requireModuleRoleMock.mockRejectedValue(new Error('db-down'))

    const { default: RevendedorasLayout } = await import('./layout')

    await expect(
      RevendedorasLayout({ children: <div>Contenido</div> }),
    ).rejects.toThrow('db-down')

    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('renderiza children cuando está autorizado', async () => {
    requireModuleRoleMock.mockResolvedValue(undefined)

    const { default: RevendedorasLayout } = await import('./layout')
    const result = await RevendedorasLayout({ children: <div>Contenido</div> })

    expect(redirectMock).not.toHaveBeenCalled()
    expect(result).toBeDefined()
  })
})
