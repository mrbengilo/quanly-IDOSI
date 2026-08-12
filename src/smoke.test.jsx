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

beforeAll(() => {
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
  })
})
