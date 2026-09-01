import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeeAssignedTasksPage, EmployeeShiftExpensePage } from './EmployeeShiftOperations'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const baseApp = () => ({
  session: { role: 'employee', employeeId: 'E01', code: 'E01', storeId: 'S01' },
  currentEmployee: { id: 'EMP-DB-01', code: 'E01', name: 'Nguyễn An', storeId: 'S01', unit: 'store' },
  employees: [{ id: 'EMP-DB-01', code: 'E01', name: 'Nguyễn An', storeId: 'S01', unit: 'store' }],
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
  saveStoreTaskProgress: vi.fn().mockResolvedValue({ ok: true, completionRate: 100 }),
})

const renderAssignedTasks = (initialEntries = ['/employee/tasks']) => render(
  <MemoryRouter initialEntries={initialEntries}><EmployeeAssignedTasksPage /></MemoryRouter>,
)

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
      attendanceId: 'ATT-01', name: 'Mua vật dụng vệ sinh', amount: 35, note: 'Mua trong ca sáng',
      idempotencyKey: expect.stringMatching(/^shift-expense:/u),
    }))
  })

  it('keeps case-colliding employee attendance and expenses isolated by exact id', async () => {
    mocked.app.employees = [
      mocked.app.currentEmployee,
      { id: 'e01', name: 'Nhân viên chữ thường', storeId: 'S01', unit: 'store' },
    ]
    mocked.app.attendance = [{
      ...mocked.app.attendance[0],
      id: 'ATT-LOWER-EMPLOYEE',
      employeeId: 'e01',
    }, {
      ...mocked.app.attendance[0],
      id: 'ATT-UPPER-EMPLOYEE',
      employeeId: 'E01',
    }]
    mocked.app.expenseEntries = [{
      id: 'EXP-UPPER', sourceType: 'shift-expense-item', employeeId: 'E01',
      storeId: 'S01', name: 'Chi phí đúng nhân viên', amount: 20_000,
    }, {
      id: 'EXP-LOWER', sourceType: 'shift-expense-item', employeeId: 'e01',
      storeId: 'S01', name: 'Chi phí nhân viên khác', amount: 90_000,
    }]

    render(<EmployeeShiftExpensePage />)

    expect(screen.getByText('Chi phí đúng nhân viên')).toBeTruthy()
    expect(screen.queryByText('Chi phí nhân viên khác')).toBeNull()
    fireEvent.change(screen.getByLabelText(/Tên chi phí/i), { target: { value: 'Bổ sung vật dụng' } })
    fireEvent.change(screen.getByLabelText(/Số tiền/i), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    await waitFor(() => expect(mocked.app.addShiftExpense).toHaveBeenCalledTimes(1))
    expect(mocked.app.addShiftExpense).toHaveBeenCalledWith(expect.objectContaining({
      attendanceId: 'ATT-UPPER-EMPLOYEE',
    }))
  })

  it('requires one reason for incomplete fixed work and submits every task with the calculated progress', async () => {
    mocked.app.tasks = [{
      id: 'TASK-01', assignmentId: 'ASSIGN-01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Kiểm tra quầy', required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }, {
      id: 'TASK-02', assignmentId: 'ASSIGN-01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Báo cáo tồn kho', required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }]
    renderAssignedTasks()

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    expect(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }).disabled).toBe(true)
    expect(screen.getByText('1/2 · 50%')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Lý do công việc bắt buộc chưa hoàn thành/i), { target: { value: 'Chưa kiểm xong kho cuối ca' } })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }))

    await waitFor(() => expect(mocked.app.saveStoreTaskProgress).toHaveBeenCalledTimes(1))
    expect(mocked.app.saveStoreTaskProgress).toHaveBeenCalledWith(expect.objectContaining({
      attendanceId: 'ATT-01',
      tasks: [{ id: 'TASK-01', completed: true }, { id: 'TASK-02', completed: false }],
      incompleteReason: 'Chưa kiểm xong kho cuối ca',
      idempotencyKey: expect.stringMatching(/^task-progress:/u),
    }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Kiểm tra quầy/i }).disabled).toBe(true))
    expect(screen.getByText('Đã lưu')).toBeTruthy()
    expect(screen.getByText('Kiểm tra quầy').closest('label').classList.contains('is-locked')).toBe(true)
  })

  it('keeps reward work separate and shows already-completed fixed work dimmed and locked', () => {
    mocked.app.tasks = [{
      id: 'TASK-FIXED', assignmentId: 'ASSIGN-01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Mở cửa đúng quy trình', required: true, catalogKind: 'FIXED_TASK', completedBy: { E01: true },
    }, {
      id: 'TASK-REWARD', assignmentId: 'ASSIGN-01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Quay clip sản phẩm', required: false, rewardEligible: true,
      catalogKind: 'REWARD_TASK', amountVnd: 50_000, completedBy: {},
    }]

    renderAssignedTasks()

    expect(screen.queryByText('Tùy chọn · Thưởng 50,000 đ')).toBeNull()
    expect(screen.queryByText('Quay clip sản phẩm')).toBeNull()
    expect(screen.getByText('Mở cửa đúng quy trình')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /Mở cửa đúng quy trình/i }).checked).toBe(true)
    expect(screen.getByRole('checkbox', { name: /Mở cửa đúng quy trình/i }).disabled).toBe(true)
    expect(screen.getByText('Mở cửa đúng quy trình').closest('label').classList.contains('is-locked')).toBe(true)
    expect(screen.getByText(/Công việc nhận thưởng được tick và lưu riêng/i)).toBeTruthy()
    expect(screen.getByText('1/1 · 100%')).toBeTruthy()
    expect(screen.queryByLabelText(/Lý do công việc bắt buộc/u)).toBeNull()
    expect(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }))
    expect(mocked.app.saveStoreTaskProgress).not.toHaveBeenCalled()
  })

  it('shows the three canonical shift tabs and enables updates only for the checked-in shift', () => {
    mocked.app.tasks = [{
      id: 'TASK-MORNING', checklistAttendanceId: 'ATT-01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Checklist ca sáng', required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }]

    renderAssignedTasks()

    expect(screen.getByRole('tab', { name: /Ca Sáng/i }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /Ca Chiều/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Ca Tối/i })).toBeTruthy()
    expect(screen.getByText('Checklist ca sáng')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /Checklist ca sáng/i }).disabled).toBe(false)

    fireEvent.click(screen.getByRole('tab', { name: /Ca Chiều/i }))

    expect(screen.queryByText('Checklist ca sáng')).toBeNull()
    expect(screen.getByText(/Chỉ ca đang điểm danh mới được tick và lưu/i)).toBeTruthy()
    expect(screen.getByText(/Chưa có công việc bắt buộc cho ca này/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }).disabled).toBe(true)
  })

  it('shows only checklist rows bound to the current open attendance', () => {
    mocked.app.tasks = [{
      id: 'TASK-CURRENT', checklistAttendanceId: 'att-01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Checklist ca đang mở', required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }, {
      id: 'TASK-CLOSED', checklistAttendanceId: 'ATT-CLOSED', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Checklist ca đã đóng', required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }, {
      id: 'TASK-MANUAL', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Công việc giao thêm trong ca', required: true, completedBy: {},
    }]

    renderAssignedTasks()

    expect(screen.getByText('Checklist ca đang mở')).toBeTruthy()
    expect(screen.getByText('Công việc giao thêm trong ca')).toBeTruthy()
    expect(screen.queryByText('Checklist ca đã đóng')).toBeNull()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('does not attach a lowercase checklist binding to an exact uppercase attendance collision', () => {
    mocked.app.attendance = [{
      ...mocked.app.attendance[0],
      id: 'ATT-X',
    }, {
      ...mocked.app.attendance[0],
      id: 'att-x',
      checkOut: '12:00',
      checkOutAt: '2026-08-22T05:00:00.000Z',
    }]
    mocked.app.tasks = [{
      id: 'TASK-LOWER', checklistAttendanceId: 'att-x', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Chỉ thuộc ca chữ thường', required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }]

    renderAssignedTasks()

    expect(screen.queryByText('Chỉ thuộc ca chữ thường')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('opens a future assignment from its notification deep link without allowing an early save', () => {
    mocked.app.attendance = []
    mocked.app.tasks = [{
      id: 'TASK-FUTURE', assignmentId: 'ASSIGN-FUTURE', storeId: 'S01', date: '2026-09-02', shiftId: 'CA-2',
      employeeIds: ['E01'], title: 'Chuẩn bị quầy cho ca tương lai', required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }, {
      id: 'TASK-OTHER', assignmentId: 'ASSIGN-OTHER', storeId: 'S01', date: '2026-09-02', shiftId: 'CA-2',
      employeeIds: ['E01'], title: 'Không thuộc thông báo', required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }]

    renderAssignedTasks(['/employee/tasks?assignment=ASSIGN-FUTURE'])

    expect(screen.getByText('Chuẩn bị quầy cho ca tương lai')).toBeTruthy()
    expect(screen.queryByText('Không thuộc thông báo')).toBeNull()
    expect(screen.getByRole('checkbox').disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }).disabled).toBe(true)
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
    renderAssignedTasks()
    expect(screen.getByRole('checkbox').disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }).disabled).toBe(true)
  })
})
