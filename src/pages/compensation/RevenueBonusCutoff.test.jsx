import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevenueBonusPage } from './RevenueBonusPage'

const mocked = vi.hoisted(() => ({ app: {}, liveRevenue: vi.fn() }))

vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))
vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusLive: (payload) => mocked.liveRevenue(payload),
}))

const readyApp = () => ({
  session: { role: 'business_support', employeeId: 'HT-01' },
  currentEmployee: { id: 'HT-01', name: 'Hỗ trợ KD', unit: 'business_support' },
  activeStoreId: 'S01',
  stores: [{ id: 'S01', name: 'Dosii NTL', code: 'DOSII-NTL' }],
  employees: [
    { id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'S01' },
    { id: 'HT-01', name: 'Hỗ trợ KD', unit: 'business_support' },
  ],
  orders: [{
    id: 'O01', storeId: 'S01', amount: 1_000_000, status: 'Hoàn tất',
    createdAt: '2026-08-26T10:00:00+07:00',
  }],
  attendance: [{
    id: 'A01', storeId: 'S01', employeeId: 'E01', employeeName: 'Nguyễn An',
    workDate: '2026-08-26', shiftId: 'night', shiftName: 'Ca tối',
    shiftStart: '18:00', shiftEnd: '21:00', workedSeconds: 10_800,
    checkInAt: '2026-08-26T11:00:00.000Z', checkOutAt: '2026-08-26T14:00:00.000Z',
  }],
  schedule: [],
  shiftDefinitions: [{ id: 'night', storeId: 'S01', name: 'Ca tối', start: '18:00', end: '21:00', active: true }],
  revenueBonuses: [],
  revenueBonusDaily: [],
  revenueBonusAllocations: [],
  teamRewardClaims: [],
  apiStatus: 'local',
  notify: vi.fn(),
  calculateRevenueBonusDay: vi.fn().mockResolvedValue({ ok: true }),
  approveRevenueBonusMilestone: vi.fn(),
  rejectRevenueBonusMilestone: vi.fn(),
})

const dianApp = () => ({
  ...readyApp(),
  activeStoreId: 'DI-AN',
  stores: [{ id: 'DI-AN', name: 'Dosii Dĩ An', code: 'DOSII-DI-AN' }],
  employees: [
    { id: 'DIAN-E01', name: 'Nguyễn An', unit: 'store', storeId: 'DI-AN' },
    { id: 'DIAN-E02', name: 'Trần Bình', unit: 'store', storeId: 'DI-AN' },
    { id: 'HT-01', name: 'Hỗ trợ KD', unit: 'business_support' },
  ],
  orders: [
    {
      id: 'DIAN-O01', storeId: 'DI-AN', employeeId: 'DIAN-E01', amount: 1_000_000,
      status: 'Hoàn tất', createdAt: '2026-09-02T10:00:00+07:00',
    },
    {
      id: 'DIAN-O02', storeId: 'DI-AN', employeeId: 'DIAN-E02', amount: 1_585_000,
      status: 'Hoàn tất', createdAt: '2026-09-02T16:00:00+07:00',
    },
  ],
  attendance: [
    {
      id: 'DIAN-A01', storeId: 'DI-AN', employeeId: 'DIAN-E01', employeeName: 'Nguyễn An',
      workDate: '2026-09-02', shiftId: 'morning', shiftName: 'Ca sáng',
      shiftStart: '08:30', shiftEnd: '12:00', workedSeconds: 12_600,
      checkInAt: '2026-09-02T01:30:00.000Z', checkOutAt: '2026-09-02T05:00:00.000Z',
    },
    {
      id: 'DIAN-A02', storeId: 'DI-AN', employeeId: 'DIAN-E02', employeeName: 'Trần Bình',
      workDate: '2026-09-02', shiftId: 'afternoon', shiftName: 'Ca chiều',
      shiftStart: '13:00', shiftEnd: '17:30', workedSeconds: 16_200,
      checkInAt: '2026-09-02T06:00:00.000Z', checkOutAt: '2026-09-02T10:30:00.000Z',
    },
  ],
  schedule: [{
    id: 'DIAN-SCHEDULE', storeId: 'DI-AN', employeeId: 'DIAN-E01', date: '2026-09-02',
    shiftSnapshots: [
      { id: 'morning', name: 'Ca sáng', start: '08:30', end: '12:00' },
      { id: 'afternoon', name: 'Ca chiều', start: '13:00', end: '17:30' },
      { id: 'night', name: 'Ca tối', start: '18:00', end: '21:00' },
    ],
  }],
  shiftDefinitions: [
    { id: 'morning', storeId: 'DI-AN', name: 'Ca sáng', start: '08:30', end: '12:00', active: true },
    { id: 'afternoon', storeId: 'DI-AN', name: 'Ca chiều', start: '13:00', end: '17:30', active: true },
    { id: 'night', storeId: 'DI-AN', name: 'Ca tối', start: '18:00', end: '21:00', active: true },
  ],
})

describe('RevenueBonusPage daily cutoff', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    mocked.liveRevenue.mockReset()
    mocked.app = readyApp()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps TÍNH THƯỞNG NGÀY disabled before 21:00 Vietnam time', () => {
    vi.setSystemTime(new Date('2026-08-26T13:59:59.000Z'))
    render(<RevenueBonusPage storeScoped />)

    const button = screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })
    expect(button.disabled).toBe(true)
    expect(screen.getByText(/chỉ được mở sau 21:00/i)).toBeTruthy()
    expect(button.classList.contains('is-ready')).toBe(false)
  })

  it('asks for confirmation after 21:00 and submits the store day only once', async () => {
    vi.setSystemTime(new Date('2026-08-26T14:01:00.000Z'))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<RevenueBonusPage storeScoped />)

    const button = screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })
    expect(button.disabled).toBe(false)
    expect(button.classList.contains('is-ready')).toBe(true)
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledWith({
      storeId: 'S01', businessDate: '2026-08-26',
    }))
    expect(mocked.app.calculateRevenueBonusDay).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toMatch(/chỉ được tính một lần/i)
  })

  it('does not calculate when the operator cancels the confirmation', () => {
    vi.setSystemTime(new Date('2026-08-26T14:01:00.000Z'))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<RevenueBonusPage storeScoped />)

    fireEvent.click(screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' }))
    expect(mocked.app.calculateRevenueBonusDay).not.toHaveBeenCalled()
  })

  it('enables Dosii Dĩ An on 02/09 when its two actual shifts are closed and the unused night shift was not attended', async () => {
    vi.setSystemTime(new Date('2026-09-03T03:00:00.000Z'))
    mocked.app = dianApp()
    const { container } = render(<RevenueBonusPage storeScoped />)
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2026-09-02' } })

    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })
      expect(button.disabled).toBe(false)
      expect(button.classList.contains('is-ready')).toBe(true)
    })
    expect(screen.queryByText(/chưa có nhân viên điểm danh vào ca cuối cùng/i)).toBeNull()
    expect(screen.getByText(/toàn bộ nhân viên đã kết ca/i)).toBeTruthy()
  })

  it('shows a large named warning while an employee is still working after 21:00', async () => {
    vi.setSystemTime(new Date('2026-08-26T14:05:00.000Z'))
    mocked.app = { ...readyApp(), apiStatus: 'connected' }
    mocked.liveRevenue.mockResolvedValue({
      snapshot: {
        storeId: 'S01', businessDate: '2026-08-26', projectedAt: '2026-08-26T14:05:00.000Z',
        revenueVnd: 1_000_000, percentagePoolVnd: 10_000, allocatedVnd: 0, unallocatedVnd: 10_000,
        totalWorkedSeconds: 10_800, attendanceCount: 1, openAttendanceCount: 1, allocations: [],
        calculationEligibility: {
          allowed: false,
          code: 'ATTENDANCE_OPEN',
          openAttendanceCount: 1,
          openEmployeeNames: ['Nguyễn An'],
          message: 'Nhân viên Nguyễn An đang làm việc nên chưa tính thưởng được. Hãy chờ nhân viên Nguyễn An kết ca mới được tính thưởng.',
        },
      },
    })

    render(<RevenueBonusPage storeScoped />)

    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledWith({
      storeId: 'S01', businessDate: '2026-08-26',
    }))
    const alert = await screen.findByRole('alert')
    expect(alert.classList.contains('revenue-bonus-attendance-alert')).toBe(true)
    expect(alert.textContent).toContain('Nhân viên Nguyễn An đang làm việc')
    expect(screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' }).disabled).toBe(true)
  })
})
