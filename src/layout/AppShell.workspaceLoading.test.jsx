import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { lazy } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'

const app = vi.hoisted(() => ({
  session: { id: 'USER-ADMIN', role: 'admin', name: 'Admin' },
  logout: vi.fn(),
  prefetchWorkspaceData: vi.fn(() => Promise.resolve()),
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

vi.mock('../services/idosiApi', () => ({ hasPendingApiRequests: () => false }))

vi.mock('../routeModules', () => ({
  preloadRouteModule: vi.fn(() => Promise.resolve()),
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
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('keeps navigation and account controls visible while projection data loads', () => {
    renderShell({ workspaceStatus: { kind: 'loading', message: 'Đang tải dữ liệu chi tiết...' } })

    expect(screen.getByText('Danh sách cửa hàng')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mở trang tài khoản' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Đang tải dữ liệu chi tiết...')
    expect(screen.queryByText('Dữ liệu trang')).toBeNull()
  })

  it('waits for projection data and the lazy page commit before any speculative requests', async () => {
    vi.useFakeTimers()
    const loading = renderShell({ workspaceStatus: { kind: 'loading' } })
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(app.prefetchWorkspaceData).not.toHaveBeenCalled()
    loading.unmount()
    const PendingPage = lazy(() => new Promise(() => {}))
    renderShell({ element: <PendingPage /> })
    await act(() => vi.advanceTimersByTimeAsync(10000))
    fireEvent.focus(screen.getByText('Danh sách cửa hàng').closest('a'))
    expect(app.prefetchWorkspaceData).not.toHaveBeenCalled()
  })

  it('warms only two permitted adjacent menus after the current page is displayed', async () => {
    vi.useFakeTimers()
    renderShell()
    expect(screen.getByText('Dữ liệu trang')).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(1499))
    expect(app.prefetchWorkspaceData).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(app.prefetchWorkspaceData).toHaveBeenCalledTimes(2)
    expect(app.prefetchWorkspaceData.mock.calls.every(([path]) => path !== '/admin/cashflow')).toBe(true)
  })

  it('contains a lazy page fallback inside the shell instead of replacing the application', async () => {
    const PendingPage = lazy(() => new Promise(() => {}))
    renderShell({ element: <PendingPage /> })

    expect(screen.getByText('Danh sách cửa hàng')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mở trang tài khoản' })).toBeTruthy()
    expect((await screen.findByRole('status')).textContent).toContain('Đang mở danh mục...')
  })
})
