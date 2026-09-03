import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevenueBonusPage } from './RevenueBonusPage'

const mocked = vi.hoisted(() => ({ app: {}, liveRevenue: vi.fn(), periodRevenue: vi.fn() }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusLive: (payload) => mocked.liveRevenue(payload),
  apiGetRevenueBonusPeriod: (payload) => mocked.periodRevenue(payload),
}))

const app = () => ({
  session: { role: 'employee', employeeId: 'E01', storeId: 'S01' },
  currentEmployee: { id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'S01' },
  activeStoreId: 'S01',
  stores: [{ id: 'S01', name: 'Dosii NTL', code: 'DOSII-NTL' }],
  employees: [{ id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'S01' }],
  // The employee bootstrap intentionally contains only their own rows. The UI
  // must not use these partial collections to recompute the team denominator.
  orders: [{
    id: 'OWN-ORDER', storeId: 'S01', employeeId: 'E01', amount: 1_000_000,
    status: 'Hoàn tất', createdAt: '2026-09-03T10:00:00+07:00',
  }],
  attendance: [{
    id: 'OWN-ATT', storeId: 'S01', employeeId: 'E01', workDate: '2026-09-03',
    workedSeconds: 3_600, checkOutAt: '2026-09-03T11:00:00.000Z',
  }],
  supportTransfers: [],
  revenueBonusDaily: [],
  revenueBonusAllocations: [],
  revenueBonusOverrides: [],
  revenueBonuses: [],
  apiStatus: 'connected',
  notify: vi.fn(),
})

describe('RevenueBonusPage server-authoritative automatic history', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-03T12:00:00.000Z'))
    mocked.app = app()
    mocked.liveRevenue.mockReset().mockResolvedValue({
      snapshot: {
        storeId: 'S01', businessDate: '2026-09-03', projectedAt: '2026-09-03T12:00:00.000Z',
        revenueVnd: 2_000_000, totalPoolVnd: 20_000, automaticAllocatedVnd: 20_000,
        allocatedVnd: 20_000, unallocatedVnd: 0, adminAdjustmentVnd: 0,
        totalWorkedSeconds: 7_200, attendanceCount: 2, allocations: [{
          id: 'automatic-revenue:S01:2026-09-03:E01', storeId: 'S01', businessDate: '2026-09-03',
          employeeId: 'E01', employeeName: 'Nguyễn An', workedSeconds: 3_600,
          approvedSalesHours: 1, weightPercent: 50, automaticAmountVnd: 10_000,
          amountVnd: 10_000, status: 'LIVE',
        }],
      },
    })
    mocked.periodRevenue.mockReset().mockResolvedValue({
      period: {
        storeId: 'S01', period: '2026-09', projectedAt: '2026-09-03T12:00:00.000Z',
        days: [{ businessDate: '2026-09-03', projectedAt: '2026-09-03T12:00:00.000Z' }],
        allocations: [{
          id: 'server-history-E01', storeId: 'S01', businessDate: '2026-09-03', period: '2026-09',
          employeeId: 'E01', employeeName: 'Nguyễn An', workedSeconds: 3_600,
          approvedSalesHours: 1, weightPercent: 25, automaticAmountVnd: 123_456,
          amountVnd: 123_456, status: 'LIVE',
        }],
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders employee month history from the server instead of partial local state', async () => {
    render(<RevenueBonusPage storeScoped />)

    await waitFor(() => expect(mocked.periodRevenue).toHaveBeenCalledWith({
      storeId: 'S01', period: '2026-09',
    }))
    expect((await screen.findAllByText('123,456 đ')).length).toBeGreaterThan(0)
    expect(screen.getByText('25.00%')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /tính thưởng ngày/i })).toBeNull()
  })
})
