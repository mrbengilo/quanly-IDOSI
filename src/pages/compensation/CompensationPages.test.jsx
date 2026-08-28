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
  resolveRevenueBonusZeroHourPool: vi.fn().mockResolvedValue({ ok: true }),
  approveRevenueBonusMilestone: vi.fn().mockResolvedValue({ ok: true }),
  rejectRevenueBonusMilestone: vi.fn().mockResolvedValue({ ok: true }),
})

const canonicalZeroHourRevenue = (overrides = {}) => ({
  id: 'RB-ZERO-HOUR-CANONICAL', storeId: 'CH001', businessDate: '2026-08-26',
  programId: 'revenue-bonus.store-dosii-daily.v1',
  milestoneProgramId: 'team-milestone.store-dosii-daily-revenue.v1',
  revenueVnd: 2_000_000, tierId: 'dosii.daily.1_500_000_through_2_000_000',
  rateBasisPoints: 100, percentagePoolVnd: 20_000, milestonePoolVnd: 0,
  totalPoolVnd: 20_000, allocatedVnd: 0, unallocatedVnd: 20_000,
  participantCount: 0, status: 'APPROVED', version: 1,
  ...overrides,
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
      }, {
        id: 'VIO-OTHER-STORE', targetUnit: 'store', employeeId: 'NV-UNRELATED',
        employeeName: 'Nhân viên Cửa Hàng Khác', storeId: 'CH002', occurredOn: '2026-08-26',
        shiftId: 'SHIFT-MORNING', title: 'Vi phạm cửa hàng khác', amountVnd: 2_000,
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
    expect(screen.getByText('Vi phạm ngoài phạm vi')).toBeTruthy()
    expect(screen.queryByText('Vi phạm cửa hàng khác')).toBeNull()
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
    expect(screen.getByText('Vi phạm alias điều chuyển')).toBeTruthy()
    expect(screen.getByText('Vi phạm ngoài phạm vi')).toBeTruthy()
    expect(screen.queryByText('Vi phạm cửa hàng khác')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Hủy' })).toHaveLength(2)
  })

  it('keeps projected non-store violation history after the employee leaves the current picker', () => {
    mocked.app = {
      ...baseApp(),
      violations: [{
        id: 'VIO-FORMER-OFFICE', targetUnit: 'office', employeeId: 'FORMER-OFFICE-01',
        employeeName: 'Nhân viên văn phòng cũ', occurredOn: '2026-08-20',
        title: 'Vi phạm cần lưu lịch sử', amountVnd: 5_000, status: 'ACTIVE',
      }],
    }
    render(<ViolationManagementPage targetUnit="office" />)

    expect(screen.getByText('Vi phạm cần lưu lịch sử')).toBeTruthy()
    expect(screen.getByText('Nhân viên văn phòng cũ')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeTruthy()
  })

  it('keeps inactive-store violation history reachable but blocks new assignments there', () => {
    mocked.app = {
      ...baseApp('business_support'),
      stores: [...stores, {
        id: 'CH003', name: 'Dosii lịch sử', status: 'Ngưng hoạt động', active: false,
      }],
      employees: [...employees, {
        id: 'NV-03', name: 'Nhân viên Lịch Sử', unit: 'store', storeId: 'CH003',
      }],
      schedule: [{
        id: 'SCHEDULE-NV-03', employeeId: 'NV-03', storeId: 'CH003', date: '2026-08-26',
        shiftIds: ['SHIFT-MORNING'],
        shiftSnapshots: [{ id: 'SHIFT-MORNING', name: 'Ca sáng', start: '08:00', end: '12:00' }],
      }],
      workCatalogItems: [{
        id: 'violation-inactive-store', code: 'store.violation.inactive', kind: 'violation',
        targetGroup: 'store', storeId: 'CH003', shiftId: null, shiftName: null,
        name: 'Không mở nhạc', amountVnd: 2_000, sortOrder: 10, active: true,
        version: 1, effectiveFrom: '2026-08-01', effectiveTo: null,
      }],
      violations: [{
        id: 'VIO-INACTIVE-HISTORICAL', targetUnit: 'store', employeeId: 'FORMER-NV-03',
        employeeName: 'Nhân viên cũ CH003', storeId: 'CH003', occurredOn: '2026-07-15',
        shiftId: 'SHIFT-MORNING', shiftName: 'Ca sáng lịch sử', title: 'Vi phạm tại cửa hàng đã đóng',
        amountVnd: 5_000, status: 'ACTIVE',
      }, {
        id: 'VIO-OPERATIONAL-STORE', targetUnit: 'store', employeeId: 'NV-01',
        employeeName: 'Nhân viên Một', storeId: 'CH001', occurredOn: '2026-08-26',
        shiftId: 'SHIFT-MORNING', title: 'Vi phạm cửa hàng đang mở', amountVnd: 2_000,
        status: 'ACTIVE',
      }],
    }
    render(<ViolationManagementPage targetUnit="store" />)

    const storeSelect = screen.getByLabelText('Cửa hàng')
    expect(within(storeSelect).getByRole('option', {
      name: 'Dosii lịch sử — Ngừng hoạt động (chỉ xem lịch sử)',
    })).toBeTruthy()
    fireEvent.change(storeSelect, { target: { value: 'CH003' } })

    expect(screen.getByText('Vi phạm tại cửa hàng đã đóng')).toBeTruthy()
    expect(screen.getByText('Nhân viên cũ CH003')).toBeTruthy()
    expect(screen.queryByText('Vi phạm cửa hàng đang mở')).toBeNull()
    expect(screen.getByText(/chỉ dùng để xem lịch sử/i)).toBeTruthy()
    expect(screen.getByLabelText('Nhân viên').disabled).toBe(true)
    expect(screen.getByRole('checkbox', { name: /Không mở nhạc/i }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'GHI NHẬN VI PHẠM' }).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Hủy' })).toBeNull()

    fireEvent.change(screen.getByLabelText('Ngày phát sinh'), { target: { value: '2026-08-25' } })
    expect(screen.getByText('Vi phạm tại cửa hàng đã đóng')).toBeTruthy()
    expect(mocked.app.createViolation).not.toHaveBeenCalled()
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

  it('shows only the signed-in employee violations across strict profile aliases', () => {
    mocked.app = {
      ...baseApp('employee'),
      session: { role: 'employee', employeeId: 'CODE-NV-01', storeId: 'CH001' },
      currentEmployee: {
        id: 'PROFILE-NV-01', code: 'CODE-NV-01', employeeId: 'LEGACY-NV-01', employeeCode: 'STAFF-NV-01',
        name: 'Nhân viên Một', unit: 'store', storeId: 'CH001',
      },
      violations: [{
        id: 'VIO-ALIAS', targetUnit: 'store', employeeId: 'LEGACY-NV-01', storeId: 'CH001',
        occurredOn: '2026-08-26', shiftName: 'Ca alias', title: 'Vi phạm của mã cũ',
        amountVnd: 3_000, status: 'ACTIVE',
      }, {
        id: 'VIO-OTHER', targetUnit: 'store', employeeId: 'NV-02', storeId: 'CH001',
        occurredOn: '2026-08-26', shiftName: 'Ca khác', title: 'Vi phạm người khác',
        amountVnd: 99_000, status: 'ACTIVE',
      }],
    }

    render(<MyViolationsPage />)

    expect(screen.getByText('Vi phạm của mã cũ')).toBeTruthy()
    expect(screen.getAllByText('3,000 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('Vi phạm người khác')).toBeNull()
    expect(screen.queryByText('99,000 đ')).toBeNull()
  })

  it('falls back to the authenticated session when the current employee profile is unavailable', () => {
    mocked.app = {
      ...baseApp('employee'),
      currentEmployee: null,
      session: { role: 'employee', employeeId: 'LEGACY-NV-01', storeId: 'CH001' },
      violations: [{
        id: 'VIO-SESSION-ONLY', employeeId: 'LEGACY-NV-01', storeId: 'CH001',
        occurredOn: '2026-08-26', shiftName: 'Ca phiên đăng nhập', title: 'Vi phạm theo phiên',
        amountVnd: 3_000, status: 'ACTIVE',
      }],
      compensationEntries: [{
        id: 'CMP-SESSION-ONLY', employeeId: 'LEGACY-NV-01', type: 'WORK', amountVnd: 5_000,
        effectiveDate: '2026-08-26', note: 'Thưởng theo phiên', status: 'APPROVED',
      }],
    }

    const { unmount } = render(<MyViolationsPage />)
    expect(screen.getByText('Vi phạm theo phiên')).toBeTruthy()
    unmount()

    render(<MyCompensationPage />)
    expect(screen.getByText('Thưởng theo phiên')).toBeTruthy()
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
          {
            id: 'A-TODAY', employeeId: 'NV-01', allocatedVnd: 35_000, status: 'APPROVED',
            weightUnits: 18_000, totalWeightUnits: 36_000,
          },
          { id: 'A-PRIVATE', employeeId: 'NV-02', allocatedVnd: 145_000, status: 'APPROVED' },
        ],
      }, {
        id: 'RB-PAST', storeId: 'CH001', businessDate: '2026-08-12', revenueVnd: 2_500_000,
        totalPoolVnd: 50_000, allocations: [
          {
            id: 'A-PAST', employeeId: 'NV-01', allocatedVnd: 20_000, status: 'APPROVED',
            weightUnits: 14_400, totalWeightUnits: 28_800,
          },
        ],
      }],
    }
    render(<RevenueBonusPage />)

    expect(screen.getByText('TỔNG GIỜ LÀM CỦA TÔI')).toBeTruthy()
    expect(screen.getAllByText('5.00 giờ').length).toBeGreaterThan(0)
    expect(screen.getByText('50.00%')).toBeTruthy()
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

  it('keeps a completed transfer-store allocation in private reward history', () => {
    mocked.app = {
      ...baseApp('employee'),
      revenueBonuses: [{
        id: 'RB-TRANSFER-HISTORY', storeId: 'CH002', businessDate: '2026-08-26',
        revenueVnd: 3_000_000, totalPoolVnd: 60_000, allocations: [{
          id: 'A-TRANSFER-HISTORY', storeId: 'CH002', businessDate: '2026-08-26',
          employeeId: 'NV-01', allocatedVnd: 25_000, status: 'APPROVED',
          weightUnits: 14_400, totalWeightUnits: 28_800,
        }],
      }],
    }
    render(<RevenueBonusPage />)

    const history = screen.getByRole('heading', { name: 'Lịch sử nhận thưởng' }).closest('.card')
    expect(within(history).getByText('SM TNV')).toBeTruthy()
    expect(within(history).getAllByText('25,000 đ').length).toBeGreaterThan(0)
    expect(within(history).getByText('4.00 giờ')).toBeTruthy()
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
      session: { role: 'store_manager', employeeId: 'LEGACY-QL-01', storeId: 'CH001' },
      currentEmployee: {
        id: 'PROFILE-QL-01', code: 'QL-01', employeeId: 'LEGACY-QL-01',
        name: 'Quản lý Một', unit: 'store_manager', storeId: 'CH001',
      },
      revenueBonuses: [{
        id: 'RB-MANAGER', storeId: 'CH001', businessDate: '2026-08-26', totalPoolVnd: 170,
        allocations: [
          { id: 'A-MANAGER', storeId: 'CH001', businessDate: '2026-08-26', employeeId: 'PROFILE-QL-01', employeeName: 'Quản lý Một', allocatedVnd: 70, status: 'Đã duyệt' },
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

  it('keeps an inactive store manager store identity and SM program for finalized history', () => {
    const inactiveStore = {
      id: 'SM234', name: 'IDOSI SecondMall đã đóng', short: 'SM234',
      status: 'Ngưng hoạt động', active: false,
    }
    mocked.app = {
      ...baseApp('store_manager'),
      session: { role: 'store_manager', employeeId: 'QL-SM234', storeId: inactiveStore.id },
      currentEmployee: {
        id: 'QL-SM234', name: 'Quản lý SecondMall', unit: 'store_manager', storeId: inactiveStore.id,
      },
      stores: [inactiveStore],
      storeDailyRevenue: [{
        storeId: inactiveStore.id, businessDate: '2026-08-26', revenueVnd: 3_000_000, orderCount: 1,
      }],
      revenueBonuses: [{
        id: 'RB-SM234-FINALIZED', storeId: inactiveStore.id, businessDate: '2026-08-26',
        revenueVnd: 3_000_000, totalPoolVnd: 120_000, allocatedVnd: 120_000,
        unallocatedVnd: 0, status: 'APPROVED',
        allocations: [{
          id: 'RBA-SM234-MANAGER', employeeId: 'QL-SM234', storeId: inactiveStore.id,
          businessDate: '2026-08-26', amountVnd: 120_000, status: 'APPROVED',
        }],
      }],
    }

    render(<RevenueBonusPage />)

    expect(screen.getAllByText(inactiveStore.name).length).toBeGreaterThan(0)
    expect(screen.getByText('4% đang áp dụng')).toBeTruthy()
    expect(screen.getAllByText('120,000 đ').length).toBeGreaterThan(0)
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

  it('lets privileged roles resolve a fully unallocated zero-hour revenue pool with an audit reason', async () => {
    mocked.app = {
      ...baseApp('business_support'),
      revenueBonuses: [{
        id: 'RB-ZERO-HOUR', storeId: 'CH001', businessDate: '2026-08-26',
        percentagePoolVnd: 50_000, milestonePoolVnd: 0, totalPoolVnd: 50_000,
        allocatedVnd: 0, unallocatedVnd: 50_000, participantCount: 0,
        status: 'APPROVED', version: 3,
      }],
    }
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Không có giờ bán hàng được duyệt trong ngày.')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<RevenueBonusPage />)

    fireEvent.click(screen.getByRole('button', { name: 'XÁC NHẬN KHÔNG CÓ GIỜ ĐỦ ĐIỀU KIỆN' }))

    await waitFor(() => expect(mocked.app.resolveRevenueBonusZeroHourPool).toHaveBeenCalledWith({
      revenueBonusDailyId: 'RB-ZERO-HOUR', expectedVersion: 3,
      resolution: 'NO_ELIGIBLE_HOURS', reason: 'Không có giờ bán hàng được duyệt trong ngày.',
    }))
    expect(prompt).toHaveBeenCalled()
    expect(confirm).toHaveBeenCalled()
    prompt.mockRestore()
    confirm.mockRestore()
  })

  it('keeps an inactive store and its resolved zero-hour audit history selectable after reload', () => {
    mocked.app = {
      ...baseApp('business_support'),
      stores: [...stores, { id: 'CH003', name: 'Dosii đã ngưng hoạt động', status: 'Ngưng hoạt động', active: false }],
      revenueBonuses: [{
        id: 'RB-ZERO-HOUR-INACTIVE', storeId: 'CH003', businessDate: '2026-08-26',
        percentagePoolVnd: 0, milestonePoolVnd: 0, totalPoolVnd: 0,
        allocatedVnd: 0, unallocatedVnd: 0, participantCount: 0,
        qualifiedPercentagePoolVnd: 40_000, zeroHourUnawardedVnd: 40_000,
        unallocatedResolutionCode: 'NO_ELIGIBLE_HOURS',
        unallocatedResolutionReason: 'Không có giờ hợp lệ trước khi đóng cửa.',
        unallocatedResolvedBy: { name: 'Hỗ trợ Lịch sử' },
        unallocatedResolvedAt: '2026-08-26T06:00:00.000Z',
        supersededAt: '2026-08-27T06:00:00.000Z',
        status: 'RESOLVED_NO_ELIGIBLE_HOURS', version: 2,
      }],
    }
    render(<RevenueBonusPage />)

    const storeSelect = screen.getByLabelText('Cửa hàng')
    expect(within(storeSelect).getByRole('option', { name: 'Dosii đã ngưng hoạt động' })).toBeTruthy()
    fireEvent.change(storeSelect, { target: { value: 'CH003' } })
    const history = screen.getByRole('heading', { name: 'Lịch sử xử lý quỹ 0 giờ' }).closest('.card')
    expect(within(history).getByText('40,000 đ')).toBeTruthy()
    expect(within(history).getByText('Hỗ trợ Lịch sử')).toBeTruthy()
    expect(within(history).getByText(/13:00/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })).toBeNull()
  })

  it('surfaces an inactive store historical zero-hour date and opens it for reconciliation', () => {
    mocked.app = {
      ...baseApp('business_support'),
      stores: [...stores, { id: 'CH003', name: 'Dosii lịch sử', status: 'Ngưng hoạt động', active: false }],
      revenueBonuses: [{
        id: 'RB-ZERO-HOUR-HISTORICAL', storeId: 'CH003', businessDate: '2026-08-20',
        percentagePoolVnd: 40_000, milestonePoolVnd: 0, totalPoolVnd: 40_000,
        allocatedVnd: 0, unallocatedVnd: 40_000, participantCount: 0,
        status: 'APPROVED', version: 1,
      }],
    }
    render(<RevenueBonusPage />)

    fireEvent.change(screen.getByLabelText('Cửa hàng'), { target: { value: 'CH003' } })
    expect(screen.queryByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })).toBeNull()
    expect(screen.getByText('20/08/2026')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'XEM NGÀY' }))

    expect(screen.getByLabelText('Ngày kinh doanh').value).toBe('2026-08-20')
    expect(screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'XÁC NHẬN KHÔNG CÓ GIỜ ĐỦ ĐIỀU KIỆN' })).toBeTruthy()
  })

  it('keeps an inactive store with a historical pending milestone reachable for decision', () => {
    mocked.app = {
      ...baseApp('business_support'),
      stores: [...stores, { id: 'CH003', name: 'Dosii chờ duyệt', status: 'Ngưng hoạt động', active: false }],
      teamRewardClaims: [{
        id: 'CLAIM-INACTIVE-HISTORICAL', storeId: 'CH003', businessDate: '2026-08-19',
        amountVnd: 250_000, status: 'PENDING', version: 2,
      }],
    }
    const view = render(<RevenueBonusPage />)

    const storeSelect = screen.getByLabelText('Cửa hàng')
    expect(within(storeSelect).getByRole('option', { name: 'Dosii chờ duyệt' })).toBeTruthy()
    fireEvent.change(storeSelect, { target: { value: 'CH003' } })
    expect(screen.queryByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })).toBeNull()
    expect(screen.getByText('Thưởng mốc chờ duyệt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'XEM NGÀY' }))

    expect(screen.getByLabelText('Ngày kinh doanh').value).toBe('2026-08-19')
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Từ chối' })).toBeTruthy()

    mocked.app = baseApp('business_support')
    view.rerender(<RevenueBonusPage />)

    expect(screen.getByLabelText('Cửa hàng').value).toBe('CH001')
    expect(screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })).toBeTruthy()
  })

  it('keeps finalized inactive-store revenue history selectable after the last claim is decided', () => {
    mocked.app = {
      ...baseApp('business_support'),
      stores: [...stores, { id: 'CH003', name: 'Dosii đã quyết toán', status: 'Ngưng hoạt động', active: false }],
      revenueBonuses: [{
        id: 'RB-INACTIVE-FINALIZED', storeId: 'CH003', businessDate: '2026-08-18',
        revenueVnd: 16_000_001, percentagePoolVnd: 640_000, milestonePoolVnd: 0,
        pendingMilestonePoolVnd: 0, rejectedMilestonePoolVnd: 250_000,
        totalPoolVnd: 640_000, allocatedVnd: 640_000, unallocatedVnd: 0,
        milestoneStatus: 'REJECTED', status: 'APPROVED', version: 4,
      }],
      teamRewardClaims: [{
        id: 'CLAIM-INACTIVE-FINALIZED', revenueBonusDailyId: 'RB-INACTIVE-FINALIZED',
        storeId: 'CH003', businessDate: '2026-08-18', amountVnd: 250_000,
        status: 'REJECTED', rejectedAt: '2026-08-19T03:00:00.000Z', version: 2,
      }],
    }
    render(<RevenueBonusPage />)

    const storeSelect = screen.getByLabelText('Cửa hàng')
    expect(within(storeSelect).getByRole('option', { name: 'Dosii đã quyết toán' })).toBeTruthy()
    fireEvent.change(storeSelect, { target: { value: 'CH003' } })
    expect(storeSelect.value).toBe('CH003')
    fireEvent.change(screen.getByLabelText('Ngày kinh doanh'), { target: { value: '2026-08-18' } })
    expect(screen.getByText('18/08/2026')).toBeTruthy()
  })

  it('requires recalculation instead of offering zero-hour resolution when a shift is open or hours arrived later', () => {
    mocked.app = {
      ...baseApp('business_support'),
      revenueBonuses: [{
        id: 'RB-ZERO-HOUR-STALE', storeId: 'CH001', businessDate: '2026-08-26',
        percentagePoolVnd: 50_000, milestonePoolVnd: 0, totalPoolVnd: 50_000,
        allocatedVnd: 0, unallocatedVnd: 50_000, participantCount: 0,
        status: 'APPROVED', version: 3,
      }],
      attendance: [{
        id: 'ATT-LATE-HOURS', employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-26',
        checkInAt: '2026-08-26T01:00:00.000Z', checkOutAt: '2026-08-26T02:00:00.000Z',
        workedSeconds: 3_600, approvedSalesSeconds: 3_600,
      }],
    }
    render(<RevenueBonusPage />)

    expect(screen.queryByRole('button', { name: 'XÁC NHẬN KHÔNG CÓ GIỜ ĐỦ ĐIỀU KIỆN' })).toBeNull()
    expect(screen.getByText(/Hãy hoàn tất chấm công và bấm TÍNH THƯỞNG NGÀY/)).toBeTruthy()
  })

  it('requires recalculation when orders change the stored revenue result', () => {
    mocked.app = {
      ...baseApp('business_support'),
      revenueBonuses: [canonicalZeroHourRevenue()],
      orders: [{
        id: 'ORDER-BASE', storeId: 'CH001', amount: 2_000_000,
        status: 'Hoàn tất', createdAt: '2026-08-26T01:00:00.000Z',
      }, {
        id: 'ORDER-LATE', storeId: 'CH001', amount: 1,
        status: 'Hoàn tất', createdAt: '2026-08-26T02:00:00.000Z',
      }],
    }
    render(<RevenueBonusPage />)

    expect(screen.queryByRole('button', { name: 'XÁC NHẬN KHÔNG CÓ GIỜ ĐỦ ĐIỀU KIỆN' })).toBeNull()
    expect(screen.getByText(/Doanh thu, chính sách thưởng hoặc giờ bán hàng/)).toBeTruthy()
  })

  it('requires recalculation when the stored revenue program or tier no longer matches the store', () => {
    mocked.app = {
      ...baseApp('business_support'),
      revenueBonuses: [canonicalZeroHourRevenue({
        programId: 'revenue-bonus.store-sm-daily.v1',
        milestoneProgramId: 'team-milestone.store-sm-daily-revenue.v1',
        tierId: 'sm.daily.2_500_000_through_6_000_000',
      })],
      orders: [{
        id: 'ORDER-PROGRAM-CURRENT', storeId: 'CH001', amount: 2_000_000,
        status: 'Hoàn tất', createdAt: '2026-08-26T01:00:00.000Z',
      }],
    }
    render(<RevenueBonusPage />)

    expect(screen.queryByRole('button', { name: 'XÁC NHẬN KHÔNG CÓ GIỜ ĐỦ ĐIỀU KIỆN' })).toBeNull()
    expect(screen.getByText(/Doanh thu, chính sách thưởng hoặc giờ bán hàng/)).toBeTruthy()
  })

  it('matches the server day boundary and ignores negative orders when checking freshness', () => {
    mocked.app = {
      ...baseApp('business_support'),
      revenueBonuses: [canonicalZeroHourRevenue({
        revenueVnd: 2_000_001,
        tierId: 'dosii.daily.over_2_000_000_through_4_000_000',
        rateBasisPoints: 200,
        percentagePoolVnd: 40_000,
        totalPoolVnd: 40_000,
        unallocatedVnd: 40_000,
      })],
      orders: [{
        id: 'ORDER-VN-DAY', storeId: 'CH001', amount: 2_000_000,
        status: 'Hoàn tất', createdAt: '2026-08-25T18:30:00.000Z',
      }, {
        id: 'ORDER-VN-DAY-ONE', storeId: 'CH001', amount: 1,
        status: 'Hoàn tất', createdAt: '2026-08-26T02:00:00.000Z',
      }, {
        id: 'ORDER-NEGATIVE-IGNORED', storeId: 'CH001', amount: -1_000_000,
        status: 'Hoàn tất', createdAt: '2026-08-26T02:30:00.000Z',
      }],
    }
    render(<RevenueBonusPage />)

    expect(screen.getByRole('button', { name: 'XÁC NHẬN KHÔNG CÓ GIỜ ĐỦ ĐIỀU KIỆN' })).toBeTruthy()
    expect(screen.queryByText(/Doanh thu, chính sách thưởng hoặc giờ bán hàng/)).toBeNull()
  })

  it('warns when a previously resolved zero-hour day becomes stale', () => {
    mocked.app = {
      ...baseApp('business_support'),
      revenueBonuses: [{
        id: 'RB-ZERO-HOUR-RESOLVED-STALE', storeId: 'CH001', businessDate: '2026-08-26',
        revenueVnd: 2_000_000, percentagePoolVnd: 0, totalPoolVnd: 0,
        allocatedVnd: 0, unallocatedVnd: 0, qualifiedPercentagePoolVnd: 20_000,
        zeroHourUnawardedVnd: 20_000, unallocatedResolutionCode: 'NO_ELIGIBLE_HOURS',
        status: 'RESOLVED_NO_ELIGIBLE_HOURS', version: 2,
      }],
      attendance: [{
        id: 'ATT-RESOLVED-LATE', employeeId: 'NV-01', storeId: 'CH001', date: '2026-08-26',
        checkInAt: '2026-08-26T01:00:00.000Z', checkOutAt: '2026-08-26T02:00:00.000Z',
        workedSeconds: 3_600, approvedSalesSeconds: 3_600,
      }],
    }
    render(<RevenueBonusPage />)

    expect(screen.getByText(/Hãy hoàn tất chấm công và bấm TÍNH THƯỞNG NGÀY/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })).toBeTruthy()
  })

  it('shows the original zero-hour amount and audit metadata after resolution', () => {
    mocked.app = {
      ...baseApp('business_support'),
      revenueBonuses: [{
        id: 'RB-ZERO-HOUR-RESOLVED', storeId: 'CH001', businessDate: '2026-08-26',
        percentagePoolVnd: 0, totalPoolVnd: 0, allocatedVnd: 0, unallocatedVnd: 0,
        qualifiedPercentagePoolVnd: 50_000, zeroHourUnawardedVnd: 50_000,
        unallocatedResolutionCode: 'NO_ELIGIBLE_HOURS',
        unallocatedResolutionReason: 'Không có giờ bán hàng được duyệt trong ngày.',
        unallocatedResolvedAt: '2026-08-26T06:00:00.000Z',
        unallocatedResolvedBy: { name: 'Hỗ trợ Một' },
        supersededAt: '2026-08-27T06:00:00.000Z',
        status: 'RESOLVED_NO_ELIGIBLE_HOURS', version: 4,
      }],
    }
    render(<RevenueBonusPage />)

    const history = screen.getByRole('heading', { name: 'Lịch sử xử lý quỹ 0 giờ' }).closest('.card')
    expect(within(history).getByText('50,000 đ')).toBeTruthy()
    expect(within(history).getByText('Không có giờ bán hàng được duyệt trong ngày.')).toBeTruthy()
    expect(within(history).getByText('Hỗ trợ Một')).toBeTruthy()
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

  it('reconciles private compensation sources across strict profile aliases without widening privacy', () => {
    mocked.app = {
      ...baseApp('employee'),
      session: { role: 'employee', employeeId: 'CODE-NV-01', storeId: 'CH001' },
      currentEmployee: {
        id: 'PROFILE-NV-01', code: 'CODE-NV-01', employeeId: 'LEGACY-NV-01', employeeCode: 'STAFF-NV-01',
        name: 'Nhân viên Một', unit: 'store', storeId: 'CH001',
      },
      compensationEntries: [{
        id: 'C-ALIAS', employeeId: 'CODE-NV-01', type: 'WORK', amountVnd: 40,
        effectiveDate: '2026-08-26', note: 'Thưởng công việc mã cũ', status: 'APPROVED',
      }, {
        id: 'C-OTHER', employeeId: 'NV-02', type: 'WORK', amountVnd: 999,
        effectiveDate: '2026-08-26', note: 'Thưởng người khác', status: 'APPROVED',
      }],
      violations: [{
        id: 'V-ALIAS', employeeId: 'STAFF-NV-01', amountVnd: 10,
        occurredOn: '2026-08-26', title: 'Khấu trừ mã cũ', status: 'ACTIVE',
      }],
      revenueBonuses: [{
        id: 'RB-ALIAS', storeId: 'CH001', businessDate: '2026-08-26', allocations: [{
          id: 'RA-ALIAS', employeeId: 'PROFILE-NV-01', amountVnd: 20, status: 'APPROVED',
        }],
      }],
      payrollPeriods: [{
        id: 'PAY-ALIAS', storeId: 'CH001', storeName: 'Dosii NTL', period: '2026-08', status: 'Đã chốt',
        rows: [{
          employeeId: 'LEGACY-NV-01', salaryVnd: 100, grossCompensationVnd: 160,
          appliedViolationVnd: 10, advancesPaid: 0, netPayVnd: 150,
        }, { employeeId: 'NV-02', salaryVnd: 999, netPayVnd: 999 }],
      }],
    }

    render(<MyCompensationPage />)

    expect(screen.getByText('Thưởng công việc mã cũ')).toBeTruthy()
    expect(screen.getByText('Khấu trừ mã cũ')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Quyết toán theo cửa hàng' })).toBeTruthy()
    expect(screen.getAllByText('150 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('Thưởng người khác')).toBeNull()
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
