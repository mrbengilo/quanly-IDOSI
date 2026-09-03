import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App, { RouteErrorBoundary } from './App'

const mocked = vi.hoisted(() => ({
  session: { role: 'admin', name: 'Admin' },
  currentEmployee: undefined,
  remoteDataReady: true,
  remoteProjection: { kind: 'local', storeId: '' },
  activeStoreId: 'S01',
  ensureStoreWorkspaceData: vi.fn(() => Promise.resolve()),
  ensureSystemWorkspaceData: vi.fn(() => Promise.resolve()),
}))

vi.mock('./state/AppContext', () => ({
  useApp: () => ({
    authReady: true,
    currentEmployee: mocked.currentEmployee,
    activeStoreId: mocked.activeStoreId,
    remoteDataReady: mocked.remoteDataReady,
    remoteProjection: mocked.remoteProjection,
    ensureStoreWorkspaceData: mocked.ensureStoreWorkspaceData,
    ensureSystemWorkspaceData: mocked.ensureSystemWorkspaceData,
    session: mocked.session,
  }),
}))

vi.mock('./layout/AppShell', async () => {
  const { Outlet } = await vi.importActual('react-router-dom')
  return {
    default: ({ workspaceStatus = null }) => (
      <div data-testid="app-shell">
        <span>Khung ứng dụng</span>
        {workspaceStatus?.kind === 'loading' ? (
          <div role="status">{workspaceStatus.message}</div>
        ) : workspaceStatus?.kind === 'error' ? (
          <div role="alert">
            <strong>{workspaceStatus.message}</strong>
            <button type="button" onClick={workspaceStatus.onRetry}>Thử lại</button>
          </div>
        ) : <Outlet />}
      </div>
    ),
  }
})

vi.mock('./pages/admin/OrderInformationSettingsPage', () => ({
  OrderInformationSettingsPage: () => <div>Cài đặt thông tin đơn hàng route</div>,
}))

vi.mock('./pages/admin/DataRestorePage', () => ({
  DataRestorePage: () => <div>Khôi phục dữ liệu route</div>,
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

vi.mock('./pages/employee/EmployeeV2Pages', () => ({
  EmployeeDashboardV2: () => <div>Store employee home</div>,
}))

vi.mock('./pages/store/StoreV2Pages', () => ({
  StoreAttendanceV2: () => <div>Store attendance</div>,
  StoreCashflowV2: () => <div>Store cashflow</div>,
  StoreImportsV2: () => <div>Store imports</div>,
  StoreOverviewV2: () => <div>Store management overview</div>,
  StoreOrdersPage: () => <div>Store orders</div>,
  StorePayrollV2: () => <div>Store payroll</div>,
  StoreReportsV2: () => <div>Store reports</div>,
}))

vi.mock('./pages/compensation', () => ({
  ManagerCompensationPage: () => <div>Quản lý thưởng phụ cấp</div>,
  MyCompensationPage: () => <div>Thu nhập của tôi</div>,
  MyViolationsPage: () => <div>Vi phạm của tôi</div>,
  RevenueBonusPage: ({ storeScoped = false }) => <div data-testid="revenue-bonus-route" data-store-scoped={String(storeScoped)}>Thưởng doanh thu ngày</div>,
  ViolationRefundPage: () => <div>Hoàn trả vi phạm route</div>,
  ViolationManagementPage: ({ targetUnit, embedded }) => <div data-testid={`violation-${targetUnit}`} data-embedded={String(Boolean(embedded))}>{`Quản lý vi phạm ${targetUnit}`}</div>,
}))

function CurrentRoute() {
  const location = useLocation()
  return <output data-testid="current-route">{location.pathname}</output>
}

const renderRoute = (path, role) => {
  mocked.session = { role, name: role }
  mocked.currentEmployee = undefined
  mocked.remoteDataReady = true
  mocked.remoteProjection = { kind: 'local', storeId: '' }
  return render(<MemoryRouter initialEntries={[path]}><CurrentRoute /><App /></MemoryRouter>)
}

describe('App role routes', () => {
  afterEach(() => {
    cleanup()
    mocked.remoteDataReady = true
    mocked.remoteProjection = { kind: 'local', storeId: '' }
    mocked.ensureStoreWorkspaceData.mockClear()
    mocked.ensureSystemWorkspaceData.mockClear()
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

  it.each([
    ['admin', '/admin/overview', 'Admin overview'],
    ['business_support', '/support/overview', 'Role home'],
    ['store_manager', '/store/overview', 'Store management overview'],
    ['employee', '/employee/home', 'Store employee home'],
  ])('shows the %s home while the remaining shared state hydrates', async (role, path, expectedText) => {
    mocked.session = { role, name: role, ...(role === 'employee' ? { employeeId: 'E01', storeId: 'S01' } : {}) }
    mocked.currentEmployee = role === 'employee' ? { id: 'E01', unit: 'store', storeId: 'S01' } : undefined
    mocked.remoteDataReady = false
    render(<MemoryRouter initialEntries={[path]}><CurrentRoute /><App /></MemoryRouter>)

    expect(await screen.findByText(expectedText)).toBeTruthy()
    expect(screen.getByTestId('current-route').textContent).toBe(path)
  })

  it.each([
    ['admin', '/admin/cashflow'],
    ['business_support', '/support/tasks'],
    ['store_manager', '/store/reports'],
    ['employee', '/employee/orders'],
  ])('holds %s detail routes until the complete shared state is available', async (role, path) => {
    mocked.session = { role, name: role, ...(role === 'employee' ? { employeeId: 'E01', storeId: 'S01' } : {}) }
    mocked.currentEmployee = role === 'employee' ? { id: 'E01', unit: 'store', storeId: 'S01' } : undefined
    mocked.remoteDataReady = false
    render(<MemoryRouter initialEntries={[path]}><CurrentRoute /><App /></MemoryRouter>)

    expect(await screen.findByText('Đang tải dữ liệu chi tiết...')).toBeTruthy()
    expect(screen.getByTestId('app-shell')).toBeTruthy()
    expect(screen.getByText('Khung ứng dụng')).toBeTruthy()
    expect(screen.getByTestId('current-route').textContent).toBe(path)
  })

  it('loads and waits for the selected store projection before mounting Admin store pages', async () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.remoteProjection = { kind: 'global', storeId: '' }
    render(<MemoryRouter initialEntries={['/store/payroll?period=2026-09']}><CurrentRoute /><App /></MemoryRouter>)

    expect(await screen.findByText('Đang tải dữ liệu chi tiết...')).toBeTruthy()
    expect(mocked.ensureStoreWorkspaceData).toHaveBeenCalledWith('S01', { screen: 'payroll', period: '2026-09' })
    expect(screen.queryByText('Store payroll')).toBeNull()
  })

  it('mounts Admin store pages only when their projection matches the active store', async () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.remoteProjection = { kind: 'store', storeId: 'S01', screen: 'payroll', period: '2026-09' }
    render(<MemoryRouter initialEntries={['/store/payroll?period=2026-09']}><CurrentRoute /><App /></MemoryRouter>)

    expect(await screen.findByText('Store payroll')).toBeTruthy()
  })

  it('reloads the global projection before returning from a store to system pages', async () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.remoteProjection = { kind: 'store', storeId: 'S01' }
    render(<MemoryRouter initialEntries={['/admin/cashflow']}><CurrentRoute /><App /></MemoryRouter>)

    expect(await screen.findByText('Đang tải dữ liệu chi tiết...')).toBeTruthy()
    expect(mocked.ensureSystemWorkspaceData).toHaveBeenCalledWith({ screen: 'cashflow' })
    expect(screen.queryByText('Admin cashflow')).toBeNull()
  })

  it('loads the reset projection before mounting the Admin data restore workspace', async () => {
  mocked.session = { role: 'admin', name: 'Admin' }
  mocked.remoteDataReady = false
  mocked.remoteProjection = { kind: 'global', storeId: '', screen: 'stores' }
  render(<MemoryRouter initialEntries={['/admin/data-restore']}><CurrentRoute /><App /></MemoryRouter>)

  expect(await screen.findByText('Đang tải dữ liệu chi tiết...')).toBeTruthy()
  expect(mocked.ensureSystemWorkspaceData).toHaveBeenCalledWith({ screen: 'reset' })
  expect(screen.queryByText('Khôi phục dữ liệu route')).toBeNull()
})

  it('loads the global projection on demand for a compact Admin detail route', async () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.remoteDataReady = false
    mocked.remoteProjection = { kind: 'global', storeId: '' }
    render(<MemoryRouter initialEntries={['/admin/cashflow']}><CurrentRoute /><App /></MemoryRouter>)

    expect(await screen.findByText('Đang tải dữ liệu chi tiết...')).toBeTruthy()
    expect(mocked.ensureSystemWorkspaceData).toHaveBeenCalledWith({ screen: 'cashflow' })
    expect(screen.queryByText('Admin cashflow')).toBeNull()
  })

  it('shows a recoverable error and retries when an Admin screen projection fails', async () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.remoteProjection = { kind: 'global', storeId: '', screen: 'overview' }
    mocked.ensureSystemWorkspaceData.mockRejectedValueOnce(new Error('Network unavailable'))
    render(<MemoryRouter initialEntries={['/admin/stores']}><CurrentRoute /><App /></MemoryRouter>)

    expect((await screen.findByRole('alert')).textContent).toContain('Không thể tải dữ liệu màn hình')
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    await waitFor(() => expect(mocked.ensureSystemWorkspaceData).toHaveBeenCalledTimes(2))
    expect(mocked.ensureSystemWorkspaceData).toHaveBeenLastCalledWith({ screen: 'stores' })
  })

  it('loads only the requested employee screen projection after compact login', async () => {
    mocked.session = { role: 'employee', name: 'Nhân viên', employeeId: 'E01', storeId: 'S01' }
    mocked.currentEmployee = { id: 'E01', unit: 'store', storeId: 'S01' }
    mocked.remoteDataReady = false
    mocked.remoteProjection = { kind: 'global', storeId: '', screen: 'employee-home' }
    render(<MemoryRouter initialEntries={['/employee/orders']}><CurrentRoute /><App /></MemoryRouter>)

    expect(await screen.findByText('Đang tải dữ liệu chi tiết...')).toBeTruthy()
    expect(mocked.ensureSystemWorkspaceData).toHaveBeenCalledWith({ screen: 'employee-orders' })
  })

  it('does not load the global projection behind the compact Admin home', async () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.remoteDataReady = false
    mocked.remoteProjection = { kind: 'global', storeId: '' }
    render(<MemoryRouter initialEntries={['/admin/overview']}><CurrentRoute /><App /></MemoryRouter>)

    expect(await screen.findByText('Admin overview')).toBeTruthy()
    expect(mocked.ensureSystemWorkspaceData).not.toHaveBeenCalled()
  })

  it('mounts a system detail page only for its matching screen projection', async () => {
    mocked.session = { role: 'admin', name: 'Admin' }
    mocked.remoteProjection = { kind: 'global', storeId: '', screen: 'cashflow' }
    render(<MemoryRouter initialEntries={['/admin/cashflow']}><CurrentRoute /><App /></MemoryRouter>)

    expect(await screen.findByText('Admin cashflow')).toBeTruthy()
    expect(mocked.ensureSystemWorkspaceData).not.toHaveBeenCalled()
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

  it.each(['admin', 'business_support'])('opens the shared HTKD reward and violation workspace for %s', async (role) => {
    renderRoute('/admin/tasks', role)

    expect(await screen.findByText('Công việc tính thưởng HTKD route')).toBeTruthy()
    expect(screen.getByTestId('current-route').textContent).toBe('/admin/tasks')
  })

  it('allows a store manager to read the scoped daily-revenue bonus', async () => {
    renderRoute('/store/revenue-bonus', 'store_manager')

    expect(await screen.findByText('Thưởng doanh thu ngày')).toBeTruthy()
    expect(screen.getByTestId('revenue-bonus-route').dataset.storeScoped).toBe('true')
  })

  it.each(['admin', 'business_support', 'store_manager'])('allows %s to read the current-store violation refunds', async (role) => {
    renderRoute('/store/violation-refunds', role)

    expect(await screen.findByText('Hoàn trả vi phạm route')).toBeTruthy()
    expect(screen.getByTestId('current-route').textContent).toBe('/store/violation-refunds')
  })

  it('keeps store violation refunds unavailable to employees', async () => {
    renderRoute('/store/violation-refunds', 'employee')

    expect(screen.queryByText('Hoàn trả vi phạm route')).toBeNull()
  })

  it('keeps the Admin daily-revenue route globally selectable', async () => {
    renderRoute('/admin/compensation/revenue', 'admin')

    expect(await screen.findByText('Thưởng doanh thu ngày')).toBeTruthy()
    expect(screen.getByTestId('revenue-bonus-route').dataset.storeScoped).toBe('false')
  })

  it('locks the employee daily-revenue route to their active store', async () => {
    renderRoute('/employee/revenue-bonus', 'employee')

    expect(await screen.findByText('Thưởng doanh thu ngày')).toBeTruthy()
    expect(screen.getByTestId('revenue-bonus-route').dataset.storeScoped).toBe('true')
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
