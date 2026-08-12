import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppProvider } from './state/AppContext'
import App from './App'
import {
  AdminCashflow,
  AdminOverview,
  AdminReports,
  AdminSettings,
  AdminStores,
  AdminTasks,
  ManagerPayroll,
} from './pages/admin/AdminPages'
import { ManagerAccounts } from './pages/admin/ManagerAccounts'
import { OfficeManagement } from './pages/office/OfficeManagement'
import {
  StoreEmployees,
  StoreImports,
  StoreOverview,
  StoreSchedule,
  StoreShifts,
} from './pages/store/StoreOperations'
import {
  StoreAttendance,
  StoreCashflow,
  StorePayroll,
  StoreReports,
  StoreSettings,
} from './pages/store/StoreFinance'
import {
  EmployeeCashflow,
  EmployeeHome,
  EmployeePayroll,
  EmployeeShiftHistory,
} from './pages/employee/EmployeePages'
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
  AdminOverview,
  AdminStores,
  AdminTasks,
  AdminCashflow,
  ManagerPayroll,
  AdminReports,
  AdminSettings,
  ManagerAccounts,
  OfficeManagement,
  StoreOverview,
  StoreShifts,
  StoreSchedule,
  StoreEmployees,
  StoreImports,
  StoreAttendance,
  StorePayroll,
  StoreCashflow,
  StoreReports,
  StoreSettings,
  EmployeeHome,
  EmployeePayroll,
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

  it('logs in with the administrator demo and opens the admin dashboard', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Quản trị admin/i }))
    expect(screen.getByRole('heading', { name: 'Quản lý cửa hàng' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Tài khoản quản lý/i })).toBeTruthy()
  })

  it('lets a global manager enter one store workspace and return to the system overview', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Quản lý manager/i }))
    expect(screen.getByRole('link', { name: /Danh sách cửa hàng/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Tài khoản quản lý/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Khối văn phòng/i })).toBeNull()
    expect(screen.queryByRole('combobox', { name: /cửa hàng/i })).toBeNull()
    const storeButtons = screen.getAllByRole('button', { name: /Xem cửa hàng/i })
    expect(storeButtons).toHaveLength(9)
    fireEvent.click(storeButtons[0])
    expect(screen.getByRole('heading', { name: 'Tổng quan cửa hàng' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Quay về trang quản lý chính/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Danh sách cửa hàng/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Quay về trang quản lý chính/i }))
    expect(screen.getByRole('heading', { name: 'Quản lý cửa hàng' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /Danh sách cửa hàng/i }))
    expect(screen.getByRole('heading', { name: 'Quản lý cửa hàng' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Thêm cửa hàng' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Xóa Idosi/i })).toBeNull()
  })

  it('keeps a store employee inside the employee portal of their assigned store', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Cửa hàng employee/i }))
    expect(screen.getByRole('heading', { name: 'SecondMall SM234' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Lịch sử ca làm/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Danh sách cửa hàng/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Nhân viên cửa hàng/i })).toBeNull()
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
