import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import Login from './Login'

const login = vi.hoisted(() => vi.fn())
vi.mock('../state/AppContext', () => ({ useApp: () => ({ login }) }))
function CurrentRoute() {
  return <output data-testid="current-route">{useLocation().pathname}</output>
}
afterEach(() => { cleanup(); login.mockReset() })

it.each([
  ['business_support', '/support/overview'],
  ['manager', '/support/overview'],
  ['admin', '/admin/overview'],
  ['store_manager', '/store/overview'],
  ['employee', '/employee/home'],
])('opens the compact %s home after login', async (role, destination) => {
  login.mockResolvedValue({ ok: true, account: { role } })
  render(<MemoryRouter initialEntries={['/login']}><CurrentRoute /><Login /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))
  await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe(destination))
})

it('preserves role selection before navigating to a home screen', async () => {
  login.mockResolvedValue({ ok: true, account: { role: 'business_support', needsRoleSelection: true } })
  render(<MemoryRouter initialEntries={['/login']}><CurrentRoute /><Login /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))
  await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/select-role'))
})
