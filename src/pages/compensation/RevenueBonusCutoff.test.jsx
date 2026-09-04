import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevenueBonusPage } from './RevenueBonusPage'

const mocked = vi.hoisted(() => ({ app: {}, liveRevenue: vi.fn(), periodRevenue: vi.fn() }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusLive: (payload) => mocked.liveRevenue(payload),
  apiGetRevenueBonusPeriod: (payload) => mocked.periodRevenue(payload),
}))

const stores = [{ id: 'CH001', name: 'Dosii NTL', code: 'DOSII-NTL' }]
const employees = [
  { id: 'NV-01', name: 'Nhân viên Một', unit: 'store', storeId: 'CH001' },
  { id: 'NV-02', name: 'Nhân viên Hai', unit: 'store', storeId: 'CH001' },
]

const snapshot = (allocationOverrides = {}) => ({
  id: 'automatic-revenue-day:CH001:2026-09-03',
  sourceType: 'automatic-revenue-bonus',
  automatic: true,
  calculationMode: 'AUTOMATIC',
  editableByAdminOnly: true,
  storeId: 'CH001',
  businessDate: '2026-09-03',
  projectedAt: '2026-09-03T15:05:00.000Z',
  revenueVnd: 2_000_000,
  orderCount: 1,
  percentagePoolVnd: 20_000,
  milestonePoolVnd: 0,
  totalPoolVnd: 20_000,
  automaticAllocatedVnd: 20_000,
  allocatedVnd: 20_000,
  unallocatedVnd: 0,
  adminAdjustmentVnd: 0,
  totalWorkedSeconds: 7_200,
  attendanceCount: 2,
  openAttendanceCount: 0,
  participantCount: 2,
  status: 'FINALIZED',
  calculationEligibility: { allowed: true, code: 'FINALIZED' },
  allocations: [{
    id: 'AUTO-NV-01', storeId: 'CH001', businessDate: '2026-09-03',
    employeeId: 'NV-01', employeeName: 'Nhân viên Một', workedSeconds: 3_600,
    approvedSalesHours: 1, weightPercent: 50, automaticAmountVnd: 10_000,
    amountVnd: 10_000, allocatedVnd: 10_000, status: 'FINALIZED',
    ...allocationOverrides,
  }],
})

const appFor = (role = 'business_support', overrides = {}) => ({
  session: {
    role,
    employeeId: role === 'employee' ? 'NV-01' : undefined,
    storeId: ['employee', 'store_manager'].includes(role) ? 'CH001' : undefined,
  },
  currentEmployee: role === 'employee' ? employees[0] : null,
  activeStoreId: 'CH001',
  stores,
  employees,
  orders: [{
    id: 'ORDER-1', storeId: 'CH001', amount: 2_000_000, status: 'Hoàn tất',
    createdAt: '2026-09-03T10:00:00+07:00',
  }],
  attendance: [{
    id: 'ATT-1', storeId: 'CH001', employeeId: 'NV-01', workDate: '2026-09-03',
    workedSeconds: 3_600, checkOutAt: '2026-09-03T10:00:00+07:00',
  }, {
    id: 'ATT-2', storeId: 'CH001', employeeId: 'NV-02', workDate: '2026-09-03',
    workedSeconds: 3_600, checkOutAt: '2026-09-03T10:00:00+07:00',
  }],
  revenueBonusDaily: [],
  revenueBonusAllocations: [],
  revenueBonusOverrides: [],
  revenueBonuses: [],
  apiStatus: 'local',
  notify: vi.fn(),
  setRevenueBonusOverride: vi.fn().mockResolvedValue({ ok: true }),
  deleteRevenueBonusOverride: vi.fn().mockResolvedValue({ ok: true }),
  restoreRevenueBonusOverride: vi.fn().mockResolvedValue({ ok: true }),
  resolveRevenueBonusDailyCollision: vi.fn().mockResolvedValue({ ok: true }),
  ...overrides,
})

const automaticTable = () => screen.getByRole('heading', {
  name: 'Phân bổ thưởng tự động theo nhân viên',
}).closest('section')

describe('RevenueBonusPage automatic mode', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-03T15:05:00.000Z'))
    mocked.liveRevenue.mockReset()
    mocked.periodRevenue.mockReset()
    mocked.periodRevenue.mockImplementation(({ storeId, period }) => Promise.resolve({
      period: { storeId, period, days: [], allocations: [] },
    }))
    mocked.app = appFor()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([
    ['before the former cutoff', '2026-09-03T13:59:59.000Z'],
    ['after the former cutoff', '2026-09-03T14:00:01.000Z'],
  ])('never shows a manual calculation or approval action %s', (_label, now) => {
    vi.setSystemTime(new Date(now))
    mocked.app = appFor()
    render(<RevenueBonusPage storeScoped />)

    expect(screen.getAllByText('TỰ ĐỘNG').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /TÍNH THƯỞNG NGÀY/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /ĐÃ TÍNH THƯỞNG/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: /Duyệt thưởng mốc cao nhất/i })).toBeNull()
    expect(screen.getByText(/Không cần bấm tính hoặc duyệt/i)).toBeTruthy()
  })

  it('renders the finalized formula after 22:00 and includes no manual workflow', () => {
    render(<RevenueBonusPage storeScoped />)

    expect(screen.getAllByText('2,000,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('20,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('10,000 đ').length).toBeGreaterThan(1)
    expect(within(automaticTable()).getAllByText('Đã chốt tự động').length).toBe(2)
    expect(screen.queryByText(/chờ duyệt/i)).toBeNull()
  })

  it('uses the server live snapshot and keeps coworker allocations private for employees', async () => {
    mocked.app = appFor('employee', { apiStatus: 'connected', orders: [], attendance: [] })
    mocked.liveRevenue.mockResolvedValue({ snapshot: snapshot() })
    render(<RevenueBonusPage storeScoped />)

    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledWith({
      storeId: 'CH001', businessDate: '2026-09-03',
    }))
    expect((await screen.findAllByText('10,000 đ')).length).toBeGreaterThan(1)
    expect(screen.queryByText('Nhân viên Hai')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xóa' })).toBeNull()
  })

  it('allows only Admin to edit one employee bonus with a mandatory audit reason', async () => {
    mocked.app = appFor('admin', { apiStatus: 'connected', orders: [], attendance: [] })
    mocked.liveRevenue.mockResolvedValue({ snapshot: snapshot() })
    render(<RevenueBonusPage storeScoped />)

    const editButton = await screen.findByRole('button', { name: 'Sửa' })
    fireEvent.click(editButton)
    expect(screen.getByRole('dialog', { name: 'CHỈNH SỬA THƯỞNG DOANH THU' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Số tiền thưởng hiệu lực'), { target: { value: '12000' } })
    fireEvent.change(screen.getByLabelText('Lý do điều chỉnh thưởng doanh thu'), {
      target: { value: 'Đối soát lại doanh thu ngày' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'LƯU ĐIỀU CHỈNH' }))

    await waitFor(() => expect(mocked.app.setRevenueBonusOverride).toHaveBeenCalledWith({
      storeId: 'CH001',
      businessDate: '2026-09-03',
      employeeId: 'NV-01',
      amountVnd: 12_000,
      reason: 'Đối soát lại doanh thu ngày',
    }))
  })

  it('lets Admin logically delete a bonus without removing its audit row', async () => {
    mocked.app = appFor('admin', { apiStatus: 'connected', orders: [], attendance: [] })
    mocked.liveRevenue.mockResolvedValue({ snapshot: snapshot() })
    render(<RevenueBonusPage storeScoped />)

    fireEvent.click(await screen.findByRole('button', { name: 'Xóa' }))
    expect(screen.getByText(/Khoản thưởng hiệu lực của nhân viên sẽ về 0 đồng/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Lý do điều chỉnh thưởng doanh thu'), {
      target: { value: 'Không đủ điều kiện sau đối soát' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'XÁC NHẬN XÓA' }))

    await waitFor(() => expect(mocked.app.deleteRevenueBonusOverride).toHaveBeenCalledWith({
      storeId: 'CH001',
      businessDate: '2026-09-03',
      employeeId: 'NV-01',
      reason: 'Không đủ điều kiện sau đối soát',
    }))
  })

  it('lets Admin restore the automatic formula after an adjustment or deletion', async () => {
    mocked.app = appFor('admin', { apiStatus: 'connected', orders: [], attendance: [] })
    mocked.liveRevenue.mockResolvedValue({
      snapshot: {
        ...snapshot({
          amountVnd: 0,
          allocatedVnd: 0,
          overrideId: 'RBO-1',
          overrideMode: 'DELETED',
          overrideVersion: 2,
          overrideReason: 'Đã xóa sau đối soát',
          status: 'ADMIN_DELETED',
        }),
        allocatedVnd: 0,
        adminAdjustmentVnd: -10_000,
      },
    })
    render(<RevenueBonusPage storeScoped />)

    fireEvent.click(await screen.findByRole('button', { name: 'Khôi phục tự động' }))
    fireEvent.change(screen.getByLabelText('Lý do điều chỉnh thưởng doanh thu'), {
      target: { value: 'Khôi phục theo dữ liệu đã xác minh' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'KHÔI PHỤC TỰ ĐỘNG' }))

    await waitFor(() => expect(mocked.app.restoreRevenueBonusOverride).toHaveBeenCalledWith({
      storeId: 'CH001',
      businessDate: '2026-09-03',
      employeeId: 'NV-01',
      expectedVersion: 2,
      reason: 'Khôi phục theo dữ liệu đã xác minh',
    }))
  })

  it('shows Admin enough evidence to select and audit the canonical duplicate daily result', async () => {
    const duplicateDaily = [{
      id: 'RBD-LEGACY', storeId: 'CH001', businessDate: '2026-09-02', period: '2026-09',
      status: 'APPROVED', sourceType: 'manual', revenueVnd: 2_000_000, totalPoolVnd: 20_000,
      allocatedVnd: 20_000, calculatedAt: '2026-09-02T15:01:00.000Z', allocations: [{ id: 'RBA-LEGACY' }],
    }, {
      id: 'RBD-AUTOMATIC', storeId: 'CH001', businessDate: '2026-09-02', period: '2026-09',
      status: 'FINALIZED', sourceType: 'automatic-revenue-bonus', automatic: true,
      revenueVnd: 2_000_000, totalPoolVnd: 20_000, allocatedVnd: 20_000,
      finalizedAt: '2026-09-04T01:00:00.000Z', allocations: [{ id: 'RBA-AUTOMATIC' }],
    }]
    mocked.app = appFor('admin', {
      apiStatus: 'connected', orders: [], attendance: [], revenueBonusDaily: duplicateDaily,
    })
    mocked.liveRevenue.mockResolvedValue({ snapshot: snapshot() })
    render(<RevenueBonusPage storeScoped />)

    const resolveButton = await screen.findByRole('button', { name: 'ĐỐI SOÁT 02/09/2026' })
    fireEvent.click(resolveButton)
    expect(screen.getByRole('dialog', { name: 'XỬ LÝ KẾT QUẢ THƯỞNG TRÙNG' })).toBeTruthy()
    expect(screen.getAllByText('RBD-LEGACY').length).toBeGreaterThan(0)
    expect(screen.getAllByText('RBD-AUTOMATIC').length).toBeGreaterThan(0)
    expect(screen.getAllByText('20,000 đ').length).toBeGreaterThan(1)

    fireEvent.change(screen.getByLabelText('Kết quả thưởng doanh thu giữ lại'), {
      target: { value: 'RBD-AUTOMATIC' },
    })
    fireEvent.change(screen.getByLabelText('Lý do xử lý kết quả thưởng doanh thu trùng'), {
      target: { value: 'Giữ bản tự động đã đối chiếu doanh thu và chấm công' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'XÁC NHẬN XỬ LÝ' }))

    await waitFor(() => expect(mocked.app.resolveRevenueBonusDailyCollision).toHaveBeenCalledWith({
      storeId: 'CH001',
      businessDate: '2026-09-02',
      keepDailyId: 'RBD-AUTOMATIC',
      reason: 'Giữ bản tự động đã đối chiếu doanh thu và chấm công',
    }))
  })

  it('does not expose Admin mutation actions to Business Support', () => {
    mocked.app = appFor('business_support')
    render(<RevenueBonusPage storeScoped />)

    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xóa' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Khôi phục tự động' })).toBeNull()
  })
})
