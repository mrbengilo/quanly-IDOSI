import { act, cleanup, render } from '@testing-library/react'
import { createRef, forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider, createInitialState, STORAGE_KEY, storeTasksForAttendance, useApp } from './AppContext'

const api = vi.hoisted(() => ({
  apiBootstrapState: vi.fn(),
  apiCommand: vi.fn(),
  apiGetAccountAvatar: vi.fn(),
  apiGetState: vi.fn(),
  apiGetStoreWorkspaceState: vi.fn(),
  apiLogin: vi.fn(async () => {
    const error = new Error('API unavailable in local fallback test')
    error.code = 'NETWORK_ERROR'
    throw error
  }),
  apiSelectSessionRole: vi.fn(),
  apiListUsers: vi.fn(),
  apiLogout: vi.fn(),
  clearApiSession: vi.fn(),
}))

vi.mock('../services/idosiApi', () => ({
  ...api,
  apiPolicyEntries: () => [],
  apiPolicyMap: () => ({}),
  hasApiSession: () => false,
  isLocalApiFallbackAllowed: () => true,
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

  it('scopes mandatory tasks to the exact attendance snapshot and compares operational ids case-insensitively', () => {
    const attendance = {
      id: 'ATT-CURRENT', employeeId: 'ST-003', storeId: 'SM-TNV',
      date: '2026-08-30', shiftId: 'CA-SANG',
    }
    const tasks = [{
      id: 'TASK-CURRENT', checklistAttendanceId: 'att-current', employeeIds: ['st-003'],
      storeId: 'sm-tnv', date: '2026-08-30', shiftId: 'ca-sang',
    }, {
      id: 'TASK-OTHER-ATTENDANCE', checklistAttendanceId: 'ATT-OTHER', employeeIds: ['ST-003'],
      storeId: 'SM-TNV', date: '2026-08-30', shiftId: 'CA-SANG',
    }, {
      id: 'TASK-GENERAL', employeeIds: ['ST-003'], storeId: 'SM-TNV', date: '2026-08-30', shiftId: 'CA-SANG',
    }, {
      id: 'TASK-OTHER-EMPLOYEE', employeeIds: ['ST-004'], storeId: 'SM-TNV', date: '2026-08-30', shiftId: 'CA-SANG',
    }]

    expect(storeTasksForAttendance({ tasks, attendance, employeeId: 'ST-003' }).map(({ id }) => id)).toEqual([
      'TASK-CURRENT', 'TASK-GENERAL',
    ])
  })

  it('keeps exact attendance task bindings isolated when ids collide by casing', () => {
    const upperAttendance = {
      id: 'ATT-X', employeeId: 'ST-003', storeId: 'SM-TNV', date: '2026-08-30', shiftId: 'CA-SANG',
    }
    const lowerAttendance = { ...upperAttendance, id: 'att-x' }
    const tasks = [{
      id: 'TASK-LOWER', checklistAttendanceId: 'att-x', employeeIds: ['ST-003'],
      storeId: 'SM-TNV', date: '2026-08-30', shiftId: 'CA-SANG',
    }]
    const attendanceRecords = [upperAttendance, lowerAttendance]

    expect(storeTasksForAttendance({
      tasks, attendance: upperAttendance, attendanceRecords, employeeId: 'ST-003',
    })).toEqual([])
    expect(storeTasksForAttendance({
      tasks, attendance: lowerAttendance, attendanceRecords, employeeId: 'ST-003',
    }).map(({ id }) => id)).toEqual(['TASK-LOWER'])
  })

  it('uses the canonical employee profile for client commands while preserving historical row spelling', async () => {
    const remoteUser = {
      id: 'USER-ST-003', username: 'employee.case', displayName: 'Nhân viên chữ thường',
      role: 'employee', employeeId: 'st-003', storeId: 'sm-tnv', status: 'active', version: 1,
    }
    const remoteState = {
      ...createInitialState(),
      session: null,
      activeStoreId: 'SM-TNV',
      stores: [{ id: 'SM-TNV', name: 'SM TNV', status: 'Đang hoạt động' }],
      employees: [{
        id: 'ST-003', code: 'ST-003', name: 'Nhân viên chính thức',
        unit: 'office', storeId: 'SM-TNV', status: 'Đang làm việc', employmentType: 'Part-Time',
      }],
      attendance: [{
        id: 'ATT-RAW-CASE', employeeId: 'st-003', storeId: 'sm-tnv', date: '2026-08-31',
        checkInAt: '2026-08-31T01:00:00.000Z', checkOutAt: null,
      }],
      supportWorkAssignments: [{
        id: 'ASSIGN-CASE', employeeId: 'ST-003', employeeName: 'Nhân viên chính thức', targetUnit: 'office',
        date: '2026-08-31', submittedAt: null,
        tasks: [{ id: 'ASSIGN-TASK-CASE', name: 'Đối soát báo cáo', required: false, completed: false }],
      }],
    }
    api.apiLogin.mockResolvedValueOnce({ user: remoteUser })
    api.apiBootstrapState.mockResolvedValueOnce({
      user: remoteUser, state: remoteState, policies: [], version: 1,
    })
    api.apiCommand.mockImplementation(async (type) => type === 'attendance.check_in'
      ? { version: 2, attendance: { id: 'ATT-NEW', employeeId: 'ST-003', checkIn: '08:00' } }
      : { version: 3, assignment: { ...remoteState.supportWorkAssignments[0], status: 'in_progress' } })
    api.apiGetState.mockResolvedValue({
      user: remoteUser, state: remoteState, policies: [], version: 3,
    })
    render(<AppProvider><AppProbe ref={appRef} /></AppProvider>)

    let result
    await act(async () => {
      result = await appRef.current.login('employee.case', 'Password-Case-Sensitive')
    })

    expect(result).toMatchObject({
      ok: true,
      account: { employeeId: 'ST-003', storeId: 'SM-TNV', name: 'Nhân viên chính thức' },
    })
    expect(appRef.current.session).toMatchObject({ employeeId: 'ST-003', storeId: 'SM-TNV' })
    expect(appRef.current.attendance).toEqual([
      expect.objectContaining({ id: 'ATT-RAW-CASE', employeeId: 'st-003', storeId: 'sm-tnv' }),
    ])

    let checkInResult
    let workResult
    await act(async () => {
      checkInResult = await appRef.current.checkIn({ shiftId: 'OFFICE-AM', location: { lat: 10, lng: 106 } })
      workResult = await appRef.current.updateSupportWork({
        assignmentId: 'ASSIGN-CASE',
        tasks: [{ id: 'ASSIGN-TASK-CASE', completed: true, note: 'Đã hoàn thành' }],
      })
    })

    expect(checkInResult).toMatchObject({ ok: true, record: { employeeId: 'ST-003' } })
    expect(workResult).toMatchObject({ ok: true, assignment: { id: 'ASSIGN-CASE' } })
    expect(api.apiCommand).toHaveBeenCalledWith('attendance.check_in', expect.any(Object), expect.any(Object))
    expect(api.apiCommand).toHaveBeenCalledWith('support_work.update', expect.objectContaining({ assignmentId: 'ASSIGN-CASE' }), expect.any(Object))
  })

  it('persists local store task progress with the canonical attendance scope in one save', async () => {
    const initial = createInitialState()
    const employee = {
      id: 'ST-LOCAL-PROGRESS', code: 'ST-LOCAL-PROGRESS', name: 'Nhân viên cửa hàng',
      unit: 'store', storeId: 'SM-TNV', employmentType: 'Part-Time',
      username: 'store.progress', password: 'Store-Progress-Password',
    }
    renderLocalState({
      ...initial,
      session: {
        role: 'employee', employeeId: employee.id, id: employee.id, code: employee.id,
        unit: employee.unit, storeId: employee.storeId,
      },
      stores: [{ id: 'SM-TNV', name: 'SM TNV', status: 'Đang hoạt động' }],
      employees: [employee],
      attendance: [{
        id: 'ATT-LOCAL-PROGRESS', employeeId: employee.id, storeId: employee.storeId,
        date: '2026-08-30', workDate: '2026-08-30', shiftId: 'CA-SANG',
        checkIn: '08:00', checkInAt: '2026-08-30T01:00:00.000Z', checkOut: null, checkOutAt: null,
      }],
      tasks: [{
        id: 'TASK-LOCAL-PROGRESS', assignmentId: 'ASSIGN-LOCAL-PROGRESS',
        checklistAttendanceId: 'att-local-progress', employeeIds: ['st-local-progress'],
        storeId: 'sm-tnv', date: '2026-08-30', shiftId: 'ca-sang',
        title: 'Kiểm tra quầy', required: true, completedBy: {}, completionHistory: [],
      }],
      taskAssignmentHistory: [{
        id: 'ASSIGN-LOCAL-PROGRESS', assignmentId: 'ASSIGN-LOCAL-PROGRESS',
        checklistAttendanceId: 'ATT-LOCAL-PROGRESS', storeId: 'SM-TNV',
        date: '2026-08-30', shiftId: 'CA-SANG', employeeIds: [employee.id],
        tasks: [], progressHistory: [],
      }],
    })

    await act(async () => {
      expect(await appRef.current.login('store.progress', 'Store-Progress-Password'))
        .toMatchObject({ ok: true, account: { role: 'employee', employeeId: employee.id } })
    })

    let result
    await act(async () => {
      result = await appRef.current.saveStoreTaskProgress({
        attendanceId: 'att-local-progress',
        tasks: [{ id: 'task-local-progress', completed: true }],
      })
    })

    expect(result).toMatchObject({ ok: true, completedTasks: 1, totalTasks: 1, completionRate: 100 })
    expect(appRef.current.tasks[0]).toMatchObject({
      id: 'TASK-LOCAL-PROGRESS', completedBy: { 'ST-LOCAL-PROGRESS': true },
    })
    expect(appRef.current.taskAssignmentHistory[0].progressHistory.at(-1)).toMatchObject({
      attendanceId: 'ATT-LOCAL-PROGRESS', storeId: 'SM-TNV', date: '2026-08-30', shiftId: 'CA-SANG',
      completionRate: 100,
    })
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
        // Keep the wall-clock time stable in every test-runner timezone; this
        // case verifies payload precedence, not the early check-in policy.
        at: new Date(2026, 7, 24, 7, 30).toISOString(),
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

  it('rejects local task progress before mutating case-colliding task ids', async () => {
    const initial = createInitialState()
    const employee = {
      id: 'ST-TASK-COLLISION', code: 'ST-TASK-COLLISION', name: 'Nhân viên task collision',
      unit: 'store', storeId: 'SM-TNV', employmentType: 'Part-Time',
      username: 'task.collision', password: 'Task-Collision-Password',
    }
    const attendance = {
      id: 'ATT-TASK-COLLISION', employeeId: employee.id, storeId: employee.storeId,
      date: '2026-08-30', shiftId: 'CA-SANG', checkInAt: '2026-08-30T01:00:00.000Z',
      checkOut: null, checkOutAt: null,
    }
    renderLocalState({
      ...initial,
      session: { role: 'employee', employeeId: employee.id, id: employee.id, code: employee.id, unit: employee.unit, storeId: employee.storeId },
      stores: [{ id: 'SM-TNV', name: 'SM TNV', status: 'Đang hoạt động' }],
      employees: [employee],
      attendance: [attendance],
      tasks: [{
        id: 'TASK-X', checklistAttendanceId: attendance.id, employeeIds: [employee.id],
        storeId: employee.storeId, date: attendance.date, shiftId: attendance.shiftId, required: true,
        completedBy: {},
      }, {
        id: 'task-x', checklistAttendanceId: attendance.id, employeeIds: [employee.id],
        storeId: employee.storeId, date: attendance.date, shiftId: attendance.shiftId, required: true,
        completedBy: {},
      }],
    })

    await act(async () => {
      expect(await appRef.current.login('task.collision', 'Task-Collision-Password'))
        .toMatchObject({ ok: true, account: { employeeId: employee.id } })
    })

    let result
    await act(async () => {
      result = await appRef.current.saveStoreTaskProgress({
        attendanceId: attendance.id,
        tasks: [{ id: 'TASK-X', completed: true }, { id: 'task-x', completed: false }],
      })
    })

    expect(result).toMatchObject({ ok: false, code: 'TASK_IDENTIFIER_COLLISION' })
    expect(appRef.current.tasks.every((task) => Object.keys(task.completedBy).length === 0)).toBe(true)
  })

  it('updates only the exact local attendance when ids differ only by casing', async () => {
    const initial = createInitialState()
    const employee = {
      id: 'ST-ATT-EXACT', code: 'ST-ATT-EXACT', name: 'Nhân viên attendance exact',
      unit: 'store', storeId: 'SM-TNV', employmentType: 'Part-Time',
      username: 'attendance.exact', password: 'Attendance-Exact-Password',
    }
    const attendance = {
      employeeId: employee.id, storeId: employee.storeId, date: '2026-08-30', shiftId: 'CA-SANG',
      shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
      checkIn: '08:00', checkInAt: '2026-08-30T01:00:00.000Z', checkOut: null, checkOutAt: null,
    }
    renderLocalState({
      ...initial,
      session: { role: 'employee', employeeId: employee.id, id: employee.id, code: employee.id, unit: employee.unit, storeId: employee.storeId },
      employees: [employee],
      attendance: [{ ...attendance, id: 'ATT-X' }, { ...attendance, id: 'att-x' }],
      activeAttendanceId: 'ATT-X',
      tasks: [],
      orders: [{
        id: 'ORDER-ATT-UPPER', employeeId: employee.id, storeId: employee.storeId,
        attendanceId: 'ATT-X', amount: 11_000, paymentMethod: 'Tiền mặt', status: 'Hoàn tất',
        createdAt: '2026-08-30T01:30:00.000Z',
      }, {
        id: 'ORDER-ATT-LOWER', employeeId: employee.id, storeId: employee.storeId,
        attendanceId: 'att-x', amount: 99_000, paymentMethod: 'Tiền mặt', status: 'Hoàn tất',
        createdAt: '2026-08-30T01:30:00.000Z',
      }],
      expenseEntries: [{
        id: 'EXP-ATT-UPPER', attendanceId: 'ATT-X', amount: 3_000,
        sourceType: 'shift-expense-item', recognized: true,
      }, {
        id: 'EXP-ATT-LOWER', attendanceId: 'att-x', amount: 7_000,
        sourceType: 'shift-expense-item', recognized: true,
      }],
      cashTransactions: [],
      payrollPeriods: [],
    })

    await act(async () => {
      expect(await appRef.current.login('attendance.exact', 'Attendance-Exact-Password'))
        .toMatchObject({ ok: true, account: { employeeId: employee.id } })
    })

    await act(async () => {
      expect(await appRef.current.addShiftExpense({
        attendanceId: 'ATT-X', name: 'Nước uống', amount: 10_000,
      })).toMatchObject({ ok: true })
    })
    expect(appRef.current.attendance.find((record) => record.id === 'ATT-X')).toMatchObject({ shiftExpenseTotal: 13_000 })
    expect(appRef.current.attendance.find((record) => record.id === 'att-x').shiftExpenseTotal).toBeUndefined()

    await act(async () => {
      expect(await appRef.current.checkOut({
        at: '2026-08-30T02:00:00.000Z', cashRevenue: 11_000, transferRevenue: 0,
      })).toMatchObject({ ok: true })
    })
    expect(appRef.current.attendance.find((record) => record.id === 'ATT-X')).toMatchObject({
      checkOutAt: expect.any(String), revenue: 11_000, orderCount: 1, shiftExpenseTotal: 13_000,
    })
    expect(appRef.current.attendance.find((record) => record.id === 'att-x').checkOutAt).toBeNull()
  })

  it('fails closed before calculating a salary advance for colliding employee ids', async () => {
    const initial = createInitialState()
    const employee = {
      id: 'EMP-X', code: 'EMP-X', name: 'Nhân viên trên', unit: 'store', storeId: 'SM-TNV',
      employmentType: 'Part-Time', hourlyRate: 25_000,
    }
    const manager = {
      id: 'MANAGER-COLLISION', code: 'MANAGER-COLLISION', name: 'Quản lý kiểm thử',
      unit: 'store_manager', storeId: employee.storeId, role: 'store_manager',
      username: 'manager.collision', password: 'Manager-Collision-Password',
    }
    renderLocalState({
      ...initial,
      session: null,
      employees: [manager, employee, { ...employee, id: 'emp-x', code: 'emp-x', name: 'Nhân viên dưới' }],
      salaryAdvances: [],
    })

    await act(async () => {
      expect(await appRef.current.login('manager.collision', 'Manager-Collision-Password'))
        .toMatchObject({ ok: true })
    })

    let result
    await act(async () => {
      result = await appRef.current.createSalaryAdvance({ employeeId: 'emp-x', period: '2026-08', amount: 10_000 })
    })

    expect(result).toMatchObject({ ok: false, code: 'EMPLOYEE_IDENTIFIER_COLLISION' })
    expect(appRef.current.salaryAdvances).toEqual([])
  })
})
