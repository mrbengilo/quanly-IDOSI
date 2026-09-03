import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeeOrdersPage } from './EmployeeV2Pages'
import { EmployeeAssignedTasksPage } from './EmployeeShiftOperations'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const employee = {
  id: 'E01', code: 'E01', employeeCode: 'E01', name: 'Nhân viên A',
  storeId: 'STORE-B', unit: 'store',
}

const openSupportAttendance = {
  id: 'ATT-SUPPORT-OPEN', employeeId: 'E01', storeId: 'STORE-C',
  supportTransferId: 'TRANSFER-BC-01', date: '2026-09-03',
  shiftId: 'SUPPORT_TRANSFER_TRANSFER-BC-01', shiftName: 'Ca hỗ trợ cửa hàng',
  shiftStart: '08:00', shiftEnd: '12:00', checkIn: '08:05',
  checkInAt: '2026-09-03T01:05:00.000Z', checkOut: null, checkOutAt: null,
}

const baseApp = () => ({
  apiStatus: 'connected',
  session: {
    role: 'employee', employeeId: 'E01', code: 'E01',
    // Simulate a stale/home session after the configured transfer window.
    storeId: 'STORE-B', homeStoreId: 'STORE-B',
  },
  currentEmployee: employee,
  employees: [employee],
  stores: [
    { id: 'STORE-B', name: 'Cửa hàng B' },
    { id: 'STORE-C', name: 'Cửa hàng C' },
  ],
  attendance: [openSupportAttendance, {
    ...openSupportAttendance,
    id: 'ATT-SUPPORT-CLOSED',
    date: '2026-09-02',
    checkInAt: '2026-09-02T01:00:00.000Z',
    checkOut: '12:00',
    checkOutAt: '2026-09-02T05:00:00.000Z',
  }],
  orders: [{
    id: 'ORDER-CURRENT', code: 'DH-CURRENT', employeeId: 'E01',
    storeId: 'STORE-C', attendanceId: 'ATT-SUPPORT-OPEN',
    customerName: 'Khách trong ca', amount: 120_000, paymentMethod: 'Tiền mặt',
    createdAt: '2026-09-03T02:00:00.000Z', status: 'Hoàn tất',
  }, {
    id: 'ORDER-OLD-SUPPORT', code: 'DH-OLD-SUPPORT', employeeId: 'E01',
    storeId: 'STORE-C', attendanceId: 'ATT-SUPPORT-CLOSED',
    customerName: 'Khách ca cũ', amount: 90_000, paymentMethod: 'Chuyển khoản',
    createdAt: '2026-09-02T02:00:00.000Z', status: 'Hoàn tất',
  }, {
    id: 'ORDER-HOME', code: 'DH-HOME', employeeId: 'E01',
    storeId: 'STORE-B', attendanceId: 'ATT-HOME-CLOSED',
    customerName: 'Khách cửa hàng chính', amount: 80_000, paymentMethod: 'Tiền mặt',
    createdAt: '2026-09-01T02:00:00.000Z', status: 'Hoàn tất',
  }],
  orderInformationOptions: [],
  shiftDefinitions: [],
  tasks: [],
  taskAssignmentHistory: [],
  createOrder: vi.fn().mockResolvedValue({ ok: true }),
  saveStoreTaskProgress: vi.fn().mockResolvedValue({ ok: true, completionRate: 100 }),
  notify: vi.fn(),
})

const renderOrders = () => render(
  <MemoryRouter initialEntries={['/employee/orders']}><EmployeeOrdersPage /></MemoryRouter>,
)

const renderTasks = () => render(
  <MemoryRouter initialEntries={['/employee/tasks']}><EmployeeAssignedTasksPage /></MemoryRouter>,
)

describe('employee active-shift context', () => {
  beforeEach(() => {
    mocked.app = baseApp()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows only orders from the open support attendance and keeps order entry at the destination store', () => {
    renderOrders()

    expect(screen.getByText('DH-CURRENT')).toBeTruthy()
    expect(screen.queryByText('DH-OLD-SUPPORT')).toBeNull()
    expect(screen.queryByText('DH-HOME')).toBeNull()
    expect(screen.getByText('Đơn hàng trong ca đang làm')).toBeTruthy()
    expect(screen.getByText('ĐƠN TRONG CA')).toBeTruthy()
    expect(screen.getByText('DOANH THU TRONG CA')).toBeTruthy()

    const createButton = screen.getByRole('button', { name: 'TẠO ĐƠN HÀNG' })
    expect(createButton.disabled).toBe(false)
    fireEvent.click(createButton)
    expect(screen.getByText('Tạo đơn hàng • Cửa hàng C')).toBeTruthy()
  })

  it('keeps Save usable for a valid open custom/support shift that has no canonical display template', async () => {
    mocked.app.attendance = [{
      ...openSupportAttendance,
      shiftName: 'Ca hỗ trợ linh hoạt',
      shiftStart: '08:15',
      shiftEnd: '12:15',
      checkIn: undefined,
    }]
    mocked.app.tasks = [{
      id: 'TASK-SUPPORT-CUSTOM', checklistAttendanceId: 'ATT-SUPPORT-OPEN',
      storeId: 'STORE-C', date: '2026-09-03',
      shiftId: 'SUPPORT_TRANSFER_TRANSFER-BC-01', employeeIds: ['E01'],
      title: 'Hoàn tất công việc tại cửa hàng C', required: true,
      catalogKind: 'FIXED_TASK', completedBy: {},
    }]

    renderTasks()

    const checkbox = screen.getByRole('checkbox', { name: /Hoàn tất công việc tại cửa hàng C/u })
    expect(checkbox.disabled).toBe(false)
    fireEvent.click(checkbox)

    const saveButton = screen.getByRole('button', { name: 'LƯU KẾT QUẢ' })
    expect(saveButton.disabled).toBe(false)
    fireEvent.click(saveButton)

    await waitFor(() => expect(mocked.app.saveStoreTaskProgress).toHaveBeenCalledWith(expect.objectContaining({
      attendanceId: 'ATT-SUPPORT-OPEN',
      tasks: [{ id: 'TASK-SUPPORT-CUSTOM', completed: true }],
      incompleteReason: '',
      idempotencyKey: expect.stringMatching(/^task-progress:/u),
    })))
  })
})
