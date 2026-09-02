import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EmployeeAttendancePage,
  EmployeeDashboardV2,
  EmployeeOrdersPage,
  EmployeePayrollDetails,
} from './EmployeeV2Pages'
import {
  checkoutReconciliation,
  effectiveEmployeeStoreId,
  employeeCreatedOrders,
  orderCreatedByEmployee,
  ordersForOpenAttendance,
  paymentChannel,
  shiftRevenueBreakdown,
  validateEmployeeOrder,
} from './employeeShiftOrders'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const chooseOccupation = async (label) => {
  const input = screen.getByRole('combobox', { name: 'Nghề nghiệp' })
  if (input.getAttribute('aria-expanded') !== 'true') fireEvent.click(input)
  fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm Nghề nghiệp' }), { target: { value: label } })
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

const choosePaymentMethod = (value = 'Tiền mặt') => {
  fireEvent.change(screen.getByLabelText(/^Hình thức thanh toán/u), { target: { value } })
}

describe('store employee current-shift orders', () => {
  it('keeps only the signed-in employee orders from the open shift', () => {
    const openRecord = { id: 'ATT-01', date: '2026-08-18', shiftId: 'CA-01' }
    const rows = ordersForOpenAttendance([
      { id: 'O1', employeeId: 'NV-01', attendanceId: 'ATT-01', createdAt: '2026-08-18T08:30:00+07:00' },
      { id: 'O2', employeeId: 'NV-01', shiftId: 'CA-01', createdAt: '2026-08-18T09:30:00+07:00' },
      { id: 'O3', employeeId: 'NV-02', attendanceId: 'ATT-01', createdAt: '2026-08-18T10:30:00+07:00' },
      { id: 'O4', employeeId: 'NV-01', shiftId: 'CA-02', createdAt: '2026-08-18T11:30:00+07:00' },
      { id: 'O5', employeeId: 'NV-01', shiftId: 'CA-01', createdAt: '2026-08-17T12:30:00+07:00' },
      { id: 'O6', employeeId: 'NV-01', attendanceId: 'ATT-01', deletedAt: '2026-08-18T12:30:00+07:00' },
      { id: 'O7', employeeId: 'NV-01', attendanceId: 'ATT-OTHER', shiftId: 'CA-01', createdAt: '2026-08-18T13:30:00+07:00' },
      { id: 'O8', employeeId: 'NV-01', createdByEmployeeId: 'NV-02', attendanceId: 'ATT-01', createdAt: '2026-08-18T14:30:00+07:00' },
    ], 'NV-01', openRecord)

    expect(rows.map((row) => row.id)).toEqual(['O2', 'O1'])
  })

  it('returns no rows before the employee checks in', () => {
    expect(ordersForOpenAttendance([{ id: 'O1' }], 'NV-01', null)).toEqual([])
  })

  it('keeps legacy same-day orders compatible when neither record has a shift id', () => {
    const openRecord = { id: 'ATT-LEGACY', date: '2026-08-18' }
    const rows = ordersForOpenAttendance([{
      id: 'O-LEGACY', employeeId: 'nv-01', createdAt: '2026-08-18T09:30:00+07:00',
    }], 'NV-01', openRecord)

    expect(rows.map((row) => row.id)).toEqual(['O-LEGACY'])
  })

  it('does not attach an order to the wrong attendance when ids differ only by case', () => {
    const upper = { id: 'ATT-X', date: '2026-08-18', shiftId: 'CA-01' }
    const lower = { id: 'att-x', date: '2026-08-18', shiftId: 'CA-01' }
    const orders = [{
      id: 'O-LOWER', employeeId: 'NV-01', attendanceId: 'att-x', createdAt: '2026-08-18T09:30:00+07:00',
    }]

    expect(ordersForOpenAttendance(orders, 'NV-01', upper, [upper, lower])).toEqual([])
    expect(ordersForOpenAttendance(orders, 'NV-01', lower, [upper, lower]).map((row) => row.id)).toEqual(['O-LOWER'])
  })

  it('uses the exact order creator and keeps legacy employee orders compatible', () => {
    const rows = employeeCreatedOrders([
      { id: 'OWN', employeeId: 'NV-01', createdByEmployeeId: 'NV-01', storeId: 'S01' },
      { id: 'COWORKER', employeeId: 'NV-02', createdByEmployeeId: 'NV-02', storeId: 'S01' },
      { id: 'ASSIGNED', employeeId: 'NV-01', createdByEmployeeId: 'NV-02', storeId: 'S01' },
      { id: 'ADMIN', employeeId: 'NV-01', createdBy: { role: 'admin' }, storeId: 'S01' },
      { id: 'LEGACY', employeeId: 'NV-01', storeId: 'S01' },
    ], 'NV-01', 'S01')

    expect(rows.map(({ id }) => id)).toEqual(['OWN', 'LEGACY'])
    expect(orderCreatedByEmployee({ employeeId: 'NV-02', updatedBy: { employeeId: 'NV-01' } }, 'NV-01')).toBe(false)
    expect(effectiveEmployeeStoreId({ storeId: 'S02' }, { storeId: 'S01' })).toBe('S02')
  })

  it('keeps case-colliding employee and store order records isolated with exact precedence', () => {
    const employees = [{ id: 'NV-01' }, { id: 'nv-01' }]
    const stores = [{ id: 'S01' }, { id: 's01' }]
    const rows = employeeCreatedOrders([
      { id: 'EXACT', createdByEmployeeId: 'NV-01', storeId: 'S01' },
      { id: 'OTHER-EMPLOYEE', createdByEmployeeId: 'nv-01', storeId: 'S01' },
      { id: 'OTHER-STORE', createdByEmployeeId: 'NV-01', storeId: 's01' },
    ], 'NV-01', 'S01', { employees, stores })

    expect(rows.map(({ id }) => id)).toEqual(['EXACT'])
    expect(orderCreatedByEmployee(
      { createdByEmployeeId: 'Nv-01' },
      'Nv-01',
      employees,
    )).toBe(false)
  })

  it('keeps an order on the exact shift when shift identifiers collide by case', () => {
    const openRecord = {
      id: 'ATT-UPPER-SHIFT', employeeId: 'NV-01', storeId: 'S01',
      date: '2026-08-18', shiftId: 'MORNING',
    }
    const rows = ordersForOpenAttendance([{
      id: 'EXACT-SHIFT', employeeId: 'NV-01', storeId: 'S01', shiftId: 'MORNING',
      createdAt: '2026-08-18T09:00:00+07:00',
    }, {
      id: 'OTHER-SHIFT', employeeId: 'NV-01', storeId: 'S01', shiftId: 'morning',
      createdAt: '2026-08-18T09:05:00+07:00',
    }], 'NV-01', openRecord, [openRecord], {
      employees: [{ id: 'NV-01' }],
      stores: [{ id: 'S01' }],
      shiftDefinitions: [{ id: 'MORNING' }, { id: 'morning' }],
    })

    expect(rows.map(({ id }) => id)).toEqual(['EXACT-SHIFT'])
  })

  it('keeps support-shift orders when the synthetic attendance shift is not a stored definition', () => {
    const openRecord = {
      id: 'ATT-SUPPORT', employeeId: 'NV-01', storeId: 'S02',
      date: '2026-08-18', shiftId: 'SUPPORT_TRANSFER_TR-01',
    }
    const rows = ordersForOpenAttendance([{
      id: 'ORDER-SUPPORT', employeeId: 'NV-01', createdByEmployeeId: 'NV-01', storeId: 'S02',
      attendanceId: 'ATT-SUPPORT', shiftId: 'SUPPORT_TRANSFER_TR-01',
      createdAt: '2026-08-18T09:00:00+07:00',
    }], 'NV-01', openRecord, [openRecord], {
      employees: [{ id: 'NV-01' }],
      stores: [{ id: 'S01' }, { id: 'S02' }],
      shiftDefinitions: [{ id: 'CA-1', storeId: 'S02' }, { id: 'CA-2', storeId: 'S02' }],
    })

    expect(rows.map(({ id }) => id)).toEqual(['ORDER-SUPPORT'])
  })

  it('does not reveal a coworker order through an employee order deep link', () => {
    mocked.app = {
      currentEmployee: { id: 'E01', name: 'Nhân viên 01', storeId: 'S01' },
      stores: [{ id: 'S01', name: 'IDOSI S01' }],
      orders: [
        {
          id: 'ORDER-OWN', code: 'S01-OWN', storeId: 'S01', employeeId: 'E01', createdByEmployeeId: 'E01',
          attendanceId: 'ATT-E01', shiftId: 'CA-SAME', customerName: 'Khách của tôi', amount: 120_000,
          paymentMethod: 'Tiền mặt', status: 'Hoàn tất', createdAt: '2026-08-20T08:30:00+07:00',
        },
        {
          id: 'ORDER-COWORKER', code: 'S01-COWORKER', storeId: 'S01', employeeId: 'E02', createdByEmployeeId: 'E02',
          attendanceId: 'ATT-E02', shiftId: 'CA-SAME', customerName: 'Khách bí mật', amount: 980_000,
          paymentMethod: 'Chuyển khoản', status: 'Hoàn tất', createdAt: '2026-08-20T08:35:00+07:00',
        },
      ],
      attendance: [
        { id: 'ATT-E01', employeeId: 'E01', storeId: 'S01', shiftId: 'CA-SAME', shiftName: 'Ca chung', checkInAt: '2026-08-20T08:00:00+07:00' },
        { id: 'ATT-E02', employeeId: 'E02', storeId: 'S01', shiftId: 'CA-SAME', shiftName: 'Ca chung', checkInAt: '2026-08-20T08:00:00+07:00' },
      ],
      createOrder: vi.fn(),
      notify: vi.fn(),
    }

    render(createElement(MemoryRouter, {
      initialEntries: ['/employee/orders?store=S01&order=ORDER-COWORKER'],
    }, createElement(EmployeeOrdersPage)))

    expect(screen.getByText('S01-OWN')).toBeTruthy()
    expect(screen.getByText('Khách của tôi')).toBeTruthy()
    expect(screen.queryByText('S01-COWORKER')).toBeNull()
    expect(screen.queryByText('Khách bí mật')).toBeNull()
    expect(screen.getAllByText('120,000 đ')).toHaveLength(2)
    expect(screen.queryByText('980,000 đ')).toBeNull()
  })

  it('uses the exact signed-in employee id and does not mix a case-colliding order owner', () => {
    mocked.app = {
      session: { role: 'employee', employeeId: 'E01', storeId: 'S01' },
      currentEmployee: { id: 'E01', name: 'Nhân viên chữ hoa', storeId: 'S01' },
      employees: [
        { id: 'E01', name: 'Nhân viên chữ hoa', storeId: 'S01' },
        { id: 'e01', name: 'Nhân viên chữ thường', storeId: 'S01' },
      ],
      stores: [{ id: 'S01', name: 'IDOSI S01' }],
      orders: [{
        id: 'ORDER-UPPER', code: 'ORDER-UPPER', storeId: 'S01', employeeId: 'E01', createdByEmployeeId: 'E01',
        customerName: 'Khách đúng nhân viên', amount: 120_000, createdAt: '2026-08-20T08:30:00+07:00',
      }, {
        id: 'ORDER-LOWER', code: 'ORDER-LOWER', storeId: 'S01', employeeId: 'e01', createdByEmployeeId: 'e01',
        customerName: 'Khách nhân viên khác', amount: 900_000, createdAt: '2026-08-20T08:35:00+07:00',
      }],
      attendance: [],
      createOrder: vi.fn(),
      notify: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(EmployeeOrdersPage)))

    expect(screen.getByText('Khách đúng nhân viên')).toBeTruthy()
    expect(screen.queryByText('Khách nhân viên khác')).toBeNull()
  })

  it('uses the active support store for order history, attendance and new orders', async () => {
    const createOrder = vi.fn().mockResolvedValue({ ok: true, order: { id: 'ORDER-NEW' } })
    mocked.app = {
      session: {
        role: 'employee', employeeId: 'E01', storeId: 'S02', homeStoreId: 'S01', activeTransferId: 'TRANSFER-01',
      },
      currentEmployee: { id: 'E01', name: 'Nhân viên hỗ trợ', storeId: 'S01' },
      stores: [{ id: 'S01', name: 'Dosii TNV' }, { id: 'S02', name: 'Dosii KVC' }],
      orders: [
        {
          id: 'ORDER-HOME', code: 'S01-HOME', storeId: 'S01', employeeId: 'E01', createdByEmployeeId: 'E01',
          customerName: 'Khách cửa hàng chính', amount: 100_000, paymentMethod: 'Tiền mặt', createdAt: '2026-08-20T08:10:00+07:00',
        },
        {
          id: 'ORDER-SUPPORT', code: 'S02-OWN', storeId: 'S02', employeeId: 'E01', createdByEmployeeId: 'E01',
          customerName: 'Khách cửa hàng hỗ trợ', amount: 220_000, paymentMethod: 'Chuyển khoản', createdAt: '2026-08-20T14:15:00+07:00',
        },
        {
          id: 'ORDER-COWORKER-SUPPORT', code: 'S02-COWORKER', storeId: 'S02', employeeId: 'E02', createdByEmployeeId: 'E02',
          customerName: 'Khách của đồng nghiệp', amount: 330_000, paymentMethod: 'Tiền mặt', createdAt: '2026-08-20T14:20:00+07:00',
        },
      ],
      attendance: [
        { id: 'ATT-HOME', employeeId: 'E01', storeId: 'S01', shiftId: 'CA-HOME', shiftName: 'Ca cửa hàng chính', checkInAt: '2026-08-20T08:00:00+07:00' },
        { id: 'ATT-SUPPORT', employeeId: 'E01', storeId: 'S02', shiftId: 'CA-SUPPORT', shiftName: 'Ca hỗ trợ', checkInAt: '2026-08-20T14:00:00+07:00' },
      ],
      createOrder,
      notify: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(EmployeeOrdersPage)))

    expect(screen.getByText('S02-OWN')).toBeTruthy()
    expect(screen.getByText('Khách cửa hàng hỗ trợ')).toBeTruthy()
    expect(screen.queryByText('S01-HOME')).toBeNull()
    expect(screen.queryByText('S02-COWORKER')).toBeNull()
    expect(screen.getByText(/Mọi đơn hàng và doanh thu được ghi nhận cho Dosii KVC/u)).toBeTruthy()
    expect(screen.getByText('Ca hỗ trợ')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'TẠO ĐƠN HÀNG' }))
    await screen.findByRole('dialog')
    expect(screen.getByRole('heading', { name: 'Tạo đơn hàng • Dosii KVC' })).toBeTruthy()
    const occupationInput = screen.getByRole('combobox', { name: 'Nghề nghiệp' })
    fireEvent.click(occupationInput)
    expect(screen.getByRole('listbox', { name: 'Nghề nghiệp - danh sách' })).toBeTruthy()
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(expect.arrayContaining([
      'Nhân viên VP', 'Kỹ sư', 'Bác sĩ', 'Giáo viên', 'Học sinh/Sinh viên', 'Lao động', 'Nội trợ',
      'Buôn bán/kinh doanh', 'Tài xế', 'Giám đốc', 'Ca sỉ', 'Lao công', 'Bảo vệ', 'Công nhân', 'Khác',
    ]))
    fireEvent.change(screen.getByLabelText(/^Tên khách hàng/u), { target: { value: 'Khách hỗ trợ mới' } })
    fireEvent.change(screen.getByLabelText(/^Giới tính/u), { target: { value: 'Nữ' } })
    await chooseOccupation('Nhân viên VP')
    fireEvent.change(screen.getByLabelText(/^Biết qua kênh nào/u), { target: { value: 'Facebook' } })
    fireEvent.change(screen.getByLabelText(/^Số tiền/u), { target: { value: '35' } })
    choosePaymentMethod()
    fireEvent.click(screen.getByRole('button', { name: 'LƯU ĐƠN' }))

    await waitFor(() => expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'E01', storeId: 'S02', attendanceId: 'ATT-SUPPORT', shiftId: 'CA-SUPPORT', shiftName: 'Ca hỗ trợ',
      amount: 35,
    })))
  }, 10_000)

  it('reconciles checkout only with orders created by the signed-in employee', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T09:00:00.000Z')
    mocked.app = {
      session: { role: 'employee', employeeId: 'E01', storeId: 'S01', homeStoreId: 'S01' },
      currentEmployee: { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', employmentType: 'Full-Time' },
      stores: [{ id: 'S01', name: 'Dosii TNV' }],
      attendance: [{
        id: 'ATT-E01', employeeId: 'E01', storeId: 'S01', date: '2026-08-20',
        shiftId: 'CA-SAME', shiftName: 'Ca chung', shiftStart: '08:00', shiftEnd: '17:00',
        checkIn: '08:00', checkInAt: '2026-08-20T01:00:00.000Z',
      }],
      orders: [{
        id: 'ORDER-OWN', code: 'S01-OWN', storeId: 'S01', employeeId: 'E01',
        createdByEmployeeId: 'E01', attendanceId: 'ATT-E01', shiftId: 'CA-SAME',
        amount: 120_000, paymentMethod: 'Tiền mặt', status: 'Hoàn tất', createdAt: '2026-08-20T02:00:00.000Z',
      }, {
        id: 'ORDER-ADMIN-ASSIGNED', code: 'S01-ADMIN', storeId: 'S01', employeeId: 'E01',
        createdBy: { id: 'admin', role: 'admin' }, attendanceId: 'ATT-E01', shiftId: 'CA-SAME',
        amount: 900_000, paymentMethod: 'Chuyển khoản', status: 'Hoàn tất', createdAt: '2026-08-20T02:05:00.000Z',
      }],
      schedule: [], tasks: [], taskAssignmentHistory: [], shiftDefinitions: [], supportTransfers: [], policies: {},
      checkIn: vi.fn(), checkOut: vi.fn(), setTaskDone: vi.fn(), notify: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(EmployeeDashboardV2)))
    fireEvent.click(screen.getByRole('button', { name: 'KẾT CA' }))

    expect(screen.getByText('Theo đơn trong ca: 120,000 đ')).toBeTruthy()
    expect(screen.getByText('Theo đơn trong ca: 0 đ')).toBeTruthy()
    expect(screen.queryByText(/900,000 đ/u)).toBeNull()
  })

  it('warns about yesterday open shift and keeps new check-in unavailable until checkout', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-09-02T03:00:00.000Z')
    mocked.app = {
      session: { role: 'employee', employeeId: 'E01', storeId: 'S01', homeStoreId: 'S01' },
      currentEmployee: { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', employmentType: 'Full-Time' },
      employees: [{ id: 'E01', name: 'Nhân viên 01', storeId: 'S01', employmentType: 'Full-Time' }],
      stores: [{ id: 'S01', name: 'SM TNV' }],
      attendance: [{
        id: 'ATT-YESTERDAY', employeeId: 'E01', storeId: 'S01', date: '2026-09-01',
        shiftId: 'CA-SANG', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
        checkIn: '08:00', checkInAt: '2026-09-01T01:00:00.000Z',
      }],
      orders: [], schedule: [], tasks: [], taskAssignmentHistory: [], shiftDefinitions: [], supportTransfers: [], policies: {},
      checkIn: vi.fn(), checkOut: vi.fn(), setTaskDone: vi.fn(), notify: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(EmployeeDashboardV2)))

    expect(screen.getByRole('dialog', { name: 'CẢNH BÁO CHẤM CÔNG QUÁ HẠN' })).toBeTruthy()
    expect(screen.getByText('Bạn chưa bấm “Kết ca” ngày hôm qua')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ĐÃ HIỂU' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'KẾT CA' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'ĐIỂM DANH' })).toBeNull()
  })

  it('keeps checkout blocked until every fixed active-shift task is completed', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T09:00:00.000Z')
    mocked.app = {
      session: { role: 'employee', employeeId: 'E01', storeId: 'S01', homeStoreId: 'S01' },
      currentEmployee: { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', employmentType: 'Full-Time' },
      stores: [{ id: 'S01', name: 'Dosii TNV' }],
      attendance: [{
        id: 'ATT-E01', employeeId: 'E01', storeId: 'S01', date: '2026-08-20',
        shiftId: 'CA-SAME', shiftName: 'Ca chung', shiftStart: '08:00', shiftEnd: '17:00',
        checkIn: '08:00', checkInAt: '2026-08-20T01:00:00.000Z',
      }],
      orders: [], schedule: [], taskAssignmentHistory: [], shiftDefinitions: [], supportTransfers: [], policies: {},
      tasks: [{
        id: 'TASK-OPEN', storeId: 'S01', date: '2026-08-20', shiftId: 'CA-SAME',
        employeeIds: ['E01'], title: 'Kiểm tra quầy', catalogKind: 'FIXED_TASK', required: true, completedBy: {},
      }],
      checkIn: vi.fn(), checkOut: vi.fn(), setTaskDone: vi.fn(), notify: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(EmployeeDashboardV2)))
    fireEvent.click(screen.getByRole('button', { name: 'KẾT CA' }))
    fireEvent.change(screen.getByLabelText(/^Tiền mặt/u), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText(/^Chuyển khoản/u), { target: { value: '0' } })

    expect(screen.getByText(/Còn 1 công việc cố định chưa hoàn thành/u)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'XÁC NHẬN KẾT CA' }).disabled).toBe(true)
    expect(screen.queryByLabelText(/Lý do/u)).toBeNull()
  })

  it('shows reward money without making optional reward work block checkout or require a reason', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T09:00:00.000Z')
    mocked.app = {
      session: { role: 'employee', employeeId: 'E01', storeId: 'S01', homeStoreId: 'S01' },
      currentEmployee: { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', employmentType: 'Full-Time' },
      stores: [{ id: 'S01', name: 'Dosii TNV' }],
      attendance: [{
        id: 'ATT-E01', employeeId: 'E01', storeId: 'S01', date: '2026-08-20',
        shiftId: 'CA-SAME', shiftName: 'Ca chung', shiftStart: '08:00', shiftEnd: '17:00',
        checkIn: '08:00', checkInAt: '2026-08-20T01:00:00.000Z',
      }],
      orders: [], schedule: [], taskAssignmentHistory: [], shiftDefinitions: [], supportTransfers: [], policies: {},
      tasks: [{
        id: 'TASK-REWARD', storeId: 'S01', date: '2026-08-20', shiftId: 'CA-SAME',
        employeeIds: ['E01'], title: 'Quay clip sản phẩm', catalogKind: 'REWARD_TASK',
        required: false, rewardEligible: true, amountVnd: 50_000, completedBy: {},
      }],
      checkIn: vi.fn(), checkOut: vi.fn(), setTaskDone: vi.fn(), notify: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(EmployeeDashboardV2)))

    expect(screen.queryByText('Tùy chọn · Thưởng 50,000 đ')).toBeNull()
    expect(screen.getByRole('button', { name: 'Công việc tính thưởng' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'KẾT CA' }))
    fireEvent.change(screen.getByLabelText(/^Tiền mặt/u), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText(/^Chuyển khoản/u), { target: { value: '0' } })

    expect(screen.getByText(/bạn vẫn có thể kết ca và không cần nhập lý do/u)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'XÁC NHẬN KẾT CA' }).disabled).toBe(false)
    expect(screen.queryByLabelText(/Lý do/u)).toBeNull()
  })

  it('reconciles cash and transfer separately instead of only comparing the total', () => {
    const orders = [
      { amount: 130_000, paymentMethod: 'Tiền mặt' },
      { amount: 270_000, paymentMethod: 'Chuyển khoản' },
    ]

    expect(shiftRevenueBreakdown(orders)).toEqual({ cash: 130_000, transfer: 270_000, unknown: 0, total: 400_000 })
    expect(checkoutReconciliation({ orders, cashRevenue: 130_000, transferRevenue: 270_000 }).matches).toBe(true)
    expect(checkoutReconciliation({ orders, cashRevenue: 400_000, transferRevenue: 0 })).toMatchObject({
      cashMatches: false,
      transferMatches: false,
      matches: false,
    })
  })

  it('blocks reconciliation when an order uses an unsupported payment method', () => {
    expect(paymentChannel('bank_transfer')).toBe('transfer')
    expect(checkoutReconciliation({
      orders: [{ amount: 50_000, paymentMethod: 'Voucher' }],
      cashRevenue: 0,
      transferRevenue: 0,
    }).matches).toBe(false)
  })

  it('requires demographics and acquisition channel on employee orders', () => {
    expect(validateEmployeeOrder({
      customerName: 'Khách A',
      amount: 159_000,
      gender: 'Nữ',
      occupation: 'Nhân viên VP',
      acquisitionChannel: 'Tiktok',
      paymentMethod: 'Tiền mặt',
    })).toEqual({})

    expect(validateEmployeeOrder({
      customerName: 'Khách A',
      amount: 159_000,
      gender: 'Nữ',
      occupation: 'Kế toán',
      acquisitionChannel: 'Tiktok',
      paymentMethod: 'Tiền mặt',
    }).occupation).toBe('Vui lòng chọn nghề nghiệp trong danh sách.')

    expect(Object.keys(validateEmployeeOrder({ customerName: 'Khách A', amount: 159_000 }))).toEqual([
      'gender',
      'occupation',
      'acquisitionChannel',
      'paymentMethod',
    ])
  })

  it('reuses the order idempotency key after a lost response and rotates it when the draft changes', async () => {
    const createOrder = vi.fn().mockResolvedValue({ ok: false, message: 'Mất phản hồi' })
    mocked.app = {
      currentEmployee: { id: 'E01', name: 'Nhân viên 01', storeId: 'S01' },
      stores: [{ id: 'S01', name: 'IDOSI S01' }],
      orders: [],
      attendance: [{ id: 'ATT-01', employeeId: 'E01', storeId: 'S01', shiftId: 'CA-01', shiftName: 'Ca sáng', checkInAt: '2026-08-18T08:00:00+07:00' }],
      createOrder,
      notify: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(EmployeeOrdersPage)))
    fireEvent.click(screen.getByRole('button', { name: 'TẠO ĐƠN HÀNG' }))
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText(/^Tên khách hàng/), { target: { value: 'Khách A' } })
    fireEvent.change(screen.getByLabelText(/^Giới tính/), { target: { value: 'Nữ' } })
    await chooseOccupation('Nhân viên VP')
    fireEvent.change(screen.getByLabelText(/^Biết qua kênh nào/), { target: { value: 'Facebook' } })
    fireEvent.change(screen.getByLabelText(/^Số tiền/), { target: { value: '159' } })
    choosePaymentMethod()

    fireEvent.click(screen.getByRole('button', { name: 'LƯU ĐƠN' }))
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'LƯU ĐƠN' }))
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2))

    const firstKey = createOrder.mock.calls[0][0].idempotencyKey
    expect(firstKey).toBeTruthy()
    expect(createOrder.mock.calls[1][0].idempotencyKey).toBe(firstKey)

    await chooseOccupation('Kỹ sư')
    fireEvent.click(screen.getByRole('button', { name: 'LƯU ĐƠN' }))
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(3))
    expect(createOrder.mock.calls[2][0].idempotencyKey).not.toBe(firstKey)
  })

  it('keeps task mutations out of the overview even for a legacy assignment deep link', () => {
    mocked.app = {
      currentEmployee: { id: 'E01', name: 'Nhân viên 01', storeId: 'S01' },
      stores: [{ id: 'S01', name: 'IDOSI S01' }],
      attendance: [],
      orders: [],
      schedule: [],
      policies: {},
      shiftDefinitions: [{ id: 'night', name: 'Ca tối', start: '17:00', end: '23:00' }],
      taskAssignmentHistory: [{
        id: 'TAS-FUTURE',
        storeId: 'S01',
        date: '2026-08-20',
        shiftId: 'night',
        employeeIds: ['E01', 'E02'],
        createdAt: '2026-08-18T10:00:00+07:00',
        createdBy: { displayName: 'Quản lý A' },
      }],
      tasks: [
        { id: 'OWN', assignmentId: 'TAS-FUTURE', storeId: 'S01', date: '2026-08-20', shiftId: 'night', employeeIds: ['E01'], title: 'Kiểm tra tồn kho' },
        { id: 'OTHER', assignmentId: 'TAS-FUTURE', storeId: 'S01', date: '2026-08-20', shiftId: 'night', employeeIds: ['E02'], title: 'Công việc bí mật' },
      ],
      checkIn: vi.fn(),
      checkOut: vi.fn(),
      setTaskDone: vi.fn(),
      notify: vi.fn(),
    }

    render(createElement(MemoryRouter, { initialEntries: ['/employee/home?assignment=TAS-FUTURE'] }, createElement(EmployeeDashboardV2)))

    expect(screen.queryByRole('heading', { name: 'CÔNG VIỆC TỪ THÔNG BÁO' })).toBeNull()
    expect(screen.queryByText('Kiểm tra tồn kho')).toBeNull()
    expect(screen.queryByText('Công việc bí mật')).toBeNull()
    expect(screen.getByRole('button', { name: 'Công việc được giao' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Công việc tính thưởng' })).toBeTruthy()
    expect(mocked.app.setTaskDone).not.toHaveBeenCalled()
  })

  it('shows the effective support store, home store and transfer compensation without requiring a schedule', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T07:00:00.000Z')
    mocked.app = {
      session: { role: 'employee', employeeId: 'E01', storeId: 'S02', homeStoreId: 'S01', activeTransferId: 'TR-01' },
      currentEmployee: { id: 'E01', name: 'Nhân viên hỗ trợ', storeId: 'S01', employmentType: 'Full-Time' },
      stores: [{ id: 'S01', name: 'Dosii TNV' }, { id: 'S02', name: 'Dosii KVC' }],
      supportTransfers: [{
        id: 'TR-01', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        fromDate: '2026-08-01', toDate: '2026-08-31', hourlySupportRate: 45_000, allowance: 180_000,
        status: 'Đã duyệt',
      }],
      attendance: [],
      orders: [],
      schedule: [{ id: 'HOME-SCHEDULE', employeeId: 'E01', storeId: 'S01', date: '2026-08-20', shiftId: 'HOME-SHIFT' }],
      tasks: [],
      taskAssignmentHistory: [],
      shiftDefinitions: [{ id: 'HOME-SHIFT', storeId: 'S01', name: 'Ca cửa hàng chính', start: '08:00', end: '17:00' }],
      policies: {},
      checkIn: vi.fn(),
      checkOut: vi.fn(),
      setTaskDone: vi.fn(),
      notify: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(EmployeeDashboardV2)))

    expect(screen.getAllByText('Dosii KVC').length).toBeGreaterThan(0)
    expect(screen.getByText(/NV hỗ trợ từ Dosii TNV/i)).toBeTruthy()
    expect(screen.getByText('45,000 đ/giờ')).toBeTruthy()
    expect(screen.getByText('180,000 đ')).toBeTruthy()
    expect(screen.getAllByText('Ca hỗ trợ cửa hàng').length).toBeGreaterThan(0)
    expect(screen.queryByText('Ca cửa hàng chính')).toBeNull()
    expect(screen.getByRole('button', { name: 'ĐIỂM DANH' })).toBeTruthy()
  })

  it('allows attendance-route check-in for an active transfer without a schedule', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T07:00:00.000Z')
    mocked.app = {
      session: { role: 'employee', employeeId: 'E01', storeId: 'S02', homeStoreId: 'S01', activeTransferId: 'TR-ATTENDANCE' },
      currentEmployee: { id: 'E01', name: 'Nhân viên hỗ trợ', storeId: 'S01', employmentType: 'Part-Time' },
      stores: [{ id: 'S01', name: 'Dosii TNV' }, { id: 'S02', name: 'Dosii KVC' }],
      supportTransfers: [{
        id: 'TR-ATTENDANCE', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        // A full VN-day window keeps this UI test independent from the host
        // process timezone while still exercising an active transfer shift.
        startAt: '2026-08-20T00:00:00.000Z', endAt: '2026-08-20T14:00:00.000Z',
        hourlySupportRate: 45_000, allowance: 180_000, status: 'Đã duyệt',
      }],
      attendance: [], orders: [], schedule: [], tasks: [], taskAssignmentHistory: [], shiftDefinitions: [],
      policies: { earlyCheckInLimitMinutes: 120 }, checkIn: vi.fn(), notify: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(EmployeeAttendancePage)))
    expect(screen.getByText('1 ca có thể điểm danh')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ĐIỂM DANH' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Ca hỗ trợ cửa hàng')).toBeTruthy()
    expect(mocked.app.notify).not.toHaveBeenCalled()
  })

  it('keeps an expired destination attendance visible only for checkout settlement', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-20T14:00:01.000Z')
    mocked.app = {
      session: { role: 'employee', employeeId: 'E01', storeId: 'S01', homeStoreId: 'S01' },
      currentEmployee: { id: 'E01', name: 'Nhân viên hỗ trợ', storeId: 'S01', employmentType: 'Full-Time' },
      stores: [{ id: 'S01', name: 'Dosii TNV' }, { id: 'S02', name: 'Dosii KVC' }],
      supportTransfers: [{
        id: 'TR-EXPIRED', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-20T07:00:00.000Z', endAt: '2026-08-20T14:00:00.000Z',
        fromDate: '2026-08-20', toDate: '2026-08-20', hourlySupportRate: 45_000, allowance: 180_000,
        status: 'Đã duyệt',
      }],
      attendance: [{
        id: 'ATT-DESTINATION', employeeId: 'E01', storeId: 'S02', supportTransferId: 'TR-EXPIRED',
        date: '2026-08-20', shiftId: 'SUPPORT_TRANSFER_TR-EXPIRED', shiftName: 'Ca hỗ trợ cửa hàng',
        shiftStart: '14:00', shiftEnd: '21:00', checkIn: '14:00', checkInAt: '2026-08-20T07:00:00.000Z',
      }],
      orders: [], schedule: [], tasks: [], taskAssignmentHistory: [], shiftDefinitions: [], policies: {},
      checkIn: vi.fn(), checkOut: vi.fn(), setTaskDone: vi.fn(), notify: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(EmployeeDashboardV2)))

    expect(screen.getAllByText('Dosii KVC').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'KẾT CA' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'ĐIỂM DANH' })).toBeNull()
    expect(screen.getByText('20/08/2026 14:00 – 20/08/2026 21:00')).toBeTruthy()
    expect(screen.getByText(/NV hỗ trợ từ Dosii TNV/i)).toBeTruthy()
  })

  it('shows support-store notes and canonical actual pay in the employee work history', () => {
    mocked.app = {
      session: { role: 'employee', employeeId: 'E01', storeId: 'S01', homeStoreId: 'S01' },
      currentEmployee: { id: 'E01', name: 'Nhân viên 01', storeId: 'S01', employmentType: 'Full-Time' },
      stores: [{ id: 'S01', name: 'Dosii TNV' }, { id: 'S02', name: 'Dosii KVC' }],
      supportTransfers: [{
        id: 'TR-01', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02',
        startAt: '2026-08-20T14:00:00+07:00', endAt: '2026-08-20T21:00:00+07:00',
        hourlySupportRate: 29_000, allowance: 50_000, status: 'Đã duyệt',
      }],
      attendance: [{
        id: 'ATT-HOME', employeeId: 'E01', storeId: 'S01', date: '2026-08-19',
        shiftName: 'Ca cửa hàng chính', shiftStart: '08:00', shiftEnd: '17:00',
        checkIn: '08:00', checkOut: '17:00', hours: 8, arrivalTag: 'Đi đúng giờ',
      }, {
        id: 'ATT-SUPPORT', employeeId: 'E01', storeId: 'S02', date: '2026-08-20',
        supportTransferId: 'TR-01', shiftName: 'Ca hỗ trợ', shiftStart: '14:00', shiftEnd: '21:00',
        checkIn: '14:00', checkOut: '17:00', hours: 3, arrivalTag: 'Đi đúng giờ',
        supportCompensation: {
          transferId: 'TR-01', supportStoreId: 'S02', transferStartAt: '2026-08-20T14:00:00+07:00',
          transferEndAt: '2026-08-20T21:00:00+07:00', hourlyRate: 29_000, hours: 3,
          basePay: 87_000, allowance: 50_000, allowanceApplied: true, totalPay: 137_000,
        },
      }],
      orders: [], policies: {}, checkIn: vi.fn(), notify: vi.fn(),
    }

    render(createElement(MemoryRouter, null, createElement(EmployeeAttendancePage)))

    expect(screen.getByText('Ca cửa hàng chính')).toBeTruthy()
    expect(screen.getByText('Ca hỗ trợ • Dosii KVC')).toBeTruthy()
    expect(screen.getByText('20/08/2026 14:00 – 20/08/2026 21:00')).toBeTruthy()
    expect(screen.getByText('3.00 giờ × 29,000 đ + 50,000 đ')).toBeTruthy()
    expect(screen.getByText('137,000 đ')).toBeTruthy()
  })

  it('combines locked home and support payroll snapshots and keeps support detail attribution', () => {
    mocked.app = {
      currentEmployee: {
        id: 'EMP-DB-01', code: 'E01', name: 'Nhân viên 01', storeId: 'S01', employmentType: 'Full-Time',
        baseSalary: 4_000_000, requiredMonthlyHours: 176,
      },
      employees: [{ id: 'EMP-DB-01', code: 'E01', name: 'Nhân viên 01', storeId: 'S01' }],
      stores: [{ id: 'S01', name: 'Dosii TNV' }, { id: 'S02', name: 'Dosii KVC' }],
      attendance: [], supportTransfers: [], salaryAdjustments: [], salaryAdvances: [],
      storeEmployeeSalaryConfigs: [{
        id: 'CFG-UPPER', employeeId: 'E01', storeId: 'S01', effectiveFrom: '2026-08',
        thresholdHours: 208, standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000,
      }, {
        id: 'CFG-LOWER', employeeId: 'e01', storeId: 's01', effectiveFrom: '2026-08',
        thresholdHours: 208, standardHourlyRateVnd: 99_000, excessHourlyRateVnd: 98_000,
      }],
      payrollPeriods: [{
        id: 'PAY-HOME', storeId: 'S01', period: '2026-08', status: 'Đã khóa',
        lockedAt: '2026-09-01T08:00:00+07:00',
        rows: [{
          employeeId: 'E01', baseSalary: 4_000_000, kpiBonus: 200_000,
          gross: 4_200_000, advancesPaid: 500_000, remaining: 3_700_000,
        }],
      }, {
        id: 'PAY-SUPPORT', storeId: 'S02', period: '2026-08', status: 'Đã khóa',
        lockedAt: '2026-09-01T08:05:00+07:00',
        rows: [{
          employeeId: 'E01', baseSalary: 87_000, gross: 137_000, remaining: 137_000,
          supportCompensation: { hours: 3, basePay: 87_000, allowance: 50_000, totalPay: 137_000 },
          supportDetails: [{
            transferId: 'TR-01', supportStoreId: 'S02', startAt: '2026-08-20T14:00:00+07:00',
            endAt: '2026-08-20T21:00:00+07:00', hours: 3, hourlyRate: 29_000,
            basePay: 87_000, allowance: 50_000, totalPay: 137_000, attendanceIds: ['ATT-SUPPORT'],
          }],
        }],
      }],
    }

    render(createElement(MemoryRouter, null, createElement(EmployeePayrollDetails)))

    expect(screen.getByText('3.00 giờ hỗ trợ • Gồm phụ cấp 50,000 đ')).toBeTruthy()
    expect(screen.getAllByText('137,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('3,637,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByText('Dosii KVC')).toBeTruthy()
    expect(screen.getByText('20/08/2026 14:00 – 20/08/2026 21:00')).toBeTruthy()
    expect(screen.getByText('1 ca đã chốt')).toBeTruthy()
  })

  it('fails closed with a visible warning when live salary config ids collide by case', () => {
    mocked.app = {
      currentEmployee: {
        id: 'E01', name: 'Nhân viên 01', storeId: 'S01', unit: 'store',
        employmentType: 'Full-Time', payBasis: 'tiered-hourly',
      },
      stores: [{ id: 'S01', name: 'Dosii TNV' }],
      attendance: [{ id: 'ATT-01', employeeId: 'e01', storeId: 's01', date: '2026-08-20', hours: 8 }],
      supportTransfers: [], salaryAdjustments: [], salaryAdvances: [], payrollPeriods: [],
      storeEmployeeSalaryConfigs: [{
        id: 'CFG-UPPER', employeeId: 'E01', storeId: 'S01', effectiveFrom: '2026-08',
        thresholdHours: 208, standardHourlyRateVnd: 30_000, excessHourlyRateVnd: 27_000,
      }, {
        id: 'CFG-LOWER', employeeId: 'e01', storeId: 's01', effectiveFrom: '2026-08',
        thresholdHours: 208, standardHourlyRateVnd: 99_000, excessHourlyRateVnd: 98_000,
      }],
    }

    render(createElement(MemoryRouter, null, createElement(EmployeePayrollDetails)))

    expect(screen.getByText(/Mã cấu hình lương đang trùng hoa\/thường/u)).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText('0 đ')).toBeNull()
  })

  it('adds live support compensation when only the home payroll snapshot is closed', () => {
    mocked.app = {
      currentEmployee: {
        id: 'E01', name: 'Nhân viên 01', storeId: 'S01', employmentType: 'Full-Time', baseSalary: 4_000_000,
      },
      stores: [{ id: 'S01', name: 'Dosii TNV' }],
      supportTransfers: [], salaryAdjustments: [], salaryAdvances: [],
      attendance: [{
        id: 'ATT-SUPPORT-LIVE', employeeId: 'E01', storeId: 'S02', date: '2026-08-20',
        supportTransferId: 'TR-LIVE', shiftStart: '14:00', shiftEnd: '21:00', hours: 3,
        supportCompensation: {
          transferId: 'TR-LIVE', supportStoreId: 'S02', supportStoreName: 'Dosii KVC',
          transferStartAt: '2026-08-20T14:00:00+07:00', transferEndAt: '2026-08-20T21:00:00+07:00',
          hours: 3, hourlyRate: 29_000, basePay: 87_000, allowance: 50_000,
          allowanceApplied: true, totalPay: 137_000,
        },
      }],
      payrollPeriods: [{
        id: 'PAY-HOME', storeId: 'S01', period: '2026-08', status: 'Đã khóa',
        rows: [{
          employeeId: 'E01', baseSalary: 4_000_000, kpiBonus: 200_000,
          gross: 4_200_000, advancesPaid: 500_000, remaining: 3_700_000,
        }],
      }],
    }

    render(createElement(MemoryRouter, null, createElement(EmployeePayrollDetails)))

    expect(screen.getByText('3.00 giờ hỗ trợ • Gồm phụ cấp 50,000 đ')).toBeTruthy()
    expect(screen.getAllByText('137,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('3,637,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByText('Dosii KVC')).toBeTruthy()
  })

  it('adds live home pay when only the destination payroll snapshot is closed without duplicating support', () => {
    mocked.app = {
      currentEmployee: {
        id: 'E01', name: 'Nhân viên 01', storeId: 'S01', employmentType: 'Part-Time',
        payBasis: 'hourly', hourlyRate: 25_000,
      },
      stores: [{ id: 'S01', name: 'Dosii TNV' }, { id: 'S02', name: 'Dosii KVC' }],
      supportTransfers: [], salaryAdjustments: [], salaryAdvances: [],
      attendance: [{
        id: 'ATT-HOME-LIVE', employeeId: 'E01', storeId: 'S01', date: '2026-08-19', hours: 4,
      }, {
        id: 'ATT-SUPPORT-CLOSED', employeeId: 'E01', storeId: 'S02', date: '2026-08-20',
        supportTransferId: 'TR-CLOSED', hours: 3,
        supportCompensation: {
          transferId: 'TR-CLOSED', supportStoreId: 'S02', supportStoreName: 'Dosii KVC',
          hours: 3, hourlyRate: 29_000, basePay: 87_000, allowance: 50_000,
          allowanceApplied: true, totalPay: 137_000,
        },
      }],
      payrollPeriods: [{
        id: 'PAY-SUPPORT', storeId: 'S02', period: '2026-08', status: 'Đã khóa',
        rows: [{
          employeeId: 'E01', baseSalary: 87_000, gross: 137_000, remaining: 137_000,
          supportCompensation: {
            hours: 3, basePay: 87_000, allowance: 50_000, totalPay: 137_000, transferIds: ['TR-CLOSED'],
          },
          supportDetails: [{
            transferId: 'TR-CLOSED', supportStoreId: 'S02', startAt: '2026-08-20T14:00:00+07:00',
            endAt: '2026-08-20T21:00:00+07:00', hours: 3, hourlyRate: 29_000,
            basePay: 87_000, allowance: 50_000, totalPay: 137_000, attendanceIds: ['ATT-SUPPORT-CLOSED'],
          }],
        }],
      }],
    }

    render(createElement(MemoryRouter, null, createElement(EmployeePayrollDetails)))

    expect(screen.getAllByText('100,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('137,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('237,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Dosii KVC')).toHaveLength(1)
  })
})
