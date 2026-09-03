import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storesSeed } from '../../data'
import { RevenueBonusPage } from './RevenueBonusPage'

const mocked = vi.hoisted(() => ({ app: {}, liveRevenue: vi.fn() }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusLive: (payload) => mocked.liveRevenue(payload),
}))

const managerCatchUpApp = (store, overrides = {}) => {
  const managerId = `QL-${store.id}`
  const employeeId = `NV-${store.id}`
  return {
    session: { role: 'store_manager', employeeId: managerId, storeId: store.id },
    currentEmployee: {
      id: managerId,
      name: `Quản lý ${store.short || store.name}`,
      unit: 'store_manager',
      storeId: store.id,
    },
    activeStoreId: store.id,
    stores: [store],
    employees: [
      {
        id: managerId,
        name: `Quản lý ${store.short || store.name}`,
        unit: 'store_manager',
        storeId: store.id,
      },
      {
        id: employeeId,
        name: `Nhân viên ${store.short || store.name}`,
        unit: 'store',
        storeId: store.id,
      },
    ],
    orders: [{
      id: `O-${store.id}`,
      storeId: store.id,
      employeeId,
      amount: 1_000_000,
      status: 'Hoàn tất',
      createdAt: '2026-09-02T10:00:00+07:00',
    }],
    attendance: [{
      id: `A-${store.id}`,
      storeId: store.id,
      employeeId,
      employeeName: `Nhân viên ${store.short || store.name}`,
      workDate: '2026-09-02',
      shiftId: `morning-${store.id}`,
      shiftName: 'Ca sáng',
      shiftStart: '08:30',
      shiftEnd: '12:00',
      workedSeconds: 12_600,
      checkInAt: '2026-09-02T01:30:00.000Z',
      checkOutAt: '2026-09-02T05:00:00.000Z',
    }],
    schedule: [],
    shiftDefinitions: [{
      id: `morning-${store.id}`,
      storeId: store.id,
      name: 'Ca sáng',
      start: '08:30',
      end: '12:00',
      active: true,
    }],
    revenueBonuses: [],
    revenueBonusDaily: [],
    revenueBonusAllocations: [],
    teamRewardClaims: [],
    apiStatus: 'local',
    notify: vi.fn(),
    calculateRevenueBonusDay: vi.fn().mockResolvedValue({ ok: true }),
    approveRevenueBonusMilestone: vi.fn(),
    rejectRevenueBonusMilestone: vi.fn(),
    ...overrides,
  }
}

describe('RevenueBonusPage store-manager calculation action', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-03T02:00:00.000Z')) // 03/09 09:00 Vietnam
    mocked.liveRevenue.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each(storesSeed)(
    'shows an enabled 02/09 catch-up action to the assigned manager of $name',
    (store) => {
      mocked.app = managerCatchUpApp(store)
      render(<RevenueBonusPage storeScoped />)

      fireEvent.change(screen.getByLabelText('Ngày kinh doanh'), {
        target: { value: '2026-09-02' },
      })

      const button = screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })
      expect(button.disabled).toBe(false)
      expect(button.classList.contains('is-ready')).toBe(true)
      expect(screen.getByRole('group', { name: 'Cửa hàng hiện tại' }).textContent).toContain(store.name)
      expect(screen.queryByRole('heading', { name: 'Duyệt thưởng mốc cao nhất' })).toBeNull()
    },
  )

  it('lets the Dosii Dĩ An manager calculate 02/09 on 03/09 after confirmation', async () => {
    const store = {
      ...storesSeed.find(({ id }) => id === 'CH003'),
      name: 'Dosii Dĩ An',
      short: 'Dosii Dĩ An',
    }
    mocked.app = managerCatchUpApp(store)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<RevenueBonusPage storeScoped />)

    fireEvent.change(screen.getByLabelText('Ngày kinh doanh'), {
      target: { value: '2026-09-02' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' }))

    await waitFor(() => expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledWith({
      storeId: 'CH003',
      businessDate: '2026-09-02',
    }))
    expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('shows the assigned store manager a large named warning while an employee is still working', async () => {
    const store = { id: 'S01', name: 'Dosii NTL', code: 'DOSII-NTL' }
    mocked.app = managerCatchUpApp(store, { apiStatus: 'connected' })
    mocked.liveRevenue.mockResolvedValue({
      snapshot: {
        storeId: 'S01',
        businessDate: '2026-09-03',
        projectedAt: '2026-09-03T14:05:00.000Z',
        revenueVnd: 1_000_000,
        percentagePoolVnd: 10_000,
        allocatedVnd: 0,
        unallocatedVnd: 10_000,
        totalWorkedSeconds: 10_800,
        attendanceCount: 1,
        openAttendanceCount: 1,
        allocations: [],
        calculationEligibility: {
          allowed: false,
          code: 'ATTENDANCE_OPEN',
          openAttendanceCount: 1,
          openEmployeeNames: ['Nguyễn An'],
          message: 'Nhân viên Nguyễn An đang làm việc nên chưa tính thưởng được. Hãy chờ nhân viên Nguyễn An kết ca mới được tính thưởng.',
        },
      },
    })

    vi.setSystemTime(new Date('2026-09-03T14:05:00.000Z')) // 03/09 21:05 Vietnam
    render(<RevenueBonusPage storeScoped />)

    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledWith({
      storeId: 'S01',
      businessDate: '2026-09-03',
    }))
    const alert = await screen.findByRole('alert')
    expect(alert.classList.contains('revenue-bonus-attendance-alert')).toBe(true)
    expect(alert.textContent).toContain('Nhân viên Nguyễn An đang làm việc')
    expect(screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' }).disabled).toBe(true)
  })
})
