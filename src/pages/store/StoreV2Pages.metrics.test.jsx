import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmployeePayrollDetails } from '../employee/EmployeeV2Pages'
import { today } from '../../utils'
import { StoreAttendanceV2, StoreOrdersPage, StorePayrollV2 } from './StoreV2Pages'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

const store = { id: 'S01', name: 'Dosii KVC' }
const employee = {
  id: 'S01-001',
  name: 'Nguyễn An',
  unit: 'store',
  storeId: store.id,
  status: 'Đang làm việc',
  employmentType: 'Part-Time',
  payBasis: 'hourly',
  hourlyRate: 20_000,
  tiktokAllowance: 0,
}

const policies = {
  version: 1,
  effectiveFrom: today(),
  employeeKpiRates: { from30000: 0, from15000: 0, from7000: 0 },
  attendanceEvaluation: { improveMinLateCount: 3, improveMinLateMinutes: 30 },
}

const baseApp = (role = 'admin') => ({
  session: role === 'store_manager'
    ? { role, storeId: store.id }
    : { role },
  stores: [store, { id: 'S02', name: 'Dosii TNV' }],
  activeStoreId: store.id,
  activeStore: store,
  employees: [employee],
  attendance: [],
  orders: [],
  fixedExpenses: [],
  salaryAdjustments: [],
  salaryAdvances: [],
  payrollPeriods: [],
  policies,
  updateOrder: vi.fn(),
  deleteOrder: vi.fn(),
  notify: vi.fn(),
  getAvailableSalary: vi.fn(() => 0),
})

const renderPage = (Page, route = '/') => render(<MemoryRouter initialEntries={[route]}><Page /></MemoryRouter>)

afterEach(cleanup)

describe('store order, attendance, and payroll summaries', () => {
  it('summarizes the current store and active filters by payment method', () => {
    mocked.app = {
      ...baseApp(),
      orders: [
        { id: 'O-CASH', code: 'O-CASH', storeId: store.id, employeeId: employee.id, employeeName: employee.name, customerName: 'Khách tiền mặt', amount: 130_000, paymentMethod: 'Tiền mặt', createdAt: `${today()}T08:00:00+07:00` },
        { id: 'O-BANK', code: 'O-BANK', storeId: store.id, employeeId: employee.id, employeeName: employee.name, customerName: 'Khách chuyển khoản', amount: 270_000, paymentMethod: 'Chuyển khoản', createdAt: `${today()}T09:00:00+07:00` },
        { id: 'O-OTHER-STORE', code: 'O-OTHER-STORE', storeId: 'S02', amount: 900_000, paymentMethod: 'Tiền mặt', createdAt: `${today()}T09:00:00+07:00` },
      ],
    }

    renderPage(StoreOrdersPage, '/store/orders')

    const metrics = screen.getByLabelText('Tổng quan đơn hàng')
    expect(within(metrics).getByText('2')).toBeTruthy()
    expect(within(metrics).getByText('270,000 đ')).toBeTruthy()
    expect(within(metrics).getByText('130,000 đ')).toBeTruthy()
    expect(within(metrics).getByText('400,000 đ')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Tìm mã đơn, khách hàng...'), { target: { value: 'O-BANK' } })

    expect(within(metrics).getByText('1')).toBeTruthy()
    expect(within(metrics).getAllByText('270,000 đ')).toHaveLength(2)
    expect(within(metrics).getByText('0 đ')).toBeTruthy()
  })

  it.each(['admin', 'business_support', 'store_manager'])('lets %s open a safe attendance map link and shows early/late minute totals', (role) => {
    mocked.app = {
      ...baseApp(role),
      attendance: [
        { id: 'A-EARLY', storeId: store.id, employeeId: employee.id, employeeName: employee.name, date: today(), shift: 'CA-01', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', checkIn: '07:45', checkOut: '12:00', hours: 4, status: 'Đi sớm', minutesEarly: 15, minutesLate: 0, location: { latitude: 10.857789, longitude: 106.749938, label: 'Cửa hàng Dosii KVC' } },
        { id: 'A-LATE', storeId: store.id, employeeId: employee.id, employeeName: employee.name, date: today(), shift: 'CA-02', shiftName: 'Ca chiều', shiftStart: '13:00', shiftEnd: '17:00', checkIn: '13:07', checkOut: '17:00', hours: 4, status: 'Đi trễ', minutesEarly: 0, minutesLate: 7, location: { latitude: 10.85779, longitude: 106.74994 } },
      ],
    }

    renderPage(StoreAttendanceV2)

    const links = screen.getAllByRole('link', { name: new RegExp(`Xem vị trí điểm danh của ${employee.name}`, 'i') })
    expect(links).toHaveLength(2)
    expect(links[0].href).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/)
    expect(links[0].target).toBe('_blank')
    expect(links[0].rel).toContain('noreferrer')
    expect(screen.getByRole('columnheader', { name: 'Tổng phút sớm' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Tổng phút trễ' })).toBeTruthy()
    expect(screen.getByText((_, node) => node?.classList.contains('attendance-minutes') && node.textContent === '15 sớm / 0 trễ')).toBeTruthy()
  })

  it('shows the configured hourly rate while keeping earned pay in store payroll totals', () => {
    mocked.app = {
      ...baseApp(),
      attendance: [{ id: 'A-01', storeId: store.id, employeeId: employee.id, date: today(), hours: 4, status: 'Đi đúng giờ' }],
    }

    renderPage(StorePayrollV2)

    expect(screen.getByText('20,000 đ/giờ')).toBeTruthy()
    expect(screen.getAllByText('80,000 đ').length).toBeGreaterThan(0)
  })

  it('shows the configured hourly rate in employee income details and both punctuality minute totals', () => {
    mocked.app = {
      currentEmployee: employee,
      attendance: [
        { id: 'A-01', storeId: store.id, employeeId: employee.id, date: today(), hours: 4, status: 'Đi sớm', minutesEarly: 12, minutesLate: 0 },
        { id: 'A-02', storeId: store.id, employeeId: employee.id, date: today(), hours: 1, status: 'Đi trễ', minutesEarly: 0, minutesLate: 8 },
      ],
      salaryAdjustments: [],
      salaryAdvances: [],
      payrollPeriods: [],
    }

    renderPage(EmployeePayrollDetails, '/employee/payroll')

    expect(screen.getByText('20,000 đ/giờ')).toBeTruthy()
    expect(screen.getAllByText('100,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByRole('columnheader', { name: 'Tổng phút sớm' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Tổng phút trễ' })).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
  })
})
