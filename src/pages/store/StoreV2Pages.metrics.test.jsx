import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmployeePayrollDetails } from '../employee/EmployeeV2Pages'
import { today } from '../../utils'
import { StoreAttendanceV2, StoreOrdersPage, StorePayrollV2, StoreReportsV2 } from './StoreV2Pages'

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

  it('shows daily and monthly store reports with shift revenue, expense detail and growth', () => {
    mocked.app = {
      ...baseApp(),
      orders: [
        { id: 'O-REPORT-1', storeId: store.id, amount: 500_000, shiftName: 'Ca sáng', createdAt: `${today()}T08:00:00+07:00` },
        { id: 'O-REPORT-2', storeId: store.id, amount: 300_000, shiftName: 'Ca chiều', createdAt: `${today()}T14:00:00+07:00` },
      ],
      expenseEntries: [{ id: 'EXP-REPORT', storeId: store.id, amount: 200_000, type: 'Mặt bằng', direction: 'out', occurredAt: `${today()}T15:00:00+07:00`, recognized: true }],
    }

    renderPage(StoreReportsV2)

    expect(screen.getByRole('columnheader', { name: 'Doanh thu cụ thể mỗi ca' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Chi phí gì' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'So sánh kỳ trước' })).toBeTruthy()
    expect(screen.getByText(/Ca sáng:/)).toBeTruthy()
    expect(screen.getByText(/Ca chiều:/)).toBeTruthy()
    expect(screen.getByText(/Mặt bằng:/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Theo tháng' }))
    expect(screen.getByRole('columnheader', { name: 'Tháng' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Đánh giá tăng trưởng' })).toBeTruthy()
  })

  it.each(['admin', 'business_support', 'store_manager'])('lets %s open a safe attendance map link and shows early/late minute totals', (role) => {
    const onTimeEmployee = { ...employee, id: 'S01-002', name: 'Trần Bình' }
    mocked.app = {
      ...baseApp(role),
      employees: [employee, onTimeEmployee],
      attendance: [
        { id: 'A-EARLY', storeId: store.id, employeeId: employee.id, employeeName: employee.name, date: today(), shift: 'CA-01', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', checkIn: '07:45', checkOut: '12:00', hours: 4, status: 'Đi sớm', minutesEarly: 15, minutesLate: 0, location: { latitude: 10.857789, longitude: 106.749938, label: 'Cửa hàng Dosii KVC' } },
        { id: 'A-LATE', storeId: store.id, employeeId: employee.id, employeeName: employee.name, date: today(), shift: 'CA-02', shiftName: 'Ca chiều', shiftStart: '13:00', shiftEnd: '17:00', checkIn: '13:07', hours: 4, status: 'Đi trễ', minutesEarly: 0, minutesLate: 7, location: { latitude: 10.85779, longitude: 106.74994 } },
        { id: 'A-ON-TIME', storeId: store.id, employeeId: onTimeEmployee.id, employeeName: onTimeEmployee.name, date: today(), shift: 'CA-03', shiftName: 'Ca tối', shiftStart: '17:00', shiftEnd: '21:00', checkIn: '17:00', checkOut: '21:00', hours: 4, status: 'Đi đúng giờ', minutesEarly: 0, minutesLate: 0 },
      ],
    }

    renderPage(StoreAttendanceV2)

    const links = screen.getAllByRole('link', { name: new RegExp(`Xem vị trí điểm danh của ${employee.name}`, 'i') })
    expect(links).toHaveLength(2)
    expect(links[0].href).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/)
    expect(links[0].target).toBe('_blank')
    expect(links[0].rel).toContain('noreferrer')
    links.forEach((link) => expect(link.textContent).toBe('Xem vị trí'))
    expect(screen.queryByText(/10\.857789|106\.749938|10\.85779|106\.74994/)).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Tổng phút sớm' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Tổng phút trễ' })).toBeTruthy()
    const earlyMinutes = screen.getByText((_, node) => node?.classList.contains('attendance-minutes') && node.textContent === 'Sớm 15 phút')
    const lateMinutes = screen.getByText((_, node) => node?.classList.contains('attendance-minutes') && node.textContent === 'Trễ 7 phút')
    const onTimeMinutes = screen.getByText((_, node) => node?.classList.contains('attendance-minutes') && node.textContent === 'Đúng giờ')
    expect(earlyMinutes.classList.contains('attendance-minutes--early')).toBe(true)
    expect(lateMinutes.classList.contains('attendance-minutes--late')).toBe(true)
    expect(onTimeMinutes.classList.contains('attendance-minutes--on-time')).toBe(true)
    expect(screen.queryByText(/\d+ sớm \/ \d+ trễ/)).toBeNull()

    const closedRow = earlyMinutes.closest('tr')
    expect(within(closedRow).getByText('07:45')).toBeTruthy()
    expect(within(closedRow).getByText('12:00')).toBeTruthy()
    expect(within(closedRow).getByText('Đã kết ca')).toBeTruthy()
    const openRow = lateMinutes.closest('tr')
    expect(within(openRow).getByText('13:07')).toBeTruthy()
    expect(within(openRow).getByText('Đang làm')).toBeTruthy()

    const statsTable = screen.getByRole('columnheader', { name: 'Tổng phút sớm' }).closest('table')
    const employeeStatsRow = within(statsTable).getByText(employee.name).closest('tr')
    const employeeStatsCells = within(employeeStatsRow).getAllByRole('cell')
    expect(employeeStatsCells[2].classList.contains('red-text')).toBe(true)
    expect(employeeStatsCells[3].classList.contains('blue-text')).toBe(true)
    expect(employeeStatsCells[4].classList.contains('green-text')).toBe(true)
    expect(employeeStatsCells[5].classList.contains('green-text')).toBe(true)
    expect(employeeStatsCells[6].classList.contains('red-text')).toBe(true)
    expect(employeeStatsCells[8].classList.contains('blue-text')).toBe(true)
    const onTimeStatsRow = within(statsTable).getByText(onTimeEmployee.name).closest('tr')
    const onTimeStatsCells = within(onTimeStatsRow).getAllByRole('cell')
    expect(onTimeStatsCells[2].textContent).toBe('0')
    expect(onTimeStatsCells[2].classList.contains('red-text')).toBe(true)
    expect(onTimeStatsCells[4].textContent).toBe('0')
    expect(onTimeStatsCells[4].classList.contains('green-text')).toBe(true)
    expect(onTimeStatsCells[5].textContent).toBe('0')
    expect(onTimeStatsCells[5].classList.contains('green-text')).toBe(true)
    expect(onTimeStatsCells[6].textContent).toBe('0')
    expect(onTimeStatsCells[6].classList.contains('red-text')).toBe(true)
  })

  it('includes inbound support attendance and applies the canonical home/support pay rules', () => {
    const fullTimeEmployee = { ...employee, id: 'S01-FT', name: 'Nhân viên Full-Time', employmentType: 'Full-Time', payBasis: 'monthly', monthlySalary: 8_000_000 }
    const supportEmployee = { ...employee, id: 'S02-PT', name: 'Nhân viên hỗ trợ', storeId: 'S02', hourlyRate: 35_000 }
    mocked.app = {
      ...baseApp(),
      employees: [employee, fullTimeEmployee, supportEmployee],
      supportTransfers: [{ id: 'TR-01', employeeId: supportEmployee.id, fromStoreId: 'S02', toStoreId: store.id, hourlySupportRate: 45_000, allowance: 50_000 }],
      expenseEntries: [{ id: 'EXP-SUPPORT', storeId: store.id, sourceType: 'support-attendance-compensation', sourceId: 'A-SUPPORT', category: 'payroll-support', amount: 140_000, occurredAt: `${today()}T12:00:00+07:00`, recognized: true }],
      attendance: [
        { id: 'A-PT', storeId: store.id, employeeId: employee.id, employeeName: employee.name, date: today(), shift: 'CA-01', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', checkIn: '08:00', checkOut: '12:00', hours: 4, status: 'Đi đúng giờ' },
        { id: 'A-FT', storeId: store.id, employeeId: fullTimeEmployee.id, employeeName: fullTimeEmployee.name, date: today(), shift: 'CA-01', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', checkIn: '08:00', checkOut: '12:00', hours: 4, status: 'Đi đúng giờ' },
        { id: 'A-SUPPORT', storeId: store.id, employeeId: supportEmployee.id, employeeName: supportEmployee.name, date: today(), shift: 'SUPPORT', shiftName: 'Ca hỗ trợ', shiftStart: '13:00', shiftEnd: '15:00', checkIn: '13:00', checkOut: '15:00', hours: 2, status: 'Đi đúng giờ', supportTransferId: 'TR-01', supportCompensation: { transferId: 'TR-01', homeStoreId: 'S02', supportStoreId: store.id, transferStartAt: `${today()}T13:00:00+07:00`, transferEndAt: `${today()}T15:00:00+07:00`, hourlyRate: 45_000, hours: 2, basePay: 90_000, allowance: 50_000, allowanceApplied: true, totalPay: 140_000, expenseEntryId: 'EXP-SUPPORT' } },
      ],
    }

    renderPage(StoreAttendanceV2)

    const attendanceTable = screen.getByRole('columnheader', { name: 'Nhân viên / Cửa hàng' }).closest('table')
    const partTimeRow = within(attendanceTable).getByText(employee.name).closest('tr')
    const fullTimeRow = within(attendanceTable).getByText(fullTimeEmployee.name).closest('tr')
    const supportRow = within(attendanceTable).getByText(supportEmployee.name).closest('tr')
    expect(within(partTimeRow).getByText('80,000 đ')).toBeTruthy()
    expect(within(fullTimeRow).getByText('Không áp dụng')).toBeTruthy()
    expect(within(supportRow).getByText('NV hỗ trợ')).toBeTruthy()
    expect(within(supportRow).getByText(/Dosii TNV.*Dosii KVC/i)).toBeTruthy()
    expect(within(supportRow).getByText('140,000 đ')).toBeTruthy()
    expect(within(screen.getByLabelText('Tổng quan chấm công cửa hàng')).getByText('140,000 đ')).toBeTruthy()
    expect(screen.getAllByText('220,000 đ').length).toBeGreaterThan(0)
  })

  it('accrues each support attendance once when recognized and legacy pay rows are only partially migrated', () => {
    const supportEmployee = { ...employee, id: 'S02-MIXED', name: 'Nhân viên hỗ trợ chuyển đổi', storeId: 'S02', hourlyRate: 35_000 }
    const supportCompensation = (transferId, totalPay, allowanceApplied) => ({
      transferId,
      homeStoreId: 'S02',
      supportStoreId: store.id,
      transferStartAt: `${today()}T08:00:00+07:00`,
      transferEndAt: `${today()}T12:00:00+07:00`,
      hourlyRate: 45_000,
      hours: 2,
      basePay: 90_000,
      allowance: allowanceApplied ? 50_000 : 0,
      allowanceApplied,
      totalPay,
    })
    mocked.app = {
      ...baseApp(),
      employees: [supportEmployee],
      supportTransfers: [{ id: 'TR-MIXED', employeeId: supportEmployee.id, fromStoreId: 'S02', toStoreId: store.id }],
      attendance: [
        { id: 'A-RECORDED', storeId: store.id, employeeId: supportEmployee.id, employeeName: supportEmployee.name, date: today(), shift: 'SUPPORT-1', hours: 2, status: 'Đi đúng giờ', supportTransferId: 'TR-MIXED', supportCompensation: supportCompensation('TR-MIXED', 140_000, true) },
        { id: 'A-LEGACY', storeId: store.id, employeeId: supportEmployee.id, employeeName: supportEmployee.name, date: today(), shift: 'SUPPORT-2', hours: 2, status: 'Đi đúng giờ', supportTransferId: 'TR-MIXED', supportCompensation: supportCompensation('TR-MIXED', 90_000, false) },
      ],
      expenseEntries: [
        { id: 'EXP-RECORDED', storeId: store.id, sourceType: 'support-attendance-compensation', sourceId: 'A-RECORDED', amount: 140_000, occurredAt: `${today()}T12:00:00+07:00`, recognized: true },
        { id: 'EXP-DUPLICATE', storeId: store.id, sourceType: 'support-attendance-compensation', sourceId: 'A-RECORDED', amount: 140_000, occurredAt: `${today()}T12:01:00+07:00`, recognized: true },
      ],
    }

    renderPage(StoreAttendanceV2)

    const metrics = screen.getByLabelText('Tổng quan chấm công cửa hàng')
    expect(within(metrics).getByText('230,000 đ')).toBeTruthy()
    expect(within(metrics).queryByText('280,000 đ')).toBeNull()
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

    expect(screen.getByText((_, node) => node?.tagName === 'SMALL' && node.textContent.includes('20,000 đ/giờ'))).toBeTruthy()
    expect(screen.getAllByText('100,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByRole('columnheader', { name: 'Tổng phút sớm' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Tổng phút trễ' })).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
  })
})
