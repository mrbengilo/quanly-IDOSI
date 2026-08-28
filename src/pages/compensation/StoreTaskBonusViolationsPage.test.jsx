import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoreTaskBonusViolationsPage } from './StoreTaskBonusViolationsPage'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const stores = [
  { id: 'CH001', name: 'Dosii NTL', status: 'Đang hoạt động' },
  { id: 'CH002', name: 'SM TNV', status: 'Đang hoạt động' },
]

const employees = [
  { id: 'NV-01', name: 'Nguyễn An', unit: 'store', storeId: 'CH001' },
  { id: 'NV-02', name: 'Lê Bình', unit: 'store', storeId: 'CH001' },
  { id: 'QLCH-001', name: 'Trần Quản Lý', unit: 'store_manager', storeId: 'CH001', role: 'store_manager' },
  { id: 'NV-OTHER', name: 'Nhân viên cửa hàng khác', unit: 'store', storeId: 'CH002' },
]

const schedule = [{
  id: 'SCH-NV-01', employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-28',
  shiftIds: ['MORNING'],
  shiftSnapshots: [{ id: 'MORNING', name: 'Ca sáng', start: '08:00', end: '12:00' }],
}, {
  id: 'SCH-NV-02', employeeId: 'NV-02', storeId: 'CH001', date: '2026-08-28',
  shiftIds: ['AFTERNOON'],
  shiftSnapshots: [{ id: 'AFTERNOON', name: 'Ca chiều', start: '12:00', end: '17:00' }],
}]

const baseApp = (role = 'admin') => ({
  session: role === 'store_manager'
    ? { role, employeeId: 'NV-01', storeId: 'CH001' }
    : { role, employeeId: role === 'business_support' ? 'HTKD-01' : 'ADMIN-01' },
  activeStoreId: 'CH001',
  stores,
  employees,
  attendance: [],
  schedule,
  shiftDefinitions: [
    { id: 'MORNING', storeId: 'CH001', name: 'Ca sáng', start: '08:00', end: '12:00', active: true },
    { id: 'AFTERNOON', storeId: 'CH001', name: 'Ca chiều', start: '12:00', end: '17:00', active: true },
  ],
  workCatalogItems: [],
  workCatalogProgress: [],
  compensationEntries: [],
  taskAssignmentHistory: [],
  tasks: [],
  violations: [],
  createViolationBatch: vi.fn().mockResolvedValue({ ok: true }),
  notify: vi.fn(),
})

describe('StoreTaskBonusViolationsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-28T05:00:00.000Z'))
    mocked.app = baseApp()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders approved accessible tabs and only totals active linked reward records in the selected store', () => {
    mocked.app = {
      ...baseApp(),
      workCatalogProgress: [{
        id: 'PROGRESS-01', employeeId: 'NV-01', employeeName: 'Nguyễn An', storeId: 'CH001', workDate: '2026-08-28',
        shiftRef: 'MORNING', catalogItemId: 'REWARD-01', kind: 'REWARD_TASK', name: 'Lau nhà', amountVnd: 2_000,
        completed: true, submittedAt: '2026-08-28T03:15:00.000Z',
      }, {
        id: 'PROGRESS-OTHER', employeeId: 'NV-OTHER', storeId: 'CH002', workDate: '2026-08-28',
        shiftRef: 'MORNING', catalogItemId: 'REWARD-OTHER', kind: 'REWARD_TASK', name: 'Không được xem', amountVnd: 99_000,
        completed: true,
      }],
      compensationEntries: [{ id: 'WORK-01', workCatalogProgressId: 'PROGRESS-01', type: 'WORK', status: 'ACTIVE' }],
    }
    render(<StoreTaskBonusViolationsPage />)

    expect(screen.getByRole('heading', { name: 'CÔNG VIỆC TÍNH THƯỞNG VÀ VI PHẠM' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Công việc tính thưởng' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Ghi nhận vi phạm' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByText('Lau nhà')).toBeTruthy()
    expect(screen.getAllByText('+2,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByText('Đã ghi nhận')).toBeTruthy()
    expect(screen.queryByText('Không được xem')).toBeNull()
    const payableMetric = screen.getByText('THƯỞNG ĐỦ ĐIỀU KIỆN').closest('.metric')
    expect(within(payableMetric).getByText('2,000 đ')).toBeTruthy()
  })

  it('supports roving focus and standard Arrow, Home and End tab keys', () => {
    render(<StoreTaskBonusViolationsPage />)
    const rewardTab = screen.getByRole('tab', { name: 'Công việc tính thưởng' })
    const violationTab = screen.getByRole('tab', { name: 'Ghi nhận vi phạm' })

    expect(rewardTab.tabIndex).toBe(0)
    expect(violationTab.tabIndex).toBe(-1)
    rewardTab.focus()
    fireEvent.keyDown(rewardTab, { key: 'ArrowRight' })
    expect(violationTab.getAttribute('aria-selected')).toBe('true')
    expect(violationTab.tabIndex).toBe(0)
    expect(document.activeElement).toBe(violationTab)

    fireEvent.keyDown(violationTab, { key: 'Home' })
    expect(rewardTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(rewardTab)
    fireEvent.keyDown(rewardTab, { key: 'End' })
    expect(violationTab.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(violationTab, { key: 'ArrowRight' })
    expect(rewardTab.getAttribute('aria-selected')).toBe('true')
  })

  it('resets reward filters when Admin changes the active store', () => {
    mocked.app = {
      ...baseApp(),
      workCatalogProgress: [{
        id: 'PROGRESS-S01', employeeId: 'NV-01', storeId: 'CH001', workDate: '2026-08-28', shiftId: 'MORNING',
        catalogItemId: 'REWARD-FLOOR', kind: 'REWARD_TASK', name: 'Lau nhà', amountVnd: 2_000, completed: true,
      }, {
        id: 'PROGRESS-S02', employeeId: 'NV-OTHER', storeId: 'CH002', workDate: '2026-08-28', shiftId: 'AFTERNOON',
        catalogItemId: 'REWARD-MUSIC', kind: 'REWARD_TASK', name: 'Mở nhạc', amountVnd: 1_000, completed: true,
      }],
      compensationEntries: [
        { id: 'WORK-S01', workCatalogProgressId: 'PROGRESS-S01', type: 'WORK', status: 'ACTIVE' },
        { id: 'WORK-S02', workCatalogProgressId: 'PROGRESS-S02', type: 'WORK', status: 'ACTIVE' },
      ],
    }
    const view = render(<StoreTaskBonusViolationsPage />)
    const search = screen.getByLabelText('Tìm kiếm')
    fireEvent.change(search, { target: { value: 'Lau nhà' } })
    expect(search.value).toBe('Lau nhà')

    mocked.app = { ...mocked.app, activeStoreId: 'CH002' }
    view.rerender(<StoreTaskBonusViolationsPage />)

    expect(screen.getByLabelText('Tìm kiếm').value).toBe('')
    expect(screen.getByText('Mở nhạc')).toBeTruthy()
  })

  it('submits fallback policy codes once as a batch and keeps the idempotency key stable across retry', async () => {
    mocked.app = {
      ...baseApp('business_support'),
      createViolationBatch: vi.fn()
        .mockRejectedValueOnce(new Error('Mạng tạm thời gián đoạn'))
        .mockResolvedValueOnce({ ok: true, batchId: 'BATCH-01' }),
    }
    render(<StoreTaskBonusViolationsPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Ghi nhận vi phạm' }))

    fireEvent.change(screen.getByLabelText('Nhân viên vi phạm'), { target: { value: 'NV-01' } })

    expect(screen.getAllByRole('checkbox')).toHaveLength(15)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn vi phạm Đi trễ' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn vi phạm Quên điểm danh' }))
    const summary = screen.getByLabelText('Tóm tắt vi phạm đã chọn')
    expect(within(summary).getByText('−4,000 đ')).toBeTruthy()

    fireEvent.click(within(summary).getByRole('button', { name: 'LƯU VI PHẠM' }))
    await waitFor(() => expect(screen.getByText('Mạng tạm thời gián đoạn')).toBeTruthy())
    fireEvent.click(within(summary).getByRole('button', { name: 'LƯU VI PHẠM' }))
    await waitFor(() => expect(mocked.app.createViolationBatch).toHaveBeenCalledTimes(2))

    const first = mocked.app.createViolationBatch.mock.calls[0][0]
    const second = mocked.app.createViolationBatch.mock.calls[1][0]
    expect(first).toMatchObject({
      targetUnit: 'store', storeId: 'CH001', employeeId: 'NV-01', occurredOn: '2026-08-28', shiftId: 'MORNING',
      policyCodes: ['store.violation.late', 'store.violation.forgot_attendance'],
    })
    expect(first.catalogItemIds).toBeUndefined()
    expect(first.idempotencyKey).toBe(second.idempotencyKey)
    expect(mocked.app.notify).toHaveBeenCalledWith('Đã ghi nhận 2 vi phạm cho Nguyễn An.', 'success')
  })

  it('offers a transferred employee only on a day with explicit work evidence at the selected store', () => {
    mocked.app = {
      ...baseApp(),
      employees: [
        ...employees,
        { id: 'NV-TRANSFER', name: 'Nhân viên đã điều chuyển', unit: 'store', storeId: 'CH002' },
      ],
      attendance: [{
        id: 'ATT-TRANSFER-HISTORY', employeeId: 'NV-TRANSFER', storeId: 'CH001', date: '2026-08-28',
        shiftId: 'MORNING', shiftName: 'Ca sáng lịch sử', shiftStart: '08:00', shiftEnd: '12:00',
      }],
    }
    render(<StoreTaskBonusViolationsPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Ghi nhận vi phạm' }))

    const employeePicker = screen.getByLabelText('Nhân viên vi phạm')
    expect(within(employeePicker).getByRole('option', { name: /Nhân viên đã điều chuyển/u })).toBeTruthy()
    const dateInput = screen.getByLabelText('Ngày vi phạm')
    expect(dateInput.max).toBe('2026-08-28')
    fireEvent.change(dateInput, { target: { value: '2026-08-27' } })
    expect(within(employeePicker).queryByRole('option', { name: /Nhân viên đã điều chuyển/u })).toBeNull()
  })

  it('locks a store manager to the assigned store and sends catalog ids when available', async () => {
    mocked.app = {
      ...baseApp('store_manager'),
      activeStoreId: 'CH002',
      workCatalogItems: [{
        id: 'CATALOG-LATE', code: 'store.violation.late', kind: 'VIOLATION', targetGroup: 'store', storeId: 'CH001',
        name: 'Đi trễ theo danh mục', amountVnd: 2_000, active: true, version: 1, sortOrder: 1,
        effectiveFrom: '2026-08-01', effectiveTo: null,
      }],
    }
    render(<StoreTaskBonusViolationsPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Ghi nhận vi phạm' }))

    expect(screen.getAllByText('Dosii NTL').length).toBeGreaterThan(0)
    expect(screen.queryByText('Nhân viên cửa hàng khác')).toBeNull()
    expect(within(screen.getByLabelText('Nhân viên vi phạm')).queryByRole('option', { name: /Trần Quản Lý/u })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn vi phạm Đi trễ theo danh mục' }))
    fireEvent.click(screen.getByRole('button', { name: 'LƯU VI PHẠM' }))

    await waitFor(() => expect(mocked.app.createViolationBatch).toHaveBeenCalledWith(expect.objectContaining({
      storeId: 'CH001', catalogItemIds: ['CATALOG-LATE'],
    })))
    expect(mocked.app.createViolationBatch.mock.calls[0][0].policyCodes).toBeUndefined()
  })

  it('blocks the checklist when the work catalog is malformed instead of showing an unsavable fallback', () => {
    mocked.app = {
      ...baseApp(),
      workCatalogItems: [{ id: 'BROKEN-CATALOG', kind: 'VIOLATION', targetGroup: 'store', storeId: 'CH001' }],
    }
    render(<StoreTaskBonusViolationsPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Ghi nhận vi phạm' }))

    expect(screen.getByText('Danh mục vi phạm đang có dữ liệu không hợp lệ. Vui lòng liên hệ Admin để sửa danh mục trước khi lưu.')).toBeTruthy()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'LƯU VI PHẠM' }).disabled).toBe(true)
  })

  it('disables saving when the employee has neither schedule nor attendance for the day', () => {
    mocked.app = { ...baseApp(), schedule: [], attendance: [] }
    render(<StoreTaskBonusViolationsPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Ghi nhận vi phạm' }))

    expect(screen.getByText('Nhân viên chưa có lịch phân ca hoặc chấm công tại cửa hàng trong ngày này.')).toBeTruthy()
    expect(screen.getByLabelText('Ca nhân viên đã làm').disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'LƯU VI PHẠM' }).disabled).toBe(true)
  })
})
