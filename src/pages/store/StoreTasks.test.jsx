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
const fixedTask = {
  id: 'work-catalog:store:fixed_task:inventory-counter',
  code: 'store.fixed.inventory-counter',
  kind: 'FIXED_TASK',
  targetGroup: 'store',
  storeId: store.id,
  shiftId: futureShift.id,
  name: 'Kiểm kê quầy',
  amountVnd: 0,
  active: true,
  sortOrder: 1,
  effectiveFrom: '2099-01-01',
  version: 3,
}
const rewardTask = {
  id: 'work-catalog:store:reward_task:price-board',
  code: 'store.reward.price-board',
  kind: 'REWARD_TASK',
  targetGroup: 'store',
  storeId: store.id,
  shiftId: futureShift.id,
  name: 'Chuẩn bị bảng giá',
  amountVnd: 150_000,
  active: true,
  sortOrder: 2,
  effectiveFrom: '2099-01-01',
  version: 2,
}

const makeApp = (role = 'business_support', overrides = {}) => ({
  session: { role, employeeId: role === 'store_manager' ? 'QLCH-001' : 'HTKD-001', storeId: role === 'store_manager' ? store.id : undefined },
  stores: [store],
  activeStoreId: store.id,
  employees,
  attendance: [],
  schedule: [],
  shiftDefinitions: [futureShift],
  workCatalogItems: [fixedTask, rewardTask],
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
    fireEvent.click(screen.getByLabelText(`Chọn công việc ${fixedTask.name}`))
    fireEvent.click(screen.getByLabelText(`Chọn công việc ${rewardTask.name}`))
    expect(screen.getByText(/Thưởng 150[.,]000/)).toBeTruthy()
    expect(screen.queryByPlaceholderText(/Nhập tên công việc/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^GỬI$/i }))

    await waitFor(() => expect(mocked.app.replaceTasks).toHaveBeenCalledWith(expect.objectContaining({
      storeId: store.id,
      date: futureDate,
      shiftId: futureShift.id,
      employeeIds: employees.map((employee) => employee.id),
      tasks: [
        expect.objectContaining({
          title: fixedTask.name,
          catalogItemId: fixedTask.id,
          catalogCode: fixedTask.code,
          catalogVersion: fixedTask.version,
          kind: fixedTask.kind,
          catalogKind: fixedTask.kind,
          amountVnd: 0,
          required: true,
          catalogSnapshot: expect.objectContaining({
            catalogItemId: fixedTask.id,
            effectiveDate: futureDate,
          }),
        }),
        expect.objectContaining({
          title: rewardTask.name,
          catalogItemId: rewardTask.id,
          catalogCode: rewardTask.code,
          catalogVersion: rewardTask.version,
          kind: rewardTask.kind,
          catalogKind: rewardTask.kind,
          amountVnd: rewardTask.amountVnd,
          required: false,
          catalogSnapshot: expect.objectContaining({
            catalogItemId: rewardTask.id,
            effectiveDate: futureDate,
          }),
        }),
      ],
    })))
    expect(mocked.app.replaceTasks.mock.calls[0][0].idempotencyKey).toMatch(/^tasks:/)
    expect(mocked.app.notify).not.toHaveBeenCalledWith(expect.stringMatching(/điểm danh|bắt đầu ca/i), expect.anything())
  })

  it('only lists active fixed and reward catalog work for the selected store, date, and shift', () => {
    const irrelevantCatalogItems = [
      { ...fixedTask, id: `${fixedTask.id}:inactive`, code: `${fixedTask.code}.inactive`, name: 'Công việc đã ngừng', active: false },
      { ...fixedTask, id: `${fixedTask.id}:other-store`, code: `${fixedTask.code}.other-store`, name: 'Công việc cửa hàng khác', storeId: 'CH-KHAC' },
      { ...fixedTask, id: `${fixedTask.id}:other-shift`, code: `${fixedTask.code}.other-shift`, name: 'Công việc ca khác', shiftId: 'CA-KHAC' },
      { ...fixedTask, id: `${fixedTask.id}:future`, code: `${fixedTask.code}.future`, name: 'Công việc chưa hiệu lực', effectiveFrom: '2100-01-01' },
      { ...fixedTask, id: `${fixedTask.id}:violation`, code: `${fixedTask.code}.violation`, name: 'Nội dung vi phạm', kind: 'VIOLATION', amountVnd: 50_000 },
    ]
    mocked.app = makeApp('business_support', {
      workCatalogItems: [fixedTask, rewardTask, ...irrelevantCatalogItems],
    })
    render(<StoreTasks />)

    fireEvent.change(screen.getByLabelText(/Ngày giao việc/i), { target: { value: futureDate } })

    expect(screen.getByLabelText(`Chọn công việc ${fixedTask.name}`)).toBeTruthy()
    expect(screen.getByLabelText(`Chọn công việc ${rewardTask.name}`)).toBeTruthy()
    irrelevantCatalogItems.forEach((item) => {
      expect(screen.queryByLabelText(`Chọn công việc ${item.name}`)).toBeNull()
    })
  })

  it('reuses the assignment idempotency key after a lost response and rotates it when the draft changes', async () => {
    const replaceTasks = vi.fn().mockResolvedValue({ ok: false, message: 'Mất phản hồi' })
    mocked.app = makeApp('business_support', { replaceTasks })
    render(<StoreTasks />)

    fireEvent.change(screen.getByLabelText(/Ngày giao việc/i), { target: { value: futureDate } })
    fireEvent.click(screen.getByLabelText(`Chọn nhân viên ${employees[0].name}`))
    fireEvent.click(screen.getByLabelText(`Chọn công việc ${fixedTask.name}`))
    fireEvent.click(screen.getByRole('button', { name: /^GỬI$/i }))
    await waitFor(() => expect(replaceTasks).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /^GỬI$/i }))
    await waitFor(() => expect(replaceTasks).toHaveBeenCalledTimes(2))
    const firstKey = replaceTasks.mock.calls[0][0].idempotencyKey
    expect(replaceTasks.mock.calls[1][0].idempotencyKey).toBe(firstKey)

    fireEvent.click(screen.getByLabelText(`Chọn công việc ${rewardTask.name}`))
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

    const picker = screen.getByRole('group', { name: 'Danh mục công việc' })
    expect(picker.classList.contains('task-template-picker')).toBe(true)
    expect(screen.getByText('Admin IDOSI')).toBeTruthy()
    expect(screen.getByText('24/12/99 14:05:06')).toBeTruthy()
    expect(screen.getByText(/Ca tương lai · 14:00–22:00/i)).toBeTruthy()
    expect(screen.getByText(`${employees[0].name}, ${employees[1].name}`)).toBeTruthy()
    expect(screen.getByText('Hoàn thành · 2/2 nhân viên')).toBeTruthy()
    expect(screen.getByText('Chưa hoàn thành · 0/2 nhân viên')).toBeTruthy()
    expect(screen.getByText('Đang thực hiện')).toBeTruthy()
  })

  it.each(['admin', 'store_manager', 'business_support'])('shows mutation controls for %s', (role) => {
    mocked.app = makeApp(role)
    const view = render(<StoreTasks />)
    fireEvent.change(screen.getByLabelText(/Ngày giao việc/i), { target: { value: futureDate } })

    expect(screen.getByRole('button', { name: /^GỬI$/i })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Danh mục công việc' })).toBeTruthy()
    expect(screen.getByLabelText(`Chọn công việc ${fixedTask.name}`)).toBeTruthy()
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
    expect(screen.queryByRole('group', { name: 'Danh mục công việc' })).toBeNull()
    expect(screen.queryByLabelText(`Chọn nhân viên ${employees[0].name}`)).toBeNull()
    expect(screen.getByText(/Mở quầy/)).toBeTruthy()
    expect(screen.getByText(/Chỉ Admin, Quản lý cửa hàng và Nhân viên hỗ trợ KD/i)).toBeTruthy()
  })
})
