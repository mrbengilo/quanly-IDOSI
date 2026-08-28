import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagerCompensationPage } from './ManagerCompensationPage'
import { MyCompensationPage } from './MyCompensationPage'
import { RevenueBonusPage } from './RevenueBonusPage'
import { MyViolationsPage, ViolationManagementPage } from './ViolationManagementPage'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

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
  storeDailyRevenue: [],
  attendance: [],
  schedule: [{
    id: 'SCHEDULE-QL-01', employeeId: 'QL-01', storeId: 'CH001', date: '2026-08-26',
    shiftIds: ['SHIFT-MORNING'],
    shiftSnapshots: [{ id: 'SHIFT-MORNING', name: 'Ca sáng', start: '08:00', end: '12:00' }],
  }],
  shiftDefinitions: [
    { id: 'SHIFT-MORNING', storeId: 'CH001', name: 'Ca sáng', start: '08:00', end: '12:00', active: true },
    { id: 'SHIFT-AFTERNOON', storeId: 'CH001', name: 'Ca chiều', start: '12:00', end: '17:00', active: true },
  ],
  payrollPeriods: [],
  workCatalogItems: [{
    id: 'violation-store-late', code: 'store.violation.late', kind: 'violation',
    targetGroup: 'store', storeId: 'CH001', shiftId: null, shiftName: null,
    name: 'Đi trễ', amountVnd: 2_000, sortOrder: 10, active: true,
    version: 1, effectiveFrom: '2026-08-01', effectiveTo: null,
  }],
  notify: vi.fn(),
  createCompensationEntry: vi.fn().mockResolvedValue({ ok: true }),
  approveCompensationEntry: vi.fn().mockResolvedValue({ ok: true }),
  voidCompensationEntry: vi.fn().mockResolvedValue({ ok: true }),
  createViolation: vi.fn().mockResolvedValue({ ok: true }),
  voidViolation: vi.fn().mockResolvedValue({ ok: true }),
  calculateRevenueBonusDay: vi.fn().mockResolvedValue({ ok: true }),
  approveRevenueBonusMilestone: vi.fn().mockResolvedValue({ ok: true }),
  rejectRevenueBonusMilestone: vi.fn().mockResolvedValue({ ok: true }),
})

describe('compensation pages', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-26T05:00:00.000Z'))
    mocked.app = baseApp()
  })
  afterEach(() => {
    cleanup()
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

  it('denies manager mutations and reserves HTKD violations for Admin', () => {
    mocked.app = baseApp('store_manager')
    const { rerender } = render(<ManagerCompensationPage />)
    expect(screen.getByRole('heading', { name: 'KHÔNG CÓ QUYỀN TRUY CẬP' })).toBeTruthy()

    mocked.app = baseApp('business_support')
    rerender(<ViolationManagementPage targetUnit="business_support" />)
    expect(screen.getByText('Chỉ Admin được ghi nhận vi phạm cho Nhân viên hỗ trợ KD.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'GHI NHẬN VI PHẠM' })).toBeNull()
  })

  it('creates a policy-backed violation as a positive receivable amount', async () => {
    render(<ViolationManagementPage targetUnit="store" />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Đi trễ/i }))
    fireEvent.click(screen.getByRole('button', { name: 'GHI NHẬN VI PHẠM' }))

    await waitFor(() => expect(mocked.app.createViolation).toHaveBeenCalledWith(expect.objectContaining({
      targetUnit: 'store', employeeId: 'QL-01', storeId: 'CH001', catalogItemId: 'violation-store-late', amountVnd: 2_000,
      shiftId: 'SHIFT-MORNING', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
    })))
  })

  it('limits violation shifts to the selected employee day and prefers attendance history', () => {
    mocked.app = {
      ...baseApp(),
      schedule: [],
      attendance: [{
        id: 'ATT-QL-HISTORICAL', employeeId: 'QL-01', storeId: 'CH001', date: '2026-08-26',
        shiftId: 'SHIFT-MORNING', shiftName: 'Ca sáng lịch sử', shiftStart: '07:30', shiftEnd: '11:30',
      }],
    }
    render(<ViolationManagementPage targetUnit="store" />)

    expect(within(screen.getByLabelText('Ca vi phạm')).getByRole('option', {
      name: 'Ca sáng lịch sử · 07:30 – 11:30 · Đã chấm công',
    })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Nhân viên'), { target: { value: 'NV-01' } })
    expect(screen.getByLabelText('Ca vi phạm').disabled).toBe(true)
    expect(screen.getByText('Nhân viên chưa có lịch phân ca hoặc chấm công tại cửa hàng trong ngày đã chọn.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'GHI NHẬN VI PHẠM' }).disabled).toBe(true)
  })

  it('includes a transferred employee when the selected store and day have historical work evidence', async () => {
    mocked.app = {
      ...baseApp(),
      employees: [...employees, {
        id: 'PROFILE-TRANSFER', code: 'CODE-TRANSFER', employeeId: 'NV-TRANSFER',
        name: 'Nhân viên Điều Chuyển', unit: 'store', storeId: 'CH002',
      }, {
        id: 'NV-UNRELATED', name: 'Nhân viên Không Liên Quan', unit: 'store', storeId: 'CH002',
      }],
      attendance: [{
        id: 'ATT-TRANSFER', employeeId: 'NV-TRANSFER', storeId: 'CH001', date: '2026-08-26',
        shiftId: 'SHIFT-MORNING', shiftName: 'Ca sáng điều chuyển', shiftStart: '07:30', shiftEnd: '11:30',
      }],
      violations: [{
        id: 'VIO-TRANSFER-ALIAS', targetUnit: 'store', employeeId: 'NV-TRANSFER',
        employeeName: 'Nhân viên Điều Chuyển', storeId: 'CH001', occurredOn: '2026-08-26',
        shiftId: 'SHIFT-MORNING', title: 'Vi phạm alias điều chuyển', amountVnd: 2_000,
        status: 'ACTIVE',
      }, {
        id: 'VIO-UNRELATED', targetUnit: 'store', employeeId: 'NV-UNRELATED',
        employeeName: 'Nhân viên Không Liên Quan', storeId: 'CH001', occurredOn: '2026-08-26',
        shiftId: 'SHIFT-MORNING', title: 'Vi phạm ngoài phạm vi', amountVnd: 2_000,
        status: 'ACTIVE',
      }],
    }
    render(<ViolationManagementPage targetUnit="store" />)

    const employeeSelect = screen.getByLabelText('Nhân viên')
    expect(within(employeeSelect).getByRole('option', {
      name: 'Nhân viên Điều Chuyển — PROFILE-TRANSFER',
    })).toBeTruthy()
    expect(within(employeeSelect).queryByRole('option', {
      name: 'Nhân viên Không Liên Quan — NV-UNRELATED',
    })).toBeNull()
    expect(screen.getByText('Vi phạm alias điều chuyển')).toBeTruthy()
    expect(screen.queryByText('Vi phạm ngoài phạm vi')).toBeNull()
    fireEvent.change(employeeSelect, { target: { value: 'PROFILE-TRANSFER' } })
    expect(within(screen.getByLabelText('Ca vi phạm')).getByRole('option', {
      name: 'Ca sáng điều chuyển · 07:30 – 11:30 · Đã chấm công',
    })).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: /Đi trễ/i }))
    fireEvent.click(screen.getByRole('button', { name: 'GHI NHẬN VI PHẠM' }))
    await waitFor(() => expect(mocked.app.createViolation).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'PROFILE-TRANSFER', storeId: 'CH001', occurredOn: '2026-08-26',
      shiftId: 'SHIFT-MORNING', shiftName: 'Ca sáng điều chuyển',
    })))

    fireEvent.change(screen.getByLabelText('Ngày phát sinh'), { target: { value: '2026-08-25' } })
    expect(employeeSelect.value).toBe('QL-01')
    expect(within(employeeSelect).queryByRole('option', {
      name: 'Nhân viên Điều Chuyển — PROFILE-TRANSFER',
    })).toBeNull()
  })

  it('shows each private violation with its store, shift, date and total deduction', () => {
    mocked.app = {
      ...baseApp('employee'),
      violations: [{
        id: 'VIO-01', targetUnit: 'store', employeeId: 'NV-01', storeId: 'CH001',
        occurredOn: '2026-08-26', shiftId: 'SHIFT-MORNING', shiftName: 'Ca sáng',
        shiftStart: '08:00', shiftEnd: '12:00', title: 'Đi trễ', amountVnd: 2_000, status: 'ACTIVE',
      }, {
        id: 'VIO-OTHER', targetUnit: 'store', employeeId: 'NV-02', storeId: 'CH001',
        occurredOn: '2026-08-26', shiftName: 'Ca chiều', title: 'Không được xem', amountVnd: 99_000, status: 'ACTIVE',
      }],
    }
    render(<MyViolationsPage />)

    expect(screen.getByText('TỔNG SỐ TIỀN BỊ TRỪ')).toBeTruthy()
    expect(screen.getAllByText('2,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByText('Dosii NTL')).toBeTruthy()
    expect(screen.getByText('Ca sáng')).toBeTruthy()
    expect(screen.getByText('08:00 – 12:00')).toBeTruthy()
    expect(screen.getByText('26/08/2026')).toBeTruthy()
    expect(screen.queryByText('Không được xem')).toBeNull()
    expect(screen.queryByText('99,000 đ')).toBeNull()
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

  it('shows live daily revenue, own work hours, crossed tiers and day/month reward history', () => {
    mocked.app = {
      ...baseApp('employee'),
      storeDailyRevenue: [{
        id: 'daily-revenue:CH001:2026-08-26', storeId: 'CH001', businessDate: '2026-08-26',
        revenueVnd: 4_500_001, orderCount: 12,
      }],
      attendance: [{
        id: 'ATT-01', employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-26',
        checkInAt: '2026-08-26T01:00:00.000Z', checkOutAt: '2026-08-26T06:00:00.000Z', workedSeconds: 18_000,
      }],
      revenueBonuses: [{
        id: 'RB-TODAY', storeId: 'CH001', businessDate: '2026-08-26', revenueVnd: 4_500_001,
        totalPoolVnd: 180_000, allocations: [
          { id: 'A-TODAY', employeeId: 'NV-01', allocatedVnd: 35_000, status: 'APPROVED', approvedSalesHours: 5 },
          { id: 'A-PRIVATE', employeeId: 'NV-02', allocatedVnd: 145_000, status: 'APPROVED' },
        ],
      }, {
        id: 'RB-PAST', storeId: 'CH001', businessDate: '2026-08-12', revenueVnd: 2_500_000,
        totalPoolVnd: 50_000, allocations: [
          { id: 'A-PAST', employeeId: 'NV-01', allocatedVnd: 20_000, status: 'APPROVED', approvedSalesHours: 4 },
        ],
      }],
    }
    render(<RevenueBonusPage />)

    expect(screen.getByText('TỔNG GIỜ LÀM CỦA TÔI')).toBeTruthy()
    expect(screen.getAllByText('5.00 giờ').length).toBeGreaterThan(0)
    expect(screen.getByText('DOANH THU CỬA HÀNG TRONG NGÀY')).toBeTruthy()
    expect(screen.getByText('4,500,001 đ')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Mốc thưởng doanh thu' })).toBeTruthy()
    expect(screen.getAllByText('Đã đạt').length).toBe(2)
    expect(screen.getByText('Mốc cao nhất được tính')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Kiểu thống kê'), { target: { value: 'month' } })
    expect(screen.getByText('12/08/2026')).toBeTruthy()
    expect(screen.getByText('20,000 đ')).toBeTruthy()
    expect(screen.queryByText('145,000 đ')).toBeNull()
  })

  it('treats a missing canonical daily-revenue row as zero while preserving the legacy fallback when the collection is unavailable', () => {
    const staleRevenueBonus = {
      id: 'RB-STALE', storeId: 'CH001', businessDate: '2026-08-26', revenueVnd: 4_500_001,
      totalPoolVnd: 180_000, allocations: [],
    }
    mocked.app = {
      ...baseApp('employee'),
      storeDailyRevenue: [],
      revenueBonuses: [staleRevenueBonus],
    }
    const view = render(<RevenueBonusPage />)

    let revenueMetric = screen.getByText('DOANH THU CỬA HÀNG TRONG NGÀY').closest('.metric')
    expect(within(revenueMetric).getByText('0 đ')).toBeTruthy()
    expect(screen.getByText('Chưa đạt mốc')).toBeTruthy()
    view.unmount()

    mocked.app = {
      ...baseApp('employee'),
      storeDailyRevenue: undefined,
      revenueBonuses: [staleRevenueBonus],
    }
    render(<RevenueBonusPage />)

    revenueMetric = screen.getByText('DOANH THU CỬA HÀNG TRONG NGÀY').closest('.metric')
    expect(within(revenueMetric).getByText('4,500,001 đ')).toBeTruthy()
  })

  it('derives elapsed time for an open attendance whose persisted counters are still zero', () => {
    mocked.app = {
      ...baseApp('employee'),
      attendance: [{
        id: 'ATT-OPEN-ZERO', employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-26',
        checkInAt: '2026-08-26T01:00:00.000Z', checkOutAt: null, workedSeconds: 0, hours: 0,
      }],
    }
    render(<RevenueBonusPage />)

    const hoursMetric = screen.getByText('TỔNG GIỜ LÀM CỦA TÔI').closest('.metric')
    expect(within(hoursMetric).getByText('4.00 giờ')).toBeTruthy()
  })

  it('shows a store manager only the team total and their own allocation', () => {
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
    expect(screen.queryByText('100 đ')).toBeNull()
    expect(screen.queryByText('Nhân viên Hai')).toBeNull()
    expect(screen.queryByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })).toBeNull()
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
    mocked.app = { ...baseApp('business_support'), activeStoreId: 'CH002' }
    render(<RevenueBonusPage />)

    expect(screen.getByLabelText('Cửa hàng').value).toBe('CH002')
    fireEvent.change(screen.getByLabelText('Ngày kinh doanh'), { target: { value: '2026-08-26' } })
    fireEvent.click(screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' }))

    await waitFor(() => expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledWith({
      storeId: 'CH002', businessDate: '2026-08-26',
    }))
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
