import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmployeeDashboardV2, EmployeeOrdersPage } from './EmployeeV2Pages'
import {
  checkoutReconciliation,
  ordersForOpenAttendance,
  paymentChannel,
  shiftRevenueBreakdown,
  validateEmployeeOrder,
} from './employeeShiftOrders'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

afterEach(cleanup)

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
    ], 'NV-01', openRecord)

    expect(rows.map((row) => row.id)).toEqual(['O2', 'O1'])
  })

  it('returns no rows before the employee checks in', () => {
    expect(ordersForOpenAttendance([{ id: 'O1' }], 'NV-01', null)).toEqual([])
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
      occupation: 'Nhân viên văn phòng',
      acquisitionChannel: 'Tiktok',
    })).toEqual({})

    expect(Object.keys(validateEmployeeOrder({ customerName: 'Khách A', amount: 159_000 }))).toEqual([
      'gender',
      'occupation',
      'acquisitionChannel',
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
    fireEvent.change(screen.getByLabelText(/^Nghề nghiệp/), { target: { value: 'Kế toán' } })
    fireEvent.change(screen.getByLabelText(/^Biết qua kênh nào/), { target: { value: 'Facebook' } })
    fireEvent.change(screen.getByLabelText(/^Số tiền/), { target: { value: '159,000' } })

    fireEvent.click(screen.getByRole('button', { name: 'LƯU ĐƠN' }))
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'LƯU ĐƠN' }))
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2))

    const firstKey = createOrder.mock.calls[0][0].idempotencyKey
    expect(firstKey).toBeTruthy()
    expect(createOrder.mock.calls[1][0].idempotencyKey).toBe(firstKey)

    fireEvent.change(screen.getByLabelText(/^Nghề nghiệp/), { target: { value: 'Marketing' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU ĐƠN' }))
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(3))
    expect(createOrder.mock.calls[2][0].idempotencyKey).not.toBe(firstKey)
  })

  it('opens a future assignment deep link without exposing another employee task', () => {
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

    expect(screen.getByRole('heading', { name: 'CÔNG VIỆC TỪ THÔNG BÁO' })).toBeTruthy()
    expect(screen.getByText('Kiểm tra tồn kho')).toBeTruthy()
    expect(screen.queryByText('Công việc bí mật')).toBeNull()
    expect(screen.getByRole('button', { name: /Chờ điểm danh đúng ca để cập nhật Kiểm tra tồn kho/i }).disabled).toBe(true)
    expect(screen.getByText(/Người giao: Quản lý A/i)).toBeTruthy()
  })

  it('shows the effective support store, home store and transfer compensation without requiring a schedule', () => {
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
      schedule: [],
      tasks: [],
      taskAssignmentHistory: [],
      shiftDefinitions: [],
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
    expect(screen.getByRole('button', { name: 'ĐIỂM DANH' })).toBeTruthy()
  })
})
