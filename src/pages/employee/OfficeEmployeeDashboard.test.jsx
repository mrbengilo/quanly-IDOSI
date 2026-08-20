import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OfficeEmployeeDashboard } from './OfficeEmployeeDashboard'

const mocked = vi.hoisted(() => ({
  app: {},
}))

vi.mock('../../state/AppContext', () => ({
  useApp: () => mocked.app,
}))

const profile = {
  id: 'QLCH-001',
  code: 'QLCH-001',
  name: 'Quản lý SecondMall',
  position: 'Quản lý cửa hàng',
  unit: 'store_manager',
  storeId: 'CH001',
  workStart: '08:00',
  workEnd: '17:00',
}

const makeApp = (overrides = {}) => ({
  session: { role: 'store_manager', employeeId: profile.id, storeId: profile.storeId },
  currentEmployee: profile,
  employees: [profile],
  attendance: [],
  policies: { attendanceEvaluation: {} },
  payrollPeriods: [],
  salaryAdjustments: [],
  officeAdjustments: [],
  checkIn: vi.fn().mockResolvedValue({ ok: true }),
  checkOut: vi.fn().mockResolvedValue({ ok: true }),
  notify: vi.fn(),
  ...overrides,
})

describe('operational-role attendance overview', () => {
  beforeEach(() => {
    mocked.app = makeApp()
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success) => success({
          coords: { latitude: 10.8231, longitude: 106.6297, accuracy: 8 },
        })),
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('requires a captured location when a store manager checks in', async () => {
    render(<OfficeEmployeeDashboard />)

    expect(screen.getByRole('heading', { name: 'TỔNG QUAN QUẢN LÝ CỬA HÀNG' })).toBeTruthy()
    expect(screen.getByText('THỜI GIAN HIỆN TẠI')).toBeTruthy()
    expect(screen.getByText('Lịch sử chấm công chi tiết')).toBeTruthy()
    expect(screen.getByText('CHUYÊN CẦN')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^BẤM ĐIỂM DANH$/i }))

    await waitFor(() => expect(mocked.app.checkIn).toHaveBeenCalledTimes(1))
    expect(mocked.app.checkIn.mock.calls[0][0]).toMatchObject({
      employeeId: 'QLCH-001',
      shiftStart: '08:00',
      shiftEnd: '17:00',
      location: { latitude: 10.8231, longitude: 106.6297, accuracy: 8 },
    })
  })

  it('does not check in when location permission is denied', async () => {
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((_success, failure) => failure({ code: 1 })),
      },
    })

    render(<OfficeEmployeeDashboard />)
    fireEvent.click(screen.getByRole('button', { name: /^BẤM ĐIỂM DANH$/i }))

    expect((await screen.findByRole('alert')).textContent).toContain('bật và cấp quyền vị trí')
    expect(mocked.app.checkIn).not.toHaveBeenCalled()
  })

  it('records check-out with a fresh location for the open attendance row', async () => {
    const openRecord = {
      id: 'CC-001',
      employeeId: profile.id,
      date: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      shiftName: 'Giờ làm Quản lý cửa hàng',
      shiftStart: '08:00',
      shiftEnd: '17:00',
      checkIn: '08:00',
      checkInAt: '2026-08-17T08:00:00+07:00',
      checkInLocation: { label: 'SecondMall SM234' },
      arrivalTag: 'Đi đúng giờ',
    }
    mocked.app = makeApp({ attendance: [openRecord] })

    render(<OfficeEmployeeDashboard />)
    fireEvent.click(screen.getByRole('button', { name: /^RA VỀ$/i }))

    await waitFor(() => expect(mocked.app.checkOut).toHaveBeenCalledTimes(1))
    expect(mocked.app.checkOut.mock.calls[0][0]).toMatchObject({
      employeeId: 'QLCH-001',
      attendanceId: 'CC-001',
      location: { latitude: 10.8231, longitude: 106.6297, accuracy: 8 },
    })
  })

  it('uses the support-specific overview title', () => {
    const supportProfile = { ...profile, id: 'HTKD-001', code: 'HTKD-001', unit: 'business_support', position: 'NV hỗ trợ KD' }
    mocked.app = makeApp({
      session: { role: 'business_support', employeeId: supportProfile.id },
      currentEmployee: supportProfile,
      employees: [supportProfile],
    })

    render(<OfficeEmployeeDashboard />)
    expect(screen.getByRole('heading', { name: 'TỔNG QUAN NHÂN VIÊN HỖ TRỢ KD' })).toBeTruthy()
    expect(screen.queryByText('Bảng lương theo ngày công')).toBeNull()
  })

  it('lets a Part-Time employee choose the configured afternoon shift before check-in', async () => {
    const partTimeProfile = {
      ...profile,
      id: 'VP-PT-001',
      code: 'VP-PT-001',
      unit: 'office',
      employmentType: 'Part-Time',
      workTimeType: 'Part-Time',
      workShifts: [
        { id: 'ca_sang', name: 'Ca sáng', start: '08:00', end: '12:00' },
        { id: 'ca_chieu', name: 'Ca chiều', start: '13:00', end: '17:30' },
      ],
    }
    mocked.app = makeApp({
      session: { role: 'employee', employeeId: partTimeProfile.id, storeId: 'OFFICE' },
      currentEmployee: partTimeProfile,
      employees: [partTimeProfile],
    })

    render(<OfficeEmployeeDashboard />)
    fireEvent.change(screen.getByLabelText('Chọn ca làm việc để điểm danh'), { target: { value: 'ca_chieu' } })
    expect(screen.getByText('13:00 – 17:30')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^BẤM ĐIỂM DANH$/i }))

    await waitFor(() => expect(mocked.app.checkIn).toHaveBeenCalledTimes(1))
    expect(mocked.app.checkIn).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'VP-PT-001',
      shiftId: 'ca_chieu',
      workShiftId: 'ca_chieu',
      shiftName: 'Ca chiều',
      shiftStart: '13:00',
      shiftEnd: '17:30',
    }))
  })
})
