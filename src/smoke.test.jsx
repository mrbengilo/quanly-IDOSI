import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppProvider } from './state/AppContext'
import App from './App'
import {
  AdminSettings,
  AdminStores,
} from './pages/admin/AdminPages'
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

beforeAll(() => {
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

describe('IDOSI page smoke tests', () => {
  Object.entries(pages).forEach(([name, Page]) => {
    it(`renders ${name} without crashing`, () => {
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
    fireEvent.change(screen.getByPlaceholderText('Nhập tên đăng nhập'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByPlaceholderText('Nhập mật khẩu'), { target: { value: 'idosi123' } })
    fireEvent.click(screen.getByRole('button', { name: /^Đăng nhập$/i }))
    expect(await screen.findByRole('heading', { name: 'TỔNG QUAN HỆ THỐNG' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Tài khoản quản lý/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Lương thưởng quản lý/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Chia lợi nhuận/i })).toBeNull()
  })

  it('gives the manager an Admin-style workspace with restricted menus and read-only orders', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Nhập tên đăng nhập'), { target: { value: 'manager' } })
    fireEvent.change(screen.getByPlaceholderText('Nhập mật khẩu'), { target: { value: 'idosi123' } })
    fireEvent.click(screen.getByRole('button', { name: /^Đăng nhập$/i }))
    expect(await screen.findByRole('heading', { name: 'TỔNG QUAN HỆ THỐNG' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^Cửa hàng$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Quản lý nhân viên/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Khối văn phòng/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Cài đặt chính sách/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Reset dữ liệu/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Lịch sử sửa\/xóa đơn hàng/i })).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: /Mở cửa hàng/i })[0])
    fireEvent.click(screen.getByRole('link', { name: /^Đơn hàng$/i }))
    expect(screen.getByRole('heading', { name: 'ĐƠN HÀNG' })).toBeTruthy()
    expect(screen.getByText(/Chế độ chỉ xem/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Sửa$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Xóa$/i })).toBeNull()
  })

  it('lets admin enter one store workspace and return to the system overview', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Nhập tên đăng nhập'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByPlaceholderText('Nhập mật khẩu'), { target: { value: 'idosi123' } })
    fireEvent.click(screen.getByRole('button', { name: /^Đăng nhập$/i }))
    expect(await screen.findByRole('link', { name: /^Cửa hàng$/i })).toBeTruthy()
    const storeButtons = screen.getAllByRole('button', { name: /Mở cửa hàng/i })
    expect(storeButtons).toHaveLength(9)
    fireEvent.click(storeButtons[0])
    expect(screen.getByRole('heading', { name: 'SecondMall SM234' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Quay về trang quản lý chính/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Cửa hàng$/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Quay về trang quản lý chính/i }))
    expect(screen.getByRole('heading', { name: 'TỔNG QUAN HỆ THỐNG' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /^Cửa hàng$/i }))
    expect(screen.getByRole('heading', { name: 'Quản lý cửa hàng' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Thêm cửa hàng' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Xóa Idosi/i }).length).toBeGreaterThan(0)
  })

  it('keeps an employee inside the employee portal of their assigned store', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Nhập tên đăng nhập'), { target: { value: 'employee' } })
    fireEvent.change(screen.getByPlaceholderText('Nhập mật khẩu'), { target: { value: 'idosi123' } })
    fireEvent.click(screen.getByRole('button', { name: /^Đăng nhập$/i }))
    expect(await screen.findByRole('heading', { name: /XIN CHÀO, NGUYỄN MINH ANH/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Lịch sử làm việc/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Cửa hàng$/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Nhân viên cửa hàng/i })).toBeNull()
  })

  it('routes an Office employee to the dedicated attendance and payroll workspace', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByPlaceholderText('Nhập tên đăng nhập'), { target: { value: 'office' } })
    fireEvent.change(screen.getByPlaceholderText('Nhập mật khẩu'), { target: { value: 'idosi123' } })
    fireEvent.click(screen.getByRole('button', { name: /^Đăng nhập$/i }))
    expect(await screen.findByRole('heading', { name: 'NHÂN VIÊN VĂN PHÒNG' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Đơn hàng$/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Dòng tiền$/i })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: /^Chấm công$/i }))
    expect(screen.getByRole('heading', { name: 'NHÂN VIÊN VĂN PHÒNG' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /^Bảng lương$/i }))
    expect(screen.getByRole('heading', { name: 'BẢNG LƯƠNG VĂN PHÒNG CỦA TÔI' })).toBeTruthy()
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
