import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App, { RouteErrorBoundary } from './App'

const mocked = vi.hoisted(() => ({
  session: { role: 'admin', name: 'Admin' },
  currentEmployee: undefined,
}))

vi.mock('./state/AppContext', () => ({
  useApp: () => ({
    authReady: true,
    currentEmployee: mocked.currentEmployee,
    session: mocked.session,
  }),
}))

vi.mock('./layout/AppShell', async () => {
  const { Outlet } = await vi.importActual('react-router-dom')
  return { default: () => <Outlet /> }
})

vi.mock('./pages/admin/OrderInformationSettingsPage', () => ({
  OrderInformationSettingsPage: () => <div>Cài đặt thông tin đơn hàng route</div>,
}))

vi.mock('./pages/admin/AdminWorkRegistrationSchedulePage', () => ({
  AdminWorkRegistrationSchedulePage: () => <div>Lịch đăng ký HTKD và KVP route</div>,
}))

vi.mock('./pages/admin/SupportWorkPages', () => ({
  AdminSupportAssignmentPage: () => <div>Giao việc Admin route</div>,
  AdminSupportWorkPage: () => <div>Công việc tính thưởng HTKD route</div>,
  SupportAssignedWorkPage: () => <div>Công việc tính thưởng của tôi route</div>,
  SupportWorkInboxPage: () => <div>Công việc được giao route</div>,
}))

vi.mock('./pages/admin/SystemFinanceV2', () => ({
  AdminCashflowV2: () => <div>Admin cashflow</div>,
  AdminOverviewV2: () => <div>Admin overview</div>,
  AdminReportsV2: () => <div>Admin reports</div>,
}))

vi.mock('./pages/employee/OfficeEmployeeDashboard', () => ({
  OfficeEmployeeDashboard: () => <div>Role home</div>,
  OfficeEmployeePayrollPage: () => <div>Office payroll</div>,
}))

vi.mock('./pages/compensation', () => ({
  ManagerCompensationPage: () => <div>Quản lý thưởng phụ cấp</div>,
  MyCompensationPage: () => <div>Thu nhập của tôi</div>,
  MyViolationsPage: () => <div>Vi phạm của tôi</div>,
  RevenueBonusPage: () => <div>Thưởng doanh thu ngày</div>,
  ViolationManagementPage: ({ targetUnit, embedded }) => <div data-testid={`violation-${targetUnit}`} data-embedded={String(Boolean(embedded))}>{`Quản lý vi phạm ${targetUnit}`}</div>,
}))

function CurrentRoute() {
  const location = useLocation()
  return <output data-testid="current-route">{location.pathname}</output>
}

const renderRoute = (path, role) => {
  mocked.session = { role, name: role }
  mocked.currentEmployee = undefined
  return render(<MemoryRouter initialEntries={[path]}><CurrentRoute /><App /></MemoryRouter>)
}

describe('App role routes', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('offers a reload when a lazy route cannot be loaded after a deployment', () => {
    const reload = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const BrokenRoute = () => { throw new Error('Failed to fetch dynamically imported module') }

    render(<RouteErrorBoundary onReload={reload}><BrokenRoute /></RouteErrorBoundary>)

    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại trang' }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it.each(['admin', 'business_support'])('allows %s to open order information settings', async (role) => {
    renderRoute('/admin/order-information-settings', role)

    expect(await screen.findByText('Cài đặt thông tin đơn hàng route')).toBeTruthy()
    expect(screen.getByTestId('current-route').textContent).toBe('/admin/order-information-settings')
  })

  it('keeps order information settings unavailable to store managers', async () => {
    renderRoute('/admin/order-information-settings', 'store_manager')

    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/store/overview'))
    expect(screen.queryByText('Cài đặt thông tin đơn hàng route')).toBeNull()
  })

  it('allows Admin to open the aggregate work-registration schedule', async () => {
    renderRoute('/admin/work-registration-schedules', 'admin')

    expect(await screen.findByText('Lịch đăng ký HTKD và KVP route')).toBeTruthy()
    expect(screen.getByTestId('current-route').textContent).toBe('/admin/work-registration-schedules')
  })

  it('keeps the aggregate work-registration schedule Admin-only', async () => {
    renderRoute('/admin/work-registration-schedules', 'business_support')

    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/support/overview'))
    expect(screen.queryByText('Lịch đăng ký HTKD và KVP route')).toBeNull()
  })

  it('exposes the manual assignment screen to Admin', async () => {
    renderRoute('/admin/assignments', 'admin')

    expect(await screen.findByText('Giao việc Admin route')).toBeTruthy()
    expect(screen.getByTestId('current-route').textContent).toBe('/admin/assignments')
  })

  it('exposes the dedicated assigned-work inbox to HTKD', async () => {
    renderRoute('/support/assigned-work', 'business_support')

    expect(await screen.findByText('Công việc được giao route')).toBeTruthy()
    expect(screen.getByTestId('current-route').textContent).toBe('/support/assigned-work')
  })

  it('exposes the dedicated assigned-work inbox to Office employees', async () => {
    mocked.session = { role: 'employee', name: 'Nhân viên văn phòng', employeeId: 'VP-001' }
    mocked.currentEmployee = { id: 'VP-001', unit: 'office' }
    render(<MemoryRouter initialEntries={['/employee/assigned-work']}><CurrentRoute /><App /></MemoryRouter>)

    expect(await screen.findByText('Công việc được giao route')).toBeTruthy()
    expect(screen.getByTestId('current-route').textContent).toBe('/employee/assigned-work')
  })

  it('does not expose the removed working-time settings through a direct URL', async () => {
    renderRoute('/admin/working-time-settings', 'admin')

    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/admin/overview'))
  })

  it.each(['admin', 'business_support'])('allows %s to manage compensation across operational stores', async (role) => {
    renderRoute('/admin/compensation/managers', role)

    expect(await screen.findByText('Quản lý thưởng phụ cấp')).toBeTruthy()
  })

  it('keeps manager-compensation mutations unavailable to store managers', async () => {
    renderRoute('/admin/compensation/managers', 'store_manager')

    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/store/overview'))
    expect(screen.queryByText('Quản lý thưởng phụ cấp')).toBeNull()
  })

  it('keeps HTKD violation management Admin-only', async () => {
    renderRoute('/admin/violations/business-support', 'business_support')

    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/support/overview'))
    expect(screen.queryByText('Quản lý vi phạm business_support')).toBeNull()
  })

  it('combines HTKD reward tasks and embedded violation management on the Admin task route', async () => {
    renderRoute('/admin/tasks', 'admin')

    expect(await screen.findByText('Công việc tính thưởng HTKD route')).toBeTruthy()
    expect(screen.getByTestId('violation-business_support').dataset.embedded).toBe('true')
    expect(screen.getByTestId('current-route').textContent).toBe('/admin/tasks')
  })

  it('allows a store manager to read the scoped daily-revenue bonus', async () => {
    renderRoute('/store/revenue-bonus', 'store_manager')

    expect(await screen.findByText('Thưởng doanh thu ngày')).toBeTruthy()
  })

  it('allows an employee to read only their compensation statement', async () => {
    renderRoute('/employee/compensation', 'employee')

    expect(await screen.findByText('Thu nhập của tôi')).toBeTruthy()
  })

  it('keeps the store revenue bonus route unavailable to office employees', async () => {
    mocked.session = { role: 'employee', name: 'Nhân viên văn phòng', employeeId: 'VP-001' }
    mocked.currentEmployee = { id: 'VP-001', unit: 'office' }
    render(<MemoryRouter initialEntries={['/employee/revenue-bonus']}><CurrentRoute /><App /></MemoryRouter>)

    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/employee/home'))
    expect(screen.queryByText('Thưởng doanh thu ngày')).toBeNull()
  })
})
