// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createIdosiServer } from './server.mjs'
import { STAFF_WORK_CATALOG_SEED_VERSION } from '../../src/domain/compensationPolicies.js'
import { taskShiftContext } from '../../src/domain/taskShift.js'

it('persists manual shift progress atomically, isolates scopes, preserves legacy/rewards and gates checkout across VPS restart', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-22T16:48:00+07:00'))
  const directory = await mkdtemp(resolve(tmpdir(), 'idosi-task-shift-'))
  const options = { databasePath: resolve(directory, 'state.sqlite'), imagesDirectory: resolve(directory, 'images'),
    bootstrapToken: 'manual-shift-fixture', automaticRevenueBonusEnabled: false }
  let server, runtime, base
  const start = async () => {
    ;({ server, runtime } = createIdosiServer(options))
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    base = `http://127.0.0.1:${server.address().port}`
  }
  const request = async (path, body, token, headers = {}, status = 200) => {
    const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    const result = await response.json()
    expect(response.status, JSON.stringify(result)).toBe(status)
    return result
  }
  const version = () => runtime.database.database.prepare("SELECT version FROM app_state WHERE scope_key='global'").get().version
  const command = (token, type, payload, status = 200, key = crypto.randomUUID(), expectedVersion = version()) => request('/api/command',
    { type, payload, expectedVersion }, token, { 'idempotency-key': key }, status)
  const login = async (username) => (await request('/api/login', { username, password: 'Synthetic-task-shift-password' })).token
  const projected = async (token) => (await request('/api/system-screens/employee-tasks', null, token)).state
  const taskContext = (state, id) => taskShiftContext({ state, attendance: state.attendance.find((row) => !row.checkOutAt), employeeId: 'E1', selectedTaskShiftId: id })
  const payload = (state, shiftId, completed = true) => ({ attendanceId: state.attendance.find((row) => !row.checkOutAt).id,
    selectedTaskShiftId: shiftId, tasks: taskContext(state, shiftId).tasks.map((task) => ({ id: task.id, completed })),
    incompleteReason: completed ? '' : `Chưa hoàn thành ${shiftId}` })
  const location = { latitude: 10.8, longitude: 106.7, accuracy: 5 }
  try {
    await start()
    await request('/api/bootstrap', { username: 'shift.admin', password: 'Synthetic-task-shift-password', initialState: {
      staffWorkCatalogSeedVersion: STAFF_WORK_CATALOG_SEED_VERSION,
      stores: [{ id: 'S1', name: 'Cửa hàng kiểm thử' }, { id: 'S2', name: 'Cửa hàng khác' }],
      employees: [{ id: 'E1', name: 'Nhân viên kiểm thử', storeId: 'S1', unit: 'store', status: 'Đang làm việc', employmentType: 'Part-Time', hourlyRate: 30000 }],
      shiftDefinitions: [
        { id: 'ca1', storeId: 'S1', name: 'Ca Sáng', start: '08:00', end: '12:00', active: true },
        { id: 'ca2', storeId: 'S1', name: 'Ca Chiều', start: '12:00', end: '17:00', active: true },
        { id: 'ca3', storeId: 'S1', name: 'Ca Tối', start: '17:00', end: '21:00', active: true },
        { id: 'foreign', storeId: 'S2', name: 'Ca khác', start: '17:00', end: '21:00', active: true },
        { id: 'other-date', storeId: 'S1', date: '2026-09-23', name: 'Ca ngày khác', start: '17:00', end: '21:00', active: true },
      ],
      workCatalogItems: ['ca2', 'ca3'].map((shiftId) => ({ id: `FIXED-${shiftId}`, code: `store.fixed.${shiftId}`,
        targetGroup: 'store', kind: 'FIXED_TASK', storeId: 'S1', shiftId, name: `Công việc ${shiftId}`,
        active: true, amountVnd: 0, sortOrder: 0, version: 1 })).concat({ id: 'REWARD', code: 'store.reward.synthetic',
        targetGroup: 'store', kind: 'REWARD_TASK', storeId: 'S1', name: 'Công việc thưởng', active: true, amountVnd: 10000, sortOrder: 1, version: 1 }),
      schedule: [], attendance: [], orders: [], tasks: [], supportTransfers: [],
    } }, null, { 'x-idosi-bootstrap-token': 'manual-shift-fixture' }, 201)
    const admin = await login('shift.admin')
    await command(admin, 'user.create', { username: 'shift.employee', password: 'Synthetic-task-shift-password',
      displayName: 'Nhân viên kiểm thử', role: 'employee', storeId: 'S1', employeeId: 'E1' }, 201)
    const employee = await login('shift.employee')
    await command(admin, 'schedule.assign', { storeId: 'S1', date: '2026-09-22', employeeIds: ['E1'], shiftIds: ['ca3'] })
    const checked = await command(employee, 'attendance.check_in', { shiftId: 'ca3', location }, 201)
    const original = checked.attendance
    let state = await projected(employee)
    expect(state.shiftDefinitions.map((shift) => shift.id)).toEqual(expect.arrayContaining(['ca1', 'ca2', 'ca3']))
    expect(taskContext(state, 'ca3').tasks.map((task) => task.catalogItemId)).toEqual(['FIXED-ca3'])
    const beforeVersion = version()
    taskContext(state, 'ca1')
    taskContext(state, 'ca2')
    expect(version()).toBe(beforeVersion)
    const requestBody = payload(state, 'ca3', false)
    // One attendance owns one task shift: saving requires a server-side selection first.
    await command(employee, 'task.progress.save', requestBody, 409)
    expect(version()).toBe(beforeVersion)
    await command(employee, 'task.shift.select', { attendanceId: original.id, selectedTaskShiftId: 'ca3' })
    const selectedVersion = version()
    await command(employee, 'task.progress.save', { ...requestBody, selectedTaskShiftId: 'foreign' }, 409)
    await command(employee, 'task.progress.save', { ...requestBody, selectedTaskShiftId: 'other-date' }, 409)
    await command(employee, 'task.progress.save', { ...requestBody, selectedTaskShiftId: '' }, 409)
    await command(employee, 'task.progress.save', { ...requestBody, employeeId: 'E2' }, 403)
    await command(employee, 'task.progress.save', { ...requestBody, storeId: 'S2' }, 403)
    await command(employee, 'task.progress.save', { ...requestBody, attendanceId: 'foreign' }, 409)
    await command(employee, 'task.progress.save', { ...requestBody, tasks: [...requestBody.tasks, { id: 'fake-task', completed: true }] }, 400)
    await command(employee, 'task.progress.save', { ...requestBody, tasks: [] }, 400)
    expect(version()).toBe(selectedVersion)
    const key = crypto.randomUUID()
    const saved = await command(employee, 'task.progress.save', requestBody, 200, key, selectedVersion)
    expect(saved.completionRate).toBe(0)
    await command(employee, 'task.progress.save', requestBody, 200, key, selectedVersion)
    await command(employee, 'task.progress.save', requestBody, 409, crypto.randomUUID(), selectedVersion)
    state = await projected(employee)
    const savedAttendance = state.attendance.find((row) => row.id === original.id)
    expect(savedAttendance).toMatchObject({ shiftId: 'ca3', checkIn: original.checkIn, checkInAt: original.checkInAt,
      checklistSnapshot: original.checklistSnapshot, taskShiftContexts: [{ shiftId: 'ca3', taskIds: requestBody.tasks.map((task) => task.id) }] })
    expect(state.tasks.find((task) => task.catalogItemId === 'REWARD').completedBy).toEqual({})
    expect(state.workCatalogProgress || []).toEqual([])
    const histories = state.taskAssignmentHistory.flatMap((assignment) => assignment.progressHistory || [])
    expect(histories.filter((event) => event.shiftId === 'ca3')).toHaveLength(1)
    // The check-in snapshot captured the afternoon catalog by check-in time; with
    // the night shift locked it stays stored but is no longer owed or writable.
    taskContext(state, 'ca1')
    const lockedVersion = version()
    expect((await command(employee, 'task.progress.save', payload(state, 'ca2', false), 409)).error.code).toBe('TASK_SHIFT_LOCKED')
    expect((await command(employee, 'task.shift.select', { attendanceId: original.id, selectedTaskShiftId: 'ca2' }, 409)).error.code).toBe('TASK_SHIFT_ALREADY_SELECTED')
    expect(version()).toBe(lockedVersion)
    await command(employee, 'task.progress.save', payload(state, 'ca3', true))
    await new Promise((done) => server.close(done))
    await start()
    const refreshedToken = await login('shift.employee')
    state = await projected(refreshedToken)
    expect(taskContext(state, 'ca3').tasks.every((task) => task.completedBy.E1 === true)).toBe(true)
    expect(state.attendance[0].taskShiftContexts).toHaveLength(1)
    expect(state.attendance[0].taskShiftSelection.shiftId).toBe('ca3')
    vi.setSystemTime(new Date('2026-09-22T21:00:00+07:00'))
    const closed = await command(refreshedToken, 'attendance.check_out', { attendanceId: original.id, cashRevenue: 0, transferRevenue: 0, location })
    expect(closed.attendance.incompleteTaskReason).toBeNull()
    expect(closed.attendance.incompleteTasksSnapshot).toEqual([])
    expect(closed.attendance.checklistSnapshot).toEqual(original.checklistSnapshot)
    await command(refreshedToken, 'task.progress.save', requestBody, 409)
  } finally {
    if (server?.listening) await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
    vi.useRealTimers()
  }
}, 30_000)
