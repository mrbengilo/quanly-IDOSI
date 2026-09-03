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

const dianSeptemberApp = ({ apiStatus = 'local', calculated = false } = {}) => ({
  ...readyApp(),
  activeStoreId: 'DOSII-DI-AN',
  stores: [{ id: 'DOSII-DI-AN', name: 'Dosii Dĩ An', code: 'DOSII-DI-AN' }],
  employees: [
    { id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'DOSII-DI-AN' },
    { id: 'E02', name: 'Trần Bình', unit: 'store', storeId: 'DOSII-DI-AN' },
    { id: 'HT-01', name: 'Hỗ trợ KD', unit: 'business_support' },
  ],
  orders: [{
    id: 'DIAN-O01', storeId: 'DOSII-DI-AN', amount: 2_585_000, status: 'Hoàn tất',
    createdAt: '2026-09-02T16:00:00+07:00',
  }],
  attendance: [
    {
      id: 'DIAN-A01', storeId: 'DOSII-DI-AN', employeeId: 'E01', employeeName: 'Nguyễn An',
      workDate: '2026-09-02', shiftId: 'morning', shiftName: 'Ca sáng',
      shiftStart: '08:00', shiftEnd: '12:00', workedSeconds: 14_400,
      checkInAt: '2026-09-02T01:00:00.000Z', checkOutAt: '2026-09-02T05:00:00.000Z',
    },
    {
      id: 'DIAN-A02', storeId: 'DOSII-DI-AN', employeeId: 'E02', employeeName: 'Trần Bình',
      workDate: '2026-09-02', shiftId: 'afternoon', shiftName: 'Ca chiều',
      shiftStart: '13:00', shiftEnd: '17:30', workedSeconds: 16_200,
      checkInAt: '2026-09-02T06:00:00.000Z', checkOutAt: '2026-09-02T10:30:00.000Z',
    },
  ],
  schedule: [{
    id: 'DIAN-SCHEDULE', storeId: 'DOSII-DI-AN', employeeId: 'E01', date: '2026-09-02',
    shiftIds: ['morning', 'evening'],
    shiftSnapshots: [
      { id: 'morning', name: 'Ca sáng', start: '08:00', end: '12:00' },
      { id: 'evening', name: 'Ca tối', start: '18:00', end: '21:00' },
    ],
  }],
  shiftDefinitions: [
    { id: 'morning', storeId: 'DOSII-DI-AN', name: 'Ca sáng', start: '08:00', end: '12:00', active: true },
    { id: 'evening', storeId: 'DOSII-DI-AN', name: 'Ca tối', start: '18:00', end: '21:00', active: true },
  ],
  revenueBonuses: calculated ? [{
    id: 'DIAN-RB-0209', storeId: 'DOSII-DI-AN', businessDate: '2026-09-02',
    status: 'APPROVED', revenueVnd: 2_585_000, percentagePoolVnd: 51_700,
  }] : [],
  revenueBonusDaily: calculated ? [{
    id: 'DIAN-RB-0209', storeId: 'DOSII-DI-AN', businessDate: '2026-09-02', status: 'APPROVED',
  }] : [],
  apiStatus,
})

const selectBusinessDate = (date) => {
  fireEvent.change(screen.getByLabelText('Ngày kinh doanh'), { target: { value: date } })
}

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

  it('opens Dosii Dĩ An 02/09 under the new system-wide rule when every worked shift is closed', () => {
    vi.setSystemTime(new Date('2026-09-03T03:00:00.000Z'))
    mocked.app = dianSeptemberApp()
    render(<RevenueBonusPage storeScoped />)
    selectBusinessDate('2026-09-02')

    const button = screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })
    expect(button.disabled).toBe(false)
    expect(button.classList.contains('is-ready')).toBe(true)
    expect(screen.getByText(/toàn bộ nhân viên đã kết ca/i)).toBeTruthy()
  })

  it('keeps an already-calculated September store-day locked instead of reopening it', () => {
    vi.setSystemTime(new Date('2026-09-03T03:00:00.000Z'))
    mocked.app = dianSeptemberApp({ calculated: true })
    render(<RevenueBonusPage storeScoped />)
    selectBusinessDate('2026-09-02')

    const button = screen.getByRole('button', { name: 'ĐÃ TÍNH THƯỞNG' })
    expect(button.disabled).toBe(true)
    expect(mocked.app.calculateRevenueBonusDay).not.toHaveBeenCalled()
  })

  it('uses a closed historical snapshot to keep the button available while live refresh is temporarily stale', async () => {
    vi.setSystemTime(new Date('2026-09-03T03:00:00.000Z'))
    mocked.app = dianSeptemberApp({ apiStatus: 'connected' })
    mocked.liveRevenue.mockImplementation(({ businessDate }) => Promise.resolve({
      snapshot: {
        storeId: 'DOSII-DI-AN',
        businessDate,
        projectedAt: '2026-09-03T02:59:00.000Z',
        revenueVnd: businessDate === '2026-09-02' ? 2_585_000 : 0,
        percentagePoolVnd: businessDate === '2026-09-02' ? 51_700 : 0,
        allocatedVnd: businessDate === '2026-09-02' ? 51_700 : 0,
        unallocatedVnd: 0,
        totalWorkedSeconds: businessDate === '2026-09-02' ? 30_600 : 0,
        attendanceCount: businessDate === '2026-09-02' ? 2 : 0,
        openAttendanceCount: 0,
        allocations: [],
        calculationEligibility: {
          allowed: false,
          code: 'FINAL_SHIFT_NOT_ATTENDED',
          attendanceCount: businessDate === '2026-09-02' ? 2 : 0,
          openAttendanceCount: 0,
          message: 'Chưa có nhân viên điểm danh vào ca cuối cùng của ngày.',
        },
      },
    }))

    render(<RevenueBonusPage storeScoped />)
    selectBusinessDate('2026-09-02')

    await waitFor(() => expect(mocked.liveRevenue).toHaveBeenCalledWith({
      storeId: 'DOSII-DI-AN', businessDate: '2026-09-02',
    }))
    const button = screen.getByRole('button', { name: 'TÍNH THƯỞNG NGÀY' })
    expect(button.disabled).toBe(false)
    expect(screen.getByText(/ngày cũ chưa tính thưởng/i)).toBeTruthy()
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
