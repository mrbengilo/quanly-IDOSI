import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { StoreTasks } from './StoreOperations'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', async (importOriginal) => ({
  ...await importOriginal(),
  useApp: () => mocked.app,
}))

vi.mock('../compensation/ViolationManagementPage', () => ({
  ViolationManagementPage: ({ targetUnit, storeId, embedded }) => <div data-testid="store-violation-management" data-target-unit={targetUnit} data-store-id={storeId} data-embedded={String(embedded)} />,
}))

vi.mock('../compensation/UnitCompensationStatistics', () => ({
  UnitCompensationStatistics: ({ targetUnit, storeId, employees, sections }) => <div data-testid="store-compensation-statistics" data-target-unit={targetUnit} data-store-id={storeId} data-employee-count={employees.length} data-sections={sections} />,
}))

const store = { id: 'CH001', name: 'SM TNV', short: 'SM TNV' }
const employees = [
  { id: 'ST-001', name: 'Nguyễn Thị Thúy Trang', unit: 'store', storeId: store.id, status: 'Đang làm việc' },
  { id: 'ST-002', name: 'Trần Thị Ngọc Bích', unit: 'store', storeId: store.id, status: 'Đang làm việc' },
]
const violation = {
  id: 'store-violation-late',
  code: 'store.violation.late',
  kind: 'VIOLATION',
  targetGroup: 'store',
  storeId: store.id,
  name: 'Đi trễ',
  amountVnd: 2_000,
  active: true,
  effectiveFrom: '2026-01-01',
}

const makeApp = (role = 'business_support') => ({
  session: { role, employeeId: 'HTKD-001', storeId: role === 'store_manager' ? store.id : undefined },
  stores: [store],
  activeStoreId: store.id,
  employees,
  attendance: [],
  workCatalogProgress: [],
  compensationEntries: [],
  workCatalogItems: [violation],
  tasks: [],
  taskAssignmentHistory: [],
  schedule: [],
})

const renderStoreTasks = (entry = '/store/tasks') => render(
  <MemoryRouter initialEntries={[entry]}>
    <StoreTasks />
  </MemoryRouter>,
)

describe('StoreTasks reward and violation tabs', () => {
  afterEach(cleanup)

  it.each(['admin', 'store_manager', 'business_support'])('shows reporting instead of reward assignment controls for %s', (role) => {
    mocked.app = makeApp(role)
    renderStoreTasks()

    expect(screen.getByRole('heading', { level: 1, name: /Công việc tính thưởng & vi phạm/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Thưởng công việc/i }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /Vi phạm/i }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByText(/nhân viên tự tick và lưu/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^GỬI$/i })).toBeNull()
    expect(screen.queryByText(/Chọn nhân viên nhận việc/i)).toBeNull()
    expect(screen.queryByRole('group', { name: /Danh mục công việc/i })).toBeNull()
    expect(screen.getByTestId('store-compensation-statistics').dataset).toMatchObject({
      targetUnit: 'store',
      storeId: store.id,
      employeeCount: '2',
      sections: 'reward',
    })
  })

  it('switches to the always-available violation workflow in one click', () => {
    mocked.app = makeApp('store_manager')
    renderStoreTasks()

    const rewardTab = screen.getByRole('tab', { name: /Thưởng công việc/i })
    const violationTab = screen.getByRole('tab', { name: /Vi phạm/i })
    expect(document.getElementById('store-task-reward-panel')).toBeTruthy()
    expect(document.getElementById('store-task-violation-panel')).toBeNull()
    fireEvent.click(violationTab)

    expect(rewardTab.getAttribute('aria-selected')).toBe('false')
    expect(violationTab.getAttribute('aria-selected')).toBe('true')
    expect(document.getElementById('store-task-reward-panel')).toBeNull()
    expect(document.getElementById('store-task-violation-panel')).toBeTruthy()
    expect(screen.getByTestId('store-violation-management').dataset).toMatchObject({
      targetUnit: 'store',
      storeId: store.id,
      embedded: 'true',
    })
  })

  it('does not expose store violation mutation controls to an employee route', () => {
    mocked.app = makeApp('employee')
    mocked.app.session = { role: 'employee', employeeId: employees[0].id, storeId: store.id }
    renderStoreTasks()

    expect(screen.getByRole('tab', { name: /Thưởng công việc/i })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /Vi phạm/i })).toBeNull()
    expect(screen.queryByTestId('store-violation-management')).toBeNull()
    expect(screen.getByTestId('store-compensation-statistics')).toBeTruthy()
  })

  it('restores the mandatory progress submitted from a manager notification link', () => {
    mocked.app = makeApp('store_manager')
    mocked.app.taskAssignmentHistory = [{
      id: 'ASSIGN-1',
      assignmentId: 'ASSIGN-1',
      storeId: store.id,
      date: '2026-08-29',
      shiftId: 'SHIFT-MORNING',
      tasks: [
        { id: 'TASK-REQUIRED', title: 'Kiểm tra quầy', required: true, completedBy: { 'ST-001': true } },
        { id: 'TASK-REWARD', title: 'Đổ rác', required: false, completedBy: { 'ST-001': false } },
      ],
      progressHistory: [{
        action: 'progress-submitted',
        employeeId: 'ST-001',
        employeeName: 'Nguyễn Thị Thúy Trang',
        date: '2026-08-29',
        shiftId: 'SHIFT-MORNING',
        completedTasks: 1,
        totalTasks: 1,
        completionRate: 100,
        at: '2026-08-29T02:15:00.000Z',
      }],
    }]

    renderStoreTasks('/store/tasks?assignment=ASSIGN-1')

    expect(screen.getByText('Kết quả công việc bắt buộc nhân viên đã gửi')).toBeTruthy()
    expect(screen.getByText('Nguyễn Thị Thúy Trang')).toBeTruthy()
    expect(screen.getByText('1/1 (100%)')).toBeTruthy()
    expect(screen.getByText('Kiểm tra quầy')).toBeTruthy()
    expect(screen.queryByText('Đổ rác')).toBeNull()
    expect(screen.getByText('Đã hoàn thành')).toBeTruthy()
  })
})
