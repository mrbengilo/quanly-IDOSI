import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoreOrdersPage } from '../pages/store/StoreV2Pages'
import AppShell from './AppShell'

const mocked = vi.hoisted(() => ({
  session: { role: 'admin', name: 'Admin' },
  activeStoreId: 'CH001',
  readNotification: vi.fn(),
  clearNotifications: vi.fn(),
  setActiveStoreId: vi.fn(),
  updateOrder: vi.fn(),
  deleteOrder: vi.fn(),
  notifications: [],
  orders: [],
  currentEmployee: undefined,
  settings: { avatar: '/avatar-shell.jpg' },
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
    orders: mocked.orders,
    currentEmployee: mocked.currentEmployee,
    settings: mocked.settings,
    readNotification: mocked.readNotification,
    clearNotifications: mocked.clearNotifications,
    setActiveStoreId: mocked.setActiveStoreId,
    updateOrder: mocked.updateOrder,
    deleteOrder: mocked.deleteOrder,
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
    mocked.orders = [{ id: 'ORDER-CH002', code: 'CH2-00001', storeId: 'CH002' }]
    mocked.currentEmployee = undefined
    sessionStorage.clear()
    mocked.readNotification.mockReset()
    mocked.clearNotifications.mockReset().mockResolvedValue({ ok: true, updatedCount: 2 })
    mocked.setActiveStoreId.mockReset()
    mocked.updateOrder.mockReset()
    mocked.deleteOrder.mockReset()
  })

  it('marks all notifications in one scoped command instead of one request per item', async () => {
    render(<MemoryRouter initialEntries={['/store/overview']}><AppShell /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    fireEvent.click(screen.getByRole('button', { name: /Xóa tất cả thông báo/i }))

    await waitFor(() => expect(mocked.clearNotifications).toHaveBeenCalledWith('CH001'))
    expect(mocked.clearNotifications).toHaveBeenCalledTimes(1)
    expect(mocked.readNotification).not.toHaveBeenCalled()
  })

  it('opens a legacy order-code notification in its authoritative store workspace', async () => {
    mocked.notifications = baseNotifications.map((item) => (
      item.id === 'N3' ? { ...item, orderId: undefined, orderCode: 'CH2-00001', storeId: 'CH001' } : item
    ))
    mocked.orders = [
      { id: 'ORDER-CH001', code: 'CH1-00001', storeId: 'CH001', amount: 10_000, createdAt: '2026-08-20T08:00:00+07:00' },
      { id: 'ORDER-CH002', code: 'CH2-00001', storeId: 'CH002', amount: 20_000, createdAt: '2026-08-20T09:00:00+07:00' },
    ]
    mocked.readNotification.mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/admin/overview']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/store/orders" element={<><StoreOrdersPage /><CurrentRoute /></>} />
            <Route path="*" element={<CurrentRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    fireEvent.click(screen.getByText('Don moi cua hang 2'))

    expect(mocked.setActiveStoreId).toHaveBeenCalledWith('CH002')
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/store/orders?store=CH002&order=ORDER-CH002'))
    expect(document.querySelector('.global-topbar__store-name')?.textContent).toBe('Cua hang 2')
    expect(screen.getByText('CH2-00001')).toBeTruthy()
    expect(screen.queryByText('CH1-00001')).toBeNull()
    await waitFor(() => expect(mocked.readNotification).toHaveBeenCalledWith('N3'))
    expect(mocked.readNotification).toHaveBeenCalledTimes(1)
  })

  it('uses nested order store metadata to route a duplicate code to the exact order id', async () => {
    mocked.notifications = baseNotifications.map((item) => (
      item.id === 'N3'
        ? {
            ...item,
            orderId: undefined,
            orderCode: 'SHARED-00001',
            storeId: 'CH001',
            data: { order: { id: 'ORDER-CH002-DUP', code: 'SHARED-00001', storeId: 'CH002' } },
            title: 'Don trung ma cua hang 2',
          }
        : item
    ))
    mocked.orders = [
      {
        id: 'ORDER-CH001-DUP', code: 'SHARED-00001', storeId: 'CH001', customerName: 'Khach sai cua hang',
        amount: 10_000, createdAt: '2026-08-20T08:00:00+07:00',
      },
      {
        id: 'ORDER-CH002-DUP', code: 'SHARED-00001', storeId: 'CH002', customerName: 'Khach dung cua hang',
        amount: 20_000, createdAt: '2026-08-20T09:00:00+07:00',
      },
    ]
    mocked.readNotification.mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/admin/overview']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/store/orders" element={<><StoreOrdersPage /><CurrentRoute /></>} />
            <Route path="*" element={<CurrentRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    fireEvent.click(screen.getByText('Don trung ma cua hang 2'))

    expect(mocked.setActiveStoreId).toHaveBeenCalledWith('CH002')
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe(
      '/store/orders?store=CH002&order=ORDER-CH002-DUP',
    ))
    expect(screen.getByText('Khach dung cua hang')).toBeTruthy()
    expect(screen.queryByText('Khach sai cua hang')).toBeNull()
    expect(mocked.readNotification).toHaveBeenCalledWith('N3')
  })

  it('marks only the selected order notification as read', async () => {
    mocked.notifications = baseNotifications.slice(0, 2)
    mocked.readNotification.mockResolvedValue({ ok: true })
    render(<MemoryRouter initialEntries={['/admin/overview']}><AppShell /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    fireEvent.click(screen.getByText('Don moi 1'))
    await waitFor(() => expect(mocked.readNotification).toHaveBeenCalledWith('N1'))

    fireEvent.click(screen.getByRole('button', { name: /Xem thông báo/i }))
    expect(screen.queryByText('Don moi 1')).toBeNull()
    expect(screen.getByText('Don moi 2')).toBeTruthy()
    expect(mocked.readNotification).toHaveBeenCalledTimes(1)
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
    expect(screen.getByRole('link', { name: /Khảo sát thông tin KH/i }).getAttribute('href')).toBe('/admin/customer-survey')
    expect(screen.getByRole('link', { name: /Reset dữ liệu/i }).getAttribute('href')).toBe('/admin/reset')
    expect(screen.getByRole('link', { name: /Điều chuyển nhân sự/i }).getAttribute('href')).toBe('/admin/support-transfers')
    expect(screen.getByRole('link', { name: /Cài đặt thông tin đơn hàng/i }).getAttribute('href')).toBe('/admin/order-information-settings')
    expect(screen.getByRole('link', { name: /Lịch đăng ký làm việc của HTKD và KVP/i }).getAttribute('href')).toBe('/admin/work-registration-schedules')
    expect(document.querySelector('.sidebar nav a em')).toBeNull()
  })

  it('gives business support its employee directory, policy and survey access without Reset dữ liệu', () => {
    mocked.session = { role: 'business_support', name: 'Hỗ trợ KD', employeeId: 'HTKD001' }
    render(<MemoryRouter initialEntries={['/support/overview']}><AppShell /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /^Tổng quan$/i }).getAttribute('href')).toBe('/support/overview')
    expect(screen.getByRole('link', { name: /^Danh sách cửa hàng$/i })).toBeTruthy()
    expect(screen.getAllByText('Hỗ trợ KD').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link').find((link) => link.getAttribute('href') === '/office')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Danh sách nhân viên cửa hàng/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Nhân viên hỗ trợ KD$/i }).getAttribute('href')).toBe('/admin/business-support')
    expect(screen.getByRole('link', { name: /^Nhân viên quản lý cửa hàng$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Điều chuyển nhân sự$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Công việc được giao/i }).getAttribute('href')).toBe('/support/tasks')
    expect(screen.getByRole('link', { name: /Lịch sử chỉnh sửa đơn hàng/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Cài đặt$/i })).toBeNull()
    expect(screen.getByRole('link', { name: /Cài đặt chính sách/i }).getAttribute('href')).toBe('/admin/policies')
    expect(screen.getByRole('link', { name: /Khảo sát thông tin KH/i }).getAttribute('href')).toBe('/admin/customer-survey')
    expect(screen.getByRole('link', { name: /Cài đặt thông tin đơn hàng/i }).getAttribute('href')).toBe('/admin/order-information-settings')
    expect(screen.queryByRole('link', { name: /Lịch đăng ký làm việc của HTKD và KVP/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Reset dữ liệu/i })).toBeNull()
    expect(document.querySelector('.sidebar nav a em')).toBeNull()
    expect(Array.from(document.querySelectorAll('.sidebar nav a')).map((link) => link.querySelector('span')?.textContent)).toEqual([
      'Tổng quan', 'Công việc được giao', 'Lịch làm việc của tôi', 'Thu nhập của tôi', 'Vi phạm của tôi', 'Phân lịch làm việc',
      'Nhân viên hỗ trợ KD', 'Khối văn phòng', 'Danh sách cửa hàng',
      'Danh sách nhân viên cửa hàng', 'Nhân viên quản lý cửa hàng', 'Dòng tiền', 'Báo cáo',
      'Cài đặt thông tin đơn hàng', 'Danh mục công việc & vi phạm', 'Khảo sát thông tin KH', 'Thưởng và phụ cấp quản lý', 'Thưởng doanh thu ngày',
      'Vi phạm nhân viên', 'Vi phạm Khối văn phòng', 'Lịch sử chỉnh sửa đơn hàng', 'Điều chuyển nhân sự', 'Cài đặt chính sách',
    ])
  })

  it('shows Cài đặt lương in the store workspace only to Admin and Business Support', () => {
    const adminView = render(<MemoryRouter initialEntries={['/store/overview']}><AppShell /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Cài đặt lương' }).getAttribute('href')).toBe('/store/salary-settings')

    adminView.unmount()
    mocked.session = { role: 'business_support', name: 'Hỗ trợ KD', employeeId: 'HTKD001' }
    const supportView = render(<MemoryRouter initialEntries={['/store/overview']}><AppShell /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Cài đặt lương' }).getAttribute('href')).toBe('/store/salary-settings')

    supportView.unmount()
    mocked.session = { role: 'store_manager', name: 'Quản lý cửa hàng', storeId: 'CH001' }
    render(<MemoryRouter initialEntries={['/store/overview']}><AppShell /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: 'Cài đặt lương' })).toBeNull()
  })

  it('opens the role selector below the logo and keeps the account avatar for a multi-role account', async () => {
    mocked.session = {
      role: 'store_manager', name: 'Nhân viên đa vai trò', employeeId: 'QLCH01', storeId: 'CH001',
      availableRoles: [
        { role: 'store_manager', employeeId: 'QLCH01', storeId: 'CH001' },
        { role: 'employee', employeeId: 'E01', storeId: 'CH001' },
        { role: 'business_support', employeeId: 'HTKD01', storeId: 'BUSINESS_SUPPORT' },
      ],
    }
    render(<MemoryRouter initialEntries={['/store/overview']}><Routes>
      <Route element={<AppShell />}><Route path="*" element={<CurrentRoute />} /></Route>
    </Routes></MemoryRouter>)

    expect(document.querySelector('.sidebar__brand + .role-switcher-button')).toBeTruthy()
    expect(document.querySelector('.sidebar__profile img')?.getAttribute('src')).toBe('/avatar-shell.jpg')
    fireEvent.click(screen.getByRole('button', { name: 'Đổi vai trò' }))
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/select-role'))
  })

  it('renames the Office employee schedule menu to Lịch làm việc của tôi', () => {
    mocked.session = { role: 'employee', name: 'Nhân viên văn phòng', employeeId: 'VP01', storeId: 'OFFICE', unit: 'office' }
    mocked.currentEmployee = { id: 'VP01', name: 'Nhân viên văn phòng', unit: 'office' }
    render(<MemoryRouter initialEntries={['/employee/home']}><AppShell /></MemoryRouter>)

    expect(screen.getByRole('link', { name: 'Lịch làm việc của tôi' }).getAttribute('href')).toBe('/employee/schedule')
    expect(screen.queryByRole('link', { name: 'Lịch phân ca' })).toBeNull()
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
    expect(screen.getByRole('link', { name: /^Chi phí cửa hàng$/i }).getAttribute('href')).toBe('/store/expenses')
    expect(screen.getAllByText('Cua hang 2').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Quay về trang quản lý chính/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Danh sách cửa hàng$/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Quản lý nhân viên/i })).toBeNull()
    expect(screen.getByAltText('Logo IDOSI').getAttribute('src')).toBe('/favicon.png')
  })
})
