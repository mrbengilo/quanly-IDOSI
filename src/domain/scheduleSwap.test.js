import { describe, expect, it } from 'vitest'
import { buildScheduleSwap, scheduleSwapRevision } from './scheduleSwap.js'

const date = '2026-10-22'
const fixture = () => {
  const shifts = [['S1', '08:00', '10:00'], ['S2', '10:00', '12:00'], ['S3', '14:00', '16:00'], ['S4', '16:00', '18:00']]
    .map(([id, start, end]) => ({ id, name: id, storeId: 'STORE', start, end, active: true }))
  return { stores: [{ id: 'STORE' }], employees: ['A', 'B', 'C'].map((id) => ({ id, code: `CODE-${id}`, identifierAliases: [`alias-${id}`], storeId: 'STORE', unit: 'store', status: 'Đang làm việc' })),
    shiftDefinitions: shifts, schedule: ['A', 'B', 'C'].map((employeeId, index) => ({
      id: `ASS-${employeeId}`, employeeId, storeId: 'STORE', date, note: `note-${employeeId}`,
      shiftIds: [shifts[index].id], shiftId: shifts[index].id, shiftSnapshots: [{ ...shifts[index] }],
    })), attendance: [], tasks: [], workCatalogProgress: [], orders: [], payrollPeriods: [] }
}
const payload = (state) => ({ storeId: 'STORE', date,
  ...Object.fromEntries(['a', 'b'].map((key, index) => [key, { assignmentId: state.schedule[index].id,
    employeeId: state.schedule[index].employeeId, shiftId: state.schedule[index].shiftIds?.[0] || state.schedule[index].shiftId,
    revision: scheduleSwapRevision(state.schedule[index]) }])),
})
const addShift = (state, index, id) => {
  state.schedule[index].shiftIds.push(id)
  state.schedule[index].shiftSnapshots.push({ ...state.shiftDefinitions.find((row) => row.id === id) })
}
const rejects = (state, code, intent = payload(state)) => {
  const before = structuredClone(state)
  expect(() => buildScheduleSwap(state, intent)).toThrow(expect.objectContaining({ code }))
  expect(state).toEqual(before)
}

describe('atomic schedule swap domain', () => {
  it.each([[false, false], [true, false], [true, true]])('only replaces selected shifts (multi A=%s B=%s)', (multiA, multiB) => {
    const state = fixture()
    if (multiA) addShift(state, 0, 'S3')
    if (multiB) addShift(state, 1, 'S4')
    state.schedule.push({ ...state.schedule[2], id: 'OTHER-DAY', date: '2026-10-23' }, { ...state.schedule[2], id: 'OTHER-STORE', storeId: 'OTHER' })
    const before = structuredClone(state)
    const result = buildScheduleSwap(state, payload(state))
    expect(result.assignments.map((row) => row.shiftIds)).toEqual([multiA ? ['S2', 'S3'] : ['S2'], multiB ? ['S1', 'S4'] : ['S1']])
    expect(result.assignments.map((row) => [row.id, row.employeeId, row.storeId, row.date, row.note, row.shiftId]))
      .toEqual([['ASS-A', 'A', 'STORE', date, 'note-A', 'S2'], ['ASS-B', 'B', 'STORE', date, 'note-B', 'S1']])
    expect(result.schedule.slice(2)).toEqual(before.schedule.slice(2))
    expect(state).toEqual(before)
  })
  it('resolves aliases and rejects the same identity under another alias', () => {
    const state = fixture()
    state.schedule[1].employeeId = 'alias-A'
    rejects(state, 'SCHEDULE_SAME_EMPLOYEE')
  })
  it('supports alias references in attendance and legacy shiftId', () => {
    const state = fixture()
    delete state.schedule[0].shiftIds
    expect(buildScheduleSwap(state, payload(state)).assignments[0].shiftIds).toEqual(['S2'])
    state.attendance.push({ employeeId: 'alias-A', storeId: 'STORE', date, shiftId: 'S1' })
    rejects(state, 'SCHEDULE_STARTED_IMMUTABLE')
  })
  it.each(['', '2026-02-30', 'wrong'])('rejects invalid date %s', (value) => {
    const state = fixture(); rejects(state, 'SCHEDULE_DATE_INVALID', { ...payload(state), date: value })
  })
  it.each(['assignmentId', 'employeeId', 'shiftId'])('rejects forged %s', (field) => {
    const state = fixture(); const intent = payload(state); intent.a[field] = 'missing'
    rejects(state, field === 'assignmentId' ? 'SCHEDULE_ASSIGNMENT_INVALID' : field === 'employeeId' ? 'SCHEDULE_EMPLOYEE_INVALID' : 'SHIFT_INVALID', intent)
  })
  it.each([{ projectionReadOnly: true }, { deletedAt: 'now' }, { status: 'Đã hủy' }])('rejects unusable records %s', (patch) => {
    const state = fixture(); Object.assign(state.schedule[0], patch); rejects(state, 'SCHEDULE_ASSIGNMENT_INVALID')
  })
  it('rejects no-op and duplicates instead of deduplicating', () => {
    const state = fixture()
    state.schedule[1].shiftIds = ['S1']; state.schedule[1].shiftSnapshots = [{ ...state.shiftDefinitions[0] }]
    rejects(state, 'SCHEDULE_SWAP_NO_CHANGE')
    const other = fixture(); addShift(other, 0, 'S2'); rejects(other, 'SCHEDULE_DUPLICATE_SHIFT')
  })
  it('rejects overlap with remaining shifts but accepts touching boundaries', () => {
    const state = fixture(); addShift(state, 0, 'S3')
    state.schedule[0].shiftSnapshots[1].start = '11:00'
    rejects(state, 'SCHEDULE_TIME_OVERLAP')
    state.schedule[0].shiftSnapshots[1].start = '12:00'
    expect(buildScheduleSwap(state, payload(state)).assignments).toHaveLength(2)
  })
  it('checks adjacent dates and other stores after both replacements', () => {
    const state = fixture()
    state.schedule[2] = { id: 'NIGHT', employeeId: 'A', storeId: 'OTHER', date: '2026-10-21', shiftIds: ['N'],
      shiftSnapshots: [{ id: 'N', start: '23:00', end: '11:00' }] }
    rejects(state, 'SCHEDULE_TIME_OVERLAP')
  })
  it('only locks the selected attended shift and keeps unrelated history unchanged', () => {
    const state = fixture(); addShift(state, 0, 'S3')
    state.attendance = [{ id: 'ATT', employeeId: 'A', storeId: 'STORE', date, shiftId: 'S3', selectedTaskShiftId: 'MANUAL', taskProgress: { completedTasks: 3 } }]
    state.tasks = [{ id: 'MANUAL-TASK', checklistAttendanceId: 'ATT', employeeId: 'A', storeId: 'STORE', date, shiftId: 'S1' }]
    const before = structuredClone(state)
    const result = buildScheduleSwap(state, payload(state))
    expect(result.assignments[0].shiftSnapshots[1]).toEqual(state.schedule[0].shiftSnapshots[1])
    expect(state).toEqual(before)
    state.attendance[0].shiftId = 'S1'; rejects(state, 'SCHEDULE_STARTED_IMMUTABLE')
  })
  it('keeps assigned snapshots even if the definition changed', () => {
    const state = fixture(); state.shiftDefinitions[1].start = '09:00'; state.shiftDefinitions[1].name = 'New name'
    expect(buildScheduleSwap(state, payload(state)).assignments[0].shiftSnapshots[0]).toEqual(state.schedule[1].shiftSnapshots[0])
  })
  it.each(['retired', 'deleted', 'missing', 'ambiguous', 'invalid'])('fails closed on %s timing', (kind) => {
    const state = fixture()
    if (kind === 'retired') state.shiftDefinitions[0].active = false
    if (kind === 'deleted') state.shiftDefinitions.splice(0, 1)
    if (kind === 'missing') state.schedule[0].shiftSnapshots = []
    if (kind === 'ambiguous') state.schedule[0].shiftSnapshots.push({ ...state.schedule[0].shiftSnapshots[0] })
    if (kind === 'invalid') state.schedule[0].shiftSnapshots[0].start = '25:00'
    rejects(state, ['retired', 'deleted'].includes(kind) ? 'SHIFT_INVALID' : 'SCHEDULE_SNAPSHOT_INVALID')
  })
  it.each(['inactive', 'locked', 'Đã nghỉ làm', 'unknown'])('rejects inactive employee %s', (status) => {
    const state = fixture(); state.employees[0].status = status; rejects(state, 'SCHEDULE_EMPLOYEE_INACTIVE')
  })
  it('recalculates support metadata for recipients and validates their windows', () => {
    const state = fixture(); state.employees[0].storeId = 'HOME'
    state.supportTransfers = [{ id: 'TR-A', employeeId: 'A', fromStoreId: 'HOME', toStoreId: 'STORE', fromDate: date, toDate: date, status: 'Đã duyệt' }]
    state.schedule[0].shiftSnapshots[0].supportTransferId = 'TR-A'
    const result = buildScheduleSwap(state, payload(state))
    expect(result.assignments[0].shiftSnapshots[0].supportTransferId).toBe('TR-A')
    expect(result.assignments[1].shiftSnapshots[0].supportTransferId).toBeUndefined()
    state.supportTransfers[0].endAt = `${date}T03:30:00Z`
    state.supportTransfers[0].startAt = `${date}T01:00:00Z`
    rejects(state, 'SUPPORT_SCHEDULE_OUTSIDE_WINDOW')
  })
  it('rejects stale assignment intent even with a refreshed global version', () => {
    const state = fixture(); const intent = payload(state)
    const result = buildScheduleSwap(state, intent)
    rejects({ ...state, schedule: result.schedule }, 'VERSION_CONFLICT', intent)
    state.schedule[0].updatedAt = 'changed'; rejects(state, 'VERSION_CONFLICT', intent)
  })
  it.each(['tasks', 'orders', 'workCatalogProgress'])('blocks direct %s lifecycle data', (collection) => {
    const state = fixture(); state[collection] = [{ employeeId: 'A', storeId: 'STORE', date, shiftId: 'S1' }]
    rejects(state, 'SCHEDULE_WORK_IMMUTABLE')
  })
  it('protects legacy task assignments with employeeIds and completedBy aliases', () => {
    const state = fixture()
    state.tasks = [{ storeId: 'STORE', date, shiftId: 'S1', employeeIds: ['alias-A'], completedBy: { 'CODE-A': true } }]
    rejects(state, 'SCHEDULE_WORK_IMMUTABLE')
  })
  it('rejects assignment IDs duplicated outside the requested scope without replacing unrelated rows', () => {
    const state = fixture(); state.schedule.push({ ...state.schedule[0], storeId: 'OTHER' })
    rejects(state, 'SCHEDULE_ASSIGNMENT_INVALID')
  })
  it('fails closed on alias collisions with a third employee', () => {
    const state = fixture(); state.employees[2].identifierAliases.push('alias-A')
    rejects(state, 'SCHEDULE_EMPLOYEE_INVALID')
  })
})
