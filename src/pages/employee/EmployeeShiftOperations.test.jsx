import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeeAssignedTasksPage, EmployeeShiftExpensePage } from './EmployeeShiftOperations'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const baseApp = () => ({
  apiStatus: 'local',
  session: { role: 'employee', employeeId: 'E01', code: 'E01', storeId: 'S01' },
  currentEmployee: { id: 'EMP-DB-01', code: 'E01', name: 'Nguyễn An', storeId: 'S01', unit: 'store' },
  employees: [{ id: 'EMP-DB-01', code: 'E01', name: 'Nguyễn An', storeId: 'S01', unit: 'store' }],
  stores: [{ id: 'S01', name: 'Dosii NTL' }],
  attendance: [{
    id: 'ATT-01', employeeId: 'E01', storeId: 'S01', date: '2026-08-22',
    shiftId: 'CA-1', shiftName: 'Ca sáng', checkIn: '08:00', checkInAt: '2026-08-22T01:00:00.000Z',
    checkOut: null, checkOutAt: null,
  }],
  shiftDefinitions: [{ id: 'CA-1', storeId: 'S01', name: 'Ca Sáng' }, { id: 'CA-2', storeId: 'S01', name: 'Ca Chiều' }, { id: 'CA-3', storeId: 'S01', name: 'Ca Tối' }],
  workCatalogItems: [],
  expenseEntries: [],
  tasks: [],
  taskAssignmentHistory: [],
  addShiftExpense: vi.fn().mockResolvedValue({ ok: true, expense: { id: 'EXP-01' } }),
  saveStoreTaskProgress: vi.fn().mockResolvedValue({ ok: true, completionRate: 100 }),
})

const lockAttendance = (shiftId) => {
  mocked.app.attendance = mocked.app.attendance.map((row) => (row.checkOutAt ? row : {
    ...row, taskShiftSelection: { attendanceId: row.id, shiftId, shiftName: shiftId },
    taskShiftContexts: [...(row.taskShiftContexts || [])],
  }))
}

// Server-locked state is what the page renders; `lock` simulates the attendance
// returned by task.shift.select instead of a client-side dropdown.
const renderAssignedTasks = (initialEntries = ['/employee/tasks'], lock = true) => {
  if (lock) lockAttendance(mocked.app.attendance.find((row) => !row.checkOutAt)?.shiftId || 'CA-1')
  return render(<MemoryRouter initialEntries={initialEntries}><EmployeeAssignedTasksPage /></MemoryRouter>)
}

describe('employee shift operations', () => {
  it('opens independent time choices without writing or showing tasks, then locks only after server confirmation', async () => {
    mocked.app.shiftDefinitions = [
      ['AM1', 'Ca sáng', '08:00', '12:00'], ['AM2', 'Ca sáng', '08:30', '12:00'],
      ['PM1', 'Ca chiều', '12:00', '18:00'], ['PM2', 'Ca chiều', '13:30', '18:00'],
      ['N1', 'Ca tối', '17:00', '21:00'], ['N2', 'Ca tối', '19:00', '21:00'],
    ].map(([id, name, start, end]) => ({ id, name, start, end, storeId: 'S01' }))
    let finish
    mocked.app.selectTaskShift = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const view = renderAssignedTasks(['/employee/tasks'], false)
    const morning = screen.getByRole('button', { name: /Ca sáng 2 ca/u })
    expect(morning.disabled).toBe(false)
    fireEvent.click(morning)
    expect(morning.getAttribute('aria-expanded')).toBe('true')
    expect(mocked.app.selectTaskShift).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'LƯU' })).toBeNull()
    const choice = screen.getByRole('button', { name: 'Ca sáng 08:30–12:00' })
    fireEvent.click(choice)
    fireEvent.click(choice)
    expect(mocked.app.selectTaskShift).toHaveBeenCalledTimes(1)
    expect(mocked.app.selectTaskShift).toHaveBeenCalledWith(expect.objectContaining({ selectedTaskShiftId: 'AM2' }))
    expect(screen.queryByText(/Đã chọn · đã khóa/u)).toBeNull()
    lockAttendance('AM2')
    finish({ ok: true })
    view.rerender(<MemoryRouter><EmployeeAssignedTasksPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/Đã chọn · đã khóa/u)).toBeTruthy())
    expect(screen.getByRole('button', { name: /Ca sáng 08:30–12:00/u }).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /Ca chiều/u })).toBeNull()
  })
  it('keeps all three choices usable when the configuration contains repeated copies without showing a checklist', async () => {
    mocked.app.shiftDefinitions.push(...structuredClone(mocked.app.shiftDefinitions))
    mocked.app.selectTaskShift = vi.fn().mockResolvedValue({ ok: false, uncertain: true, message: 'Chưa xác định kết quả' })
    renderAssignedTasks(['/employee/tasks'], false)
    for (const label of ['Ca sáng', 'Ca chiều', 'Ca tối']) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'u') }).disabled).toBe(false)
    }
    expect(screen.queryByText('Cấu hình trùng')).toBeNull()
    expect(screen.queryByRole('button', { name: 'LƯU' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Ca chiều/u }))
    await waitFor(() => expect(mocked.app.selectTaskShift).toHaveBeenCalledTimes(1))
    expect(mocked.app.selectTaskShift).toHaveBeenCalledWith(expect.objectContaining({ attendanceId: 'ATT-01', selectedTaskShiftId: 'CA-2' }))
    expect(screen.queryByText(/Đã chọn · đã khóa/u)).toBeNull()
  })
  beforeEach(() => {
    globalThis.sessionStorage.clear()
    mocked.app = baseApp()
  })
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
      employeeIds: ['E01'], title: 'Kiểm tra quầy', description: 'Mô tả không được hiển thị',
      required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }, {
      id: 'TASK-02', assignmentId: 'ASSIGN-01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Báo cáo tồn kho', required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }]
    renderAssignedTasks()

    const firstTitle = screen.getByText('Kiểm tra quầy')
    expect(screen.getAllByText('Kiểm tra quầy')).toHaveLength(1)
    expect(firstTitle.tagName).toBe('SPAN')
    expect(firstTitle.classList.contains('task-checklist__title')).toBe(true)
    expect(firstTitle.closest('strong')).toBeNull()
    expect(screen.queryByText('Mô tả không được hiển thị')).toBeNull()
    expect(screen.queryByText('Bắt buộc')).toBeNull()
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
    expect(mocked.app.saveStoreTaskProgress.mock.calls[0][0].selectedTaskShiftId).toBe('CA-1')
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Kiểm tra quầy/i }).disabled).toBe(true))
    expect(screen.getByText('Đã lưu')).toBeTruthy()
    expect(screen.getByText('Kiểm tra quầy').closest('label').classList.contains('is-locked')).toBe(true)
  })

  it('allows saving an incomplete checklist with no checked task when a note is provided', async () => {
    mocked.app.tasks = [{
      id: 'TASK-01', assignmentId: 'ASSIGN-01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1',
      employeeIds: ['E01'], title: 'Kiểm tra quầy', required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }]
    renderAssignedTasks()

    expect(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Lý do công việc bắt buộc chưa hoàn thành/i), {
      target: { value: 'Khách đông nên chưa thực hiện được' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU KẾT QUẢ' }))

    await waitFor(() => expect(mocked.app.saveStoreTaskProgress).toHaveBeenCalledWith(expect.objectContaining({
      attendanceId: 'ATT-01',
      tasks: [{ id: 'TASK-01', completed: false }],
      incompleteReason: 'Khách đông nên chưa thực hiện được',
    })))
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

  it('shows the support attendance checklist when its synthetic shift is not a stored definition', () => {
    mocked.app.session = {
      role: 'employee', employeeId: 'E01', code: 'E01',
      storeId: 'S02', homeStoreId: 'S01', activeTransferId: 'TR-01',
    }
    mocked.app.currentEmployee = {
      id: 'EMP-DB-01', code: 'E01', name: 'Nguyễn An', storeId: 'S01', unit: 'store',
    }
    mocked.app.employees = [mocked.app.currentEmployee]
    mocked.app.stores = [{ id: 'S01', name: 'Dosii Home' }, { id: 'S02', name: 'Dosii Support' }]
    mocked.app.shiftDefinitions = [
      { id: 'CA-1', storeId: 'S02', name: 'Ca sáng', start: '07:00', end: '12:00' },
      { id: 'CA-2', storeId: 'S02', name: 'Ca chiều', start: '12:00', end: '17:00' },
    ]
    mocked.app.attendance = [{
      id: 'ATT-SUPPORT', employeeId: 'E01', storeId: 'S02', supportTransferId: 'TR-01',
      date: '2026-08-22', shiftId: 'SUPPORT_TRANSFER_TR-01', shiftName: 'Ca hỗ trợ cửa hàng',
      shiftStart: '12:00', shiftEnd: '17:00', checkIn: '13:00', checkInAt: '2026-08-22T06:00:00.000Z',
      checkOut: null, checkOutAt: null,
    }]
    mocked.app.tasks = [{
      id: 'TASK-SUPPORT', checklistAttendanceId: 'ATT-SUPPORT', storeId: 'S02', date: '2026-08-22',
      shiftId: 'SUPPORT_TRANSFER_TR-01', employeeIds: ['E01'], title: 'Checklist cửa hàng hỗ trợ',
      required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }]

    renderAssignedTasks()

    expect(screen.getByText('Checklist cửa hàng hỗ trợ')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /Checklist cửa hàng hỗ trợ/i }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: /Ca chiều/u }).getAttribute('aria-pressed')).toBe('true')
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

  it('requires attendance before any shift selector or checklist, even from a deep link', () => {
    mocked.app.attendance = [{ ...mocked.app.attendance[0], checkOut: '12:00', checkOutAt: '2026-08-22T05:00:00.000Z' }]
    mocked.app.tasks = [{
      id: 'TASK-FUTURE', assignmentId: 'ASSIGN-FUTURE', storeId: 'S01', date: '2026-09-02', shiftId: 'CA-2',
      employeeIds: ['E01'], title: 'Chuẩn bị quầy cho ca tương lai', required: true, catalogKind: 'FIXED_TASK', completedBy: {},
    }]
    mocked.app.taskAssignmentHistory = [{ id: 'ASSIGN-OLD', progressHistory: [{ employeeId: 'E01', at: '2026-08-21T10:00:00.000Z', shiftName: 'Ca Chiều', completedTasks: 1, totalTasks: 1, completionRate: 100 }] }]
    mocked.app.selectTaskShift = vi.fn()
    renderAssignedTasks(['/employee/tasks?assignment=ASSIGN-FUTURE'], false)
    expect(screen.getByText('Bạn cần điểm danh trước khi chọn ca và xem công việc được giao.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Đi đến điểm danh' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Chọn ca công việc' })).toBeNull()
    expect(screen.queryByText('Chuẩn bị quầy cho ca tương lai')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'LƯU KẾT QUẢ' })).toBeNull()
    expect(screen.getByText('Lịch sử kết quả đã gửi')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()
  })

  it('offers three unselected shift buttons and locks the server-confirmed choice only', async () => {
    mocked.app.attendance[0] = { ...mocked.app.attendance[0], shiftId: 'CA-3', checkIn: '16:48' }
    mocked.app.shiftDefinitions = [
      { id: 'uuid-am', storeId: 'S01', name: 'Ca Sáng', start: '08:00', end: '12:00' },
      { id: 'uuid-pm', storeId: 'S01', name: 'Ca Chiều', start: '12:00', end: '17:00' },
      { id: 'uuid-night', storeId: 'S01', name: 'Ca Tối', start: '17:00', end: '21:00' },
    ]
    mocked.app.tasks = ['uuid-am', 'uuid-pm', 'uuid-night'].map((shiftId) => ({
      id: `TASK-${shiftId}`, storeId: 'S01', date: '2026-08-22', shiftId, employeeIds: ['E01'], title: `Checklist ${shiftId}`, required: true, completedBy: {},
    }))
    let finish
    mocked.app.selectTaskShift = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const view = renderAssignedTasks(['/employee/tasks'], false)
    const group = screen.getByRole('group', { name: 'Chọn ca công việc' })
    const buttons = Array.from(group.querySelectorAll('button'))
    expect(buttons.map((button) => button.querySelector('strong').textContent)).toEqual(['Ca sáng', 'Ca chiều', 'Ca tối'])
    expect(buttons.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'LƯU KẾT QUẢ' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Ca chiều/u }))
    fireEvent.click(screen.getByRole('button', { name: /Ca chiều/u }))
    fireEvent.click(screen.getByRole('button', { name: /Ca tối/u }))
    expect(mocked.app.selectTaskShift).toHaveBeenCalledTimes(1)
    expect(mocked.app.selectTaskShift).toHaveBeenCalledWith({ attendanceId: 'ATT-01', selectedTaskShiftId: 'uuid-pm', idempotencyKey: expect.stringMatching(/^task-shift:/u) })
    expect(screen.getByText('Đang ghi nhận…')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    // The server confirms: its attendance record now carries the lock.
    lockAttendance('uuid-pm')
    finish({ ok: true })
    view.rerender(<MemoryRouter initialEntries={['/employee/tasks']}><EmployeeAssignedTasksPage /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText('Đang ghi nhận…')).toBeNull())
    const locked = screen.getByRole('group', { name: 'Chọn ca công việc' }).querySelectorAll('button')
    expect(locked).toHaveLength(1)
    expect(locked[0].getAttribute('aria-pressed')).toBe('true')
    expect(locked[0].disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /Ca sáng/u })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ca tối/u })).toBeNull()
    expect(screen.getByText('Checklist uuid-pm')).toBeTruthy()
    expect(screen.queryByText('Checklist uuid-night')).toBeNull()
    expect(screen.queryByText('Checklist uuid-am')).toBeNull()
    // Remount (reload / other device) shows the same server lock.
    view.unmount()
    renderAssignedTasks(['/employee/tasks'], false)
    expect(screen.getByRole('button', { name: /Ca chiều/u }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  })

  it('keeps an unknown outcome unlocked, reuses the idempotency key and never opens two shifts', async () => {
    mocked.app.selectTaskShift = vi.fn()
      .mockResolvedValueOnce({ ok: false, uncertain: true, message: 'Chưa xác định được kết quả chọn ca do kết nối gián đoạn.' })
      .mockResolvedValueOnce({ ok: false, code: 'TASK_SHIFT_ALREADY_SELECTED', message: 'Lượt điểm danh này đã chọn ca công việc khác; không thể đổi ca.' })
    renderAssignedTasks(['/employee/tasks'], false)
    fireEvent.click(screen.getByRole('button', { name: /Ca sáng/u }))
    await waitFor(() => expect(screen.getByText(/Chưa xác định được kết quả chọn ca/u)).toBeTruthy())
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Ca sáng/u }))
    await waitFor(() => expect(mocked.app.selectTaskShift).toHaveBeenCalledTimes(2))
    expect(mocked.app.selectTaskShift.mock.calls[1][0].idempotencyKey).toBe(mocked.app.selectTaskShift.mock.calls[0][0].idempotencyKey)
    await waitFor(() => expect(screen.getByText(/không thể đổi ca/u)).toBeTruthy())
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('disables missing or ambiguous shift configuration without guessing', () => {
    mocked.app.shiftDefinitions = [
      { id: 'A1', storeId: 'S01', name: 'Ca Sáng', start: '08:00', end: '12:00' },
      { id: 'A2', storeId: 'S01', name: 'Ca Sáng', start: '08:00', end: '12:00' },
      { id: 'CA-3', storeId: 'S01', name: 'Ca Tối', start: '17:00', end: '21:00' },
    ]
    mocked.app.selectTaskShift = vi.fn()
    renderAssignedTasks(['/employee/tasks'], false)
    expect(screen.getByRole('button', { name: /Ca sáng/u }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Ca sáng/u }).textContent).toContain('Cấu hình trùng')
    expect(screen.getByRole('button', { name: /Ca chiều/u }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Ca chiều/u }).textContent).toContain('Chưa cấu hình')
    expect(screen.getByRole('button', { name: /Ca tối/u }).disabled).toBe(false)
    expect(screen.getByText(/cấu hình trùng cho cùng buổi/u)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Ca sáng/u }))
    expect(mocked.app.selectTaskShift).not.toHaveBeenCalled()
  })

  it('shows an empty state for a locked shift with no work and resets drafts for a new attendance', () => {
    mocked.app.tasks = [{ id: 'TASK-1', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-1', employeeIds: ['E01'], title: 'Checklist sáng', required: true, completedBy: {} }]
    lockAttendance('CA-2')
    const view = renderAssignedTasks(['/employee/tasks'], false)
    expect(screen.getByText(/Không có công việc bắt buộc cho ca này/u)).toBeTruthy()
    expect(screen.queryByText('Checklist sáng')).toBeNull()
    view.unmount()
    mocked.app.attendance = [{ ...mocked.app.attendance[0], checkOut: '17:00', checkOutAt: '2026-08-22T10:00:00.000Z' },
      { id: 'ATT-02', employeeId: 'E01', storeId: 'S01', date: '2026-08-22', shiftId: 'CA-3', checkIn: '17:00', checkInAt: '2026-08-22T10:00:00.000Z', checkOut: null, checkOutAt: null }]
    renderAssignedTasks(['/employee/tasks'], false)
    expect(screen.getAllByRole('button', { name: /Ca (sáng|chiều|tối)/u })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: /Ca (sáng|chiều|tối)/u }).every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true)
  })

  it('lets a legacy multi-shift attendance finish only its saved shifts', () => {
    mocked.app.tasks = ['CA-1', 'CA-2', 'CA-3'].map((shiftId) => ({ id: `T-${shiftId}`, storeId: 'S01', date: '2026-08-22', shiftId, employeeIds: ['E01'], title: `Việc ${shiftId}`, required: true, completedBy: {} }))
    mocked.app.attendance[0] = { ...mocked.app.attendance[0], taskShiftContexts: [{ shiftId: 'CA-1', taskIds: ['T-CA-1'] }, { shiftId: 'CA-2', taskIds: ['T-CA-2'] }] }
    mocked.app.selectTaskShift = vi.fn()
    renderAssignedTasks(['/employee/tasks'], false)
    expect(screen.getByText(/nhiều ca trước khi áp dụng quy tắc một ca/u)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Ca tối/u })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Ca chiều/u }))
    expect(screen.getByText('Việc CA-2')).toBeTruthy()
    expect(screen.queryByText('Việc CA-1')).toBeNull()
    expect(mocked.app.selectTaskShift).not.toHaveBeenCalled()
  })

})
