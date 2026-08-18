import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreTasks } from './StoreOperations'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

const store = { id: 'CH001', name: 'SecondMall SM234', short: 'SM234' }
const employees = [
  { id: 'SM234-001', code: 'SM234-001', name: 'Nguyễn Minh Anh', unit: 'store', storeId: store.id, status: 'Đang làm việc', employmentType: 'Full-Time' },
  { id: 'SM234-002', code: 'SM234-002', name: 'Trần Gia Hân', unit: 'store', storeId: store.id, status: 'Đang làm việc', employmentType: 'Part-Time' },
]
const futureDate = '2099-12-24'
const futureShift = { id: 'CA-TUONG-LAI', storeId: store.id, date: futureDate, name: 'Ca tương lai', start: '14:00', end: '22:00', active: true }

const makeApp = (role = 'business_support', overrides = {}) => ({
  session: { role, employeeId: role === 'store_manager' ? 'QLCH-001' : 'HTKD-001', storeId: role === 'store_manager' ? store.id : undefined },
  stores: [store],
  activeStoreId: store.id,
  employees,
  attendance: [],
  schedule: [],
  shiftDefinitions: [futureShift],
  tasks: [],
  taskAssignmentHistory: [],
  replaceTasks: vi.fn().mockResolvedValue({ ok: true }),
  notify: vi.fn(),
  ...overrides,
})

describe('StoreTasks assignment workflow', () => {
  afterEach(cleanup)

  it('sends a future, unstarted shift to multiple employees without attendance', async () => {
    mocked.app = makeApp('business_support')
    render(<StoreTasks />)

    fireEvent.change(screen.getByLabelText(/Ngày giao việc/i), { target: { value: futureDate } })
    expect(screen.getByLabelText(/Ca làm việc/i).value).toBe(futureShift.id)

    fireEvent.click(screen.getByLabelText(`Chọn nhân viên ${employees[0].name}`))
    fireEvent.click(screen.getByLabelText(`Chọn nhân viên ${employees[1].name}`))
    fireEvent.change(screen.getByLabelText('Tên công việc 1'), { target: { value: 'Kiểm kê quầy' } })
    fireEvent.change(screen.getByLabelText('Mô tả công việc 1'), { target: { value: 'Đếm hàng trước ca' } })
    fireEvent.click(screen.getByRole('button', { name: /Thêm công việc/i }))
    fireEvent.change(screen.getByLabelText('Tên công việc 2'), { target: { value: 'Chuẩn bị bảng giá' } })
    fireEvent.change(screen.getByLabelText('Mô tả công việc 2'), { target: { value: 'Đặt tại quầy thu ngân' } })
    fireEvent.click(screen.getByRole('button', { name: /^GỬI$/i }))

    await waitFor(() => expect(mocked.app.replaceTasks).toHaveBeenCalledWith(expect.objectContaining({
      storeId: store.id,
      date: futureDate,
      shiftId: futureShift.id,
      employeeIds: employees.map((employee) => employee.id),
      tasks: [
        { title: 'Kiểm kê quầy', detail: 'Đếm hàng trước ca' },
        { title: 'Chuẩn bị bảng giá', detail: 'Đặt tại quầy thu ngân' },
      ],
    })))
    expect(mocked.app.replaceTasks.mock.calls[0][0].idempotencyKey).toMatch(/^tasks:/)
    expect(mocked.app.notify).not.toHaveBeenCalledWith(expect.stringMatching(/điểm danh|bắt đầu ca/i), expect.anything())
  })

  it('reuses the assignment idempotency key after a lost response and rotates it when the draft changes', async () => {
    const replaceTasks = vi.fn().mockResolvedValue({ ok: false, message: 'Mất phản hồi' })
    mocked.app = makeApp('business_support', { replaceTasks })
    render(<StoreTasks />)

    fireEvent.change(screen.getByLabelText(/Ngày giao việc/i), { target: { value: futureDate } })
    fireEvent.click(screen.getByLabelText(`Chọn nhân viên ${employees[0].name}`))
    fireEvent.change(screen.getByLabelText('Tên công việc 1'), { target: { value: 'Kiểm kê quầy' } })
    fireEvent.click(screen.getByRole('button', { name: /^GỬI$/i }))
    await waitFor(() => expect(replaceTasks).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /^GỬI$/i }))
    await waitFor(() => expect(replaceTasks).toHaveBeenCalledTimes(2))
    const firstKey = replaceTasks.mock.calls[0][0].idempotencyKey
    expect(replaceTasks.mock.calls[1][0].idempotencyKey).toBe(firstKey)

    fireEvent.change(screen.getByLabelText('Tên công việc 1'), { target: { value: 'Kiểm kê cuối ca' } })
    fireEvent.click(screen.getByRole('button', { name: /^GỬI$/i }))
    await waitFor(() => expect(replaceTasks).toHaveBeenCalledTimes(3))
    expect(replaceTasks.mock.calls[2][0].idempotencyKey).not.toBe(firstKey)
  })

  it('renders full assignment history with 24-hour time, assignees, content, and completion', () => {
    mocked.app = makeApp('admin', {
      taskAssignmentHistory: [{
        id: 'TASK-ASG-001',
        storeId: store.id,
        date: futureDate,
        shiftId: futureShift.id,
        employeeIds: employees.map((employee) => employee.id),
        assignedAt: `${futureDate}T14:05:06+07:00`,
        assignedBy: { id: 'ADMIN', name: 'Admin IDOSI' },
        status: 'Đang thực hiện',
        tasks: [
          { id: 'TASK-001', title: 'Kiểm kê quầy', detail: 'Đếm hàng trước ca', completedBy: { 'SM234-001': true, 'SM234-002': true } },
          { id: 'TASK-002', title: 'Chuẩn bị bảng giá', detail: 'Đặt tại quầy thu ngân', completedBy: {} },
        ],
      }],
    })

    render(<StoreTasks />)

    expect(screen.getByText('Admin IDOSI')).toBeTruthy()
    expect(screen.getByText('24/12/2099 14:05:06')).toBeTruthy()
    expect(screen.getByText(/Ca tương lai · 14:00–22:00/i)).toBeTruthy()
    expect(screen.getByText(`${employees[0].name}, ${employees[1].name}`)).toBeTruthy()
    expect(screen.getByText('Đếm hàng trước ca')).toBeTruthy()
    expect(screen.getByText('Hoàn thành · 2/2 nhân viên')).toBeTruthy()
    expect(screen.getByText('Chưa hoàn thành · 0/2 nhân viên')).toBeTruthy()
    expect(screen.getByText('Đang thực hiện')).toBeTruthy()
  })

  it.each(['admin', 'store_manager', 'business_support'])('shows mutation controls for %s', (role) => {
    mocked.app = makeApp(role)
    const view = render(<StoreTasks />)

    expect(screen.getByRole('button', { name: /^GỬI$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Thêm công việc/i })).toBeTruthy()
    expect(screen.getByLabelText(`Chọn nhân viên ${employees[0].name}`)).toBeTruthy()
    view.unmount()
  })

  it('keeps unsupported employee roles read-only while preserving history access', () => {
    mocked.app = makeApp('employee', {
      session: { role: 'employee', employeeId: employees[0].id, storeId: store.id },
      taskAssignmentHistory: [{
        id: 'TASK-ASG-002',
        storeId: store.id,
        date: futureDate,
        shiftId: futureShift.id,
        employeeIds: [employees[0].id],
        assignedAt: `${futureDate}T08:15:00+07:00`,
        assignedBy: { name: 'Quản lý cửa hàng' },
        tasks: [{ id: 'TASK-003', title: 'Mở quầy', detail: 'Kiểm tra vệ sinh', completedBy: {} }],
      }],
    })

    render(<StoreTasks />)

    expect(screen.queryByRole('button', { name: /^GỬI$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Thêm công việc/i })).toBeNull()
    expect(screen.queryByLabelText(`Chọn nhân viên ${employees[0].name}`)).toBeNull()
    expect(screen.getByText(/Mở quầy/)).toBeTruthy()
    expect(screen.getByText(/Chỉ Admin, Quản lý cửa hàng và Nhân viên hỗ trợ KD/i)).toBeTruthy()
  })
})
