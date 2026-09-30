import { describe, expect, it } from 'vitest'
import { taskShiftContext, bindTaskShiftContext, mergeTaskShiftProgress, taskShiftChoices } from './taskShift'

const fixture = (checkIn = '16:48') => ({
  stores: [{ id: 'S1' }, { id: 'S2' }], employees: [{ id: 'E1', code: 'NV1' }, { id: 'E2' }],
  attendance: [{ id: 'A1', employeeId: 'NV1', storeId: 'S1', date: '2026-09-29', shiftId: 'ca3', checkIn }],
  shiftDefinitions: [
    { id: 'ca1', name: 'Ca Sáng', storeId: 'S1' },
    { id: 'ca2', name: 'Ca Chiều', storeId: 'S1' },
    { id: 'ca3', name: 'Ca Tối', storeId: 'S1' },
    { id: 'custom', name: 'Ca qua đêm', storeId: 'S1', start: '22:00', end: '06:00' },
  ],
  workCatalogItems: ['ca1', 'ca2', 'ca3', 'custom'].map((shiftId) => ({
    id: `CAT-${shiftId}`, code: `fixed.${shiftId}`, name: `Việc ${shiftId}`, targetGroup: 'store', kind: 'FIXED_TASK',
    storeId: 'S1', shiftId, amountVnd: 0, sortOrder: 1, active: true,
  })), tasks: [],
})
const context = (state, selectedTaskShiftId = 'ca3') => taskShiftContext({ state, attendance: state.attendance[0], employeeId: 'E1', selectedTaskShiftId })

describe('explicit task shift scope', () => {
  it.each(['11:59', '12:00', '16:48', '16:59', '17:00', '00:01'])('does not derive tasks or work date from check-in %s', (time) => {
    const state = fixture(time)
    const before = structuredClone(state)
    expect(context(state).tasks.map((task) => task.catalogItemId)).toEqual(['CAT-ca3'])
    expect(context(state).date).toBe('2026-09-29')
    expect(context(state, 'ca1').tasks.map((task) => task.catalogItemId)).toEqual(['CAT-ca1'])
    expect(state).toEqual(before)
  })
  it('requires a choice and rejects removed, foreign and colliding shifts', () => {
    const state = fixture()
    expect(context(state, '').error).toMatch(/Vui lòng chọn ca/)
    expect(context(state, 'absent').error).toBeTruthy()
    state.shiftDefinitions.push({ id: 'other', storeId: 'S2' }, { id: 'CA3', storeId: 'S1' })
    expect(context(state, 'other').error).toBeTruthy()
    expect(context(state, 'ca3').error).toMatch(/trùng/)
    state.shiftDefinitions[0].deletedAt = '2026-09-29'
    expect(context(state, 'ca1').error).toBeTruthy()
  })
  it('supports exact custom and unique aliases without expanding into another shift', () => {
    const state = fixture()
    expect(context(state, 'CA3').shift.id).toBe('ca3')
    expect(context(state, 'custom').tasks.map((task) => task.catalogItemId)).toEqual(['CAT-custom'])
  })
  it('isolates employee, store, day, attendance and rewards', () => {
    const state = fixture()
    const row = { id: 'assigned', employeeIds: ['E1'], storeId: 'S1', date: '2026-09-29', shiftId: 'ca3' }
    state.tasks = [row, { ...row, id: 'wrong-employee', employeeIds: ['E2'] },
      { ...row, id: 'wrong-store', storeId: 'S2' }, { ...row, id: 'wrong-date', date: '2026-09-30' },
      { ...row, id: 'wrong-attendance', checklistAttendanceId: 'A2' },
      { ...row, id: 'reward', catalogKind: 'REWARD_TASK', completedBy: { E1: true } }]
    expect(context(state).tasks.map((task) => task.id)).toEqual(['assigned', expect.stringContaining('CAT-ca3')])
  })
  it('preserves legacy task identity and maps its captured catalog shift instead of attendance time', () => {
    const state = fixture()
    state.tasks = [{ id: 'legacy', catalogItemId: 'CAT-ca2', catalogSnapshot: { shiftId: 'ca2' },
      employeeIds: ['E1'], storeId: 'S1', date: '2026-09-29', shiftId: 'ca3', checklistAttendanceId: 'A1', completedBy: { E1: true } }]
    expect(context(state, 'ca2').tasks).toEqual(state.tasks)
    expect(context(state).tasks.some((task) => task.id === 'legacy')).toBe(false)
  })
  it('seals only saved tasks while preserving snapshots and all previously bound obligations', () => {
    const state = fixture()
    state.attendance[0].checklistSnapshot = { tasks: [{ id: 'legacy' }] }
    const night = context(state)
    const morning = context(state, 'ca1')
    let attendance = bindTaskShiftContext(state.attendance[0], night)
    attendance = bindTaskShiftContext(attendance, morning)
    expect(attendance.checklistSnapshot).toEqual(state.attendance[0].checklistSnapshot)
    expect(attendance.taskShiftContexts).toHaveLength(2)
    state.attendance = [attendance]
    state.tasks = [...night.tasks, ...morning.tasks]
    state.workCatalogItems = []
    expect(context(state).tasks).toEqual(night.tasks)
    state.tasks = []
    expect(context(state).code).toBe('TASK_CONTEXT_CHANGED')
  })
  it('keeps incomplete reasons scoped without losing other saved obligations', () => {
    const attendance = { taskProgress: { incompleteTaskIds: ['old', 'shared'], incompleteReason: 'Lý do ca cũ' } }
    expect(mergeTaskShiftProgress(attendance, { incompleteTaskIds: ['new'], incompleteReason: 'Lý do ca mới' }, ['shared', 'new']))
      .toMatchObject({ incompleteTaskIds: ['old', 'new'], incompleteReason: 'Lý do ca cũ\nLý do ca mới' })
  })
  it('offers immutable support shift metadata without inferring from its check-in', () => {
    const state = fixture()
    state.attendance[0] = { ...state.attendance[0], shiftId: 'SUPPORT_1', supportTransferId: 'TR1', shiftName: 'Ca hỗ trợ', shiftStart: '22:00', shiftEnd: '06:00' }
    expect(taskShiftChoices(state, 'S1')).toContainEqual(expect.objectContaining({ id: 'SUPPORT_1', start: '22:00', end: '06:00' }))
  })
  it('rejects generated ids occupied by foreign or retired records', () => {
    const state = fixture()
    const generated = context(state).tasks[0]
    state.tasks = [{ ...generated, employeeId: 'E2', employeeIds: ['E2'] }]
    expect(context(state).code).toBe('TASK_IDENTIFIER_COLLISION')
    state.tasks = [{ ...generated, deletedAt: '2026-09-29' }]
    expect(context(state).code).toBe('TASK_IDENTIFIER_COLLISION')
  })

})
