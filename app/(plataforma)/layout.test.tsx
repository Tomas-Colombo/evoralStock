import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthorizationError } from '@/lib/dal/errors'

const { redirectMock, notFoundMock, requireSuperAdminMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  notFoundMock: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
  requireSuperAdminMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
}))

vi.mock('@/lib/dal/plataforma/guard', () => ({
  requireSuperAdmin: requireSuperAdminMock,
}))

describe('PlataformaLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza shell de plataforma con título, email y botón de cerrar sesión', async () => {
    requireSuperAdminMock.mockResolvedValue({
      id: 'admin-uuid',
      email: 'superadmin@utopia.test',
    })

    const { default: PlataformaLayout } = await import('./layout')
    const view = await PlataformaLayout({
      children: <div data-testid="contenido">Contenido protegido</div>,
    })

    render(view)

    expect(screen.getByRole('link', { name: 'Plataforma' })).toBeInTheDocument()
    expect(screen.getByText('superadmin@utopia.test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument()
    expect(screen.getByTestId('contenido')).toBeInTheDocument()
  })

  it('no-session -> redirige a /login', async () => {
    requireSuperAdminMock.mockRejectedValue(new AuthorizationError('no-session'))

    const { default: PlataformaLayout } = await import('./layout')

    await expect(
      PlataformaLayout({
        children: <div>Contenido</div>,
      }),
    ).rejects.toThrow('REDIRECT:/login')
    expect(redirectMock).toHaveBeenCalledWith('/login')
  })

  it('no-permission -> invoca notFound()', async () => {
    requireSuperAdminMock.mockRejectedValue(new AuthorizationError('no-permission'))

    const { default: PlataformaLayout } = await import('./layout')

    await expect(
      PlataformaLayout({
        children: <div>Contenido</div>,
      }),
    ).rejects.toThrow('NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalled()
  })
})
