import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagerCompensationPage } from './ManagerCompensationPage'
import { MyCompensationPage } from './MyCompensationPage'
import { RevenueBonusPage } from './RevenueBonusPage'
import { MyViolationsPage, ViolationManagementPage } from './ViolationManagementPage'
import { UnitCompensationStatistics } from './UnitCompensationStatistics'

const mocked = vi.hoisted(() => ({ app: {}, liveRevenue: vi.fn() }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusLive: (payload) => mocked.liveRevenue(payload),
}))

const stores = [
  { id: 'CH001', name: 'Dosii NTL' },
  { id: 'CH002', name: 'SM TNV' },
  { id: 'BUSINESS_SUPPORT', name: 'HTKD' },
]

const employees = [
  { id: 'QL-01', name: 'Quản lý Một', unit: 'store', storeId: 'CH001', isStoreManager: true },
  { id: 'QL-02', name: 'Quản lý Hai', unit: 'store', storeId: 'CH002', isStoreManager: true },
  { id: 'NV-01', name: 'Nhân viên Một', unit: 'store', storeId: 'CH001' },
  { id: 'NV-02', name: 'Nhân viên Hai', unit: 'store', storeId: 'CH001' },
  { id: 'HT-01', name: 'Hỗ trợ Một', unit: 'business_support' },
]

const baseApp = (role = 'admin') => ({
  session: {
    role,
    employeeId: role === 'employee' ? 'NV-01' : role === 'store_manager' ? 'QL-01' : undefined,
    storeId: role === 'store_manager' ? 'CH001' : undefined,
  },
  currentEmployee: role === 'employee' ? employees[2] : role === 'store_manager' ? employees[0] : null,
  stores,
  employees,
  managerAccounts: [],
  compensationEntries: [],
  violations: [],
  revenueBonuses: [],
  payrollPeriods: [],
  attendance: [{
    id: 'ATT-QL-01', employeeId: 'QL-01', storeId: 'CH001', unit: 'store', workDate: '2026-08-26',
    shiftId: 'ca1', shiftName: 'Ca 1', shiftStart: '07:00', shiftEnd: '12:00',
  }],
  schedule: [],
  supportWorkSchedules: [],
  shiftDefinitions: [{ id: 'ca1', storeId: 'CH001', name: 'Ca 1', start: '07:00', end: '12:00', active: true }],
  workCatalogItems: [{
    id: 'violation-store-late', code: 'store.violation.late', kind: 'violation',
    targetGroup: 'store', storeId: 'CH001', shiftId: null, shiftName: null,
    name: 'Đi trễ', amountVnd: 2_000, sortOrder: 10, active: true,
    version: 1, effectiveFrom: '2026-08-01', effectiveTo: null,
  }, {
    id: 'violation-store-uniform', code: 'store.violation.uniform', kind: 'violation',
    targetGroup: 'store', storeId: 'CH001', shiftId: null, shiftName: null,
    name: 'Sai đồng phục', amountVnd: 3_000, sortOrder: 20, active: true,
    version: 1, effectiveFrom: '2026-08-01', effectiveTo: null,
  }],
  notify: vi.fn(),
  createCompensationEntry: vi.fn().mockResolvedValue({ ok: true }),
  approveCompensationEntry: vi.fn().mockResolvedValue({ ok: true }),
  voidCompensationEntry: vi.fn().mockResolvedValue({ ok: true }),
  createViolationBatch: vi.fn().mockResolvedValue({ ok: true, createdCount: 2, existingCount: 0 }),
  voidViolation: vi.fn().mockResolvedValue({ ok: true }),
  calculateRevenueBonusDay: vi.fn().mockResolvedValue({ ok: true }),
  approveRevenueBonusMilestone: vi.fn().mockResolvedValue({ ok: true }),
  rejectRevenueBonusMilestone: vi.fn().mockResolvedValue({ ok: true }),
})

describe('compensation pages', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-26T05:00:00.000Z'))
    mocked.liveRevenue.mockReset()
    mocked.app = baseApp()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('lets HTKD manage managers across all operational stores and preserves exact VND input', async () => {
    mocked.app = baseApp('business_support')
    render(<ManagerCompensationPage />)

    const storeSelect = screen.getByLabelText('Cửa hàng')
    expect(within(storeSelect).getByRole('option', { name: 'Dosii NTL' })).toBeTruthy()
    expect(within(storeSelect).getByRole('option', { name: 'SM TNV' })).toBeTruthy()
    fireEvent.change(storeSelect, { target: { value: 'CH002' } })
    expect(screen.getByLabelText('Quản lý cửa hàng').value).toBe('QL-02')
    fireEvent.change(screen.getByLabelText('Số tiền'), { target: { value: '35' } })
    fireEvent.change(screen.getByLabelText('Nội dung'), { target: { value: 'Thưởng hỗ trợ vận hành' } })
    fireEvent.click(screen.getByRole('button', { name: 'TẠO KHOẢN GHI NHẬN' }))

    await waitFor(() => expect(mocked.app.createCompensationEntry).toHaveBeenCalledWith(expect.objectContaining({
      type: 'MANUAL', employeeId: 'QL-02', storeId: 'CH002', amountVnd: 35,
    })))
  })

  it('denies store-manager compensation mutations and lets HTKD manage peer violations', () => {
    mocked.app = baseApp('store_manager')
    const { rerender } = render(<ManagerCompensationPage />)
    expect(screen.getByRole('heading', { name: 'KHÔNG CÓ QUYỀN TRUY CẬP' })).toBeTruthy()

    mocked.app = baseApp('business_support')
    rerender(<ViolationManagementPage targetUnit="business_support" />)
    expect(screen.getByText('Ghi nhận vi phạm')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'LƯU VI PHẠM' })).toBeTruthy()
  })

  it('creates a policy-backed violation batch using only server-resolved catalog and shift identifiers', async () => {
    render(<ViolationManagementPage targetUnit="store" />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Đi trễ/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Sai đồng phục/i }))
    expect(screen.getByLabelText('Tổng số tiền bị trừ').value).toBe('−5,000 đ')
    fireEvent.click(screen.getByRole('button', { name: 'LƯU VI PHẠM' }))

    await waitFor(() => expect(mocked.app.createViolationBatch).toHaveBeenCalledWith({
      targetUnit: 'store',
      employeeId: 'QL-01',
      storeId: 'CH001',
      occurredOn: '2026-08-26',
      shiftId: 'ca1',
      attendanceId: 'ATT-QL-01',
      catalogItemIds: ['violation-store-late', 'violation-store-uniform'],
      note: '',
    }))
  })

  it('keeps the violation checklist visible before an employee has a matching shift', () => {
    mocked.app = { ...baseApp(), attendance: [], schedule: [], shiftDefinitions: [] }
    render(<ViolationManagementPage targetUnit="store" />)

    expect(screen.getByRole('checkbox', { name: /Đi trễ/i })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /Sai đồng phục/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'LƯU VI PHẠM' }).disabled).toBe(true)
    expect(screen.getByText(/Không tìm thấy ca đã chấm công hoặc ca đã phân/i)).toBeTruthy()
  })

  it('locks an embedded store violation workflow to the active store', () => {
    mocked.app = {
      ...baseApp(),
      attendance: [{
        id: 'ATT-NV-02', employeeId: 'NV-02', storeId: 'CH001', unit: 'store', workDate: '2026-08-26',
        shiftId: 'ca1', shiftName: 'Ca 1', shiftStart: '07:00', shiftEnd: '12:00',
      }],
    }
    render(<ViolationManagementPage targetUnit="store" storeId="CH001" embedded />)

    const storeField = screen.getByLabelText('Cửa hàng')
    expect(storeField.tagName).toBe('INPUT')
    expect(storeField.readOnly).toBe(true)
    expect(storeField.value).toBe('Dosii NTL')
    expect(screen.queryByRole('option', { name: 'SM TNV' })).toBeNull()
    expect(screen.getByLabelText('Nhân viên').textContent).not.toContain('Quản lý Hai')
  })

  it('reports an idempotent violation batch as unchanged instead of claiming a new deduction', async () => {
    mocked.app = {
      ...baseApp(),
      createViolationBatch: vi.fn().mockResolvedValue({ ok: true, createdCount: 0, existingCount: 1 }),
    }
    render(<ViolationManagementPage targetUnit="store" />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Đi trễ/i }))
    fireEvent.click(screen.getByRole('button', { name: 'LƯU VI PHẠM' }))

    await waitFor(() => expect(mocked.app.notify).toHaveBeenCalledWith(
      'Không tạo bản ghi mới vì các vi phạm đã tồn tại trong lịch sử đối soát.',
      'info',
    ))
  })

  it('keeps historical violations in unit statistics after the employee leaves the active directory', () => {
    mocked.app = {
      ...baseApp(),
      attendance: [],
      violations: [{
        id: 'V-FORMER', employeeId: 'NV-CU', employeeName: 'Nhân viên đã nghỉ',
        targetUnit: 'store', storeId: 'CH001', occurredOn: '2026-08-20',
        title: 'Đi trễ', amountVnd: 2_000, status: 'ACTIVE',
      }],
    }
    render(<UnitCompensationStatistics targetUnit="store" storeId="CH001" employees={employees.filter((employee) => employee.storeId === 'CH001')} />)

    expect(screen.getByText('Nhân viên đã nghỉ')).toBeTruthy()
    expect(screen.getAllByText('−2,000 đ').length).toBeGreaterThan(0)
  })

  it('filters store reward history by historical date, shift and employee and totals the visible rows', () => {
    const rewardRows = [{
      id: 'R-1', employeeId: 'NV-01', employeeName: 'Nhân viên Một', workDate: '2026-08-25',
      shiftId: 'ca1', shiftName: 'Ca 1', title: 'Đi làm đúng giờ', amountVnd: 3_000,
      completed: true, payoutStatus: 'approved', completedAt: '2026-08-25T01:00:00.000Z',
    }, {
      id: 'R-2', employeeId: 'NV-FORMER', employeeName: 'Nhân viên đã nghỉ', workDate: '2026-08-25',
      shiftId: 'ca2', shiftName: 'Ca 2', title: 'Dọn quầy', amountVnd: 5_000,
      completed: true, payoutStatus: 'approved', completedAt: '2026-08-25T06:00:00.000Z',
    }, {
      id: 'R-3', employeeId: 'NV-01', employeeName: 'Nhân viên Một', workDate: '2026-08-26',
      shiftId: 'ca2', shiftName: 'Ca 2', title: 'Đổ rác', amountVnd: 7_000,
      completed: true, payoutStatus: 'approved', completedAt: '2026-08-26T06:00:00.000Z',
    }, {
      id: 'R-VOID', employeeId: 'NV-01', employeeName: 'Nhân viên Một', workDate: '2026-08-25',
      shiftId: 'ca1', shiftName: 'Ca 1', title: 'Đã hủy', amountVnd: 99_000,
      completed: true, payoutStatus: 'void', completedAt: '2026-08-25T01:00:00.000Z',
    }, {
      id: 'R-OPEN', employeeId: 'NV-01', employeeName: 'Nhân viên Một', workDate: '2026-08-25',
      shiftId: 'ca1', shiftName: 'Ca 1', title: 'Chưa hoàn thành', amountVnd: 88_000,
      completed: false, payoutStatus: 'pending', completedAt: '',
    }]
    const scopedEmployees = employees.filter((employee) => employee.storeId === 'CH001')
    const view = render(<UnitCompensationStatistics
      targetUnit="store"
      storeId="CH001"
      employees={scopedEmployees}
      sections="reward"
      rewardRows={rewardRows}
    />)
    const historyCard = screen.getByRole('heading', { name: 'Lịch sử nhận thưởng — cửa hàng' }).closest('section')
    const dateFilter = within(historyCard).getByLabelText('Ngày nhận thưởng')
    const shiftFilter = within(historyCard).getByLabelText('Ca nhận thưởng')
    const employeeFilter = within(historyCard).getByLabelText('Nhân viên nhận thưởng')
    const historyHeader = historyCard.querySelector('thead')

    expect(within(employeeFilter).getByRole('option', { name: 'Nhân viên đã nghỉ' })).toBeTruthy()
    expect(within(historyHeader).getByText('+15,000 đ')).toBeTruthy()

    fireEvent.change(dateFilter, { target: { value: '2026-08-25' } })
    expect(within(historyHeader).getByText('+8,000 đ')).toBeTruthy()
    fireEvent.change(shiftFilter, { target: { value: 'shift:id:ca2' } })
    expect(within(historyHeader).getByText('+5,000 đ')).toBeTruthy()
    expect(within(historyCard).queryByText('Đi làm đúng giờ')).toBeNull()
    expect(within(historyCard).getByText('Dọn quầy')).toBeTruthy()

    fireEvent.change(employeeFilter, { target: { value: 'employee:id:NV-FORMER' } })
    fireEvent.change(dateFilter, { target: { value: '2026-08-26' } })
    expect(within(historyHeader).getByText('+0 đ')).toBeTruthy()
    expect(within(historyCard).getByText('Không có lịch sử phù hợp bộ lọc.')).toBeTruthy()

    view.rerender(<UnitCompensationStatistics
      targetUnit="office"
      employees={scopedEmployees}
      sections="reward"
      rewardRows={rewardRows}
    />)
    expect(screen.queryByLabelText('Ngày nhận thưởng')).toBeNull()
    expect(screen.queryByLabelText('Ca nhận thưởng')).toBeNull()
    expect(screen.queryByLabelText('Nhân viên nhận thưởng')).toBeNull()
  })

  it('shows the signed-in employee violation date, shift and negative deduction clearly', () => {
    mocked.app = {
      ...baseApp('employee'),
      violations: [{
        id: 'V-OWN', employeeId: 'NV-01', targetUnit: 'store', storeId: 'CH001',
        occurredOn: '2026-08-26', shiftId: 'ca2', shiftName: 'Ca 2', shiftStart: '12:00', shiftEnd: '17:00',
        title: 'Đi trễ', amountVnd: 2_000, status: 'ACTIVE',
      }],
    }
    render(<MyViolationsPage />)

    expect(screen.getByText('Ca 2')).toBeTruthy()
    expect(screen.getByText('12:00–17:00')).toBeTruthy()
    expect(screen.getAllByText('−2,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByText('Tổng số tiền bị trừ đang hiệu lực')).toBeTruthy()
  })

  it('keeps employee revenue bonus data private to the signed-in employee', () => {
    mocked.app = {
      ...baseApp('employee'),
      revenueBonuses: [{
        id: 'RB-01', storeId: 'CH001', businessDate: '2026-08-26', totalPoolVnd: 134,
        allocations: [
          { id: 'A-01', employeeId: 'NV-01', employeeName: 'Nhân viên Một', allocatedVnd: 35, status: 'Đã duyệt' },
          { id: 'A-02', employeeId: 'NV-02', employeeName: 'Nhân viên Hai', allocatedVnd: 99, status: 'Đã duyệt' },
        ],
      }],
    }
    render(<RevenueBonusPage />)

    expect(screen.getAllByText('134 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('35 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('99 đ')).toBeNull()
    expect(screen.queryByText('Nhân viên Hai')).toBeNull()
    expect(screen.queryByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })).toBeNull()
  })

  it('shows a store manager the complete reward allocation for their assigned store', () => {
    mocked.app = {
      ...baseApp('store_manager'),
      revenueBonuses: [{
        id: 'RB-MANAGER', storeId: 'CH001', businessDate: '2026-08-26', totalPoolVnd: 170,
        allocations: [
          { id: 'A-MANAGER', storeId: 'CH001', businessDate: '2026-08-26', employeeId: 'QL-01', employeeName: 'Quản lý Một', allocatedVnd: 70, status: 'Đã duyệt' },
          { id: 'A-COWORKER', storeId: 'CH001', businessDate: '2026-08-26', employeeId: 'NV-02', employeeName: 'Nhân viên Hai', allocatedVnd: 100, status: 'Đã duyệt' },
        ],
      }],
    }
    render(<RevenueBonusPage />)

    expect(screen.getAllByText('170 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('70 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('100 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Nhân viên Hai').length).toBeGreaterThan(0)
    expect(screen.getByText('TỔNG GIỜ LÀM CỬA HÀNG')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })).toBeNull()
  })

  it('filters manager revenue history by past date, synchronized month and employee with accurate totals', () => {
    vi.setSystemTime(new Date('2026-09-01T05:00:00.000Z'))
    mocked.app = {
      ...baseApp('store_manager'),
      revenueBonuses: [{
        id: 'RB-AUG', storeId: 'CH001', businessDate: '2026-08-25', period: '2026-08', status: 'APPROVED',
        totalPoolVnd: 8_000,
        allocations: [{
          id: 'A-AUG-1', employeeId: 'NV-01', employeeName: 'Nhân viên Một',
          allocatedVnd: 3_000, approvedSalesHours: 2, weightPercent: 37.5, status: 'APPROVED',
        }, {
          id: 'A-AUG-2', employeeId: 'nv-02', employeeName: 'Nhân viên Hai',
          allocatedVnd: 5_000, approvedSalesHours: 3, weightPercent: 62.5, status: 'APPROVED',
        }],
      }, {
        id: 'RB-SEP', storeId: 'ch001', businessDate: '2026-09-01', period: '2026-09', status: 'APPROVED',
        totalPoolVnd: 7_000,
        allocations: [{
          id: 'A-SEP', employeeId: 'QL-01', employeeName: 'Quản lý Một',
          allocatedVnd: 7_000, approvedSalesHours: 4, weightPercent: 100, status: 'APPROVED',
        }],
      }],
    }

    render(<RevenueBonusPage storeScoped />)

    const historyCard = screen.getByRole('heading', { name: 'Lịch sử ghi nhận thưởng doanh thu' }).closest('section')
    const dateFilter = within(historyCard).getByLabelText('Ngày ghi nhận thưởng doanh thu')
    const monthFilter = within(historyCard).getByLabelText('Tháng ghi nhận thưởng doanh thu')
    const employeeFilter = within(historyCard).getByLabelText('Nhân viên nhận thưởng doanh thu')
    const historyBody = historyCard.querySelector('tbody')

    expect(monthFilter.value).toBe('2026-09')
    expect(within(historyCard).getByText('Tổng thưởng: 7,000 đ')).toBeTruthy()
    expect(within(historyBody).queryByText('Nhân viên Hai')).toBeNull()

    fireEvent.change(dateFilter, { target: { value: '2026-08-25' } })
    expect(monthFilter.value).toBe('2026-08')
    expect(within(historyCard).getByText('Tổng thưởng: 8,000 đ')).toBeTruthy()
    expect(within(historyBody).getByText('Nhân viên Hai')).toBeTruthy()

    fireEvent.change(employeeFilter, { target: { value: 'NV-02' } })
    expect(within(historyCard).getByText('Tổng thưởng: 5,000 đ')).toBeTruthy()
    expect(within(historyBody).queryByText('Nhân viên Một')).toBeNull()
    const statisticsCard = screen.getByRole('heading', { name: 'Thống kê thưởng doanh thu' }).closest('section')
    expect(within(statisticsCard).getAllByText('8,000 đ').length).toBeGreaterThan(0)
  })

  it('derives the Admin/HTKD revenue, reached tier and allocation hours from live orders and attendance', () => {
    mocked.app = {
      ...baseApp('business_support'),
      apiStatus: 'local',
      orders: [{
        id: 'ORDER-LIVE', storeId: 'CH001', amount: 1_800_000, status: 'Hoàn tất',
        createdAt: '2026-08-26T09:00:00+07:00',
      }],
      attendance: [
        { id: 'ATT-QL', employeeId: 'QL-01', storeId: 'CH001', workDate: '2026-08-26', workedSeconds: 7_200, checkOutAt: '2026-08-26T10:00:00+07:00' },
        { id: 'ATT-NV', employeeId: 'NV-01', storeId: 'CH001', workDate: '2026-08-26', checkInAt: '2026-08-26T10:00:00+07:00' },
      ],
    }
    render(<RevenueBonusPage />)

    expect(screen.getAllByText('1,800,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('18,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByText('Đang ở mốc 1%')).toBeTruthy()
    expect(screen.getByText('Đã đạt mốc')).toBeTruthy()
    expect(screen.getAllByText('2.00 giờ').length).toBe(2)
    expect(screen.getAllByText('Tạm tính trực tiếp').length).toBe(2)
  })

  it('uses the SM revenue program from the canonical SM-TNV store code', () => {
    mocked.app = {
      ...baseApp('business_support'),
      apiStatus: 'local',
      activeStoreId: 'CH002',
      stores: [
        stores[0],
        { id: 'CH002', name: 'Cửa hàng 2', code: 'SM-TNV' },
        stores[2],
      ],
      orders: [{
        id: 'ORDER-SM-LIVE', storeId: 'CH002', amount: 7_000_000, status: 'Hoàn tất',
        createdAt: '2026-08-26T09:00:00+07:00',
      }],
      attendance: [{
        id: 'ATT-SM-LIVE', employeeId: 'QL-02', storeId: 'CH002', workDate: '2026-08-26',
        workedSeconds: 3_600, checkOutAt: '2026-08-26T10:00:00+07:00',
      }],
    }

    render(<RevenueBonusPage />)

    expect(screen.getByText('Mốc thưởng doanh thu SM TNV')).toBeTruthy()
    expect(screen.getByText('Đang ở mốc 6%')).toBeTruthy()
  })

  it('renders the employee live store aggregate without exposing coworker allocation rows', async () => {
    mocked.app = { ...baseApp('employee'), apiStatus: 'connected' }
    mocked.liveRevenue.mockResolvedValue({
      snapshot: {
        storeId: 'CH001', businessDate: '2026-08-26', projectedAt: '2026-08-26T05:00:00.000Z',
        revenueVnd: 1_800_000, percentagePoolVnd: 18_000, allocatedVnd: 18_000, unallocatedVnd: 0,
        totalWorkedSeconds: 14_400, attendanceCount: 2, openAttendanceCount: 0,
        allocations: [{ employeeId: 'NV-01', employeeName: 'Nhân viên Một', workedSeconds: 7_200, weightPercent: 50, amountVnd: 9_000, status: 'LIVE' }],
      },
    })
    render(<RevenueBonusPage />)

    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledWith({ storeId: 'CH001', businessDate: '2026-08-26' }))
    expect((await screen.findAllByText('9,000 đ')).length).toBeGreaterThan(1)
    expect(screen.getByText('2 giờ 00 phút')).toBeTruthy()
    expect(screen.getByText('4 giờ 00 phút')).toBeTruthy()
    expect(screen.queryByText('Nhân viên Hai')).toBeNull()
  })

  it('marks the last live snapshot stale after a poll error and clears the warning after recovery', async () => {
    let poll
    let pollTimerId
    let nextTimerId = 70
    const intervalSpy = vi.spyOn(window, 'setInterval').mockImplementation((callback, delay) => {
      nextTimerId += 1
      if (delay === 5_000) {
        poll = callback
        pollTimerId = nextTimerId
      }
      return nextTimerId
    })
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => {})
    const liveSnapshot = {
      storeId: 'CH001', businessDate: '2026-08-26', projectedAt: '2026-08-26T05:00:00.000Z',
      revenueVnd: 1_800_000, percentagePoolVnd: 18_000, allocatedVnd: 18_000, unallocatedVnd: 0,
      totalWorkedSeconds: 7_200, attendanceCount: 1, openAttendanceCount: 0, allocations: [],
      calculationEligibility: { allowed: false, code: 'ATTENDANCE_OPEN', message: 'Chưa đủ điều kiện.' },
    }
    mocked.app = { ...baseApp('business_support'), apiStatus: 'connected' }
    mocked.liveRevenue
      .mockResolvedValueOnce({ snapshot: liveSnapshot })
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ snapshot: liveSnapshot })

    const { unmount } = render(<RevenueBonusPage />)
    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Tự cập nhật mỗi 5 giây')).toBeTruthy()

    await act(async () => { await poll() })

    expect(screen.getByText(/không thể cập nhật dữ liệu trực tiếp/i)).toBeTruthy()
    expect(screen.queryByText('Tự cập nhật mỗi 5 giây')).toBeNull()
    expect(screen.getByText(/dữ liệu gần nhất lúc/i)).toBeTruthy()

    await act(async () => { await poll() })

    expect(screen.queryByText(/không thể cập nhật dữ liệu trực tiếp/i)).toBeNull()
    expect(screen.getByText('Tự cập nhật mỗi 5 giây')).toBeTruthy()
    unmount()
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000)
    expect(clearIntervalSpy).toHaveBeenCalledWith(pollTimerId)
  })

  it('discards a prior remote snapshot when the application returns to local mode', async () => {
    mocked.app = { ...baseApp('business_support'), apiStatus: 'connected' }
    mocked.liveRevenue.mockResolvedValue({
      snapshot: {
        storeId: 'CH001', businessDate: '2026-08-26', revenueVnd: 1_800_000,
        percentagePoolVnd: 18_000, allocatedVnd: 18_000, unallocatedVnd: 0,
        totalWorkedSeconds: 3_600, attendanceCount: 1, openAttendanceCount: 0, allocations: [],
        calculationEligibility: { allowed: false, code: 'ATTENDANCE_OPEN', message: 'Chưa đủ điều kiện.' },
      },
    })
    const { rerender } = render(<RevenueBonusPage />)
    expect((await screen.findAllByText('1,800,000 đ')).length).toBeGreaterThan(0)

    mocked.app = {
      ...baseApp('business_support'),
      apiStatus: 'local',
      orders: [{
        id: 'ORDER-LOCAL', storeId: 'CH001', amount: 3_000_000, status: 'Hoàn tất',
        createdAt: '2026-08-26T09:00:00+07:00',
      }],
      attendance: [{
        id: 'ATT-LOCAL', employeeId: 'QL-01', storeId: 'CH001', workDate: '2026-08-26',
        workedSeconds: 3_600, checkOutAt: '2026-08-26T10:00:00+07:00',
      }],
    }
    rerender(<RevenueBonusPage />)

    expect(screen.getAllByText('3,000,000 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('1,800,000 đ')).toBeNull()
  })

  it('keeps calculation disabled while the final-shift attendance is still open', async () => {
    mocked.app = { ...baseApp('business_support'), apiStatus: 'connected' }
    mocked.liveRevenue.mockResolvedValue({
      snapshot: {
        storeId: 'ch001', businessDate: '2026-08-26', revenueVnd: 1_800_000,
        percentagePoolVnd: 18_000, allocatedVnd: 0, unallocatedVnd: 18_000,
        totalWorkedSeconds: 3_600, attendanceCount: 1, openAttendanceCount: 1, allocations: [],
        calculationEligibility: {
          allowed: false, code: 'ATTENDANCE_OPEN', openAttendanceCount: 1,
          message: 'Vẫn còn nhân viên chưa kết ca trong ngày.',
        },
      },
    })

    render(<RevenueBonusPage />)

    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledTimes(1))
    const button = await screen.findByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })
    expect(button.disabled).toBe(true)
    expect(screen.getByText('Vẫn còn nhân viên chưa kết ca trong ngày.')).toBeTruthy()
  })

  it('shows the immutable saved result after calculation instead of a changed live projection', async () => {
    mocked.app = {
      ...baseApp('business_support'),
      apiStatus: 'connected',
      revenueBonuses: [{
        id: 'RB-SAVED', storeId: 'CH001', businessDate: '2026-08-26',
        revenueVnd: 1_800_000, percentagePoolVnd: 18_000, totalPoolVnd: 18_000,
        allocations: [{
          id: 'A-SAVED', storeId: 'CH001', businessDate: '2026-08-26',
          employeeId: 'NV-01', employeeName: 'Nhân viên Một', allocatedVnd: 18_000,
          approvedSalesHours: 2, status: 'APPROVED',
        }],
      }],
    }
    mocked.liveRevenue.mockResolvedValue({
      snapshot: {
        storeId: 'ch001', businessDate: '2026-08-26', revenueVnd: 9_000_000,
        percentagePoolVnd: 540_000, allocatedVnd: 540_000, unallocatedVnd: 0,
        totalWorkedSeconds: 28_800, attendanceCount: 2, openAttendanceCount: 0,
        allocations: [{ employeeId: 'NV-02', amountVnd: 540_000, workedSeconds: 28_800, status: 'LIVE' }],
        calculationEligibility: {
          allowed: false, code: 'ALREADY_CALCULATED', existingId: 'RB-SAVED',
          message: 'Thưởng doanh thu của ngày này đã được tính và không thể tính lại.',
        },
      },
    })

    render(<RevenueBonusPage />)

    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledTimes(1))
    const button = await screen.findByRole('button', { name: 'ĐÃ TÍNH THƯỞNG' })
    expect(button.disabled).toBe(true)
    expect(screen.getAllByText('1,800,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('18,000 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
    expect(screen.queryByText('540,000 đ')).toBeNull()
    const totalHoursMetric = screen.getByText('TỔNG GIỜ LÀM CỬA HÀNG').closest('section')
    expect(within(totalHoursMetric).getByText('8 giờ 00 phút')).toBeTruthy()
  })

  it('shows a synchronization state instead of zero when the saved result has not hydrated yet', async () => {
    mocked.app = { ...baseApp('business_support'), apiStatus: 'connected' }
    mocked.liveRevenue.mockResolvedValue({
      snapshot: {
        storeId: 'CH001', businessDate: '2026-08-26', revenueVnd: 9_000_000,
        percentagePoolVnd: 540_000, allocatedVnd: 540_000, unallocatedVnd: 0,
        totalWorkedSeconds: 28_800, attendanceCount: 2, openAttendanceCount: 0,
        allocations: [{ employeeId: 'NV-01', amountVnd: 540_000, workedSeconds: 28_800, status: 'LIVE' }],
        calculationEligibility: {
          allowed: false, code: 'ALREADY_CALCULATED', existingId: 'RB-NOT-YET-HYDRATED',
          message: 'Thưởng doanh thu của ngày này đã được tính.',
        },
      },
    })

    render(<RevenueBonusPage />)

    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledTimes(1))
    expect((await screen.findAllByText('Đang đồng bộ…')).length).toBeGreaterThan(1)
    expect(screen.getByRole('button', { name: 'ĐANG ĐỒNG BỘ KẾT QUẢ' }).disabled).toBe(true)
    expect(screen.getByText(/hệ thống đang đồng bộ kết quả đã lưu/i)).toBeTruthy()
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
    expect(screen.queryByText('540,000 đ')).toBeNull()
  })

  it('fails closed instead of summing duplicate active daily results', async () => {
    mocked.app = {
      ...baseApp('business_support'),
      apiStatus: 'connected',
      revenueBonuses: [{
        id: 'RB-DUPLICATE-1', storeId: 'CH001', businessDate: '2026-08-26',
        revenueVnd: 10_000, totalPoolVnd: 100, status: 'APPROVED', allocations: [],
      }, {
        id: 'RB-DUPLICATE-2', storeId: 'ch001', businessDate: '2026-08-26',
        revenueVnd: 20_000, totalPoolVnd: 200, status: 'APPROVED', allocations: [],
      }],
    }
    mocked.liveRevenue.mockResolvedValue({
      snapshot: {
        storeId: 'CH001', businessDate: '2026-08-26', revenueVnd: 30_000,
        percentagePoolVnd: 300, allocatedVnd: 0, unallocatedVnd: 300, allocations: [],
        calculationEligibility: {
          allowed: false, code: 'DATA_COLLISION', existingCount: 2,
          message: 'Ngày này có nhiều kết quả thưởng đang hiệu lực; cần xử lý dữ liệu trùng.',
        },
      },
    })

    render(<RevenueBonusPage />)

    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' }).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'ĐÃ TÍNH THƯỞNG' })).toBeNull()
    expect(screen.getByText(/nhiều kết quả thưởng đang hiệu lực/i)).toBeTruthy()
    const totalPoolMetric = screen.getByText('TỔNG QUỸ THƯỞNG').closest('section')
    expect(within(totalPoolMetric).getByText('0 đ')).toBeTruthy()
    expect(within(totalPoolMetric).queryByText('300 đ')).toBeNull()
    const historyCard = screen.getByRole('heading', { name: 'Lịch sử ghi nhận thưởng doanh thu' }).closest('section')
    expect(within(historyCard).getByText(/loại các dòng này khỏi lịch sử và thống kê/i)).toBeTruthy()
    expect(within(historyCard).getByText('Tổng thưởng: 0 đ')).toBeTruthy()
  })

  it('excludes ambiguous employee identifiers from history totals and shows one data warning', () => {
    mocked.app = {
      ...baseApp('store_manager'),
      employees: [
        ...employees,
        { id: 'E01', name: 'Hồ sơ mơ hồ 1', storeId: 'CH001' },
        { id: 'e01', name: 'Hồ sơ mơ hồ 2', storeId: 'CH001' },
        { id: 'SAFE-01', name: 'Nhân viên hợp lệ', storeId: 'CH001' },
      ],
      revenueBonuses: [{
        id: 'RB-EMPLOYEE-COLLISION', storeId: 'CH001', businessDate: '2026-08-26', status: 'APPROVED',
        allocations: [{
          id: 'A-AMBIGUOUS', employeeId: 'E01', employeeName: 'Khoản mơ hồ', allocatedVnd: 100, status: 'APPROVED',
        }, {
          id: 'A-SAFE', employeeId: 'SAFE-01', employeeName: 'Nhân viên hợp lệ', allocatedVnd: 40, status: 'APPROVED',
        }],
      }],
    }

    render(<RevenueBonusPage storeScoped />)

    const historyCard = screen.getByRole('heading', { name: 'Lịch sử ghi nhận thưởng doanh thu' }).closest('section')
    const historyBody = historyCard.querySelector('tbody')
    expect(within(historyCard).getByText(/1 nhóm mã nhân viên mơ hồ/i)).toBeTruthy()
    expect(within(historyCard).getByText('Tổng thưởng: 40 đ')).toBeTruthy()
    expect(within(historyBody).getByText('Nhân viên hợp lệ')).toBeTruthy()
    expect(within(historyBody).queryByText('Khoản mơ hồ')).toBeNull()
    expect(within(historyBody).queryByText('100 đ')).toBeNull()
  })

  it('keeps the immutable approved milestone total after later live revenue changes', async () => {
    mocked.app = {
      ...baseApp('employee'),
      apiStatus: 'connected',
      revenueBonuses: [{
        id: 'RB-APPROVED-MILESTONE', storeId: 'CH001', businessDate: '2026-08-26',
        percentagePoolVnd: 10, milestonePoolVnd: 100, totalPoolVnd: 110,
        milestoneStatus: 'APPROVED', status: 'APPROVED',
        allocations: [{
          id: 'A-APPROVED-MILESTONE', storeId: 'CH001', businessDate: '2026-08-26',
          employeeId: 'NV-01', percentagePoolVnd: 10, milestonePoolVnd: 100,
          amountVnd: 110, allocatedVnd: 110, status: 'APPROVED',
        }],
      }],
    }
    mocked.liveRevenue.mockResolvedValue({
      snapshot: {
        storeId: 'CH001', businessDate: '2026-08-26', projectedAt: '2026-08-26T05:00:00.000Z',
        revenueVnd: 2_000, percentagePoolVnd: 20, allocatedVnd: 20, unallocatedVnd: 0,
        totalWorkedSeconds: 3_600, attendanceCount: 1, openAttendanceCount: 0,
        allocations: [{ employeeId: 'NV-01', workedSeconds: 3_600, weightPercent: 100, amountVnd: 20, status: 'LIVE' }],
      },
    })

    render(<RevenueBonusPage />)

    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledTimes(1))
    expect((await screen.findAllByText('110 đ')).length).toBeGreaterThan(1)
    expect(screen.queryByText('120 đ')).toBeNull()
    expect(screen.queryByText('20 đ')).toBeNull()
  })

  it('lets privileged roles approve a pending highest-milestone claim', async () => {
    mocked.app = {
      ...baseApp('business_support'),
      revenueBonuses: [{
        id: 'RB-PENDING', storeId: 'CH001', businessDate: '2026-08-26',
        percentagePoolVnd: 50, pendingMilestonePoolVnd: 100, totalPoolVnd: 50,
        status: 'APPROVED',
      }],
      teamRewardClaims: [{
        id: 'CLAIM-01', revenueBonusDailyId: 'RB-PENDING', storeId: 'CH001',
        businessDate: '2026-08-26', milestoneId: 'MOC-CAO-NHAT', amountVnd: 100,
        status: 'PENDING', version: 3,
      }],
    }
    render(<RevenueBonusPage />)

    expect(screen.getByText('MOC-CAO-NHAT')).toBeTruthy()
    expect(screen.getByText('Chờ duyệt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }))

    await waitFor(() => expect(mocked.app.approveRevenueBonusMilestone).toHaveBeenCalledWith({
      claimId: 'CLAIM-01', expectedVersion: 3,
    }))
  })

  it('defaults privileged revenue bonus work to the active operational store', async () => {
    mocked.app = {
      ...baseApp('business_support'),
      apiStatus: 'local',
      orders: [],
      activeStoreId: 'CH002',
      attendance: [{
        id: 'ATT-READY', employeeId: 'QL-02', storeId: 'CH002', workDate: '2026-08-26',
        shiftId: 'ca2', shiftName: 'Ca 2', shiftStart: '13:00', shiftEnd: '18:00',
        workedSeconds: 18_000, checkOutAt: '2026-08-26T18:00:00+07:00',
      }],
      shiftDefinitions: [{ id: 'ca2', storeId: 'CH002', name: 'Ca 2', start: '13:00', end: '18:00', active: true }],
    }
    render(<RevenueBonusPage />)

    expect(screen.getByLabelText('Cửa hàng').value).toBe('CH002')
    const calculateButton = screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })
    expect(calculateButton.disabled).toBe(false)
    fireEvent.click(calculateButton)
    fireEvent.click(calculateButton)

    await waitFor(() => expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledWith({
      storeId: 'CH002', businessDate: '2026-08-26',
    }))
    expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'ĐANG ĐỒNG BỘ KẾT QUẢ' })).toBeTruthy()
  })

  it('clears the employee history filter when a global Admin switches stores', () => {
    mocked.app = {
      ...baseApp('admin'),
      revenueBonuses: [{
        id: 'RB-CH001', storeId: 'CH001', businessDate: '2026-08-26', status: 'APPROVED',
        allocations: [{ id: 'A-CH001', employeeId: 'NV-02', employeeName: 'Nhân viên Hai', allocatedVnd: 5_000, status: 'APPROVED' }],
      }, {
        id: 'RB-CH002', storeId: 'CH002', businessDate: '2026-08-26', status: 'APPROVED',
        allocations: [{ id: 'A-CH002', employeeId: 'QL-02', employeeName: 'Quản lý Hai', allocatedVnd: 7_000, status: 'APPROVED' }],
      }],
    }
    render(<RevenueBonusPage />)

    const employeeFilter = screen.getByLabelText('Nhân viên nhận thưởng doanh thu')
    fireEvent.change(employeeFilter, { target: { value: 'NV-02' } })
    expect(employeeFilter.value).toBe('NV-02')

    fireEvent.change(screen.getByLabelText('Cửa hàng'), { target: { value: 'CH002' } })

    expect(screen.getByLabelText('Nhân viên nhận thưởng doanh thu').value).toBe('')
    const historyCard = screen.getByRole('heading', { name: 'Lịch sử ghi nhận thưởng doanh thu' }).closest('section')
    const historyBody = historyCard.querySelector('tbody')
    expect(within(historyBody).getByText('Quản lý Hai')).toBeTruthy()
    expect(within(historyBody).queryByText('Nhân viên Hai')).toBeNull()
  })

  it('locks a store-workspace revenue page to the active store without offering another store', () => {
    mocked.app = { ...baseApp('admin'), activeStoreId: 'ch002' }
    render(<RevenueBonusPage storeScoped />)

    expect(screen.queryByRole('combobox', { name: 'Cửa hàng' })).toBeNull()
    expect(screen.getByRole('group', { name: 'Cửa hàng hiện tại' }).textContent).toContain('SM TNV')
    expect(screen.queryByText('Dosii NTL')).toBeNull()
  })

  it('fails closed instead of falling back to another store when the active store is unresolved', () => {
    mocked.app = { ...baseApp('admin'), activeStoreId: 'STORE-NOT-FOUND' }
    render(<RevenueBonusPage storeScoped />)

    expect(screen.getByRole('heading', { name: 'KHÔNG CÓ QUYỀN TRUY CẬP' })).toBeTruthy()
    expect(screen.queryByText('Dosii NTL')).toBeNull()
    expect(screen.queryByText('SM TNV')).toBeNull()
  })

  it('fails closed when the active store has no supported revenue policy', () => {
    mocked.app = {
      ...baseApp('admin'),
      activeStoreId: 'STORE-UNKNOWN-POLICY',
      stores: [{ id: 'STORE-UNKNOWN-POLICY', name: 'Cửa hàng chưa phân loại', code: 'UNKNOWN' }],
    }
    render(<RevenueBonusPage storeScoped />)

    expect(screen.getByRole('heading', { name: 'KHÔNG CÓ QUYỀN TRUY CẬP' })).toBeTruthy()
    expect(screen.getByText(/chưa có chính sách thưởng doanh thu/i)).toBeTruthy()
    expect(screen.queryByText('Mốc thưởng doanh thu Dosii')).toBeNull()
  })

  it('renders only the signed-in employee statement entries', () => {
    mocked.app = {
      ...baseApp('employee'),
      compensationEntries: [
        { id: 'C-01', employeeId: 'NV-01', type: 'MANUAL', amountVnd: 35, effectiveDate: '2026-08-26', note: 'Khoản của tôi', status: 'Đã duyệt' },
        { id: 'C-02', employeeId: 'NV-02', type: 'MANUAL', amountVnd: 999, effectiveDate: '2026-08-26', note: 'Khoản người khác', status: 'Đã duyệt' },
      ],
    }
    render(<MyCompensationPage />)

    expect(screen.getByText('Khoản của tôi')).toBeTruthy()
    expect(screen.queryByText('Khoản người khác')).toBeNull()
    expect(screen.queryByText('999 đ')).toBeNull()
  })

  it('aggregates and breaks down the signed-in employee payroll across stores', () => {
    mocked.app = {
      ...baseApp('employee'),
      payrollPeriods: [
        { id: 'PAY-CH001', storeId: 'CH001', storeName: 'Dosii NTL', period: '2026-08', status: 'Đã chốt', rows: [{ employeeId: 'NV-01', salaryVnd: 100, grossCompensationVnd: 130, appliedViolationVnd: 10, remainingViolationReceivableVnd: 2, advancesPaid: 20, netPayVnd: 100 }] },
        { id: 'PAY-CH002', storeId: 'CH002', storeName: 'SM TNV', period: '2026-08', status: 'Đã khóa', rows: [{ employeeId: 'NV-01', salaryVnd: 200, grossCompensationVnd: 260, appliedViolationVnd: 20, remainingViolationReceivableVnd: 3, advancesPaid: 40, netPayVnd: 200 }] },
        { id: 'PAY-OTHER', storeId: 'CH002', period: '2026-08', status: 'Đã khóa', rows: [{ employeeId: 'NV-02', salaryVnd: 999, netPayVnd: 999 }] },
      ],
    }
    render(<MyCompensationPage />)

    expect(screen.getAllByText('300 đ').length).toBeGreaterThan(0)
    expect(screen.getByText('390 đ')).toBeTruthy()
    const breakdown = screen.getByRole('heading', { name: 'Quyết toán theo cửa hàng' }).closest('section')
    expect(within(breakdown).getByText('Dosii NTL')).toBeTruthy()
    expect(within(breakdown).getByText('SM TNV')).toBeTruthy()
    expect(within(breakdown).getByText('130 đ')).toBeTruthy()
    expect(within(breakdown).getByText('260 đ')).toBeTruthy()
    expect(within(breakdown).queryByText('999 đ')).toBeNull()
  })
})
