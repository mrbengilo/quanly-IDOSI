import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { today } from '../../utils'
import { StoreSettings } from './StoreFinance'
import { StoreEmployees, StoreTasks } from './StoreOperations'
import {
  StoreCashflowV2,
  StoreImportsV2,
  StoreOrdersPage,
  StorePayrollV2,
} from './StoreV2Pages'
import UnifiedSchedule from './UnifiedSchedule'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

const store = {
  id: 'CH001',
  name: 'SecondMall SM234',
  short: 'SM234',
  phone: '0901234567',
  email: 'sm234@idosi.vn',
  address: '234 Đường Mẫu',
  opening: '08:00',
  closing: '22:00',
}

const employee = {
  id: 'SM234-001',
  code: 'SM234-001',
  name: 'Nguyễn Minh Anh',
  unit: 'store',
  storeId: store.id,
  status: 'Đang làm việc',
  employmentType: 'Full-Time',
  payBasis: 'monthly',
  baseSalary: 8_000_000,
  monthlySalary: 8_000_000,
  standardWorkDays: 26,
  requiredMonthlyHours: 208,
  position: 'Nhân viên bán hàng',
  phone: '0901234567',
  cccd: '079203001234',
  username: 'sm234.001',
}

const mutationNames = [
  'addEmployee',
  'updateEmployee',
  'deleteEmployee',
  'replaceTasks',
  'createShiftDefinition',
  'updateShiftDefinition',
  'deleteShiftDefinition',
  'saveScheduleMultiple',
  'updateOrder',
  'deleteOrder',
  'addFixedExpense',
  'addSalaryAdjustment',
  'createSalaryAdvance',
  'confirmSalaryAdvance',
  'closePayrollPeriod',
  'confirmPayrollPayment',
  'lockPayrollPeriod',
  'createImportVoucher',
  'updateImportVoucher',
  'deleteImportVoucher',
  'updateStore',
]

const makeApp = () => {
  const date = today()
  const shift = { id: 'CA-SANG', storeId: store.id, name: 'Ca sáng', date, start: '08:00', end: '12:00', active: true, color: '#18a558' }
  const mutations = Object.fromEntries(mutationNames.map((name) => [name, vi.fn()]))
  return {
    session: { role: 'business_support', employeeId: 'HTKD-001' },
    stores: [store],
    activeStoreId: store.id,
    activeStore: store,
    employees: [employee],
    attendance: [{ id: 'CC-001', storeId: store.id, employeeId: employee.id, date, hours: 4, checkIn: '08:00', checkOut: '12:00', status: 'Đúng giờ', shift: shift.id, shiftName: shift.name }],
    schedule: [{ id: 'LICH-001', storeId: store.id, employeeId: employee.id, date, shiftIds: [shift.id], shiftSnapshots: [shift], note: 'Lịch sáng' }],
    shiftDefinitions: [shift],
    tasks: [{ id: 'CV-001', storeId: store.id, shiftId: shift.id, date, title: 'Kiểm kê quầy', detail: 'Đếm hàng trước ca' }],
    orders: [{ id: 'DH-001', code: 'DH-001', storeId: store.id, employeeId: employee.id, employeeName: employee.name, amount: 250_000, paymentMethod: 'Tiền mặt', status: 'Hoàn tất', createdAt: `${date}T09:00:00+07:00` }],
    expenseEntries: [],
    fixedExpenses: [],
    salaryAdjustments: [],
    salaryAdvances: [{ id: 'UL-001', storeId: store.id, employeeId: employee.id, employeeName: employee.name, period: date.slice(0, 7), amount: 500_000, availableAtCreation: 2_000_000, remainingAfter: 1_500_000, status: 'Mới tạo', createdAt: `${date}T10:00:00+07:00`, createdBy: { name: 'Admin' } }],
    payrollPeriods: [],
    importVouchers: [{ id: 'PN-001', code: 'PN-170826-0001', storeId: store.id, createdAt: `${date}T10:30:00+07:00`, createdBy: { name: 'Quản lý' }, items: [{ name: 'Hàng mẫu', packageQuantity: 2, weight: 20, price: 50_000 }], shippingAmount: 100_000, totalAmount: 1_100_000 }],
    policies: {
      version: 1,
      effectiveFrom: date,
      employeeKpiRates: { from30000: 0, from15000: 0, from7000: 0 },
      attendanceEvaluation: { improveMinLateCount: 3, improveMinLateMinutes: 30 },
    },
    getAvailableSalary: vi.fn(() => 0),
    notify: vi.fn(),
    ...mutations,
  }
}

const renderPage = (Page) => render(<MemoryRouter><Page /></MemoryRouter>)

describe('business-support store workspace permits only the required order controls', () => {
  beforeEach(() => {
    mocked.app = makeApp()
  })

  afterEach(cleanup)

  it('shows store employees without account mutation controls', () => {
    renderPage(StoreEmployees)

    expect(screen.getAllByText(employee.name).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Thêm nhân viên/i })).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(`Sửa ${employee.name}`, 'i') })).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(`Xóa ${employee.name}`, 'i') })).toBeNull()
  })

  it('shows assigned work and schedules without editors', () => {
    const taskView = renderPage(StoreTasks)
    expect(screen.getByText('Kiểm kê quầy')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Lưu và gửi/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Thêm công việc/i })).toBeNull()
    taskView.unmount()

    renderPage(UnifiedSchedule)
    expect(screen.getAllByText('Ca sáng').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Tạo ca/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Sửa Ca sáng/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Xóa Ca sáng/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^LƯU$/i })).toBeNull()
  })

  it('allows order correction while keeping cashflow and payroll mutations read-only', () => {
    const orderView = renderPage(StoreOrdersPage)
    expect(screen.getByText('DH-001')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Sửa$/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /^Xóa$/i }).length).toBeGreaterThan(0)
    orderView.unmount()

    const cashflowView = renderPage(StoreCashflowV2)
    expect(screen.getByRole('heading', { name: 'DÒNG TIỀN CỬA HÀNG' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /NHẬP CHI PHÍ CỐ ĐỊNH/i })).toBeNull()
    cashflowView.unmount()

    renderPage(StorePayrollV2)
    expect(screen.getAllByText(employee.name).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /TẠO THƯỞNG/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /TẠO ỨNG LƯƠNG/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /XÁC NHẬN CHI/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /CHỐT SỔ/i })).toBeNull()
  })

  it('shows import history without voucher mutation controls', () => {
    renderPage(StoreImportsV2)

    expect(screen.getByText('Hàng mẫu')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /THÊM PHIẾU NHẬP/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Sửa PN-/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Xóa PN-/i })).toBeNull()
  })

  it('shows store settings as read-only', () => {
    renderPage(StoreSettings)

    const nameInput = screen.getByDisplayValue(store.name)
    expect(nameInput.readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: /Lưu thay đổi/i })).toBeNull()
    expect(screen.getByText(/không thể thay đổi cài đặt cửa hàng/i)).toBeTruthy()
  })

  it('never invokes a store mutation while rendering read-only views', () => {
    renderPage(StoreEmployees)
    mutationNames.forEach((name) => expect(mocked.app[name]).not.toHaveBeenCalled())
  })

  it('keeps store-manager operations available while orders remain read-only', () => {
    mocked.app.session = { role: 'store_manager', employeeId: 'QLCH-001', storeId: store.id }

    const employeeView = renderPage(StoreEmployees)
    expect(screen.getByRole('button', { name: /Thêm nhân viên/i })).toBeTruthy()
    employeeView.unmount()

    const scheduleView = renderPage(UnifiedSchedule)
    expect(screen.getByRole('button', { name: /Tạo ca làm việc/i })).toBeTruthy()
    scheduleView.unmount()

    const payrollView = renderPage(StorePayrollV2)
    expect(screen.getByRole('button', { name: /TẠO THƯỞNG/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^CHỐT SỔ$/i })).toBeTruthy()
    payrollView.unmount()

    const importView = renderPage(StoreImportsV2)
    expect(screen.getByRole('button', { name: /THÊM PHIẾU NHẬP/i })).toBeTruthy()
    importView.unmount()

    const settingsView = renderPage(StoreSettings)
    expect(screen.getByRole('button', { name: /Lưu thay đổi/i })).toBeTruthy()
    settingsView.unmount()

    renderPage(StoreOrdersPage)
    expect(screen.queryByRole('button', { name: /^Sửa$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Xóa$/i })).toBeNull()
  })
})
