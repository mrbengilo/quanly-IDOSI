import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  identityImages: {
    front: 'data:image/png;base64,store-front',
    back: 'data:image/png;base64,store-back',
  },
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
  'replaceScheduleDay',
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
    schedule: [{ id: 'LICH-001', storeId: store.id, employeeId: employee.id, date, shiftIds: [shift.id], shiftSnapshots: [shift], note: 'Lịch sáng', createdAt: `${date}T06:30:00+07:00` }],
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
      attendanceEvaluation: { improveMinLateCount: 3, improveMinLateMinutes: 30 },
    },
    getAvailableSalary: vi.fn(() => 0),
    notify: vi.fn(),
    ...mutations,
  }
}

const renderPage = (Page) => render(<MemoryRouter><Page /></MemoryRouter>)

describe('business-support store workspace permissions', () => {
  beforeEach(() => {
    mocked.app = makeApp()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('lets Business Support add and edit store employees while keeping delete Admin-only', () => {
    renderPage(StoreEmployees)

    expect(screen.getAllByText(employee.name).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Thêm nhân viên/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(`Sửa ${employee.name}`, 'i') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(`Xóa ${employee.name}`, 'i') })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Thêm nhân viên/i }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByDisplayValue('Nhân viên bán hàng').readOnly).toBe(true)
    expect(screen.getByLabelText('Mặt trước CCCD')).toBeTruthy()
    expect(screen.getByLabelText('Mặt sau CCCD')).toBeTruthy()
  })

  it('opens saved store-employee CCCD images in the stable document frame', () => {
    renderPage(StoreEmployees)

    const frontButton = screen.getByRole('button', { name: `Xem mặt trước CCCD của ${employee.name}` })
    expect(frontButton.closest('.identity-image-actions--stable')).toBeTruthy()
    fireEvent.click(frontButton)

    const image = screen.getByRole('img', { name: `${employee.name} · Mặt trước CCCD` })
    expect(image.classList.contains('identity-document-viewer__image')).toBe(true)
    expect(image.closest('.identity-document-viewer__frame')).toBeTruthy()
  })

  it('shows a transferred employee with full support assignment details at the destination store', () => {
    const supportEmployee = {
      id: 'DOSII-TNV-009', code: 'DOSII-TNV-009', name: 'Trần Minh Hỗ Trợ', unit: 'store', storeId: 'CH002',
      status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 35_000,
      phone: '0907654321', cccd: '079765432109', address: '12 Tô Ngọc Vân', position: 'Nhân viên bán hàng',
    }
    mocked.app.stores.push({ id: 'CH002', name: 'Dosii TNV', short: 'TNV' })
    mocked.app.employees.push(supportEmployee)
    mocked.app.supportTransfers = [{
      id: 'TRANSFER-001', employeeId: supportEmployee.id, fromStoreId: 'CH002', toStoreId: store.id,
      startAt: new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
      endAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      fromDate: today(), toDate: today(), hourlySupportRate: 45_000, allowance: 180_000, status: 'Đã duyệt',
    }]

    renderPage(StoreEmployees)

    expect(screen.getByText(supportEmployee.name)).toBeTruthy()
    expect(screen.getByText('Nhân viên hỗ trợ')).toBeTruthy()
    expect(screen.getByText(/Dosii TNV.*SecondMall SM234/i)).toBeTruthy()
    expect(screen.getByText(/45,000.*giờ.*180,000/i)).toBeTruthy()
    expect(screen.getByText(/Trạng thái: Đã duyệt/i)).toBeTruthy()
    expect(screen.getByText(supportEmployee.cccd)).toBeTruthy()
    expect(screen.getByText(supportEmployee.phone)).toBeTruthy()
    expect(screen.getByText(supportEmployee.address)).toBeTruthy()
  })

  it('adds and removes a destination support employee at the exact time boundaries without reload', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T06:59:59.000Z')
    const supportEmployee = {
      id: 'DOSII-TNV-010', code: 'DOSII-TNV-010', name: 'Nhân viên Biên Giới', unit: 'store', storeId: 'CH002',
      status: 'Đang làm việc', employmentType: 'Part-Time', phone: '0907000010', cccd: '079700000010',
    }
    mocked.app.stores.push({ id: 'CH002', name: 'Dosii TNV', short: 'TNV' })
    mocked.app.employees.push(supportEmployee)
    mocked.app.supportTransfers = [{
      id: 'TRANSFER-BOUNDARY', employeeId: supportEmployee.id, fromStoreId: 'CH002', toStoreId: store.id,
      startAt: '2026-08-20T07:00:00.000Z', endAt: '2026-08-20T08:00:00.000Z',
      hourlySupportRate: 45_000, allowance: 180_000, status: 'Đã duyệt',
    }]

    renderPage(StoreEmployees)
    expect(screen.queryByText(supportEmployee.name)).toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByText(supportEmployee.name)).toBeTruthy()

    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60 * 1_000) })
    expect(screen.queryByText(supportEmployee.name)).toBeNull()
  })

  it('lets Business Support assign store work and manage schedules', () => {
    const taskView = renderPage(StoreTasks)
    expect(screen.getAllByText(/Kiểm kê quầy/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /^GỬI$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Thêm công việc/i })).toBeTruthy()
    expect(screen.getByLabelText(`Chọn nhân viên ${employee.name}`)).toBeTruthy()
    taskView.unmount()

    renderPage(UnifiedSchedule)
    expect(screen.getAllByText('Ca sáng').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Tạo ca/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Sửa Ca sáng/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Xóa Ca sáng/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^LƯU$/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^PHÂN CA$/i }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText('Ngày tạo lịch phân ca')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Chọn Ca sáng 08:00 - 12:00/i })).toBeTruthy()
    expect(screen.getByLabelText(`Chọn nhân viên ${employee.name}`)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^LƯU$/i })).toBeTruthy()
  })

  it('opens the assignment flow only from its button and saves fields in the required order', async () => {
    mocked.app.saveScheduleMultiple.mockResolvedValue({ ok: true })
    renderPage(UnifiedSchedule)

    expect(screen.queryByText('1. Chọn ngày')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^PHÂN CA$/i }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Chọn Ca sáng 08:00 - 12:00/i }))
    fireEvent.click(within(dialog).getByLabelText(`Chọn nhân viên ${employee.name}`))
    fireEvent.change(within(dialog).getByPlaceholderText('Ghi chú cho lịch phân ca...'), { target: { value: 'Ưu tiên quầy chính' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /^LƯU$/i }))

    await waitFor(() => expect(mocked.app.saveScheduleMultiple).toHaveBeenCalledWith(
      [employee.id],
      ['CA-SANG'],
      { date: today(), note: 'Ưu tiên quầy chính', storeId: store.id },
    ))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it.each([
    ['admin', { role: 'admin', employeeId: 'ADMIN' }],
    ['business_support', { role: 'business_support', employeeId: 'HTKD-001' }],
    ['store_manager', { role: 'store_manager', employeeId: 'QLCH-001', storeId: store.id }],
  ])('allows %s to create, edit, and delete shifts and schedules', (_role, session) => {
    mocked.app.session = session
    renderPage(UnifiedSchedule)

    expect(screen.getByRole('button', { name: /^PHÂN CA$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sửa Ca sáng/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Xóa Ca sáng/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sửa lịch Ca sáng/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Xóa lịch Ca sáng/i })).toBeTruthy()
  })

  it('edits and deletes a created schedule from the daily schedule list', async () => {
    mocked.app.replaceScheduleDay.mockResolvedValue({ ok: true })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPage(UnifiedSchedule)
    fireEvent.click(screen.getByRole('button', { name: /Sửa lịch Ca sáng/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(screen.getByLabelText(`Chọn ${employee.name} cho Ca sáng`).checked).toBe(true)
    fireEvent.change(within(dialog).getByPlaceholderText('Ghi chú cho lịch phân ca...'), { target: { value: 'Lịch đã sửa' } })
    fireEvent.click(screen.getByRole('button', { name: /LƯU LỊCH/i }))

    await waitFor(() => expect(mocked.app.replaceScheduleDay).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'LICH-001', employeeId: employee.id, shiftIds: ['CA-SANG'], note: 'Lịch đã sửa' }),
    ], { storeId: store.id, date: today() }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    mocked.app.replaceScheduleDay.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Xóa lịch Ca sáng/i }))
    await waitFor(() => expect(mocked.app.replaceScheduleDay).toHaveBeenCalledWith([], { storeId: store.id, date: today() }))
    expect(confirm).toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('allows order correction, cashflow, and payroll operations', () => {
    const orderView = renderPage(StoreOrdersPage)
    expect(screen.getByText('DH-001')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Sửa$/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /^Xóa$/i }).length).toBeGreaterThan(0)
    orderView.unmount()

    const cashflowView = renderPage(StoreCashflowV2)
    expect(screen.getByRole('heading', { name: 'DÒNG TIỀN CỬA HÀNG' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /NHẬP CHI PHÍ CỐ ĐỊNH/i })).toBeTruthy()
    cashflowView.unmount()

    renderPage(StorePayrollV2)
    expect(screen.getAllByText(employee.name).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /TẠO THƯỞNG/i })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /TẠO ỨNG LƯƠNG/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /^XÁC NHẬN CHI$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^CHỐT SỔ$/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /KHÓA KỲ CHI LƯƠNG THƯỞNG/i })).toBeNull()
  })

  it('allows voucher mutations from import history', () => {
    renderPage(StoreImportsV2)

    expect(screen.getByText('Hàng mẫu')).toBeTruthy()
    expect(screen.getByRole('button', { name: /THÊM PHIẾU NHẬP/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sửa PN-/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Xóa PN-/i })).toBeTruthy()
  })

  it('allows Business Support to update store settings', () => {
    renderPage(StoreSettings)

    const nameInput = screen.getByDisplayValue(store.name)
    expect(nameInput.readOnly).toBe(false)
    expect(screen.getByRole('button', { name: /Lưu thay đổi/i })).toBeTruthy()
  })

  it('never invokes a store mutation while rendering read-only views', () => {
    renderPage(StoreEmployees)
    mutationNames.forEach((name) => expect(mocked.app[name]).not.toHaveBeenCalled())
  })

  it('keeps store-manager operational tools while payroll and orders remain read-only', () => {
    mocked.app.session = { role: 'store_manager', employeeId: 'QLCH-001', storeId: store.id }

    const employeeView = renderPage(StoreEmployees)
    expect(screen.getByRole('button', { name: /Thêm nhân viên/i })).toBeTruthy()
    employeeView.unmount()

    const scheduleView = renderPage(UnifiedSchedule)
    expect(screen.getByRole('button', { name: /Tạo ca làm việc/i })).toBeTruthy()
    scheduleView.unmount()

    const payrollView = renderPage(StorePayrollV2)
    expect(screen.getByText(/Quản lý cửa hàng chỉ xem số liệu cửa hàng mình/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /TẠO THƯỞNG/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /TẠO ỨNG LƯƠNG/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^XÁC NHẬN CHI$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^CHỐT SỔ$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /KHÓA KỲ CHI LƯƠNG THƯỞNG/i })).toBeNull()
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

  it('reserves payroll-period locking for Admin', () => {
    mocked.app.session = { role: 'admin', employeeId: 'ADMIN' }
    renderPage(StorePayrollV2)

    expect(screen.getByRole('button', { name: /KHÓA KỲ CHI LƯƠNG THƯỞNG/i })).toBeTruthy()
  })

  it('persists store operating hours from the server response', async () => {
    mocked.app.session = { role: 'admin', employeeId: 'ADMIN' }
    mocked.app.updateStore.mockResolvedValue({
      ok: true,
      store: { ...store, opening: '09:00', openingTime: '09:00', closing: '21:30', closingTime: '21:30' },
    })

    renderPage(StoreSettings)
    fireEvent.click(screen.getByRole('button', { name: /Giờ hoạt động/i }))
    fireEvent.change(screen.getByLabelText(/Giờ mở cửa/i), { target: { value: '09:00' } })
    fireEvent.change(screen.getByLabelText(/Giờ đóng cửa/i), { target: { value: '21:30' } })
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/i }))

    await waitFor(() => expect(mocked.app.updateStore).toHaveBeenCalledWith(store.id, expect.objectContaining({
      opening: '09:00',
      openingTime: '09:00',
      closing: '21:30',
      closingTime: '21:30',
    })))
    expect((await screen.findByRole('status')).textContent).toMatch(/Đã đồng bộ lúc/i)
  })
})
