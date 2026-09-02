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

const vietnamToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

const makeApp = (overrides = {}) => ({
  session: { role: 'store_manager', employeeId: profile.id, storeId: profile.storeId },
  currentEmployee: profile,
  employees: [profile],
  attendance: [],
  policies: { attendanceEvaluation: {} },
  payrollPeriods: [],
  salaryAdjustments: [],
  officeAdjustments: [],
  supportWorkSchedules: [],
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
    vi.useRealTimers()
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

  it('warns support staff about yesterday open attendance and requires checkout before another check-in', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-09-02T03:00:00.000Z')
    const supportProfile = { ...profile, id: 'HTKD-001', code: 'HTKD-001', unit: 'business_support', position: 'NV hỗ trợ KD' }
    mocked.app = makeApp({
      session: { role: 'business_support', employeeId: supportProfile.id },
      currentEmployee: supportProfile,
      employees: [supportProfile],
      attendance: [{
        id: 'CC-YESTERDAY', employeeId: supportProfile.id, date: '2026-09-01',
        shiftName: 'Ca hành chính', shiftStart: '08:00', shiftEnd: '17:00', checkIn: '08:00',
      }],
    })

    render(<OfficeEmployeeDashboard />)

    expect(screen.getByText('Bạn chưa bấm “Ra về” ngày hôm qua')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ĐÃ HIỂU' }))
    expect(screen.getByRole('button', { name: 'BẤM ĐIỂM DANH' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'RA VỀ' }).disabled).toBe(false)
  })

  it('shows a store-wide overdue warning to the store manager', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-09-02T03:00:00.000Z')
    const coworker = { id: 'ST-002', code: 'ST-002', name: 'Trần Thị Ngọc Bích', unit: 'store', storeId: profile.storeId }
    mocked.app = makeApp({
      employees: [profile, coworker],
      attendance: [{
        id: 'CC-COWORKER-YESTERDAY', employeeId: coworker.id, storeId: profile.storeId, date: '2026-09-01',
        shiftName: 'Ca chiều', shiftStart: '13:00', shiftEnd: '18:00', checkIn: '13:00',
      }],
    })

    render(<OfficeEmployeeDashboard />)

    expect(screen.getByRole('dialog', { name: 'CẢNH BÁO NHÂN VIÊN CHƯA KẾT CA' })).toBeTruthy()
    expect(screen.getByText(coworker.name)).toBeTruthy()
    expect(screen.getByText('chưa kết ca ngày 01/09/26 · Ca chiều')).toBeTruthy()
  })

  it.each([
    { label: 'Khối văn phòng', role: 'employee', unit: 'office', employeeId: 'VP-DAILY-001' },
    { label: 'Hỗ trợ KD', role: 'business_support', unit: 'business_support', employeeId: 'HTKD-DAILY-001' },
  ])('uses the exact daily schedule for $label attendance', async ({ role, unit, employeeId }) => {
    const dailyProfile = {
      ...profile,
      id: employeeId,
      code: employeeId,
      unit,
      employmentType: 'Full-Time',
      workShifts: [{ id: 'full_time', name: 'Giờ mặc định', start: '08:00', end: '17:30' }],
    }
    mocked.app = makeApp({
      session: { role, employeeId },
      currentEmployee: dailyProfile,
      employees: [dailyProfile],
      supportWorkSchedules: [{
        id: `sws_${employeeId}`,
        employeeId,
        targetUnit: unit,
        date: vietnamToday(),
        shiftName: 'Lịch ngày 08:30',
        start: '08:30',
        end: '17:00',
        version: 2,
      }],
    })

    render(<OfficeEmployeeDashboard />)
    expect(screen.getByText('Lịch ngày 08:30')).toBeTruthy()
    expect(screen.getByText('08:30 – 17:00')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^BẤM ĐIỂM DANH$/i }))

    await waitFor(() => expect(mocked.app.checkIn).toHaveBeenCalledTimes(1))
    expect(mocked.app.checkIn).toHaveBeenCalledWith(expect.objectContaining({
      employeeId,
      shiftId: `sws_${employeeId}`,
      workShiftId: `sws_${employeeId}`,
      shiftName: 'Lịch ngày 08:30',
      shiftStart: '08:30',
      shiftEnd: '17:00',
    }))
  })

  it('reconciles the selected shift when an exact daily schedule arrives from a state refresh', async () => {
    const supportProfile = {
      ...profile,
      id: 'HTKD-LIVE-001',
      code: 'HTKD-LIVE-001',
      unit: 'business_support',
      employmentType: 'Full-Time',
      workShifts: [{ id: 'profile_default', name: 'Giờ hồ sơ', start: '08:00', end: '17:30' }],
    }
    mocked.app = makeApp({
      session: { role: 'business_support', employeeId: supportProfile.id },
      currentEmployee: supportProfile,
      employees: [supportProfile],
    })
    const { rerender } = render(<OfficeEmployeeDashboard />)
    expect(screen.getByText('Giờ hồ sơ')).toBeTruthy()

    mocked.app = {
      ...mocked.app,
      supportWorkSchedules: [{
        id: 'sws_live_refresh',
        employeeId: supportProfile.id,
        targetUnit: 'business_support',
        date: vietnamToday(),
        shiftName: 'Lịch vừa tải',
        start: '08:30',
        end: '17:00',
      }],
    }
    rerender(<OfficeEmployeeDashboard />)

    await waitFor(() => expect(screen.getByText('Lịch vừa tải')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^BẤM ĐIỂM DANH$/i }))
    await waitFor(() => expect(mocked.app.checkIn).toHaveBeenCalledTimes(1))
    expect(mocked.app.checkIn).toHaveBeenCalledWith(expect.objectContaining({
      shiftId: 'sws_live_refresh',
      shiftStart: '08:30',
      shiftEnd: '17:00',
    }))
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

  it('clears a stale selection when a refreshed profile still has multiple shifts', async () => {
    const initialProfile = {
      ...profile,
      id: 'VP-REFRESH-001',
      code: 'VP-REFRESH-001',
      unit: 'office',
      employmentType: 'Part-Time',
      workTimeType: 'Part-Time',
      workShifts: [
        { id: 'old_am', name: 'Ca sáng cũ', start: '08:00', end: '12:00' },
        { id: 'old_pm', name: 'Ca chiều cũ', start: '13:00', end: '17:30' },
      ],
    }
    mocked.app = makeApp({
      session: { role: 'employee', employeeId: initialProfile.id },
      currentEmployee: initialProfile,
      employees: [initialProfile],
    })
    const { rerender } = render(<OfficeEmployeeDashboard />)
    fireEvent.change(screen.getByLabelText('Chọn ca làm việc để điểm danh'), { target: { value: 'old_pm' } })

    const refreshedProfile = {
      ...initialProfile,
      workShifts: [
        { id: 'new_am', name: 'Ca sáng mới', start: '08:30', end: '12:30' },
        { id: 'new_pm', name: 'Ca chiều mới', start: '13:30', end: '18:00' },
      ],
    }
    mocked.app = {
      ...mocked.app,
      currentEmployee: refreshedProfile,
      employees: [refreshedProfile],
    }
    rerender(<OfficeEmployeeDashboard />)

    const shiftSelect = screen.getByLabelText('Chọn ca làm việc để điểm danh')
    await waitFor(() => expect(shiftSelect.value).toBe(''))
    expect(screen.getByRole('button', { name: /^BẤM ĐIỂM DANH$/i }).disabled).toBe(true)
    expect(screen.getAllByText('Chọn ca làm việc').length).toBeGreaterThan(0)

    fireEvent.change(shiftSelect, { target: { value: 'new_pm' } })
    fireEvent.click(screen.getByRole('button', { name: /^BẤM ĐIỂM DANH$/i }))
    await waitFor(() => expect(mocked.app.checkIn).toHaveBeenCalledTimes(1))
    expect(mocked.app.checkIn).toHaveBeenCalledWith(expect.objectContaining({
      shiftId: 'new_pm',
      shiftStart: '13:30',
      shiftEnd: '18:00',
    }))
  })

  it('auto-selects the only valid shift after a profile refresh changes its id', async () => {
    const initialProfile = {
      ...profile,
      id: 'HTKD-REFRESH-001',
      code: 'HTKD-REFRESH-001',
      unit: 'business_support',
      workShifts: [{ id: 'old_full_time', name: 'Giờ cũ', start: '08:00', end: '17:30' }],
    }
    mocked.app = makeApp({
      session: { role: 'business_support', employeeId: initialProfile.id },
      currentEmployee: initialProfile,
      employees: [initialProfile],
    })
    const { rerender } = render(<OfficeEmployeeDashboard />)

    const refreshedProfile = {
      ...initialProfile,
      workShifts: [{ id: 'new_full_time', name: 'Giờ mới', start: '08:30', end: '17:00' }],
    }
    mocked.app = {
      ...mocked.app,
      currentEmployee: refreshedProfile,
      employees: [refreshedProfile],
    }
    rerender(<OfficeEmployeeDashboard />)

    await waitFor(() => expect(screen.getByText('Giờ mới')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^BẤM ĐIỂM DANH$/i }))
    await waitFor(() => expect(mocked.app.checkIn).toHaveBeenCalledTimes(1))
    expect(mocked.app.checkIn).toHaveBeenCalledWith(expect.objectContaining({
      shiftId: 'new_full_time',
      shiftStart: '08:30',
      shiftEnd: '17:00',
    }))
  })

  it('does not mix attendance or daily schedules from an employee id case collision', () => {
    const exactProfile = {
      ...profile,
      id: 'VP-CASE',
      code: 'VP-CASE',
      unit: 'office',
      workShifts: [{ id: 'EXACT-SHIFT', name: 'Ca hồ sơ chính xác', start: '08:00', end: '17:00' }],
    }
    const otherProfile = {
      ...exactProfile,
      id: 'vp-case',
      code: 'vp-case',
      name: 'Nhân viên chữ thường',
    }
    const date = vietnamToday()
    mocked.app = makeApp({
      session: { role: 'employee', employeeId: 'VP-CASE', storeId: 'OFFICE' },
      currentEmployee: exactProfile,
      employees: [exactProfile, otherProfile],
      attendance: [{
        id: 'ATT-EXACT', employeeId: 'VP-CASE', date, shiftName: 'Ca đúng nhân viên',
        checkIn: '08:00', checkOut: '17:00', hours: 8,
      }, {
        id: 'ATT-OTHER', employeeId: 'vp-case', date, shiftName: 'Ca của nhân viên khác',
        checkIn: '09:00', checkOut: '17:00', hours: 7,
      }],
      supportWorkSchedules: [{
        id: 'SCHEDULE-OTHER', employeeId: 'vp-case', date,
        shiftName: 'Lịch của nhân viên khác', start: '10:00', end: '18:00',
      }],
    })

    render(<OfficeEmployeeDashboard />)

    expect(screen.getByText('Ca đúng nhân viên')).toBeTruthy()
    expect(screen.queryByText('Ca của nhân viên khác')).toBeNull()
    expect(screen.queryByText('Lịch của nhân viên khác')).toBeNull()
    expect(screen.getByText('Ca hồ sơ chính xác')).toBeTruthy()
  })

  it('uses the exact store id payroll period before a case-insensitive alias', () => {
    const officeProfile = {
      ...profile,
      id: 'VP-PAYROLL-COLLISION',
      code: 'VP-PAYROLL-COLLISION',
      unit: 'office',
      storeId: 'OFFICE',
      position: 'Nhân viên văn phòng',
      monthlySalary: 8_000_000,
    }
    const period = vietnamToday().slice(0, 7)
    mocked.app = makeApp({
      session: { role: 'employee', employeeId: officeProfile.id, storeId: 'OFFICE' },
      currentEmployee: officeProfile,
      employees: [officeProfile],
      payrollPeriods: [{
        id: 'PAY-OFFICE-UPPER', storeId: 'OFFICE', period, status: 'Đã chốt',
        rows: [{ employeeId: officeProfile.id, baseSalary: 1_000_000, gross: 1_000_000 }],
      }, {
        id: 'PAY-OFFICE-LOWER', storeId: 'office', period, status: 'Đã chốt',
        needsReclose: true,
        rows: [{ employeeId: officeProfile.id, baseSalary: 9_000_000, gross: 9_000_000 }],
      }],
    })

    render(<OfficeEmployeeDashboard />)

    expect(screen.queryByText(/Kỳ lương có nhiều bản ghi trùng mã cửa hàng/u)).toBeNull()
    expect(screen.getAllByText('1,000,000 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
  })

  it('uses the exact employee id payroll row before a case-insensitive alias', () => {
    const officeProfile = {
      ...profile,
      id: 'VP-PAYROLL-ROW',
      code: 'VP-PAYROLL-ROW',
      unit: 'office',
      storeId: 'OFFICE',
      position: 'Nhân viên văn phòng',
      monthlySalary: 8_000_000,
    }
    const period = vietnamToday().slice(0, 7)
    mocked.app = makeApp({
      session: { role: 'employee', employeeId: officeProfile.id, storeId: 'OFFICE' },
      currentEmployee: officeProfile,
      employees: [officeProfile],
      payrollPeriods: [{
        id: 'PAY-OFFICE-ROW-COLLISION', storeId: 'OFFICE', period, status: 'Đã chốt',
        rows: [{ employeeId: 'VP-PAYROLL-ROW', baseSalary: 1_000_000, gross: 1_000_000 }, {
          employeeId: 'vp-payroll-row', baseSalary: 9_000_000, gross: 9_000_000,
        }],
      }],
    })

    render(<OfficeEmployeeDashboard />)

    expect(screen.queryByText(/Kỳ lương có nhiều dòng trùng mã nhân viên/u)).toBeNull()
    expect(screen.getAllByText('1,000,000 đ').length).toBeGreaterThan(0)
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
  })

  it('fails closed when a payroll store alias is ambiguous without an exact match', () => {
    const officeProfile = {
      ...profile,
      id: 'VP-PAYROLL-AMBIGUOUS-STORE',
      code: 'VP-PAYROLL-AMBIGUOUS-STORE',
      unit: 'office',
      storeId: 'OFFICE',
      monthlySalary: 8_000_000,
    }
    const period = vietnamToday().slice(0, 7)
    mocked.app = makeApp({
      session: { role: 'employee', employeeId: officeProfile.id, storeId: 'OFFICE' },
      currentEmployee: officeProfile,
      employees: [officeProfile],
      payrollPeriods: [{
        id: 'PAY-OFFICE-MIXED-ONE', storeId: 'Office', period, status: 'Đã chốt',
        rows: [{ employeeId: officeProfile.id, gross: 1_000_000 }],
      }, {
        id: 'PAY-OFFICE-MIXED-TWO', storeId: 'office', period, status: 'Đã chốt',
        rows: [{ employeeId: officeProfile.id, gross: 9_000_000 }],
      }],
    })

    render(<OfficeEmployeeDashboard />)

    expect(screen.getByText(/Kỳ lương có nhiều bản ghi trùng mã cửa hàng/u)).toBeTruthy()
    expect(screen.queryByText('1,000,000 đ')).toBeNull()
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
  })

  it('fails closed when an employee payroll alias is ambiguous without an exact match', () => {
    const officeProfile = {
      ...profile,
      id: 'VP-PAYROLL-AMBIGUOUS-ROW',
      code: 'VP-PAYROLL-AMBIGUOUS-ROW',
      unit: 'office',
      storeId: 'OFFICE',
      monthlySalary: 8_000_000,
    }
    const period = vietnamToday().slice(0, 7)
    mocked.app = makeApp({
      session: { role: 'employee', employeeId: officeProfile.id, storeId: 'OFFICE' },
      currentEmployee: officeProfile,
      employees: [officeProfile],
      payrollPeriods: [{
        id: 'PAY-OFFICE-AMBIGUOUS-ROW', storeId: 'OFFICE', period, status: 'Đã chốt',
        rows: [{ employeeId: 'vp-payroll-ambiguous-row', gross: 1_000_000 }, {
          employeeId: 'Vp-Payroll-Ambiguous-Row', gross: 9_000_000,
        }],
      }],
    })

    render(<OfficeEmployeeDashboard />)

    expect(screen.getByText(/Kỳ lương có nhiều dòng trùng mã nhân viên/u)).toBeTruthy()
    expect(screen.queryByText('1,000,000 đ')).toBeNull()
    expect(screen.queryByText('9,000,000 đ')).toBeNull()
  })
})
