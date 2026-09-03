import { cleanup, render, screen } from '@testing-library/react'
import { lazy } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'

const app = vi.hoisted(() => ({
  session: { id: 'USER-ADMIN', role: 'admin', name: 'Admin' },
  logout: vi.fn(),
  toast: null,
  notify: vi.fn(),
  stores: [{ id: 'STORE-A', name: 'IDOSI Store A', short: 'Store A' }],
  activeStoreId: 'STORE-A',
  settings: {},
  notifications: [],
  orderNotifications: [],
  orders: [],
  currentEmployee: null,
}))

vi.mock('../state/AppContext', () => ({
  useApp: () => app,
}))

vi.mock('../domain/notificationSound', () => ({
  playTaskNotificationSound: vi.fn(() => Promise.resolve()),
  unlockNotificationSound: vi.fn(() => Promise.resolve()),
}))

const renderShell = ({ workspaceStatus = null, element = <div>Dữ liệu trang</div> } = {}) => render(
  <MemoryRouter initialEntries={['/admin/cashflow']}>
    <Routes>
      <Route element={<AppShell workspaceStatus={workspaceStatus} />}>
        <Route path="/admin/cashflow" element={element} />
      </Route>
    </Routes>
  </MemoryRouter>,
)

describe('AppShell workspace loading states', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps navigation and account controls visible while projection data loads', () => {
    renderShell({ workspaceStatus: { kind: 'loading', message: 'Đang tải dữ liệu chi tiết...' } })

    expect(screen.getByText('Danh sách cửa hàng')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mở trang tài khoản' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Đang tải dữ liệu chi tiết...')
    expect(screen.queryByText('Dữ liệu trang')).toBeNull()
  })

  it('contains a lazy page fallback inside the shell instead of replacing the application', async () => {
    const PendingPage = lazy(() => new Promise(() => {}))
    renderShell({ element: <PendingPage /> })

    expect(screen.getByText('Danh sách cửa hàng')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mở trang tài khoản' })).toBeTruthy()
    expect((await screen.findByRole('status')).textContent).toContain('Đang mở danh mục...')
  })
})
