import { act, cleanup, render } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, STORAGE_KEY, useApp } from './AppContext'

vi.mock('../services/idosiApi', () => ({
  apiBootstrapState: vi.fn(),
  apiCommand: vi.fn(),
  apiGetAccountAvatar: vi.fn(),
  apiGetState: vi.fn(),
  apiLogin: vi.fn(),
  apiSelectSessionRole: vi.fn(),
  apiListUsers: vi.fn(),
  apiLogout: vi.fn(),
  apiPolicyEntries: () => [],
  apiPolicyMap: () => ({}),
  clearApiSession: vi.fn(),
  hasApiSession: () => false,
  isLocalApiFallbackAllowed: () => false,
}))

let appRef

const AppProbe = forwardRef(function AppProbe(_props, ref) {
  const app = useApp()
  useImperativeHandle(ref, () => app, [app])
  return null
})

const renderLocalState = (state) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  return render(<AppProvider><AppProbe ref={appRef} /></AppProvider>)
}

describe('local attendance canonical working time', () => {
  beforeEach(() => {
    appRef = createRef()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it.each([
    { unit: 'office', role: 'employee', employeeId: 'VP-LOCAL-001', storeId: 'OFFICE' },
    { unit: 'business_support', role: 'business_support', employeeId: 'HTKD-LOCAL-001', storeId: 'BUSINESS_SUPPORT' },
  ])('reconciles a stale $unit shift id and snapshots canonical daily times', async ({ unit, role, employeeId, storeId }) => {
    const initial = createInitialState()
    const employee = {
      id: employeeId,
      code: employeeId,
      name: `Nhân viên ${unit}`,
      unit,
      storeId,
      employmentType: 'Full-Time',
      workShifts: [{ id: 'profile_default', name: 'Giờ hồ sơ', start: '08:00', end: '17:30' }],
    }
    renderLocalState({
      ...initial,
      session: { role, employeeId, id: employeeId, code: employeeId, unit, storeId },
      employees: [employee],
      attendance: [],
      shiftDefinitions: [],
      supportWorkSchedules: [{
        id: `sws_${employeeId}`,
        employeeId,
        targetUnit: unit,
        date: '2026-08-24',
        shiftName: 'Lịch ngày chuẩn',
        start: '08:30',
        end: '17:00',
      }],
    })

    let result
    await act(async () => {
      result = await appRef.current.checkIn({
        employeeId,
        date: '2026-08-24',
        at: '2026-08-24T02:00:00.000Z',
        shiftId: 'stale_profile_id',
        shiftName: 'Giờ sai từ client',
        shiftStart: '06:00',
        shiftEnd: '07:00',
        location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
      })
    })

    expect(result).toMatchObject({
      ok: true,
      record: {
        shiftId: `sws_${employeeId}`,
        shiftName: 'Lịch ngày chuẩn',
        shiftStart: '08:30',
        shiftEnd: '17:00',
      },
    })
  })

  it('enforces profile default hours when the legacy profile has no workShifts array', async () => {
    const initial = createInitialState()
    const employee = {
      id: 'VP-LOCAL-LEGACY-001',
      code: 'VP-LOCAL-LEGACY-001',
      name: 'Nhân viên văn phòng legacy',
      unit: 'office',
      storeId: 'OFFICE',
      employmentType: 'Full-Time',
      workStart: '08:30',
      workEnd: '17:00',
    }
    renderLocalState({
      ...initial,
      session: { role: 'employee', employeeId: employee.id, id: employee.id, code: employee.id, unit: employee.unit, storeId: employee.storeId },
      employees: [employee],
      attendance: [],
      shiftDefinitions: [],
      supportWorkSchedules: [],
    })

    let result
    await act(async () => {
      result = await appRef.current.checkIn({
        employeeId: employee.id,
        date: '2026-08-24',
        at: '2026-08-24T02:00:00.000Z',
        shiftId: 'stale_client_shift',
        shiftName: 'Ca client sai',
        shiftStart: '06:00',
        shiftEnd: '07:00',
        location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
      })
    })

    expect(result).toMatchObject({
      ok: true,
      record: {
        shiftId: 'full_time',
        shiftName: 'Giờ hành chính',
        shiftStart: '08:30',
        shiftEnd: '17:00',
      },
    })
  })

  it('records local Office check-in and check-out with the Vietnam date and UTC+7 timestamp at the UTC boundary', async () => {
    const initial = createInitialState()
    const employee = {
      id: 'VP-VN-BOUNDARY-001',
      code: 'VP-VN-BOUNDARY-001',
      name: 'Nhân viên kiểm thử múi giờ',
      unit: 'office',
      storeId: 'OFFICE',
      employmentType: 'Full-Time',
      workStart: '00:00',
      workEnd: '08:00',
    }
    renderLocalState({
      ...initial,
      session: { role: 'employee', employeeId: employee.id, id: employee.id, code: employee.id, unit: employee.unit, storeId: employee.storeId },
      employees: [employee],
      attendance: [],
      shiftDefinitions: [],
      supportWorkSchedules: [],
    })

    let checkedIn
    await act(async () => {
      checkedIn = await appRef.current.checkIn({
        employeeId: employee.id,
        at: '2026-08-23T17:30:45.000Z',
        location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
      })
    })
    expect(checkedIn).toMatchObject({
      ok: true,
      record: {
        date: '2026-08-24',
        workDate: '2026-08-24',
        checkIn: '00:30:45',
        checkInAt: '2026-08-24T00:30:45+07:00',
      },
    })

    let checkedOut
    await act(async () => {
      checkedOut = await appRef.current.checkOut({
        employeeId: employee.id,
        attendanceId: checkedIn.record.id,
        at: '2026-08-23T18:00:45.000Z',
        location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
      })
    })
    expect(checkedOut).toMatchObject({
      ok: true,
      record: {
        checkOut: '01:00:45',
        checkOutAt: '2026-08-24T01:00:45+07:00',
        hours: 0.5,
        workdayCredit: 1,
      },
    })
  })

  it('credits Business Support checkout and rejects another local check-in on the completed work date', async () => {
    const initial = createInitialState()
    const employee = {
      id: 'HTKD-LOCAL-CREDIT-001',
      code: 'HTKD-LOCAL-CREDIT-001',
      name: 'Nhân viên hỗ trợ tính công',
      unit: 'business_support',
      storeId: 'BUSINESS_SUPPORT',
      employmentType: 'Full-Time',
      workStart: '08:30',
      workEnd: '17:00',
    }
    renderLocalState({
      ...initial,
      session: { role: 'business_support', employeeId: employee.id, id: employee.id, code: employee.id, unit: employee.unit, storeId: employee.storeId },
      employees: [employee],
      attendance: [],
      shiftDefinitions: [],
      supportWorkSchedules: [],
    })
    const location = { latitude: 10.8, longitude: 106.7, accuracy: 8 }

    let checkedIn
    await act(async () => {
      checkedIn = await appRef.current.checkIn({ employeeId: employee.id, at: '2026-08-24T01:30:00.000Z', location })
    })
    let checkedOut
    await act(async () => {
      checkedOut = await appRef.current.checkOut({
        employeeId: employee.id,
        attendanceId: checkedIn.record.id,
        at: '2026-08-24T02:30:00.000Z',
        location,
      })
    })
    expect(checkedOut).toMatchObject({ ok: true, record: { workdayCredit: 1, hours: 1 } })

    let duplicate
    await act(async () => {
      duplicate = await appRef.current.checkIn({ employeeId: employee.id, at: '2026-08-24T03:00:00.000Z', location })
    })
    expect(duplicate).toMatchObject({ ok: false, message: expect.stringContaining('đã chấm công') })
    expect(appRef.current.attendance).toHaveLength(1)
  })

  it('serializes rapid local Office check-ins for the same work date', async () => {
    const initial = createInitialState()
    const employee = {
      id: 'VP-LOCAL-RAPID-001',
      code: 'VP-LOCAL-RAPID-001',
      name: 'Nhân viên điểm danh liên tiếp',
      unit: 'office',
      storeId: 'OFFICE',
      employmentType: 'Full-Time',
      workStart: '08:30',
      workEnd: '17:00',
    }
    renderLocalState({
      ...initial,
      session: { role: 'employee', employeeId: employee.id, id: employee.id, code: employee.id, unit: employee.unit, storeId: employee.storeId },
      employees: [employee],
      attendance: [],
      shiftDefinitions: [],
      supportWorkSchedules: [],
    })
    const payload = {
      employeeId: employee.id,
      at: '2026-08-24T01:30:00.000Z',
      location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
    }

    let results
    await act(async () => {
      results = await Promise.all([
        appRef.current.checkIn(payload),
        appRef.current.checkIn(payload),
      ])
    })

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
    expect(appRef.current.attendance).toHaveLength(1)
  })

  it('preserves the existing payload-first fallback for a store manager', async () => {
    const initial = createInitialState()
    const storeId = initial.stores[0].id
    const employee = {
      id: 'QL-LOCAL-001',
      code: 'QL-LOCAL-001',
      name: 'Quản lý cửa hàng',
      unit: 'store_manager',
      storeId,
      employmentType: 'Full-Time',
      workShifts: [{ id: 'manager_profile', name: 'Ca hồ sơ', start: '08:00', end: '17:30' }],
    }
    renderLocalState({
      ...initial,
      session: { role: 'store_manager', employeeId: employee.id, id: employee.id, code: employee.id, unit: employee.unit, storeId },
      employees: [employee],
      attendance: [],
      shiftDefinitions: [],
      supportWorkSchedules: [],
    })

    let result
    await act(async () => {
      result = await appRef.current.checkIn({
        employeeId: employee.id,
        date: '2026-08-24',
        // 07:30 UTC is never earlier than this client-provided shift on either
        // UTC CI or the Asia/Ho_Chi_Minh developer runtime.
        at: '2026-08-24T07:30:00.000Z',
        shiftId: 'manager_client_shift',
        shiftName: 'Ca quản lý gửi lên',
        shiftStart: '07:30',
        shiftEnd: '11:30',
        location: { latitude: 10.8, longitude: 106.7, accuracy: 8 },
      })
    })

    expect(result).toMatchObject({
      ok: true,
      record: {
        shiftId: 'manager_client_shift',
        shiftName: 'Ca quản lý gửi lên',
        shiftStart: '07:30',
        shiftEnd: '11:30',
      },
    })
  })
})
