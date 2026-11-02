import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { RolesModal } from './RolesModal'
import { ToastProvider } from '@/components/ui/Toast'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

it('RolesModal renderiza el módulo revendedoras', async () => {
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <RolesModal
        roles={[{ id_rol: '1', nombre: 'Admin', permisos: { revendedoras: ['ver'] }, id_tenant: 't', created_at: '', updated_at: '' }]}
        modulosVisibles={['revendedoras']}
      />
    </ToastProvider>
  )
  
  const button = screen.getByRole('button', { name: /Roles/ })
  await user.click(button)

  expect(screen.getByText(/Revendedoras/)).toBeDefined()
})
