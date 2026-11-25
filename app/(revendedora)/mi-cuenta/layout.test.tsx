import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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

vi.mock('@/lib/auth/actions', () => ({
  logoutAction: vi.fn(),
}))

vi.mock('@/components/shell/SidebarClient', () => ({
  SidebarClient: () => null,
}))

const SESSION_REVENDEDORA = {
  user: { id: 'user-rev', email: 'ana@tenant.com' },
  tenantId: 'tenant-1',
  idRevendedora: 'rev-1',
  rolId: 'rol-rev',
  rolNombre: 'Revendedora',
  permisos: { revendedoras: ['ver_propio'] },
  modulosHabilitados: ['revendedoras'],
  subdominioOk: true,
  marca: { nombre: 'Tenant', logoUrl: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  verifySessionMock.mockResolvedValue(SESSION_REVENDEDORA)
  requireModuleRoleMock.mockResolvedValue(undefined)
})

async function renderLayout() {
  const { default: RevendedoraLayout } = await import('./layout')
  return RevendedoraLayout({ children: <div>Contenido</div> })
}

describe('RevendedoraLayout (portal)', () => {
  // Reemplaza el tramo E2E de "módulo apagado": la guarda de 00118 no deja
  // apagar revendedoras en el tenant E2E compartido.
  it('con el módulo apagado muestra "Módulo deshabilitado" sin pedir permisos', async () => {
    verifySessionMock.mockResolvedValue({ ...SESSION_REVENDEDORA, modulosHabilitados: [] })

    const html = renderToStaticMarkup(await renderLayout())

    expect(html).toContain('Módulo deshabilitado')
    expect(html).not.toContain('Contenido')
    expect(requireModuleRoleMock).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('un operador sin claim de revendedora va al panel del local', async () => {
    verifySessionMock.mockResolvedValue({ ...SESSION_REVENDEDORA, idRevendedora: null })

    await expect(renderLayout()).rejects.toThrow('REDIRECT:/revendedoras')
  })

  it('sin sesión va a /login', async () => {
    verifySessionMock.mockRejectedValue(new AuthorizationError('no-session'))

    await expect(renderLayout()).rejects.toThrow('REDIRECT:/login')
  })

  it('sin permiso ver_propio va a /login?e=no-permission', async () => {
    requireModuleRoleMock.mockRejectedValue(new AuthorizationError('no-permission'))

    await expect(renderLayout()).rejects.toThrow('REDIRECT:/login?e=no-permission')
    expect(requireModuleRoleMock).toHaveBeenCalledWith(SESSION_REVENDEDORA, 'revendedoras', 'ver_propio')
  })

  it('con módulo y permiso renderiza el contenido', async () => {
    const html = renderToStaticMarkup(await renderLayout())

    expect(html).toContain('Contenido')
    expect(html).not.toContain('Módulo deshabilitado')
  })
})
