from pathlib import Path


def write(path, content):
    Path(path).write_text(content, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    print(f'apply: {label}')
    return text.replace(old, new, 1)


def replace_section(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label}: start marker not found')
    end = text.find(end_marker, start + len(start_marker))
    if end < 0:
        raise SystemExit(f'{label}: end marker not found')
    print(f'apply: {label}')
    return text[:start] + replacement + text[end:]


write('src/pages/compensation/RevenueBonusCutoff.test.jsx', r'''import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevenueBonusPage } from './RevenueBonusPage'

const mocked = vi.hoisted(() => ({ app: {}, liveRevenue: vi.fn() }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusLive: (payload) => mocked.liveRevenue(payload),
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
  projectedAt: '2026-09-03T11:00:00.000Z',
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
  allocations: [{
    id: 'AUTO-NV-01', storeId: 'CH001', businessDate: '2026-09-03',
    employeeId: 'NV-01', employeeName: 'Nhân viên Một', workedSeconds: 3_600,
    approvedSalesHours: 1, weightPercent: 50, automaticAmountVnd: 10_000,
    amountVnd: 10_000, allocatedVnd: 10_000, status: 'LIVE',
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
  ...overrides,
})

const automaticTable = () => screen.getByRole('heading', {
  name: 'Phân bổ thưởng tự động theo nhân viên',
}).closest('section')

describe('RevenueBonusPage automatic mode', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-03T11:00:00.000Z'))
    mocked.liveRevenue.mockReset()
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

  it('renders the live formula immediately and includes no manual workflow', () => {
    render(<RevenueBonusPage storeScoped />)

    expect(screen.getAllByText('2,000,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('20,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('10,000 đ').length).toBeGreaterThan(1)
    expect(within(automaticTable()).getAllByText('Tự động trực tiếp').length).toBe(2)
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

  it('does not expose Admin mutation actions to Business Support', () => {
    mocked.app = appFor('business_support')
    render(<RevenueBonusPage storeScoped />)

    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xóa' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Khôi phục tự động' })).toBeNull()
  })
})
''')

write('src/pages/compensation/RevenueBonusStoreManager.test.jsx', r'''import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevenueBonusPage } from './RevenueBonusPage'

const mocked = vi.hoisted(() => ({ app: {} }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusLive: vi.fn(),
}))

const storesSeed = [
  { id: 'DOSII-NVT', name: 'Dosii Nguyễn Văn Trỗi', code: 'DOSII-NVT' },
  { id: 'DOSII-DI-AN', name: 'Dosii Dĩ An', code: 'DOSII-DI-AN' },
  { id: 'DOSII-CAN-THO', name: 'Dosii Cần Thơ', code: 'DOSII-CAN-THO' },
  { id: 'SM-TNV', name: 'SM TNV', code: 'SM-TNV', type: 'SM' },
]

const managerApp = (store) => {
  const managerId = `${store.id}-QL`
  const employeeId = `${store.id}-NV`
  const employees = [
    { id: managerId, name: `Quản lý ${store.name}`, unit: 'store', storeId: store.id, isStoreManager: true },
    { id: employeeId, name: `Nhân viên ${store.name}`, unit: 'store', storeId: store.id },
  ]
  return {
    session: { role: 'store_manager', employeeId: managerId, storeId: store.id },
    currentEmployee: employees[0],
    activeStoreId: store.id,
    stores: [store],
    employees,
    orders: [{
      id: `${store.id}-ORDER`, storeId: store.id, amount: 2_000_000, status: 'Hoàn tất',
      createdAt: '2026-09-03T10:00:00+07:00',
    }],
    attendance: [{
      id: `${store.id}-ATT-QL`, storeId: store.id, employeeId: managerId, workDate: '2026-09-03',
      workedSeconds: 3_600, checkOutAt: '2026-09-03T10:00:00+07:00',
    }, {
      id: `${store.id}-ATT-NV`, storeId: store.id, employeeId, workDate: '2026-09-03',
      workedSeconds: 3_600, checkOutAt: '2026-09-03T10:00:00+07:00',
    }],
    revenueBonusDaily: [],
    revenueBonusAllocations: [],
    revenueBonusOverrides: [],
    revenueBonuses: [],
    apiStatus: 'local',
    notify: vi.fn(),
  }
}

describe('store-manager automatic daily revenue bonus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-03T11:00:00.000Z'))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each(storesSeed)('shows automatic team allocation without calculate, approval, edit or delete at $name', (store) => {
    mocked.app = managerApp(store)
    render(<RevenueBonusPage storeScoped />)

    expect(screen.getByRole('group', { name: 'Cửa hàng hiện tại' }).textContent).toContain(store.name)
    expect(screen.getAllByText('TỰ ĐỘNG').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /TÍNH THƯỞNG NGÀY/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: /Duyệt thưởng mốc cao nhất/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Xóa' })).toBeNull()
    const table = screen.getByRole('heading', { name: 'Phân bổ thưởng tự động theo nhân viên' }).closest('section')
    expect(within(table).getByText(`Quản lý ${store.name}`)).toBeTruthy()
    expect(within(table).getByText(`Nhân viên ${store.name}`)).toBeTruthy()
  })
})
''')

write('server/revenueBonusCutoff.test.js', r'''// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { revenueBonusLiveSnapshot } from './worker'

const stateFor = ({ revenueVnd = 2_000_000, overrides = [] } = {}) => ({
  stores: [{ id: 'S01', name: 'Dosii S01', code: 'DOSII-S01' }],
  employees: [
    { id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'S01' },
    { id: 'E02', name: 'Trần Bình', unit: 'store', storeId: 'S01' },
  ],
  orders: [{
    id: 'O01', storeId: 'S01', employeeId: 'E01', amount: revenueVnd,
    status: 'Hoàn tất', createdAt: '2026-09-03T10:00:00+07:00',
  }],
  attendance: [{
    id: 'A01', storeId: 'S01', employeeId: 'E01', workDate: '2026-09-03',
    checkInAt: '2026-09-03T10:00:00.000Z', checkOutAt: null, workedSeconds: 0,
  }, {
    id: 'A02', storeId: 'S01', employeeId: 'E02', workDate: '2026-09-03',
    checkInAt: '2026-09-03T09:00:00.000Z', checkOutAt: '2026-09-03T10:00:00.000Z',
    workedSeconds: 3_600,
  }],
  revenueBonusDaily: [],
  revenueBonusAllocations: [],
  revenueBonusOverrides: overrides,
})

const store = { id: 'S01', name: 'Dosii S01', code: 'DOSII-S01' }
const allocation = (snapshot, employeeId) => snapshot.allocations.find((row) => row.employeeId === employeeId)

describe('revenueBonusLiveSnapshot automatic calculation', () => {
  it('calculates before the former 21:00 cutoff and projects an open shift from trusted server time', () => {
    const snapshot = revenueBonusLiveSnapshot({
      state: stateFor(),
      store,
      businessDate: '2026-09-03',
      now: '2026-09-03T11:00:00.000Z',
    })

    expect(snapshot).toMatchObject({
      calculationMode: 'AUTOMATIC',
      editableByAdminOnly: true,
      revenueVnd: 2_000_000,
      totalPoolVnd: 20_000,
      openAttendanceCount: 1,
      participantCount: 2,
    })
    expect(snapshot).not.toHaveProperty('calculationEligibility')
    expect(allocation(snapshot, 'E01').workedSeconds).toBe(3_600)
    expect(snapshot.allocations.reduce((sum, row) => sum + row.amountVnd, 0)).toBe(20_000)
  })

  it('automatically applies the highest milestone without creating a pending approval', () => {
    const snapshot = revenueBonusLiveSnapshot({
      state: stateFor({ revenueVnd: 16_000_000 }),
      store,
      businessDate: '2026-09-03',
      now: '2026-09-03T11:00:00.000Z',
    })

    expect(snapshot).toMatchObject({
      percentagePoolVnd: 640_000,
      milestonePoolVnd: 250_000,
      totalPoolVnd: 890_000,
      allocatedVnd: 890_000,
      status: 'LIVE',
    })
    expect(snapshot).not.toHaveProperty('milestoneStatus')
    expect(snapshot).not.toHaveProperty('pendingMilestonePoolVnd')
  })

  it('applies the latest Admin override to one employee while preserving the automatic amount', () => {
    const snapshot = revenueBonusLiveSnapshot({
      state: stateFor({
        overrides: [{
          id: 'RBO-1', storeId: 'S01', businessDate: '2026-09-03', employeeId: 'E01',
          employeeName: 'Nguyễn An', mode: 'AMOUNT', amountVnd: 12_345,
          reason: 'Đối soát doanh thu', status: 'ACTIVE', version: 1,
          updatedAt: '2026-09-03T11:01:00.000Z',
        }],
      }),
      store,
      businessDate: '2026-09-03',
      now: '2026-09-03T11:00:00.000Z',
    })

    expect(allocation(snapshot, 'E01')).toMatchObject({
      automaticAmountVnd: 10_000,
      amountVnd: 12_345,
      adminAdjustmentVnd: 2_345,
      overrideId: 'RBO-1',
      status: 'ADMIN_ADJUSTED',
    })
    expect(allocation(snapshot, 'E02').amountVnd).toBe(10_000)
  })
})
''')

comp_path = Path('src/pages/compensation/CompensationPages.test.jsx')
comp = comp_path.read_text(encoding='utf-8')
comp = replace_once(
    comp,
    "import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'",
    "import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'",
    'remove obsolete act import',
)
revenue_tests = r'''  it('keeps legacy employee revenue bonus data private before the automatic cutover', () => {
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
    expect(screen.queryByRole('button', { name: /TÍNH THƯỞNG NGÀY/i })).toBeNull()
    expect(screen.getByText(/dữ liệu lịch sử trước khi chuyển sang cơ chế tự động/i)).toBeTruthy()
  })

  it('automatically derives the current Dosii revenue, tier and allocations from live data', () => {
    vi.setSystemTime(new Date('2026-09-03T11:00:00.000Z'))
    mocked.app = {
      ...baseApp('business_support'),
      apiStatus: 'local',
      revenueBonusDaily: [],
      revenueBonusAllocations: [],
      revenueBonusOverrides: [],
      orders: [{
        id: 'ORDER-LIVE', storeId: 'CH001', amount: 1_800_000, status: 'Hoàn tất',
        createdAt: '2026-09-03T09:00:00+07:00',
      }],
      attendance: [{
        id: 'ATT-QL', employeeId: 'QL-01', storeId: 'CH001', workDate: '2026-09-03',
        workedSeconds: 7_200, checkOutAt: '2026-09-03T10:00:00+07:00',
      }, {
        id: 'ATT-NV', employeeId: 'NV-01', storeId: 'CH001', workDate: '2026-09-03',
        workedSeconds: 7_200, checkOutAt: '2026-09-03T10:00:00+07:00',
      }],
    }
    render(<RevenueBonusPage />)

    expect(screen.getAllByText('1,800,000 đ').length).toBeGreaterThan(0)
    expect(screen.getAllByText('18,000 đ').length).toBeGreaterThan(0)
    expect(screen.getByText('Đang ở mốc 1%')).toBeTruthy()
    expect(screen.getAllByText('Tự động trực tiếp').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /TÍNH THƯỞNG NGÀY/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: /Duyệt thưởng mốc cao nhất/i })).toBeNull()
  })

  it('uses the SM revenue program automatically from the canonical SM-TNV store code', () => {
    vi.setSystemTime(new Date('2026-09-03T11:00:00.000Z'))
    mocked.app = {
      ...baseApp('business_support'),
      apiStatus: 'local',
      activeStoreId: 'CH002',
      stores: [stores[0], { id: 'CH002', name: 'Cửa hàng 2', code: 'SM-TNV' }, stores[2]],
      revenueBonusDaily: [],
      revenueBonusAllocations: [],
      revenueBonusOverrides: [],
      orders: [{
        id: 'ORDER-SM-LIVE', storeId: 'CH002', amount: 7_000_000, status: 'Hoàn tất',
        createdAt: '2026-09-03T09:00:00+07:00',
      }],
      attendance: [{
        id: 'ATT-SM-LIVE', employeeId: 'QL-02', storeId: 'CH002', workDate: '2026-09-03',
        workedSeconds: 3_600, checkOutAt: '2026-09-03T10:00:00+07:00',
      }],
    }

    render(<RevenueBonusPage />)

    expect(screen.getByText('Mốc thưởng doanh thu SM TNV')).toBeTruthy()
    expect(screen.getByText('Đang ở mốc 6%')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Duyệt/i })).toBeNull()
  })

  it('renders the signed-in employee live aggregate without exposing coworker rows', async () => {
    vi.setSystemTime(new Date('2026-09-03T11:00:00.000Z'))
    mocked.app = {
      ...baseApp('employee'),
      apiStatus: 'connected',
      revenueBonusDaily: [],
      revenueBonusAllocations: [],
      revenueBonusOverrides: [],
      orders: [],
      attendance: [],
    }
    mocked.liveRevenue.mockResolvedValue({
      snapshot: {
        storeId: 'CH001', businessDate: '2026-09-03', projectedAt: '2026-09-03T11:00:00.000Z',
        calculationMode: 'AUTOMATIC', revenueVnd: 1_800_000, percentagePoolVnd: 18_000,
        milestonePoolVnd: 0, totalPoolVnd: 18_000, allocatedVnd: 18_000, unallocatedVnd: 0,
        totalWorkedSeconds: 14_400, attendanceCount: 2, openAttendanceCount: 0,
        allocations: [{
          employeeId: 'NV-01', employeeName: 'Nhân viên Một', workedSeconds: 7_200,
          approvedSalesHours: 2, weightPercent: 50, automaticAmountVnd: 9_000,
          amountVnd: 9_000, allocatedVnd: 9_000, status: 'LIVE',
        }],
      },
    })
    render(<RevenueBonusPage />)

    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledWith({
      storeId: 'CH001', businessDate: '2026-09-03',
    }))
    expect((await screen.findAllByText('9,000 đ')).length).toBeGreaterThan(1)
    expect(screen.getByText('2 giờ 00 phút')).toBeTruthy()
    expect(screen.queryByText('Nhân viên Hai')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sửa' })).toBeNull()
  })

  it('filters legacy manager revenue history by past date, synchronized month and employee', () => {
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
        id: 'RB-SEP', storeId: 'CH001', businessDate: '2026-09-01', period: '2026-09', status: 'APPROVED',
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

    expect(within(historyCard).getByText('Tổng thưởng: 7,000 đ')).toBeTruthy()
    fireEvent.change(dateFilter, { target: { value: '2026-08-25' } })
    expect(monthFilter.value).toBe('2026-08')
    expect(within(historyCard).getByText('Tổng thưởng: 8,000 đ')).toBeTruthy()
    fireEvent.change(employeeFilter, { target: { value: 'NV-02' } })
    expect(within(historyCard).getByText('Tổng thưởng: 5,000 đ')).toBeTruthy()
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
    fireEvent.change(screen.getByLabelText('Cửa hàng'), { target: { value: 'CH002' } })

    expect(screen.getByLabelText('Nhân viên nhận thưởng doanh thu').value).toBe('')
    const historyCard = screen.getByRole('heading', { name: 'Lịch sử ghi nhận thưởng doanh thu' }).closest('section')
    expect(within(historyCard.querySelector('tbody')).getByText('Quản lý Hai')).toBeTruthy()
    expect(within(historyCard.querySelector('tbody')).queryByText('Nhân viên Hai')).toBeNull()
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
  })

'''
comp = replace_section(
    comp,
    "  it('keeps employee revenue bonus data private to the signed-in employee', () => {\n",
    "  it('renders only the signed-in employee statement entries', () => {\n",
    revenue_tests,
    'replace obsolete manual revenue page tests',
)
comp_path.write_text(comp, encoding='utf-8')
print('Automatic revenue tests applied.')
