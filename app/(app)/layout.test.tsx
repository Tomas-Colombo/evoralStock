import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError } from '@/lib/dal/errors'

const {
  redirectMock,
  verifySessionMock,
  superAdminActualMock,
  getTenantSubdomainFromHeadersMock,
  verifyTenantMatchMock,
} = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  verifySessionMock: vi.fn(),
  superAdminActualMock: vi.fn(),
  getTenantSubdomainFromHeadersMock: vi.fn(),
  verifyTenantMatchMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}))

vi.mock('@/lib/dal/session', () => ({
  verifySession: verifySessionMock,
}))

vi.mock('@/lib/dal/plataforma/guard', () => ({
  superAdminActual: superAdminActualMock,
}))

vi.mock('@/lib/dal/tenant', () => ({
  getTenantSubdomainFromHeaders: getTenantSubdomainFromHeadersMock,
  verifyTenantMatch: verifyTenantMatchMock,
}))

vi.mock('@/components/shell/Sidebar', () => ({
  Sidebar: () => <nav data-testid="mock-sidebar" />,
}))

vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  getTenantSubdomainFromHeadersMock.mockResolvedValue(null)
  verifyTenantMatchMock.mockResolvedValue(undefined)
})

describe('AppShellLayout (REQ-SA-01 N5)', () => {
  it('no-session + super admin: desvía a /plataforma (evita bucle hacia /login)', async () => {
    verifySessionMock.mockRejectedValue(new AuthorizationError('no-session'))
    superAdminActualMock.mockResolvedValue({
      id: 'super-admin-uuid',
      email: 'admin@utopia.app',
    })

    const { default: AppShellLayout } = await import('./layout')

    await expect(
      AppShellLayout({ children: <div>Contenido</div> }),
    ).rejects.toThrow('REDIRECT:/plataforma')

    expect(superAdminActualMock).toHaveBeenCalledTimes(1)
    expect(redirectMock).toHaveBeenCalledWith('/plataforma')
  })

  it('no-session + usuario normal sin sesión: redirige a /login', async () => {
    verifySessionMock.mockRejectedValue(new AuthorizationError('no-session'))
    superAdminActualMock.mockResolvedValue(null)

    const { default: AppShellLayout } = await import('./layout')

    await expect(
      AppShellLayout({ children: <div>Contenido</div> }),
    ).rejects.toThrow('REDIRECT:/login')

    expect(superAdminActualMock).toHaveBeenCalledTimes(1)
    expect(redirectMock).toHaveBeenCalledWith('/login')
  })

  it('sesión válida de revendedora: redirige a /mi-cuenta', async () => {
    verifySessionMock.mockResolvedValue({
      user: { id: 'rev-1', email: 'rev@tenant.com' },
      tenantId: 'tenant-1',
      idRevendedora: 'rev-uuid',
      rolId: 'rol-rev',
      rolNombre: 'Revendedora',
      permisos: {},
      modulosHabilitados: ['revendedoras'],
      subdominioOk: true,
      marca: { nombre: 'Tenant', logoUrl: null },
    })

    const { default: AppShellLayout } = await import('./layout')

    await expect(
      AppShellLayout({ children: <div>Contenido</div> }),
    ).rejects.toThrow('REDIRECT:/mi-cuenta')

    expect(redirectMock).toHaveBeenCalledWith('/mi-cuenta')
    expect(superAdminActualMock).not.toHaveBeenCalled()
  })
})
