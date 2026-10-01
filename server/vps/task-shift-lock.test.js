// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { STAFF_WORK_CATALOG_SEED_VERSION } from '../../src/domain/compensationPolicies.js'
import { taskShiftContext, taskShiftSlots } from '../../src/domain/taskShift.js'

const PASSWORD = 'Synthetic-task-lock-password'
const location = { latitude: 10.8, longitude: 106.7, accuracy: 5 }
const shiftDefinitions = [
  { id: 'ca1', storeId: 'S1', name: 'Ca Sáng', start: '08:00', end: '12:00', active: true },
  { id: 'ca2', storeId: 'S1', name: 'Ca Chiều', start: '12:00', end: '17:00', active: true },
  { id: 'ca3', storeId: 'S1', name: 'Ca Tối', start: '17:00', end: '21:00', active: true },
  { id: 'foreign', storeId: 'S2', name: 'Ca Tối', start: '17:00', end: '21:00', active: true },
  { id: 'other-date', storeId: 'S1', date: '2026-09-23', name: 'Ca Tối', start: '17:00', end: '21:00', active: true },
]
const catalog = ['ca2', 'ca3'].map((shiftId) => ({ id: `FIXED-${shiftId}`, code: `store.fixed.${shiftId}`,
  targetGroup: 'store', kind: 'FIXED_TASK', storeId: 'S1', shiftId, name: `Công việc ${shiftId}`,
  active: true, amountVnd: 0, sortOrder: 0, version: 1 }))

const harness = async (name, initialState) => {
  const directory = await mkdtemp(resolve(tmpdir(), `idosi-${name}-`))
  const options = { databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: `${name}-fixture`, automaticRevenueBonusEnabled: false }
  const context = { directory }
  context.start = async () => {
    ;({ server: context.server, runtime: context.runtime } = createIdosiServer(options))
    await new Promise((done) => context.server.listen(0, '127.0.0.1', done))
    context.base = `http://127.0.0.1:${context.server.address().port}`
  }
  context.stop = async () => {
    if (context.server?.listening) await new Promise((done) => context.server.close(done))
  }
  context.raw = async (path, body, token, headers = {}) => {
    const response = await fetch(`${context.base}${path}`, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  context.request = async (path, body, token, headers = {}, status = 200) => {
    const result = await context.raw(path, body, token, headers)
    expect(result.status, JSON.stringify(result.body)).toBe(status)
    return result.body
  }
  context.version = () => context.runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
  context.command = (token, type, payload, status = 200, key = crypto.randomUUID(), expectedVersion = context.version()) => context.request('/api/command',
    { type, payload, expectedVersion }, token, { 'idempotency-key': key }, status)
  context.rawCommand = (token, type, payload, key = crypto.randomUUID(), expectedVersion = context.version()) => context.raw('/api/command',
    { type, payload, expectedVersion }, token, { 'idempotency-key': key })
  context.login = async (username) => (await context.request('/api/login', { username, password: PASSWORD })).token
  context.projected = async (token) => (await context.request('/api/system-screens/employee-tasks', null, token)).state
  context.audit = (action) => context.runtime.database.database.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n
  await context.start()
  await context.request('/api/bootstrap', { username: `${name}.admin`, password: PASSWORD, initialState: {
    staffWorkCatalogSeedVersion: STAFF_WORK_CATALOG_SEED_VERSION,
    stores: [{ id: 'S1', name: 'Cửa hàng kiểm thử' }, { id: 'S2', name: 'Cửa hàng khác' }],
    employees: [
      { id: 'E1', name: 'Nhân viên kiểm thử', storeId: 'S1', unit: 'store', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30000 },
      { id: 'E2', name: 'Nhân viên khác', storeId: 'S1', unit: 'store', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30000 },
    ],
    shiftDefinitions, workCatalogItems: catalog,
    schedule: [], attendance: [], orders: [], tasks: [], supportTransfers: [], taskAssignmentHistory: [],
    ...initialState,
  } }, null, { 'x-idosi-bootstrap-token': `${name}-fixture` }, 201)
  context.admin = await context.login(`${name}.admin`)
  for (const [username, employeeId] of [['employee', 'E1'], ['other', 'E2']]) {
    await context.command(context.admin, 'user.create', { username: `${name}.${username}`, password: PASSWORD,
      displayName: employeeId, role: 'employee', storeId: 'S1', employeeId }, 201)
  }
  context.employee = await context.login(`${name}.employee`)
  context.other = await context.login(`${name}.other`)
  context.cleanup = async () => {
    await context.stop()
    await rm(directory, { recursive: true, force: true })
  }
  return context
}

const openOf = (state, employeeId = 'E1') => state.attendance.find((row) => row.employeeId === employeeId && !row.checkOutAt)
const progressPayload = (state, shiftId, completed) => {
  const attendance = openOf(state)
  return { attendanceId: attendance.id, selectedTaskShiftId: shiftId,
    tasks: taskShiftContext({ state, attendance, employeeId: 'E1', selectedTaskShiftId: shiftId }).tasks.map((task) => ({ id: task.id, completed })),
    incompleteReason: completed ? '' : `Chưa xong ${shiftId}` }
}

it('resolves independent time choices and repeated persisted copies consistently through select/save and restart', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T16:48:00+07:00'))
  const app = await harness('task-lock-copies', {
    shiftDefinitions: [...shiftDefinitions, ...structuredClone(shiftDefinitions),
      { id: 'pm-1330', storeId: 'S1', name: 'Ca Chiều', start: '13:30', end: '18:00', active: true }],
    attendance: [{ id: 'A-copies', employeeId: 'E1', storeId: 'S1', date: '2026-09-22', workDate: '2026-09-22',
      shiftId: 'ca3', shift: 'ca3', shiftName: 'Ca Tối', shiftStart: '17:00', shiftEnd: '21:00',
      checkIn: '16:48', checkInAt: '2026-09-22T09:48:00.000Z', checkOut: null, checkOutAt: null, unit: 'store' }],
  })
  try {
    let state = await app.projected(app.employee)
    expect(state.shiftDefinitions.filter((shift) => shift.id === 'ca2')).toHaveLength(2)
    expect(taskShiftSlots(state, 'S1', '2026-09-22', openOf(state)).map((slot) => slot.status)).toEqual(['ready', 'multiple', 'ready'])
    expect(openOf(state).taskShiftSelection).toBeUndefined()
    const version = app.version()
    const payload = { attendanceId: 'A-copies', selectedTaskShiftId: 'pm-1330' }
    await app.command(app.employee, 'task.shift.select', payload, 200, 'copies-select', version)
    await app.command(app.employee, 'task.shift.select', payload, 200, 'copies-select', version)
    expect((await app.command(app.employee, 'task.shift.select', { ...payload, selectedTaskShiftId: 'ca3' }, 409, 'copies-select', version)).error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(app.audit('task.shift.select')).toBe(1)
    state = await app.projected(app.employee)
    await app.command(app.employee, 'task.progress.save', progressPayload(state, 'pm-1330', true))
    const beforeRestart = await app.projected(app.employee)
    await app.command(app.admin, 'shift_definition.update', { shiftId: 'pm-1330', name: 'Ca Chiều điều chỉnh', start: '14:00', end: '20:00' })
    await app.stop()
    await app.start()
    app.employee = await app.login('task-lock-copies.employee')
    state = await app.projected(app.employee)
    expect(openOf(state).taskShiftSelection).toEqual(openOf(beforeRestart).taskShiftSelection)
    expect(openOf(state).taskShiftContexts).toEqual(openOf(beforeRestart).taskShiftContexts)
    expect(state.tasks).toEqual(beforeRestart.tasks)
    expect(taskShiftContext({ state, attendance: openOf(state), employeeId: 'E1', selectedTaskShiftId: 'pm-1330' }).tasks).toEqual(beforeRestart.tasks)
    expect(openOf(state).shiftId).toBe('ca3')
    expect(openOf(state).taskShiftSelection.shiftId).toBe('pm-1330')
    expect(app.audit('task.shift.select')).toBe(1)
  } finally {
    await app.cleanup()
    vi.useRealTimers()
  }
}, 60_000)

it('locks one task shift per attendance on the server, idempotently, across restart and new attendance', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T16:48:00+07:00'))
  const app = await harness('task-lock', {})
  try {
    await app.command(app.admin, 'schedule.assign', { storeId: 'S1', date: '2026-09-22', employeeIds: ['E1', 'E2'], shiftIds: ['ca3'] })
    // Closed/absent attendance: nothing to select.
    await app.command(app.employee, 'task.shift.select', { attendanceId: 'missing', selectedTaskShiftId: 'ca2' }, 409)
    const checkedIn = (await app.command(app.employee, 'attendance.check_in', { shiftId: 'ca3', location }, 201)).attendance
    await app.command(app.other, 'attendance.check_in', { shiftId: 'ca3', location }, 201)
    let state = await app.projected(app.employee)
    const before = app.version()
    // Save before selecting, or by an old client omitting the field, is rejected.
    const pending = await app.command(app.employee, 'task.progress.save', progressPayload(state, 'ca2', false), 409)
    expect(pending.error.code).toBe('TASK_SHIFT_SELECTION_REQUIRED')
    const legacyPayload = progressPayload(state, 'ca3', false)
    delete legacyPayload.selectedTaskShiftId
    expect((await app.command(app.employee, 'task.progress.save', legacyPayload, 409)).error.code).toBe('TASK_SHIFT_SELECTION_REQUIRED')
    // Mandatory task.done is not a side door.
    // Check-in captured its legacy time-based checklist (16:48 → afternoon catalog).
    const checkinTask = state.tasks.find((task) => task.checklistAttendanceId === checkedIn.id)
    expect(checkinTask.catalogItemId).toBe('FIXED-ca2')
    expect((await app.command(app.employee, 'task.done', { taskId: checkinTask.id, done: true }, 409)).error.code).toBe('TASK_SHIFT_SELECTION_REQUIRED')
    // Invalid scope / configuration never writes.
    for (const [payload, status, code] of [
      [{ attendanceId: checkedIn.id, selectedTaskShiftId: 'foreign' }, 409, 'TASK_SHIFT_INVALID'],
      [{ attendanceId: checkedIn.id, selectedTaskShiftId: 'other-date' }, 409, 'TASK_SHIFT_INVALID'],
      [{ attendanceId: checkedIn.id, selectedTaskShiftId: '' }, 409, 'TASK_SHIFT_INVALID'],
      [{ attendanceId: checkedIn.id, selectedTaskShiftId: 'ca2', employeeId: 'E2' }, 403, 'TASK_SCOPE_FORBIDDEN'],
      [{ attendanceId: checkedIn.id, selectedTaskShiftId: 'ca2', storeId: 'S2' }, 403, 'TASK_SCOPE_FORBIDDEN'],
    ]) {
      const result = await app.command(app.employee, 'task.shift.select', payload, status)
      if (code !== 'TASK_SHIFT_INVALID') expect(result.error.code).toBe(code)
    }
    // Another employee cannot select on E1's attendance; managers/admin cannot select.
    await app.command(app.other, 'task.shift.select', { attendanceId: checkedIn.id, selectedTaskShiftId: 'ca2' }, 409)
    await app.command(app.admin, 'task.shift.select', { attendanceId: checkedIn.id, selectedTaskShiftId: 'ca2' }, 403)
    expect(app.version()).toBe(before)

    // Two devices choose different shifts concurrently: exactly one commits.
    const [afternoon, night] = await Promise.all([
      app.rawCommand(app.employee, 'task.shift.select', { attendanceId: checkedIn.id, selectedTaskShiftId: 'ca2' }, 'select-ca2', before),
      app.rawCommand(app.employee, 'task.shift.select', { attendanceId: checkedIn.id, selectedTaskShiftId: 'ca3' }, 'select-ca3', before),
    ])
    expect([afternoon.status, night.status].toSorted()).toEqual([200, 409])
    const winner = afternoon.status === 200 ? 'ca2' : 'ca3'
    const loserBody = afternoon.status === 200 ? night.body : afternoon.body
    expect(loserBody.error.code).toBe('TASK_SHIFT_ALREADY_SELECTED')
    expect(app.audit('task.shift.select')).toBe(1)
    const lockedVersion = app.version()
    // Lost response / retry: same key replays, a fresh same-shift request is a no-op.
    const replay = await app.command(app.employee, 'task.shift.select', { attendanceId: checkedIn.id, selectedTaskShiftId: winner }, 200, `select-${winner}`, before)
    expect(replay.taskShiftSelection.shiftId).toBe(winner)
    const repeated = await app.command(app.employee, 'task.shift.select', { attendanceId: checkedIn.id, selectedTaskShiftId: winner })
    expect(repeated.existing).toBe(true)
    expect(app.version()).toBe(lockedVersion)
    expect(app.audit('task.shift.select')).toBe(1)

    state = await app.projected(app.employee)
    let open = openOf(state)
    expect(open).toMatchObject({ shiftId: 'ca3', checkIn: checkedIn.checkIn, checkInAt: checkedIn.checkInAt,
      checklistSnapshot: checkedIn.checklistSnapshot, taskShiftSelection: { shiftId: winner, attendanceId: checkedIn.id, slot: winner === 'ca2' ? 'afternoon' : 'night' } })
    expect(open.taskShiftContexts).toHaveLength(1)
    expect(open.taskProgress).toBeUndefined()
    const lockedTasks = state.tasks.filter((task) => open.taskShiftContexts[0].taskIds.includes(task.id))
    expect(lockedTasks.map((task) => task.catalogItemId)).toEqual([`FIXED-${winner}`])
    expect(lockedTasks.every((task) => Object.keys(task.completedBy || {}).length === 0)).toBe(true)
    expect(state.compensationEntries || []).toEqual([])
    const otherShift = winner === 'ca2' ? 'ca3' : 'ca2'
    // Writes for the other shift (save or task.done) are blocked; same shift works.
    expect((await app.command(app.employee, 'task.progress.save', progressPayload(state, otherShift, true), 409)).error.code).toBe('TASK_SHIFT_LOCKED')
    if (winner === 'ca3') {
      expect((await app.command(app.employee, 'task.done', { taskId: checkinTask.id, done: true }, 409)).error.code).toBe('TASK_SHIFT_LOCKED')
    }
    const injected = progressPayload(state, winner, false)
    await app.command(app.employee, 'task.progress.save', { ...injected, tasks: [...injected.tasks, { id: checkinTask.id, completed: true }] }, 400)
    await app.command(app.employee, 'task.progress.save', injected)

    // Restart: the lock comes back from SQLite for a fresh login/device.
    await app.stop()
    await app.start()
    const secondDevice = await app.login('task-lock.employee')
    state = await app.projected(secondDevice)
    open = openOf(state)
    expect(open.taskShiftSelection.shiftId).toBe(winner)
    expect(open.taskProgress.incompleteReason).toBe(`Chưa xong ${winner}`)
    // Checkout owes only the locked shift: the unselected check-in snapshot no longer blocks it.
    vi.setSystemTime(new Date('2026-09-22T21:00:00+07:00'))
    const closed = await app.command(secondDevice, 'attendance.check_out', { attendanceId: open.id, cashRevenue: 0, transferRevenue: 0, location })
    expect(closed.attendance.incompleteTaskReason).toBe(`Chưa xong ${winner}`)
    expect(closed.attendance.incompleteTasksSnapshot.map((task) => task.id)).toEqual(lockedTasks.map((task) => task.id))
    expect(closed.attendance.taskShiftSelection.shiftId).toBe(winner)
    // Closed attendance accepts neither selection nor progress.
    await app.command(secondDevice, 'task.shift.select', { attendanceId: open.id, selectedTaskShiftId: winner }, 409)
    await app.command(secondDevice, 'task.progress.save', injected, 409)

    // A new attendance starts unlocked and does not inherit the old lock/draft.
    vi.setSystemTime(new Date('2026-09-23T16:50:00+07:00'))
    app.admin = await app.login('task-lock.admin')
    const nextDevice = await app.login('task-lock.employee')
    await app.command(app.admin, 'schedule.assign', { storeId: 'S1', date: '2026-09-23', employeeIds: ['E1'], shiftIds: ['ca3'] })
    const next = (await app.command(nextDevice, 'attendance.check_in', { shiftId: 'ca3', location }, 201)).attendance
    expect(next.taskShiftSelection).toBeUndefined()
    state = await app.projected(nextDevice)
    expect(openOf(state).taskShiftContexts || []).toEqual([])
    // On 09-23 the store's date-specific evening definition overrides generic ca3.
    expect((await app.command(nextDevice, 'task.shift.select', { attendanceId: next.id, selectedTaskShiftId: 'ca3' }, 409)).error.code).toBe('TASK_SHIFT_INVALID')
    const nextSelection = await app.command(nextDevice, 'task.shift.select', { attendanceId: next.id, selectedTaskShiftId: 'other-date' })
    expect(nextSelection.taskShiftSelection).toMatchObject({ attendanceId: next.id, shiftId: 'other-date', slot: 'night' })
  } finally {
    await app.cleanup()
    vi.useRealTimers()
  }
}, 60_000)

it('selects a shift with no tasks, and never writes a selection onto an attendance checked out concurrently', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T07:55:00+07:00'))
  const app = await harness('task-lock-race', {})
  try {
    await app.command(app.admin, 'schedule.assign', { storeId: 'S1', date: '2026-09-22', employeeIds: ['E1'], shiftIds: ['ca1'] })
    const first = (await app.command(app.employee, 'attendance.check_in', { shiftId: 'ca1', location }, 201)).attendance
    // Empty morning shift still locks.
    const empty = await app.command(app.employee, 'task.shift.select', { attendanceId: first.id, selectedTaskShiftId: 'ca1' })
    expect(empty.tasks).toEqual([])
    expect(empty.attendance.taskShiftContexts).toEqual([{ shiftId: 'ca1', shiftName: 'Ca Sáng', taskIds: [] }])
    await app.command(app.employee, 'task.shift.select', { attendanceId: first.id, selectedTaskShiftId: 'ca2' }, 409)
    vi.setSystemTime(new Date('2026-09-22T12:00:00+07:00'))
    await app.command(app.employee, 'attendance.check_out', { attendanceId: first.id, cashRevenue: 0, transferRevenue: 0, location })

    await app.command(app.admin, 'schedule.assign', { storeId: 'S1', date: '2026-09-22', employeeIds: ['E1'], shiftIds: ['ca2'] })
    const second = (await app.command(app.employee, 'attendance.check_in', { shiftId: 'ca2', location }, 201)).attendance
    vi.setSystemTime(new Date('2026-09-22T17:00:00+07:00'))
    const version = app.version()
    const [select, checkout] = await Promise.all([
      app.rawCommand(app.employee, 'task.shift.select', { attendanceId: second.id, selectedTaskShiftId: 'ca1' }, crypto.randomUUID(), version),
      app.rawCommand(app.employee, 'attendance.check_out', { attendanceId: second.id, cashRevenue: 0, transferRevenue: 0, location }, crypto.randomUUID(), version),
    ])
    let state = await app.projected(app.employee)
    let closed = state.attendance.find((row) => row.id === second.id)
    if (select.status === 200) {
      // Checkout can read the pre-selection snapshot and safely reject its
      // unfinished tasks before selection commits. Re-read, then submit anew;
      // a domain rejection is not an uncertain network write to replay blindly.
      expect(closed.taskShiftSelection.shiftId).toBe('ca1')
      if (checkout.status === 409) {
        expect(checkout.body.error.code).toBe('TASK_PROGRESS_REQUIRED')
        expect(closed.checkOutAt).toBeFalsy()
        await app.command(app.employee, 'attendance.check_out', { attendanceId: second.id, cashRevenue: 0, transferRevenue: 0, location })
        state = await app.projected(app.employee)
        closed = state.attendance.find((row) => row.id === second.id)
      } else expect(checkout.status, JSON.stringify(checkout.body)).toBe(200)
    } else {
      expect(select.body.error.code).toBe('OPEN_ATTENDANCE_REQUIRED')
      expect(checkout.status, JSON.stringify(checkout.body)).toBe(200)
      expect(closed.taskShiftSelection).toBeUndefined()
    }
    expect(closed.checkOutAt).toBeTruthy()
  } finally {
    await app.cleanup()
    vi.useRealTimers()
  }
}, 60_000)

it('keeps legacy single and multi-context obligations without letting them grow', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T18:00:00+07:00'))
  const legacyTask = (id, shiftId, attendanceId, employeeId) => ({ id, assignmentId: `legacy_${attendanceId}`, checklistAttendanceId: attendanceId,
    taskShiftId: shiftId, catalogItemId: `FIXED-${shiftId}`, catalogKind: 'FIXED_TASK', storeId: 'S1', employeeId, employeeIds: [employeeId],
    date: '2026-09-22', workDate: '2026-09-22', shiftId, title: `Legacy ${shiftId}`, required: true, rewardEligible: false, active: true, completedBy: {} })
  const legacyAttendance = (id, employeeId, contexts) => ({ id, employeeId, storeId: 'S1', date: '2026-09-22', workDate: '2026-09-22',
    shiftId: 'ca3', shift: 'ca3', shiftName: 'Ca Tối', shiftStart: '17:00', shiftEnd: '21:00', checkIn: '17:00', checkInAt: '2026-09-22T10:00:00.000Z',
    checkOut: null, checkOutAt: null, unit: 'store', taskShiftContexts: contexts, deletedAt: null })
  const app = await harness('task-lock-legacy', {
    attendance: [
      legacyAttendance('att-multi', 'E1', [{ shiftId: 'ca2', shiftName: 'Ca Chiều', taskIds: ['L-E1-ca2'] }, { shiftId: 'ca3', shiftName: 'Ca Tối', taskIds: ['L-E1-ca3'] }]),
      legacyAttendance('att-single', 'E2', [{ shiftId: 'ca2', shiftName: 'Ca Chiều', taskIds: ['L-E2-ca2'] }]),
    ],
    tasks: [legacyTask('L-E1-ca2', 'ca2', 'att-multi', 'E1'), legacyTask('L-E1-ca3', 'ca3', 'att-multi', 'E1'), legacyTask('L-E2-ca2', 'ca2', 'att-single', 'E2')],
    taskAssignmentHistory: [{ id: 'legacy_att-multi', assignmentId: 'legacy_att-multi', employeeIds: ['E1'], storeId: 'S1', date: '2026-09-22', tasks: [] },
      { id: 'legacy_att-single', assignmentId: 'legacy_att-single', employeeIds: ['E2'], storeId: 'S1', date: '2026-09-22', tasks: [] }],
  })
  try {
    // Multi-context: no new selection; each saved shift can still be completed; both stay owed.
    const multi = await app.command(app.employee, 'task.shift.select', { attendanceId: 'att-multi', selectedTaskShiftId: 'ca2' }, 409)
    expect(multi.error.code).toBe('TASK_SHIFT_LEGACY_MULTI_CONTEXT')
    let state = await app.projected(app.employee)
    await app.command(app.employee, 'task.progress.save', { attendanceId: 'att-multi', selectedTaskShiftId: 'ca2', tasks: [{ id: 'L-E1-ca2', completed: true }], incompleteReason: '' })
    vi.setSystemTime(new Date('2026-09-22T21:00:00+07:00'))
    const blocked = await app.command(app.employee, 'attendance.check_out', { attendanceId: 'att-multi', cashRevenue: 0, transferRevenue: 0, location }, 409)
    expect(blocked.error.code).toBe('TASK_PROGRESS_REQUIRED')
    expect(blocked.error.details.taskIds).toEqual(['L-E1-ca3'])
    await app.command(app.employee, 'task.progress.save', { attendanceId: 'att-multi', selectedTaskShiftId: 'ca3', tasks: [{ id: 'L-E1-ca3', completed: true }], incompleteReason: '' })
    state = await app.projected(app.employee)
    expect(openOf(state).taskShiftContexts.map((context) => context.shiftId)).toEqual(['ca2', 'ca3'])
    await app.command(app.employee, 'attendance.check_out', { attendanceId: 'att-multi', cashRevenue: 0, transferRevenue: 0, location })

    // Single legacy context is the verified lock: same shift persists the selection, other shift conflicts.
    const conflict = await app.command(app.other, 'task.shift.select', { attendanceId: 'att-single', selectedTaskShiftId: 'ca3' }, 409)
    expect(conflict.error.code).toBe('TASK_SHIFT_ALREADY_SELECTED')
    const adopted = await app.command(app.other, 'task.shift.select', { attendanceId: 'att-single', selectedTaskShiftId: 'ca2' })
    expect(adopted.attendance.taskShiftSelection).toMatchObject({ shiftId: 'ca2', legacyContext: true })
    expect(adopted.attendance.taskShiftContexts).toEqual([{ shiftId: 'ca2', shiftName: 'Ca Chiều', taskIds: ['L-E2-ca2'] }])
    const owed = await app.command(app.other, 'attendance.check_out', { attendanceId: 'att-single', cashRevenue: 0, transferRevenue: 0, location }, 409)
    expect(owed.error.details.taskIds).toEqual(['L-E2-ca2'])
  } finally {
    await app.cleanup()
    vi.useRealTimers()
  }
}, 60_000)
