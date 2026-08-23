import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeeAssignedTasksPage, EmployeeShiftExpensePage } from './EmployeeShiftOperations'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const baseApp = () => ({
  session: { role: 'employee', employeeId: 'E01', code: 'E01', storeId: 'S01' },
  currentEmployee: { id: 'E01', name: 'Nguyễn An', storeId: 'S01', unit: 'store' },
  employees: [{ id: 'E01', name: 'Nguyễn An', storeId: 'S01', unit: 'store' }],
  stores: [{ id: 'S01', name: 'Dosii NTL' }],
  attendance: [{
    id: 'ATT-01', employeeId: 'E01', storeId: 'S01', date: '2026-08-22',
    shiftId: 'CA-1', shiftName: 'Ca sáng', checkIn: '08:00', checkInAt: '2026-08-22T01:00:00.000Z',
    checkOut: null, checkOutAt: null,
  }],
  expenseEntries: [],
  tasks: [],
  taskAssignmentHistory: [],
  addShiftExpense: vi.fn().mockResolvedValue({ ok: true, expense: { id: 'EXP-01' } }),
  saveStoreTaskProgress: vi.fn().mockResolvedValue({ ok: true, completionRate: 50 }),
})

describe('employee shift operations', () => {
  beforeEach(() => { mocked.app = baseApp() })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('saves an expense against the employee open attendance and displays only own shift history', async () => {
    mocked.app.expenseEntries = [{
      id: 'EXP-OLD', sourceType: 'shift-expense-item', employeeId: 'E01', attendanceId: 'ATT-OLD',
      storeId: 'S01', shiftName: 'Ca chiều', name: 'Mua bút', amount: 20_000, note: 'Gấp',
      occurredAt: '2026-08-21T09:00:00.000Z', employeeName: 'Nguyễn An',
    }, {
      id: 'EXP-OTHER', sourceType: 'shift-expense-item', employeeId: 'E02', attendanceId: 'ATT-OTHER',
      storeId: 'S01', name: 'Không được xem', amount: 99_000, occurredAt: '2026-08-21T09:00:00.000Z',
    }]
    render(<EmployeeShiftExpensePage />)

    expect(screen.getByText('Mua bút')).toBeTruthy()
    expect(screen.queryByText('Không được xem')).toBeNull()
    fireEvent.change(screen.getByLabelText(/Tên chi phí/i), { target: { value: 'Mua vật dụng vệ sinh' } })
    fireEvent.change(screen.getByLabelText(/Số tiền/i), { target: { value: '35' } })
    fireEvent.change(screen.getByLabelText(/Ghi chú/i), { target: { value: 'Mua trong ca sáng' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    await waitFor(() => expect(mocked.app.addShiftExpense).toHaveBeenCalledTimes(1))
    expect(mocked.app.addShiftExpense).toHaveBeenCalledWith(expect.objectContaining({
      attendanceId: 'ATT-01', name: 'Mua vật dụng vệ sinh', amount: 35_000, note: 'Mua trong ca sáng',
      idempotencyKey: expect.stringMatching(/^shift-expense:/u),
    }))
  })

  it('requires one reason for incomplete work and submits every task with the calculated progress', async () => {
    mocked.app.tasks = [{
      id: 'TASK-01', assignmentId: 'ASSIGN-01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Kiểm tra quầy', completedBy: {},
    }, {
      id: 'TASK-02', assignmentId: 'ASSIGN-01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Báo cáo tồn kho', completedBy: {},
    }]
    render(<EmployeeAssignedTasksPage />)

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    expect(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }).disabled).toBe(true)
    expect(screen.getByText('1/2 · 50%')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Ghi chú khi chưa hoàn thành hết/i), { target: { value: 'Chưa kiểm xong kho cuối ca' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }))

    await waitFor(() => expect(mocked.app.saveStoreTaskProgress).toHaveBeenCalledTimes(1))
    expect(mocked.app.saveStoreTaskProgress).toHaveBeenCalledWith(expect.objectContaining({
      attendanceId: 'ATT-01',
      tasks: [{ id: 'TASK-01', completed: true }, { id: 'TASK-02', completed: false }],
      incompleteReason: 'Chưa kiểm xong kho cuối ca',
      idempotencyKey: expect.stringMatching(/^task-progress:/u),
    }))
  })

  it('keeps both forms read-only until the employee has an open attendance', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-22T03:00:00.000Z')
    mocked.app.attendance = []
    mocked.app.tasks = [{
      id: 'TASK-01', assignmentId: 'ASSIGN-01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Kiểm tra quầy', completedBy: {},
    }]
    const { unmount } = render(<EmployeeShiftExpensePage />)
    expect(screen.getByRole('button', { name: 'LƯU' }).disabled).toBe(true)
    unmount()
    render(<EmployeeAssignedTasksPage />)
    expect(screen.getByRole('checkbox').disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }).disabled).toBe(true)
  })
})
