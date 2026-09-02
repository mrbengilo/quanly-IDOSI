import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmployeePayrollDetails } from '../employee/EmployeeV2Pages'
import { today } from '../../utils'
import { StoreAttendanceV2, StoreOrdersPage, StoreOverviewV2, StorePayrollV2, StoreReportsV2 } from './StoreV2Pages'

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
  compensationEntries: [],
  revenueBonusAllocations: [],
  violations: [],
  policies,
  updateOrder: vi.fn(),
  deleteOrder: vi.fn(),
  addSalaryAdjustment: vi.fn(async () => ({ ok: true })),
  createSalaryAdvance: vi.fn(async () => ({ ok: true })),
  confirmSalaryAdvance: vi.fn(async () => ({ ok: true })),
  closePayrollPeriod: vi.fn(async () => ({ ok: true })),
  confirmPayrollPayment: vi.fn(async () => ({ ok: true })),
  lockPayrollPeriod: vi.fn(async () => ({ ok: true })),
  notify: vi.fn(),
  getAvailableSalary: vi.fn(() => 0),
})

const renderPage = (Page, route = '/') => render(<MemoryRouter initialEntries={[route]}><Page /></MemoryRouter>)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('store order, attendance, and payroll summaries', () => {
  it.each([
    ['TẠO THƯỞNG', 'Thưởng khác'],
    ['TẠO PHỤ CẤP', 'Phụ cấp khác'],
  ])('creates %s once with a stable idempotency key while saving', async (buttonName, type) => {
    let resolveCreate
    const addSalaryAdjustment = vi.fn(() => new Promise((resolve) => { resolveCreate = resolve }))
    mocked.app = { ...baseApp(), addSalaryAdjustment }

    renderPage(StorePayrollV2)
    fireEvent.click(screen.getByRole('button', { name: buttonName }))

    const createButton = screen.getByRole('button', { name: 'TẠO' })
    expect(createButton.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('Nhập số tiền'), { target: { value: '125000' } })
    expect(createButton.disabled).toBe(false)

    fireEvent.click(createButton)
    await waitFor(() => expect(createButton.disabled).toBe(true))
    fireEvent.click(createButton)
    expect(addSalaryAdjustment).toHaveBeenCalledTimes(1)
    expect(addSalaryAdjustment).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: employee.id,
      storeId: store.id,
      type,
      amount: 125_000,
      idempotencyKey: expect.stringMatching(/^store-payroll:/u),
    }))

    resolveCreate({ ok: true })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('creates an advance only below available salary and prevents duplicate submission', async () => {
    let resolveCreate
    const createSalaryAdvance = vi.fn(() => new Promise((resolve) => { resolveCreate = resolve }))
    mocked.app = {
      ...baseApp(),
      createSalaryAdvance,
      getAvailableSalary: vi.fn(() => 500_000),
    }

    renderPage(StorePayrollV2)
    fireEvent.click(screen.getAllByRole('button', { name: 'TẠO ỨNG LƯƠNG' })[0])

    const createButton = screen.getByRole('button', { name: 'TẠO' })
    fireEvent.change(screen.getByPlaceholderText('Nhập số tiền'), { target: { value: '500000' } })
    expect(createButton.disabled).toBe(true)
    expect(screen.getByText(/Số tiền ứng phải nhỏ hơn lương khả dụng/u)).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Nhập số tiền'), { target: { value: '200000' } })
    expect(createButton.disabled).toBe(false)
    fireEvent.click(createButton)
    await waitFor(() => expect(createButton.disabled).toBe(true))
    fireEvent.click(createButton)

    expect(createSalaryAdvance).toHaveBeenCalledTimes(1)
    expect(createSalaryAdvance).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: employee.id,
      amount: 200_000,
      idempotencyKey: expect.stringMatching(/^store-payroll:/u),
    }))

    resolveCreate({ ok: true })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps the same transaction key when a payroll action is retried after failure', async () => {
    const addSalaryAdjustment = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: 'Mạng tạm thời gián đoạn.' })
      .mockResolvedValueOnce({ ok: true })
    mocked.app = { ...baseApp(), addSalaryAdjustment }

    renderPage(StorePayrollV2)
    fireEvent.click(screen.getByRole('button', { name: 'TẠO THƯỞNG' }))
    fireEvent.change(screen.getByPlaceholderText('Nhập số tiền'), { target: { value: '75000' } })
    const createButton = screen.getByRole('button', { name: 'TẠO' })

    fireEvent.click(createButton)
    await waitFor(() => expect(addSalaryAdjustment).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(createButton.disabled).toBe(false))
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.click(createButton)
    await waitFor(() => expect(addSalaryAdjustment).toHaveBeenCalledTimes(2))
    expect(addSalaryAdjustment.mock.calls[1][0].idempotencyKey).toBe(addSalaryAdjustment.mock.calls[0][0].idempotencyKey)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows only the current store overdue employees in a dismissible warning', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-09-02T03:00:00.000Z')
    mocked.app = {
      ...baseApp(),
      attendance: [{
        id: 'ATT-STORE-OLD', storeId: store.id, employeeId: employee.id, date: '2026-09-01',
        shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', checkIn: '08:00',
      }, {
        id: 'ATT-OTHER-STORE', storeId: 'S02', employeeId: 'S02-001', employeeName: 'Nhân viên cửa hàng khác',
        date: '2026-09-01', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00', checkIn: '08:00',
      }],
    }

    renderPage(StoreOverviewV2, '/store/overview')

    expect(screen.getByRole('dialog', { name: 'CẢNH BÁO NHÂN VIÊN CHƯA KẾT CA' })).toBeTruthy()
    expect(screen.getByText(employee.name)).toBeTruthy()
    expect(screen.getByText('chưa kết ca ngày 01/09/26 · Ca sáng')).toBeTruthy()
    expect(screen.queryByText('Nhân viên cửa hàng khác')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ĐÃ HIỂU' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

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

  it('resolves unique store, employee, transfer, and expense-source aliases without double accrual', () => {
    const supportEmployee = {
      ...employee,
      id: 'S02-ALIAS',
      name: 'Nhân viên alias duy nhất',
      storeId: 'S02',
      hourlyRate: 35_000,
    }
    mocked.app = {
      ...baseApp(),
      employees: [supportEmployee],
      supportTransfers: [{
        id: 'TR-ALIAS',
        employeeId: supportEmployee.id,
        fromStoreId: 'S02',
        toStoreId: store.id,
        hourlySupportRate: 45_000,
        allowance: 50_000,
      }],
      attendance: [{
        id: 'A-ALIAS',
        storeId: store.id.toLowerCase(),
        employeeId: supportEmployee.id.toLowerCase(),
        employeeName: supportEmployee.name,
        date: today(),
        shift: 'SUPPORT-ALIAS',
        hours: 2,
        status: 'Đi đúng giờ',
        supportTransferId: 'tr-alias',
      }],
      expenseEntries: [{
        id: 'EXP-ALIAS-UPPER',
        storeId: store.id,
        sourceType: 'support-attendance-compensation',
        sourceId: 'A-ALIAS',
        amount: 140_000,
        occurredAt: `${today()}T12:00:00+07:00`,
        recognized: true,
      }, {
        id: 'EXP-ALIAS-LOWER',
        storeId: store.id.toLowerCase(),
        sourceType: 'support-attendance-compensation',
        sourceId: 'a-alias',
        amount: 140_000,
        occurredAt: `${today()}T12:01:00+07:00`,
        recognized: true,
      }],
    }

    renderPage(StoreAttendanceV2)

    const attendanceTable = screen.getByRole('columnheader', { name: 'Nhân viên / Cửa hàng' }).closest('table')
    const supportRow = within(attendanceTable).getByText(supportEmployee.name).closest('tr')
    expect(within(supportRow).getByText('140,000 đ')).toBeTruthy()
    expect(within(supportRow).getByText(/Dosii TNV.*Dosii KVC/i)).toBeTruthy()
    const metrics = screen.getByLabelText('Tổng quan chấm công cửa hàng')
    expect(within(metrics).getByText('140,000 đ')).toBeTruthy()
    expect(within(metrics).queryByText('280,000 đ')).toBeNull()
  })

  it('fails closed instead of joining ambiguous attendance employees or support transfers', () => {
    const selectedStoreEmployee = {
      ...employee,
      id: 'EMP-Alpha',
      name: 'Tên hồ sơ cửa hàng',
    }
    const collidingEmployee = {
      ...employee,
      id: 'emp-alpha',
      name: 'Tên hồ sơ cửa hàng khác',
      storeId: 'S02',
    }
    mocked.app = {
      ...baseApp(),
      employees: [selectedStoreEmployee, collidingEmployee],
      supportTransfers: [{
        id: 'TR-Alpha',
        employeeId: selectedStoreEmployee.id,
        fromStoreId: store.id,
        toStoreId: 'S02',
        hourlySupportRate: 45_000,
      }, {
        id: 'tr-alpha',
        employeeId: collidingEmployee.id,
        fromStoreId: 'S02',
        toStoreId: store.id,
        hourlySupportRate: 990_000,
      }],
      attendance: [{
        id: 'ATT-AMBIGUOUS',
        storeId: store.id,
        employeeId: 'Emp-Alpha',
        employeeName: 'Tên snapshot an toàn',
        date: today(),
        shift: 'SUPPORT-AMBIGUOUS',
        hours: 2,
        status: 'Đi đúng giờ',
        supportTransferId: 'Tr-Alpha',
      }],
    }

    renderPage(StoreAttendanceV2)

    const attendanceTable = screen.getByRole('columnheader', { name: 'Nhân viên / Cửa hàng' }).closest('table')
    const row = within(attendanceTable).getByText('Tên snapshot an toàn').closest('tr')
    expect(within(row).queryByText(selectedStoreEmployee.name)).toBeNull()
    expect(within(row).queryByText(collidingEmployee.name)).toBeNull()
    expect(within(row).getAllByText('0 đ').length).toBeGreaterThanOrEqual(2)
    expect(within(row).queryByText('1,980,000 đ')).toBeNull()
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

  it('attributes a support work reward to the destination payroll without leaking it to the home store', () => {
    const homeStore = { id: 'S02', name: 'Dosii TNV' }
    const supportEmployee = {
      ...employee,
      id: 'S02-SUPPORT-01',
      name: 'Nhân viên hỗ trợ nhận thưởng',
      storeId: homeStore.id,
      hourlyRate: 35_000,
    }
    const supportTransfer = {
      id: 'TR-REWARD-01', employeeId: supportEmployee.id,
      fromStoreId: homeStore.id, toStoreId: store.id,
      hourlySupportRate: 45_000, allowance: 50_000,
    }
    const supportAttendance = {
      id: 'ATT-SUPPORT-REWARD', storeId: store.id, employeeId: supportEmployee.id,
      date: today(), hours: 2, status: 'Đi đúng giờ', supportTransferId: supportTransfer.id,
      supportCompensation: {
        transferId: supportTransfer.id, homeStoreId: homeStore.id, supportStoreId: store.id,
        hours: 2, hourlyRate: 45_000, basePay: 90_000, allowance: 50_000, totalPay: 140_000,
      },
    }
    const supportReward = {
      id: 'WORK-SUPPORT-REWARD', employeeId: supportEmployee.id.toLowerCase(),
      storeId: store.id.toLowerCase(), supportStoreId: store.id.toLowerCase(),
      homeStoreId: homeStore.id.toLowerCase(), supportTransferId: supportTransfer.id.toLowerCase(),
      attendanceId: supportAttendance.id.toLowerCase(), effectiveDate: today(),
      type: 'WORK', amountVnd: 25_000, status: 'APPROVED',
    }
    const unrelatedDestinationEntries = [{
      ...supportReward,
      id: 'MANUAL-SUPPORT-REWARD',
      type: 'MANUAL',
      amountVnd: 11_000,
    }, {
      ...supportReward,
      id: 'ORPHAN-SUPPORT-REWARD',
      supportStoreId: null,
      homeStoreId: null,
      supportTransferId: null,
      attendanceId: null,
      amountVnd: 13_000,
    }]
    mocked.app = {
      ...baseApp(),
      stores: [store, homeStore],
      employees: [supportEmployee],
      attendance: [supportAttendance],
      supportTransfers: [supportTransfer],
      compensationEntries: [supportReward, ...unrelatedDestinationEntries],
    }

    renderPage(StorePayrollV2)

    let table = screen.getByRole('columnheader', { name: 'Thưởng công việc' }).closest('table')
    let row = within(table).getByText(supportEmployee.name).closest('tr')
    expect(within(row).getAllByRole('cell')[4].textContent).toContain('25,000 đ')
    expect(within(row).getAllByRole('cell')[10].textContent).toBe('165,000 đ')
    expect(within(row).getByText(/Thưởng hỗ trợ ghi nhận tại Dosii KVC.*TR-REWARD-01/iu)).toBeTruthy()

    cleanup()
    mocked.app = {
      ...baseApp(),
      stores: [store, homeStore],
      activeStoreId: homeStore.id,
      activeStore: homeStore,
      employees: [supportEmployee],
      compensationEntries: [supportReward],
    }

    renderPage(StorePayrollV2)

    table = screen.getByRole('columnheader', { name: 'Thưởng công việc' }).closest('table')
    row = within(table).getByText(supportEmployee.name).closest('tr')
    expect(within(row).getAllByRole('cell')[4].textContent).toBe('0 đ')
    expect(within(row).getAllByRole('cell')[10].textContent).toBe('0 đ')
    expect(within(row).queryByText(/Thưởng hỗ trợ ghi nhận/iu)).toBeNull()
  })

  it('keeps selected-store manager attendance out of employee payroll without locking the preview', () => {
    const storeManager = {
      ...employee,
      id: 'S01-MANAGER',
      name: 'Quản lý cửa hàng',
      unit: 'store_manager',
      employmentType: 'Full-Time',
      payBasis: 'monthly',
      monthlySalary: 12_000_000,
    }
    mocked.app = {
      ...baseApp(),
      employees: [employee, storeManager],
      attendance: [{
        id: 'A-EMPLOYEE', storeId: store.id, employeeId: employee.id,
        date: today(), hours: 4, status: 'Đi đúng giờ',
      }, {
        id: 'A-MANAGER-1', storeId: store.id, employeeId: storeManager.id,
        date: today(), hours: 4, status: 'Đi đúng giờ',
      }, {
        id: 'A-MANAGER-2', storeId: store.id, employeeId: storeManager.id,
        date: today(), hours: 4, status: 'Đi đúng giờ',
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.queryByText(/Không thể tính lương kỳ này/u)).toBeNull()
    const table = screen.getByRole('columnheader', { name: 'Lương cứng' }).closest('table')
    expect(within(table).getByText(employee.name)).toBeTruthy()
    expect(within(table).queryByText(storeManager.name)).toBeNull()
    expect(screen.getAllByText('80,000 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('12,000,000 đ')).toBeNull()
  })

  it('still locks employee payroll for foreign-store attendance without a support transfer', () => {
    const foreignEmployee = {
      ...employee,
      id: 'S02-UNLINKED',
      name: 'Nhân viên cửa hàng khác',
      storeId: 'S02',
    }
    mocked.app = {
      ...baseApp(),
      employees: [employee, foreignEmployee],
      attendance: [{
        id: 'A-EMPLOYEE', storeId: store.id, employeeId: employee.id,
        date: today(), hours: 4, status: 'Đi đúng giờ',
      }, {
        id: 'A-FOREIGN', storeId: store.id, employeeId: foreignEmployee.id,
        date: today(), hours: 4, status: 'Đi đúng giờ',
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.getByText(/Không thể tính lương kỳ này/u)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText(foreignEmployee.name)).toBeNull()
  })

  it('reads the canonical salaryConfig from a locked tiered payroll snapshot', () => {
    const fullTimeEmployee = {
      ...employee,
      employmentType: 'Full-Time',
      payBasis: 'tiered-hourly',
      hourlyRate: null,
    }
    mocked.app = {
      ...baseApp(),
      employees: [fullTimeEmployee],
      payrollPeriods: [{
        id: 'PAY-LOCKED-TIERED', storeId: store.id, period: today().slice(0, 7), status: 'Đã khóa',
        rows: [{
          employeeId: employee.id, hours: 4, baseSalary: 124_000, gross: 124_000, remaining: 124_000,
          salarySnapshot: {
            employmentType: 'Full-Time', payBasis: 'tiered-hourly',
            salaryConfig: {
              thresholdHours: 208, standardHourlyRateVnd: 31_000, excessHourlyRateVnd: 28_000,
            },
          },
        }],
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.getByText('31,000 đ/giờ')).toBeTruthy()
    expect(screen.getAllByText('124,000 đ').length).toBeGreaterThan(0)
  })

  it('uses canonical approved compensation buckets without reviving voided records', () => {
    mocked.app = {
      ...baseApp(),
      attendance: [{ id: 'A-01', storeId: store.id.toLowerCase(), employeeId: employee.id.toLowerCase(), date: today(), hours: 4, status: 'Đi đúng giờ' }],
      salaryAdjustments: [{ id: 'LEGACY-01', storeId: store.id.toLowerCase(), employeeId: employee.id.toLowerCase(), period: today().slice(0, 7), type: 'Thưởng khác', amount: 10_000, status: 'Đã duyệt' }],
      compensationEntries: [
        { id: 'MANUAL-01', employeeId: employee.id.toLowerCase(), storeId: store.id.toLowerCase(), effectiveDate: today(), type: 'MANUAL', amountVnd: 30_000, status: 'APPROVED' },
        { id: 'WORK-01', employeeId: employee.id, storeId: store.id, effectiveDate: today(), type: 'WORK', amountVnd: 15_000, status: 'APPROVED' },
        { id: 'ALLOWANCE-01', employeeId: employee.id, storeId: store.id, effectiveDate: today(), type: 'ALLOWANCE', amountVnd: 7_000, status: 'APPROVED' },
        { id: 'VOIDED-01', employeeId: employee.id, storeId: store.id, effectiveDate: today(), type: 'MANUAL', amountVnd: 999_000, status: 'APPROVED', voidedAt: `${today()}T12:00:00+07:00` },
      ],
      revenueBonusAllocations: [
        { id: 'REVENUE-01', employeeId: employee.id.toLowerCase(), storeId: store.id.toLowerCase(), businessDate: today(), amountVnd: 20_000, status: 'APPROVED' },
        { id: 'REVENUE-VOID', employeeId: employee.id, storeId: store.id, businessDate: today(), amountVnd: 999_000, status: 'APPROVED', voidedAt: `${today()}T12:00:00+07:00` },
      ],
      violations: [
        { id: 'VIOLATION-01', employeeId: employee.id.toLowerCase(), storeId: store.id.toLowerCase(), effectiveDate: today(), amountVnd: 12_000, status: 'ACTIVE' },
        { id: 'VIOLATION-VOID', employeeId: employee.id, storeId: store.id, effectiveDate: today(), amountVnd: 999_000, status: 'ACTIVE', voidedAt: `${today()}T12:00:00+07:00` },
      ],
    }

    renderPage(StorePayrollV2)

    const table = screen.getByRole('columnheader', { name: 'Thưởng doanh thu' }).closest('table')
    const row = within(table).getByText(employee.name).closest('tr')
    const cells = within(row).getAllByRole('cell')
    expect(cells[3].textContent).toBe('20,000 đ')
    expect(cells[4].textContent).toBe('15,000 đ')
    expect(cells[5].textContent).toBe('40,000 đ')
    expect(cells[7].textContent).toBe('7,000 đ')
    expect(cells[8].textContent).toBe('12,000 đ')
    expect(cells[10].textContent).toBe('150,000 đ')
  })

  it('ignores legacy unscoped payroll sources owned by another store or office profile', () => {
    const otherStoreEmployee = {
      ...employee,
      id: 'S02-001',
      name: 'Nhân viên cửa hàng khác',
      storeId: 'S02',
    }
    const officeEmployee = {
      ...employee,
      id: 'VP-001',
      name: 'Nhân viên văn phòng',
      unit: 'office',
      storeId: 'OFFICE',
    }
    mocked.app = {
      ...baseApp(),
      employees: [employee, otherStoreEmployee, officeEmployee],
      attendance: [{
        id: 'A-LOCAL', storeId: store.id, employeeId: employee.id,
        date: today(), hours: 4, status: 'Đi đúng giờ',
      }],
      salaryAdjustments: [{
        id: 'LOCAL-LEGACY', employeeId: employee.id, period: today().slice(0, 7),
        type: 'Thưởng khác', amount: 10_000, status: 'Đã duyệt',
      }, {
        id: 'OTHER-LEGACY', employeeId: otherStoreEmployee.id, period: today().slice(0, 7),
        type: 'Thưởng khác', amount: 8_000_000, status: 'Đã duyệt',
      }, {
        id: 'OFFICE-LEGACY', employeeId: officeEmployee.id, period: today().slice(0, 7),
        type: 'Thưởng khác', amount: 9_000_000, status: 'Đã duyệt',
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.queryByText(/Không thể tính lương kỳ này/u)).toBeNull()
    expect(screen.getAllByText('90,000 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('8,000,000 đ')).toBeNull()
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
  })

  it('still locks payroll for an explicitly scoped source linked to an out-of-scope employee', () => {
    const otherStoreEmployee = {
      ...employee,
      id: 'S02-001',
      name: 'Nhân viên cửa hàng khác',
      storeId: 'S02',
    }
    mocked.app = {
      ...baseApp(),
      employees: [employee, otherStoreEmployee],
      attendance: [{
        id: 'A-LOCAL', storeId: store.id, employeeId: employee.id,
        date: today(), hours: 4, status: 'Đi đúng giờ',
      }],
      salaryAdjustments: [{
        id: 'INVALID-SCOPED', storeId: store.id, employeeId: otherStoreEmployee.id,
        period: today().slice(0, 7), type: 'Thưởng khác', amount: 8_000_000, status: 'Đã duyệt',
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.getByText(/Không thể tính lương kỳ này/u)).toBeTruthy()
    expect(screen.queryByText('8,000,000 đ')).toBeNull()
  })

  it('blocks payroll actions and exposes a repair message when salary config ids collide by case', () => {
    const fullTimeEmployee = {
      ...employee,
      employmentType: 'Full-Time',
      payBasis: 'tiered-hourly',
      hourlyRate: null,
    }
    mocked.app = {
      ...baseApp(),
      employees: [fullTimeEmployee],
      closePayrollPeriod: vi.fn(),
      storeEmployeeSalaryConfigs: [{
        id: 'CFG-A', employeeId: employee.id, storeId: store.id, effectiveFrom: today().slice(0, 7),
        thresholdHours: 208, standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000,
      }, {
        id: 'CFG-B', employeeId: employee.id.toLowerCase(), storeId: store.id.toLowerCase(), effectiveFrom: today().slice(0, 7),
        thresholdHours: 208, standardHourlyRateVnd: 99_000, excessHourlyRateVnd: 98_000,
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.getByText(/Không thể tính lương kỳ này/u)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CHỐT SỔ' }).disabled).toBe(true)
    expect(screen.getAllByRole('button', { name: 'TẠO ỨNG LƯƠNG' }).every((button) => button.disabled)).toBe(true)
    expect(screen.queryByText('29,000 đ/giờ')).toBeNull()
  })

  it('renders SM-TNV payroll from case-only salary configuration history', () => {
    const smStore = { id: 'Sm-Tnv', name: 'SM TNV', status: 'Đang hoạt động' }
    const smEmployee = {
      ...employee,
      id: 'St-Abc',
      storeId: smStore.id,
      employmentType: 'Full-Time',
      payBasis: 'tiered-hourly',
      hourlyRate: null,
    }
    mocked.app = {
      ...baseApp(),
      stores: [smStore],
      activeStore: smStore,
      activeStoreId: smStore.id,
      employees: [smEmployee],
      attendance: [{
        id: 'ATT-SM-PAYROLL', storeId: 'SM-TNV', employeeId: 'ST-ABC',
        date: today(), hours: 4, status: 'Đi đúng giờ',
      }],
      storeEmployeeSalaryConfigs: [{
        id: 'CFG-SM-UPPER', employeeId: 'ST-ABC', storeId: 'SM-TNV', effectiveFrom: '2026-07',
        thresholdHours: 208, standardHourlyRateVnd: 29_000, excessHourlyRateVnd: 26_000,
      }, {
        id: 'CFG-SM-LOWER', employeeId: 'st-abc', storeId: 'sm-tnv', effectiveFrom: today().slice(0, 7),
        thresholdHours: 208, standardHourlyRateVnd: 31_000, excessHourlyRateVnd: 27_000,
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.queryByText(/Không thể tính lương kỳ này/u)).toBeNull()
    expect(screen.getByText('31,000 đ/giờ')).toBeTruthy()
    expect(screen.getAllByText('124,000 đ').length).toBeGreaterThan(0)
  })

  it('locks every store payroll total when active period ids collide by store casing', () => {
    mocked.app = {
      ...baseApp(),
      closePayrollPeriod: vi.fn(),
      payrollPeriods: [{
        id: 'PAY-UPPER', storeId: store.id, period: today().slice(0, 7), status: 'Đã chốt',
        rows: [{ employeeId: employee.id, hours: 4, baseSalary: 80_000, gross: 80_000, remaining: 80_000 }],
      }, {
        id: 'PAY-LOWER', storeId: store.id.toLowerCase(), period: today().slice(0, 7), status: 'Đã chốt',
        rows: [{ employeeId: employee.id, hours: 4, baseSalary: 9_000_000, gross: 9_000_000, remaining: 9_000_000 }],
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.getByText(/Không thể tính lương kỳ này/u)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
    expect(screen.getByRole('button', { name: 'CHỐT SỔ' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'XÁC NHẬN CHI LƯƠNG' }).disabled).toBe(true)
  })

  it('locks payroll when the selected store reference is ambiguous in the global store catalog', () => {
    const upperStore = { id: 'Store-Alpha', name: 'Cửa hàng chữ hoa' }
    const lowerStore = { id: 'store-alpha', name: 'Cửa hàng chữ thường' }
    mocked.app = {
      ...baseApp(),
      stores: [upperStore, lowerStore],
      activeStore: null,
      activeStoreId: 'STORE-ALPHA',
      employees: [{ ...employee, storeId: upperStore.id }],
      closePayrollPeriod: vi.fn(),
    }

    renderPage(StorePayrollV2)

    expect(screen.getByText(/Không thể tính lương kỳ này/u)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText(employee.name)).toBeNull()
    expect(screen.getByRole('button', { name: 'CHỐT SỔ' }).disabled).toBe(true)
  })

  it('locks the payroll preview when employee profiles collide by identifier casing', () => {
    mocked.app = {
      ...baseApp(),
      closePayrollPeriod: vi.fn(),
      employees: [employee, {
        ...employee,
        id: employee.id.toLowerCase(),
        name: 'Hồ sơ trùng chữ thường',
        hourlyRate: 99_000,
      }],
      attendance: [{
        id: 'ATT-EMPLOYEE-COLLISION', storeId: store.id,
        employeeId: employee.id.toLowerCase(), date: today(), hours: 8, status: 'Đi đúng giờ',
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.getByText(/hồ sơ nhân viên.*mã trùng/iu)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText('792,000 đ')).toBeNull()
    expect(screen.getByRole('button', { name: 'CHỐT SỔ' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'XÁC NHẬN CHI LƯƠNG' }).disabled).toBe(true)
  })

  it('locks the payroll preview when one snapshot contains case-colliding employee rows', () => {
    mocked.app = {
      ...baseApp(),
      closePayrollPeriod: vi.fn(),
      payrollPeriods: [{
        id: 'PAY-ROW-COLLISION', storeId: store.id, period: today().slice(0, 7), status: 'Đã khóa',
        rows: [{
          employeeId: employee.id, hours: 4, baseSalary: 80_000, gross: 80_000, remaining: 80_000,
        }, {
          employeeId: employee.id.toLowerCase(), hours: 4, baseSalary: 9_000_000,
          gross: 9_000_000, remaining: 9_000_000,
        }],
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.getByText(/Không thể tính lương kỳ này/u)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
    expect(screen.getByRole('button', { name: 'CHỐT SỔ' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'XÁC NHẬN CHI LƯƠNG' }).disabled).toBe(true)
  })

  it('renders an immutable payroll snapshot without resolving colliding live salary configs', () => {
    const fullTimeEmployee = {
      ...employee,
      employmentType: 'Full-Time',
      payBasis: 'tiered-hourly',
      hourlyRate: null,
    }
    const period = today().slice(0, 7)
    mocked.app = {
      ...baseApp(),
      employees: [fullTimeEmployee],
      getAvailableSalary: vi.fn(() => {
        const error = new Error('salary collision')
        error.code = 'STORE_SALARY_CONFIG_IDENTIFIER_COLLISION'
        throw error
      }),
      payrollPeriods: [{
        id: 'PAY-SNAPSHOT', storeId: store.id.toLowerCase(), period, status: 'Đã khóa',
        rows: [{
          employeeId: employee.id.toLowerCase(), hours: 10, baseSalary: 300_000,
          revenueBonusVnd: 0, workBonusVnd: 0, manualBonusVnd: 0, allowanceVnd: 0,
          violationVnd: 0, advancesPaid: 0, remaining: 300_000,
          salarySnapshot: {
            hourlyRate: 30_000,
            salaryConfigSnapshot: { thresholdHours: 208, standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000 },
          },
        }],
      }],
      storeEmployeeSalaryConfigs: [{
        id: 'CFG-A', employeeId: employee.id, storeId: store.id, effectiveFrom: period,
        thresholdHours: 208, standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000,
      }, {
        id: 'CFG-B', employeeId: employee.id.toLowerCase(), storeId: store.id.toLowerCase(), effectiveFrom: period,
        thresholdHours: 208, standardHourlyRateVnd: 99_000, excessHourlyRateVnd: 98_000,
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.queryByText(/Không thể tính lương kỳ này/u)).toBeNull()
    const table = screen.getByRole('columnheader', { name: 'Lương cứng' }).closest('table')
    const row = within(table).getByText(employee.name).closest('tr')
    expect(within(row).getAllByRole('cell')[10].textContent).toBe('300,000 đ')
    fireEvent.click(screen.getAllByRole('button', { name: 'TẠO ỨNG LƯƠNG' })[0])
    expect(screen.getByText(/Không thể tính lương khả dụng vì có cấu hình lương trùng kỳ/u)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'TẠO' }).disabled).toBe(true)
  })

  it('preserves employeeCode aliases and inbound support employees from an immutable payroll snapshot', () => {
    const homeEmployee = {
      ...employee,
      id: 'HOME-LIVE-ID',
      code: 'HOME-CODE',
      employeeCode: 'HOME-CODE',
      name: 'Tên hồ sơ hiện tại',
    }
    const supportEmployee = {
      ...employee,
      id: 'SUPPORT-LIVE-ID',
      code: 'SUPPORT-CODE',
      employeeCode: 'SUPPORT-CODE',
      name: 'Tên hỗ trợ hiện tại',
      storeId: 'S02',
    }
    mocked.app = {
      ...baseApp(),
      employees: [homeEmployee, supportEmployee],
      payrollPeriods: [{
        id: 'PAY-EMPLOYEE-CODE',
        storeId: store.id.toLowerCase(),
        period: today().slice(0, 7),
        status: 'Đã khóa',
        rows: [{
          employeeCode: 'home-code',
          employeeName: 'Tên snapshot cửa hàng',
          hours: 4,
          baseSalary: 80_000,
          gross: 80_000,
          remaining: 80_000,
          salarySnapshot: { employmentType: 'Part-Time', hourlyRate: 20_000 },
        }, {
          employeeCode: 'support-code',
          employeeName: 'Tên snapshot hỗ trợ',
          hours: 2,
          baseSalary: 90_000,
          workBonusVnd: 25_000,
          supportWorkBonusVnd: 25_000,
          allowanceVnd: 50_000,
          gross: 165_000,
          remaining: 165_000,
          supportActualPay: 140_000,
          supportTransferIds: ['TR-SNAPSHOT-01'],
          supportCompensation: {
            hours: 2, basePay: 90_000, allowance: 50_000, totalPay: 140_000,
            transferIds: ['TR-SNAPSHOT-01'],
          },
          salarySnapshot: { employmentType: 'Part-Time', hourlyRate: 45_000 },
        }],
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.queryByText(/Không thể tính lương kỳ này/u)).toBeNull()
    const table = screen.getByRole('columnheader', { name: 'Lương cứng' }).closest('table')
    const homeRow = within(table).getByText('Tên snapshot cửa hàng').closest('tr')
    const supportRow = within(table).getByText('Tên snapshot hỗ trợ').closest('tr')
    expect(within(homeRow).getByText(/home-code/i)).toBeTruthy()
    expect(within(supportRow).getByText(/support-code/i)).toBeTruthy()
    expect(within(supportRow).getByText('45,000 đ/giờ')).toBeTruthy()
    expect(within(supportRow).getByText('165,000 đ')).toBeTruthy()
    expect(within(supportRow).getAllByRole('cell')[4].textContent).toContain('25,000 đ')
    expect(within(supportRow).getByText(/Thưởng hỗ trợ ghi nhận tại Dosii KVC.*TR-SNAPSHOT-01/iu)).toBeTruthy()
    expect(screen.getAllByText('245,000 đ').length).toBeGreaterThan(0)
  })

  it('locks immutable payroll totals when a snapshot employee alias is globally ambiguous', () => {
    const selectedStoreEmployee = {
      ...employee,
      id: 'EMP-Alpha',
      name: 'Nhân viên cửa hàng đang chọn',
    }
    const otherStoreEmployee = {
      ...employee,
      id: 'emp-alpha',
      name: 'Nhân viên cửa hàng khác trùng alias',
      storeId: 'S02',
      hourlyRate: 99_000,
    }
    mocked.app = {
      ...baseApp(),
      employees: [selectedStoreEmployee, otherStoreEmployee],
      closePayrollPeriod: vi.fn(),
      payrollPeriods: [{
        id: 'PAY-GLOBAL-AMBIGUOUS',
        storeId: store.id,
        period: today().slice(0, 7),
        status: 'Đã khóa',
        rows: [{
          employeeCode: 'Emp-Alpha',
          employeeName: 'Dòng snapshot mơ hồ',
          hours: 4,
          baseSalary: 9_000_000,
          gross: 9_000_000,
          remaining: 9_000_000,
        }],
      }],
    }

    renderPage(StorePayrollV2)

    expect(screen.getByText(/Không thể tính lương kỳ này/u)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
    expect(screen.getByRole('button', { name: 'CHỐT SỔ' }).disabled).toBe(true)
  })

  it('shows the configured hourly rate in employee income details and both punctuality minute totals', () => {
    mocked.app = {
      currentEmployee: employee,
      attendance: [
        { id: 'A-01', storeId: store.id, employeeId: employee.id, date: today(), hours: 4, status: 'Đi sớm', minutesEarly: 12, minutesLate: 0 },
        { id: 'A-02', storeId: store.id, employeeId: employee.id, date: today(), hours: 1, status: 'Đi trễ', minutesEarly: 0, minutesLate: 8 },
        {
          id: 'A-SUPPORT-LEGACY', storeId: 'S02', employeeId: employee.id, date: today(), hours: 2,
          compensation: { support: { transferId: 'TR-LEGACY', hours: 2, hourlyRate: 30_000, totalPay: 60_000 } },
        },
      ],
      stores: [store, { id: 'S02', name: 'Dosii TNV' }],
      supportTransfers: [{ id: 'TR-LEGACY', employeeId: employee.id, fromStoreId: store.id, toStoreId: 'S02' }],
      salaryAdjustments: [],
      salaryAdvances: [],
      payrollPeriods: [],
    }

    renderPage(EmployeePayrollDetails, '/employee/payroll')

    expect(screen.getByText((_, node) => node?.tagName === 'SMALL' && node.textContent.includes('20,000 đ/giờ'))).toBeTruthy()
    expect(screen.getAllByText('100,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('60,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByRole('columnheader', { name: 'Tổng phút sớm' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Tổng phút trễ' })).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
  })

  it('uses the exact-case payroll period when another store id differs only by casing', () => {
    const period = today().slice(0, 7)
    mocked.app = {
      currentEmployee: employee,
      session: { role: 'employee', employeeId: employee.id, storeId: store.id },
      employees: [employee],
      stores: [store, { id: 'S02', name: 'Dosii hỗ trợ' }],
      attendance: [{
        id: 'ATT-SUPPORT-PAYROLL-COLLISION', employeeId: employee.id, storeId: 'S02', date: today(), hours: 3,
        shiftStart: '08:00', shiftEnd: '12:00', supportTransferId: 'TR-PAYROLL-COLLISION',
        supportCompensation: {
          transferId: 'TR-PAYROLL-COLLISION', homeStoreId: store.id, supportStoreId: 'S02',
          supportStoreName: 'Dosii hỗ trợ', hourlyRate: 29_000, hours: 3,
          basePay: 87_000, allowance: 50_000, totalPay: 137_000,
        },
      }],
      supportTransfers: [{
        id: 'TR-PAYROLL-COLLISION', employeeId: employee.id, fromStoreId: store.id, toStoreId: 'S02',
      }],
      salaryAdjustments: [],
      salaryAdvances: [],
      compensationEntries: [],
      revenueBonusAllocations: [],
      violations: [],
      storeEmployeeSalaryConfigs: [],
      payrollPeriods: [{
        id: 'PAY-UPPER', storeId: store.id, period, status: 'Đã chốt',
        rows: [{ employeeId: employee.id, baseSalary: 80_000, gross: 80_000, remaining: 80_000 }],
      }, {
        id: 'PAY-LOWER', storeId: store.id.toLowerCase(), period, status: 'Đã chốt',
        rows: [{ employeeId: employee.id, baseSalary: 9_000_000, gross: 9_000_000, remaining: 9_000_000 }],
      }],
    }

    renderPage(EmployeePayrollDetails, '/employee/payroll')

    expect(screen.queryByText(/Hệ thống đã khóa toàn bộ số tiền/u)).toBeNull()
    expect(screen.getAllByText('80,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('137,000 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
  })

  it('fails closed when the employee store reference has no exact case among colliding stores', () => {
    const period = today().slice(0, 7)
    const upperStore = { ...store, id: 'STORE-01' }
    const ambiguousEmployee = { ...employee, storeId: 'Store-01' }
    mocked.app = {
      currentEmployee: ambiguousEmployee,
      session: { role: 'employee', employeeId: employee.id, storeId: ambiguousEmployee.storeId },
      employees: [ambiguousEmployee],
      stores: [upperStore, { ...store, id: 'store-01', name: 'Dosii trùng mã' }],
      attendance: [],
      supportTransfers: [],
      salaryAdjustments: [],
      salaryAdvances: [],
      compensationEntries: [],
      revenueBonusAllocations: [],
      violations: [],
      storeEmployeeSalaryConfigs: [],
      payrollPeriods: [{
        id: 'PAY-UPPER', storeId: upperStore.id, period, status: 'Đã chốt',
        rows: [{ employeeId: employee.id, baseSalary: 80_000, gross: 80_000, remaining: 80_000 }],
      }, {
        id: 'PAY-LOWER', storeId: 'store-01', period, status: 'Đã chốt',
        rows: [{ employeeId: employee.id, baseSalary: 9_000_000, gross: 9_000_000, remaining: 9_000_000 }],
      }],
    }

    renderPage(EmployeePayrollDetails, '/employee/payroll')

    expect(screen.getByText(/Hệ thống đã khóa toàn bộ số tiền/u)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText('80,000 đ')).toBeNull()
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
  })
})
