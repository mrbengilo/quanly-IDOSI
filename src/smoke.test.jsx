import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { AppProvider, createInitialState, STORAGE_KEY } from './state/AppContext'
import App from './App'
import {
  AdminSettings,
  AdminStores,
} from './pages/admin/AdminPages'
import { BusinessSupportManagement, StoreManagerManagement } from './pages/admin/RoleManagement'
import { AdminSupportWorkPage, SupportAssignedWorkPage } from './pages/admin/SupportWorkPages'
import { AdminCashflowV2, AdminOverviewV2, AdminReportsV2 } from './pages/admin/SystemFinanceV2'
import { OrderAuditPage, PolicySettings, ResetDataPage, SupportTransfersPage, SystemEmployees } from './pages/admin/GovernancePages'
import { OfficeManagement } from './pages/office/OfficeManagement'
import { StoreEmployees, StoreTasks } from './pages/store/StoreOperations'
import { StoreSettings } from './pages/store/StoreFinance'
import { StoreAttendanceV2, StoreCashflowV2, StoreImportsV2, StoreOrdersPage, StoreOverviewV2, StorePayrollV2, StoreReportsV2 } from './pages/store/StoreV2Pages'
import UnifiedSchedule from './pages/store/UnifiedSchedule'
import {
  EmployeeCashflow,
  EmployeeShiftHistory,
} from './pages/employee/EmployeePages'
import { EmployeeAttendancePage, EmployeeDashboardV2, EmployeeOrdersPage, EmployeePayrollDetails } from './pages/employee/EmployeeV2Pages'
import { OfficeEmployeeDashboard, OfficeEmployeePayrollPage } from './pages/employee/OfficeEmployeeDashboard'
import {
  calculateEmployeeBasePay,
  getHourlyRate,
  getMonthlySalary,
  validateCccd,
  validateVietnamPhone,
} from './utils'
import { DEMO_PASSWORD_HASH } from './security/passwords'

beforeAll(() => {
  configure({ asyncUtilTimeout: 5_000 })
  globalThis.scrollTo = () => {}
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const pages = {
  AdminOverviewV2,
  AdminStores,
  AdminCashflowV2,
  AdminReportsV2,
  AdminSettings,
  BusinessSupportManagement,
  StoreManagerManagement,
  AdminSupportWorkPage,
  SupportAssignedWorkPage,
  SystemEmployees,
  PolicySettings,
  ResetDataPage,
  OrderAuditPage,
  SupportTransfersPage,
  OfficeManagement,
  StoreOverviewV2,
  UnifiedSchedule,
  StoreEmployees,
  StoreTasks,
  StoreOrdersPage,
  StoreImportsV2,
  StoreAttendanceV2,
  StorePayrollV2,
  StoreCashflowV2,
  StoreReportsV2,
  StoreSettings,
  EmployeeDashboardV2,
  EmployeeOrdersPage,
  EmployeeAttendancePage,
  EmployeePayrollDetails,
  OfficeEmployeeDashboard,
  OfficeEmployeePayrollPage,
  EmployeeCashflow,
  EmployeeShiftHistory,
}

function DirectRouteProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <aside aria-label="Kiểm tra điều hướng" hidden>
    <output data-testid="current-route">{location.pathname}</output>
    <button type="button" onClick={() => navigate('/admin/overview')}>Mở trực tiếp trang hệ thống</button>
    <button type="button" onClick={() => navigate('/admin/policies')}>Mở trực tiếp chính sách</button>
    <button type="button" onClick={() => navigate('/admin/reset')}>Mở trực tiếp reset dữ liệu</button>
    <button type="button" onClick={() => navigate('/support/attendance')}>Mở trực tiếp chấm công hỗ trợ</button>
    <button type="button" onClick={() => navigate('/store/orders')}>Mở trực tiếp đơn hàng cửa hàng</button>
  </aside>
}

const renderAppWithRouteProbe = () => render(
  <MemoryRouter initialEntries={['/login']}>
    <AppProvider>
      <App />
      <DirectRouteProbe />
    </AppProvider>
  </MemoryRouter>,
)

const loginAs = async (username, password = 'idosi123') => {
  const usernameInput = await screen.findByPlaceholderText('Nhập tên đăng nhập')
  fireEvent.change(usernameInput, { target: { value: username } })
  fireEvent.change(screen.getByPlaceholderText('Nhập mật khẩu'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: /^Đăng nhập$/i }))
}

const seedBusinessSupportAccount = () => {
  const storedState = createInitialState()
  const template = storedState.employees.find((employee) => employee.unit === 'office') || storedState.employees[0]
  storedState.employees.push({
    ...template,
    id: 'HTKD001',
    code: 'HTKD001',
    employeeCode: 'HTKD001',
    name: 'Nhân viên hỗ trợ KD',
    username: 'manager',
    passwordHash: DEMO_PASSWORD_HASH,
    role: 'Nhân viên hỗ trợ KD',
    position: 'Nhân viên hỗ trợ kinh doanh',
    unit: 'business_support',
    unitType: 'business_support',
    department: 'business_support',
    roleType: 'business_support',
    accountRole: 'business_support',
    storeId: 'BUSINESS_SUPPORT',
  })
  storedState.orders.unshift({
    id: 'ORDER-SUPPORT-SMOKE',
    code: 'DH-SMOKE-001',
    storeId: 'CH001',
    employeeId: 'NV001',
    employeeName: 'Nguyễn Minh Anh',
    customerName: 'Khách kiểm thử',
    customerPhone: '0900000000',
    customerAge: 28,
    amount: 250000,
    paymentMethod: 'Chuyển khoản',
    status: 'Đã ghi nhận',
    source: 'employee-order',
    createdAt: '2026-08-18T09:00:00+07:00',
    updatedAt: '2026-08-18T09:00:00+07:00',
  })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState))
}

const seedEmployeeAccount = (employeeId, username) => {
  const storedState = createInitialState()
  const employee = storedState.employees.find((item) => item.id === employeeId)
  if (employee) {
    employee.username = username
    employee.passwordHash = DEMO_PASSWORD_HASH
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState))
}

describe('IDOSI page smoke tests', () => {
  it('starts with only the Admin login credential', () => {
    const initialState = createInitialState()
    expect(initialState.adminAccounts).toHaveLength(1)
    expect(initialState.managerAccounts).toHaveLength(0)
    expect(initialState.employees.every((employee) => !employee.passwordHash)).toBe(true)
  })

  Object.entries(pages).forEach(([name, Page]) => {
    it(`renders ${name} without crashing`, () => {
      expect(Page, `${name} must be exported`).toBeTruthy()
      const view = render(
        <MemoryRouter>
          <AppProvider>
            <Page />
          </AppProvider>
        </MemoryRouter>,
      )
      expect(view.container.querySelector('.page')).toBeTruthy()
    })
  })

  it('logs in with the Admin account without legacy manager-payroll features', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    await loginAs('admin')
    expect(await screen.findByRole('heading', { name: 'TỔNG QUAN HỆ THỐNG' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Cài đặt chính sách/i }).getAttribute('href')).toBe('/admin/policies')
    expect(screen.getByRole('link', { name: /Khảo sát thông tin KH/i }).getAttribute('href')).toBe('/admin/customer-survey')
    expect(screen.getByRole('link', { name: /Reset dữ liệu/i }).getAttribute('href')).toBe('/admin/reset')
    expect(screen.queryByRole('link', { name: /Tài khoản quản lý/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Lương thưởng quản lý/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Chia lợi nhuận/i })).toBeNull()
  }, 10_000)

  it('allows an Admin-created business-support account to use its scoped workspace', async () => {
    seedBusinessSupportAccount()
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    await loginAs('manager')
    expect(await screen.findByRole('heading', { name: 'TỔNG QUAN NHÂN VIÊN HỖ TRỢ KD' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Tổng quan$/i }).getAttribute('href')).toBe('/support/overview')
    expect(screen.getByRole('link', { name: /^Danh sách cửa hàng$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Danh sách nhân viên cửa hàng/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Nhân viên hỗ trợ KD$/i }).getAttribute('href')).toBe('/admin/business-support')
    expect(screen.getAllByText('Hỗ trợ KD').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link').find((link) => link.getAttribute('href') === '/office')).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Nhân viên quản lý cửa hàng$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Điều chuyển nhân sự$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Công việc tính thưởng$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Công việc tính thưởng & Vi phạm HTKD/i }).getAttribute('href')).toBe('/admin/tasks')
    expect(screen.getByRole('link', { name: /Cài đặt chính sách/i }).getAttribute('href')).toBe('/admin/policies')
    expect(screen.getByRole('link', { name: /Khảo sát thông tin KH/i }).getAttribute('href')).toBe('/admin/customer-survey')
    expect(screen.queryByRole('link', { name: /Reset dữ liệu/i })).toBeNull()
    expect(screen.getByRole('link', { name: /Lịch sử chỉnh sửa đơn hàng/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /^Danh sách cửa hàng$/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /Danh sách cửa hàng/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Mở cửa hàng SecondMall SM234$/i }))
    fireEvent.click(await screen.findByRole('link', { name: /^Đơn hàng$/i }))
    expect(await screen.findByRole('heading', { name: 'ĐƠN HÀNG' })).toBeTruthy()
    expect(screen.queryByText(/Chế độ chỉ xem/i)).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Sửa$/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /^Xóa$/i }).length).toBeGreaterThan(0)
  })

  it('guards direct system routes while allowing business support to self-attend', async () => {
    seedBusinessSupportAccount()
    renderAppWithRouteProbe()
    await loginAs('manager')
    expect(await screen.findByRole('heading', { name: 'TỔNG QUAN NHÂN VIÊN HỖ TRỢ KD' })).toBeTruthy()

    fireEvent.click(screen.getByText('Mở trực tiếp chính sách'))
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/admin/policies'))
    expect(await screen.findByRole('heading', { name: 'CÀI ĐẶT CHÍNH SÁCH' })).toBeTruthy()

    fireEvent.click(screen.getByText('Mở trực tiếp reset dữ liệu'))
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/support/overview'))
    expect(screen.queryByRole('heading', { name: 'RESET DỮ LIỆU' })).toBeNull()

    fireEvent.click(screen.getByText('Mở trực tiếp chấm công hỗ trợ'))
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/support/overview'))
    expect(await screen.findByRole('heading', { name: 'TỔNG QUAN NHÂN VIÊN HỖ TRỢ KD' })).toBeTruthy()
  })

  it('keeps a store manager on the assigned store and rejects direct system routes', async () => {
    const storedState = createInitialState()
    const template = storedState.employees.find((employee) => employee.storeId === 'CH002')
    storedState.employees.push({
      ...template,
      id: 'QL-TNV-001',
      code: 'QL-TNV-001',
      employeeCode: 'QL-TNV-001',
      name: 'Quản lý Tô Ngọc Vân',
      username: 'store.manager',
      passwordHash: DEMO_PASSWORD_HASH,
      role: 'Quản lý cửa hàng',
      position: 'Quản lý cửa hàng',
      unit: 'store_manager',
      unitType: 'store_manager',
      department: 'store_manager',
      roleType: 'store_manager',
      accountRole: 'store_manager',
      storeId: 'CH002',
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState))

    renderAppWithRouteProbe()
    await loginAs('store.manager')
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/store/overview'))
    expect(await screen.findByRole('heading', { name: 'Idosi Tô Ngọc Vân' })).toBeTruthy()
    expect(screen.getByText('Không gian vận hành dành cho Admin và quản lý cửa hàng.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^BẤM ĐIỂM DANH$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^RA VỀ$/i })).toBeNull()
    expect(screen.getByRole('link', { name: /^Nhân viên cửa hàng$/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Quay về trang quản lý chính/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Mở trang tài khoản' }))
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/account/settings'))
    expect(await screen.findByRole('link', { name: /^Nhân viên cửa hàng$/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /^Tổng quan$/i }))
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/store/overview'))
    expect(await screen.findByRole('heading', { name: 'Idosi Tô Ngọc Vân' })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /^Nhân viên cửa hàng$/i }))
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/store/employees'))
    expect(await screen.findByRole('heading', { name: 'Quản lý nhân viên' })).toBeTruthy()
    expect(screen.queryByText('QL-TNV-001')).toBeNull()

    fireEvent.click(screen.getByText('Mở trực tiếp trang hệ thống'))
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/store/overview'))
    expect(await screen.findByRole('heading', { name: 'Idosi Tô Ngọc Vân' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Danh sách cửa hàng$/i })).toBeNull()

    fireEvent.click(screen.getByText('Mở trực tiếp đơn hàng cửa hàng'))
    await waitFor(() => expect(screen.getByTestId('current-route').textContent).toBe('/store/orders'))
    expect(await screen.findByRole('heading', { name: 'ĐƠN HÀNG' })).toBeTruthy()
  })

  it('lets admin enter one store workspace and return to the system overview', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    await loginAs('admin')
    expect(await screen.findByRole('link', { name: /^Danh sách cửa hàng$/i })).toBeTruthy()
    const storeButtons = await screen.findAllByRole('button', { name: /Mở cửa hàng/i })
    expect(storeButtons).toHaveLength(9)
    fireEvent.click(storeButtons[0])
    const returnToSystem = await screen.findByRole('button', { name: /Quay về trang quản lý chính/i })
    expect(await screen.findByRole('heading', { name: 'SecondMall SM234' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Danh sách cửa hàng$/i })).toBeNull()
    fireEvent.click(returnToSystem)
    expect(await screen.findByRole('heading', { name: 'TỔNG QUAN HỆ THỐNG' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /^Danh sách cửa hàng$/i }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Danh sách cửa hàng' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Thêm cửa hàng' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Xóa Idosi/i }).length).toBeGreaterThan(0)
  })

  it('keeps an employee inside the employee portal of their assigned store', async () => {
    seedEmployeeAccount('NV001', 'employee')
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    await loginAs('employee')
    expect(await screen.findByRole('heading', { name: /XIN CHÀO, NGUYỄN MINH ANH/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Lịch sử làm việc/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Danh sách cửa hàng$/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Nhân viên cửa hàng/i })).toBeNull()
  })

  it('routes an Office employee to the dedicated attendance and payroll workspace', async () => {
    seedEmployeeAccount('VP001', 'office')
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    await loginAs('office')
    expect(await screen.findByRole('heading', { name: 'NHÂN VIÊN VĂN PHÒNG' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Đơn hàng$/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Dòng tiền$/i })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: /^Chấm công$/i }))
    expect(await screen.findByRole('heading', { name: 'NHÂN VIÊN VĂN PHÒNG' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /^Bảng lương$/i }))
    expect(await screen.findByRole('heading', { name: 'BẢNG LƯƠNG VĂN PHÒNG CỦA TÔI' })).toBeTruthy()
  })
})

describe('IDOSI business rules', () => {
  it('validates Vietnamese identity and phone formats', () => {
    expect(validateCccd('079203001234')).toBe(true)
    expect(validateCccd('07920300123')).toBe(false)
    expect(validateVietnamPhone('0901234567')).toBe(true)
    expect(validateVietnamPhone('12345')).toBe(false)
  })

  it('uses monthly salary for full-time employees', () => {
    const employee = { employmentType: 'Full-time', monthlySalary: 12000000 }
    expect(getMonthlySalary(employee)).toBe(12000000)
    expect(getHourlyRate(employee)).toBe(0)
    expect(calculateEmployeeBasePay(employee, { hours: 160 })).toBe(12000000)
  })

  it('uses worked hours for part-time employees', () => {
    const employee = { employmentType: 'Part-time', hourlyRate: 42000 }
    expect(getHourlyRate(employee)).toBe(42000)
    expect(getMonthlySalary(employee)).toBe(0)
    expect(calculateEmployeeBasePay(employee, { hours: 80 })).toBe(3360000)
  })
})
