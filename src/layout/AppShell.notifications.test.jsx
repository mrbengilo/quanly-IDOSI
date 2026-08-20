import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'

const mocked = vi.hoisted(() => ({
  session: { role: 'admin', name: 'Admin' },
  activeStoreId: 'CH001',
  readNotification: vi.fn(),
  clearNotifications: vi.fn(),
  setActiveStoreId: vi.fn(),
  notifications: [],
}))

const baseNotifications = [
  { id: 'N1', storeId: 'CH001', title: 'Don moi 1' },
  { id: 'N2', storeId: 'CH001', title: 'Don moi 2' },
  { id: 'N3', storeId: 'CH002', orderId: 'ORDER-CH002', title: 'Don moi cua hang 2' },
  { id: 'N4', type: 'support-work-assigned', employeeId: 'HTKD001', assignmentId: 'SWA-1', route: '/support/tasks?assignment=SWA-1', title: 'Cong viec cua toi' },
  { id: 'N5', type: 'support-work-assigned', employeeId: 'HTKD002', assignmentId: 'SWA-2', route: '/support/tasks?assignment=SWA-2', title: 'Cong viec nguoi khac' },
  { id: 'N6', type: 'support-work-submitted', assignmentId: 'SWA-3', route: '/admin/support-employees', title: 'Ho tro KD da gui ket qua' },
  { id: 'N7', type: 'store-task-assigned', storeId: 'CH001', employeeId: 'E01', assignmentId: 'TSA-1', route: '/employee/home', title: 'Viec ca tuong lai' },
]

vi.mock('../state/AppContext', () => ({
  useApp: () => ({
    session: mocked.session,
    stores: [
      { id: 'CH001', name: 'Cua hang 1', short: 'CH1' },
      { id: 'CH002', name: 'Cua hang 2', short: 'CH2' },
    ],
    activeStoreId: mocked.activeStoreId,
    notifications: mocked.notifications,
    readNotification: mocked.readNotification,
    clearNotifications: mocked.clearNotifications,
    setActiveStoreId: mocked.setActiveStoreId,
    logout: vi.fn(),
    notify: vi.fn(),
    toast: null,
  }),
}))

function CurrentRoute() {
  const location = useLocation()
  return <output data-testid="current-route">{location.pathname}{location.search}</output>
}

describe('AppShell notifications', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.activeStoreId = 'CH001'
    mocked.notifications = baseNotifications.map((item) => ({ ...item }))
    sessionStorage.clear()
    mocked.readNotification.mockReset()
    mocked.clearNotifications.mockReset().mockResolvedValue({ ok: true, updatedCount: 2 })
    mocked.setActiveStoreId.mockReset()
  })

  it('marks all notifications in one scoped command instead of one request per item', async () => {
    render(<MemoryRouter initialEntries={['/store/overview']}><AppShell /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    fireEvent.click(screen.getByRole('button', { name: /Xóa tất cả thông báo/i }))

    await waitFor(() => expect(mocked.clearNotifications).toHaveBeenCalledWith('CH001'))
    expect(mocked.clearNotifications).toHaveBeenCalledTimes(1)
    expect(mocked.readNotification).not.toHaveBeenCalled()
  })

  it('switches to the notification store before opening its order', async () => {
    mocked.readNotification.mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/admin/overview']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<CurrentRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    fireEvent.click(screen.getByText('Don moi cua hang 2'))

    expect(mocked.setActiveStoreId).toHaveBeenCalledWith('CH002')
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/store/orders?store=CH002&order=ORDER-CH002'))
    await waitFor(() => expect(mocked.readNotification).toHaveBeenCalledWith('N3'))
  })

  it('shows a new assigned-task popup and removes it from the bell after opening', async () => {
    mocked.session = { role: 'employee', name: 'Nhân viên', employeeId: 'E01', code: 'E01', storeId: 'CH001', unit: 'store' }
    mocked.notifications = []
    mocked.readNotification.mockResolvedValue({ ok: true })
    const view = render(
      <MemoryRouter initialEntries={['/employee/home']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<CurrentRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    mocked.notifications = [{ id: 'TASK-NEW', type: 'store-task-assigned', storeId: 'CH001', employeeId: 'E01', assignmentId: 'ASSIGN-NEW', title: 'Công việc mới' }]
    view.rerender(
      <MemoryRouter initialEntries={['/employee/home']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<CurrentRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Mở công việc vừa được giao' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mở công việc vừa được giao' }))
    expect(screen.getByTestId('current-route').textContent).toBe('/employee/home?assignment=ASSIGN-NEW')
    await waitFor(() => expect(mocked.readNotification).toHaveBeenCalledWith('TASK-NEW'))
    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    expect(screen.queryByText('Công việc mới')).toBeNull()
  })

  it('shows Admin all current business-support menus plus account management', () => {
    render(<MemoryRouter initialEntries={['/admin/overview']}><AppShell /></MemoryRouter>)

    expect(document.querySelector('.sidebar__brand .brand__mark')?.getAttribute('src')).toBe('/favicon.png')
    expect(screen.getByRole('link', { name: /Nhân viên hỗ trợ KD/i }).getAttribute('href')).toBe('/admin/business-support')
    expect(screen.getByRole('link', { name: /^Nhân viên quản lý cửa hàng$/i }).getAttribute('href')).toBe('/admin/store-managers')
    expect(screen.getByRole('link', { name: /^Danh sách cửa hàng$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Danh sách nhân viên cửa hàng/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Cài đặt chính sách/i }).getAttribute('href')).toBe('/admin/policies')
    expect(screen.getByRole('link', { name: /Reset dữ liệu/i }).getAttribute('href')).toBe('/admin/reset')
    expect(screen.getByRole('link', { name: /Điều chuyển nhân sự/i }).getAttribute('href')).toBe('/admin/support-transfers')
  })

  it('gives business support policy access and the scoped operational reset', () => {
    mocked.session = { role: 'business_support', name: 'Hỗ trợ KD', employeeId: 'HTKD001' }
    render(<MemoryRouter initialEntries={['/support/overview']}><AppShell /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /^Tổng quan$/i }).getAttribute('href')).toBe('/support/overview')
    expect(screen.getByRole('link', { name: /^Danh sách cửa hàng$/i })).toBeTruthy()
    expect(screen.getAllByText('Hỗ trợ KD').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Khối văn phòng/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Danh sách nhân viên cửa hàng/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Nhân viên quản lý cửa hàng$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Điều chuyển nhân sự$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Công việc được giao/i }).getAttribute('href')).toBe('/support/tasks')
    expect(screen.getByRole('link', { name: /Lịch sử chỉnh sửa đơn hàng/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Nhân viên hỗ trợ KD/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Cài đặt$/i })).toBeNull()
    expect(screen.getByRole('link', { name: /Cài đặt chính sách/i }).getAttribute('href')).toBe('/admin/policies')
    expect(screen.getByRole('link', { name: /Reset dữ liệu/i }).getAttribute('href')).toBe('/admin/reset')
  })

  it('shows a support-work notification only to its assigned support employee', async () => {
    mocked.session = { role: 'business_support', name: 'Hỗ trợ KD', employeeId: 'HTKD001', code: 'HTKD001' }
    mocked.readNotification.mockResolvedValue({ ok: true })
    render(<MemoryRouter initialEntries={['/support/overview']}><AppShell /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    expect(screen.getAllByText('Cong viec cua toi').length).toBeGreaterThan(0)
    expect(screen.queryByText('Cong viec nguoi khac')).toBeNull()
    fireEvent.click(screen.getAllByText('Cong viec cua toi').find((node) => node.closest('.notification-item')).closest('.notification-item'))
    await waitFor(() => expect(mocked.readNotification).toHaveBeenCalledWith('N4'))
  })

  it('normalizes a submitted-work notification to the existing Admin support route', async () => {
    mocked.readNotification.mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/admin/overview']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<CurrentRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    fireEvent.click(screen.getByText('Ho tro KD da gui ket qua'))

    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/admin/business-support'))
    expect(mocked.readNotification).toHaveBeenCalledWith('N6')
  })

  it('opens an assigned store task on the employee home assignment view', async () => {
    mocked.session = { role: 'employee', name: 'Nhân viên', employeeId: 'E01', code: 'E01', storeId: 'CH001', unit: 'store' }
    mocked.readNotification.mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/employee/home']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<CurrentRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    fireEvent.click(screen.getAllByText('Viec ca tuong lai').find((node) => node.closest('.notification-item')).closest('.notification-item'))

    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/employee/home?assignment=TSA-1'))
    expect(mocked.readNotification).toHaveBeenCalledWith('N7')
  })

  it('locks a store manager to the assigned store workspace', () => {
    mocked.session = { role: 'store_manager', name: 'Quản lý CH2', storeId: 'CH002' }
    mocked.activeStoreId = 'CH001'
    render(<MemoryRouter initialEntries={['/store/overview']}><AppShell /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /^Tổng quan$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Nhân viên cửa hàng$/i })).toBeTruthy()
    expect(screen.getAllByText('Cua hang 2').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Quay về trang quản lý chính/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Danh sách cửa hàng$/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Quản lý nhân viên/i })).toBeNull()
    expect(screen.getByAltText('Logo IDOSI').getAttribute('src')).toBe('/favicon.png')
  })
})
