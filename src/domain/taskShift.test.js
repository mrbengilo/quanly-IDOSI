import { describe, expect, it } from 'vitest'
import { taskShiftContext, bindTaskShiftContext, mergeTaskShiftProgress, taskShiftChoices, taskShiftSlots, selectAttendanceTaskShift, attendanceTaskShiftLock, taskIsAttendanceShiftObligation, taskProgressForObligations, taskShiftLockedTaskIds } from './taskShift'

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
  it('offers every independent SM TNV-shaped shift explicitly instead of treating 3/4/3 valid choices as conflicts', () => {
    const state = fixture()
    state.shiftDefinitions = [
      ['am-0830', 'Ca sáng', '08:30', '12:00'], ['am-0800', 'Ca sáng', '08:00', '12:00'], ['am-0930', 'Ca sáng', '09:30', '13:00'],
      ['pm-1400', 'Ca chiều', '14:00', '21:00'], ['pm-1200', 'Ca chiều', '12:00', '18:00'], ['pm-0930', 'Ca chiều', '09:30', '17:30'], ['pm-1330', 'Ca chiều', '13:30', '18:00'],
      ['night-1900', 'Ca tối', '19:00', '21:00'], ['night-1700', 'Ca tối', '17:00', '21:00'], ['night-1800', 'Ca tối', '18:00', '21:00'],
    ].map(([id, name, start, end]) => ({ id, name, start, end, storeId: 'S1', date: null, active: true }))
    const before = structuredClone(state)
    const slots = taskShiftSlots(state, 'S1', '2026-09-29', state.attendance[0])
    expect(slots.map((slot) => [slot.status, slot.shift, slot.choices.length])).toEqual([
      ['multiple', null, 3], ['multiple', null, 4], ['multiple', null, 3],
    ])
    expect(taskShiftSlots({ ...state, shiftDefinitions: [...state.shiftDefinitions].reverse() }, 'S1', '2026-09-29')).toEqual(slots)
    for (const slot of slots) for (const shift of slot.choices) {
      const selected = selectAttendanceTaskShift({ state, attendance: state.attendance[0], employeeId: 'E1', selectedTaskShiftId: shift.id, now: 'x' })
      expect(selected.error).toBeUndefined()
      expect(selected.attendance.taskShiftSelection).toMatchObject({ shiftId: shift.id, slot: slot.key })
      expect(selected.context.tasks.map((task) => task.catalogItemId)).toEqual([`CAT-${{ morning: 'ca1', afternoon: 'ca2', night: 'ca3' }[slot.key]}`])
    }
    expect(state).toEqual(before)
  })
  it('collapses repeated copies of the same configured entity before resolving all three slots and context', () => {
    const state = fixture()
    state.shiftDefinitions.push(...structuredClone(state.shiftDefinitions))
    const before = structuredClone(state)
    for (const definitions of [state.shiftDefinitions, [...state.shiftDefinitions].reverse()]) {
      const input = { ...state, shiftDefinitions: definitions }
      expect(taskShiftSlots(input, 'S1', '2026-09-29').map((slot) => slot.status)).toEqual(['ready', 'ready', 'ready'])
      expect(context(input, 'ca2').tasks.map((task) => task.catalogItemId)).toEqual(['CAT-ca2'])
      expect(selectAttendanceTaskShift({ state: input, attendance: input.attendance[0], employeeId: 'E1', selectedTaskShiftId: 'ca2', now: 'x' }).error).toBeUndefined()
    }
    expect(state).toEqual(before)
  })
  it('does not collapse contradictory versions of one identity or independent ids with equal names and hours', () => {
    const state = fixture()
    state.shiftDefinitions.push({ ...state.shiftDefinitions[0], start: '09:00' })
    expect(taskShiftSlots(state, 'S1', '2026-09-29').map((slot) => slot.status)).toEqual(['ambiguous', 'ready', 'ready'])
    expect(context(state, 'ca1').error).toBeTruthy()
    state.shiftDefinitions[4] = { ...state.shiftDefinitions[0], id: 'independent' }
    expect(taskShiftSlots(state, 'S1', '2026-09-29')[0].status).toBe('ambiguous')
  })
  it('detects conflicting identity even across different slots and ignores JSON key order for identical copies', () => {
    const state = fixture()
    const original = state.shiftDefinitions[0]
    state.shiftDefinitions.push(Object.fromEntries(Object.entries(original).reverse()))
    expect(taskShiftSlots(state, 'S1', '2026-09-29')[0].status).toBe('ready')
    state.shiftDefinitions.push({ id: 'custom', name: 'Ca linh hoạt', start: '09:00', end: '11:00', storeId: 'S1', date: '2026-09-29' })
    expect(taskShiftSlots(state, 'S1', '2026-09-29')[0].status).toBe('ambiguous')
  })
  it('filters production-shaped UUID definitions by store, business date and lifecycle without inventing alias choices', () => {
    const state = fixture()
    state.workCatalogItems = state.workCatalogItems.filter((item) => item.shiftId !== 'custom')
    state.shiftDefinitions = state.shiftDefinitions.slice(0, 3).map((shift, i) => ({ ...shift, id: `shift-uuid-${i}` }))
    const valid = structuredClone(state.shiftDefinitions)
    state.shiftDefinitions.push(...valid.map((shift) => ({ ...shift, id: `deleted-${shift.id}`, deletedAt: '2026-08-24', active: false })),
      ...valid.map((shift) => ({ ...shift, id: `past-${shift.id}`, date: '2026-08-23' })),
      ...valid.map((shift) => ({ ...shift, id: `future-${shift.id}`, date: '2026-12-08' })),
      ...valid.map((shift) => ({ ...shift, id: `foreign-${shift.id}`, storeId: 'S2' })),
      ...valid.map((shift) => ({ ...shift, id: `inactive-${shift.id}`, active: false })))
    expect(taskShiftChoices(state, 'S1', '2026-09-29')).toEqual(valid)
    expect(taskShiftSlots(state, 'S1', '2026-09-29').map((slot) => slot.status)).toEqual(['ready', 'ready', 'ready'])
    expect(context(state, 'shift-uuid-2').tasks.map((task) => task.catalogItemId)).toEqual(['CAT-ca3'])
  })
  it('does not offer another employee support attendance in either server or employee projection', () => {
    const state = fixture()
    state.shiftDefinitions = []
    state.workCatalogItems = []
    const support = { id: 'A2', employeeId: 'E2', storeId: 'S1', date: '2026-09-29', supportTransferId: 'TR2', shiftId: 'SUPPORT_2', shiftName: 'Ca Sáng', shiftStart: '08:00', shiftEnd: '12:00' }
    state.attendance.push(support)
    expect(taskShiftSlots(state, 'S1', '2026-09-29', state.attendance[0]).map((slot) => slot.status)).toEqual(['missing', 'missing', 'missing'])
    expect(context(state, 'SUPPORT_2').error).toBeTruthy()
    const own = { ...support, id: 'A1', employeeId: 'E1' }
    state.attendance = [own, support]
    expect(taskShiftSlots(state, 'S1', '2026-09-29', own)[0]).toMatchObject({ status: 'ready', shift: { id: 'SUPPORT_2' } })
    expect(context(state, 'SUPPORT_2').error).toBeUndefined()
  })
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
  it('excludes shifts configured for another business date and rejects their direct selection', () => {
    const state = fixture('00:01')
    state.shiftDefinitions[2].date = '2026-09-30'
    expect(taskShiftChoices(state, 'S1', '2026-09-29').map((shift) => shift.id)).not.toContain('ca3')
    expect(context(state, 'ca3').code).toBe('TASK_SHIFT_INVALID')
    state.shiftDefinitions[2].date = '2026-09-29'
    expect(context(state, 'ca3').tasks.map((task) => task.catalogItemId)).toEqual(['CAT-ca3'])
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
  it('reuses legacy canonical catalog rows when configuration uses UUID shift ids', () => {
    const state = fixture()
    state.shiftDefinitions[1].id = 'shift-afternoon-uuid'
    state.shiftDefinitions[2].id = 'shift-night-uuid'
    expect(taskShiftChoices(state, 'S1', '2026-09-29').map((shift) => shift.id)).not.toContain('ca2')
    expect(taskShiftChoices(state, 'S1', '2026-09-29').map((shift) => shift.id)).not.toContain('ca3')
    state.tasks = [{ id: 'legacy', catalogItemId: 'CAT-ca2', catalogSnapshot: { shiftId: 'ca2' },
      employeeIds: ['E1'], storeId: 'S1', date: '2026-09-29', shiftId: 'shift-night-uuid', checklistAttendanceId: 'A1', completedBy: { E1: true } }]
    expect(context(state, 'shift-afternoon-uuid').tasks).toEqual(state.tasks)
    expect(context(state, 'shift-night-uuid').tasks.some((task) => task.id === 'legacy')).toBe(false)
    state.tasks.push({ id: 'different-configured-shift', employeeIds: ['E1'], storeId: 'S1', date: '2026-09-29', shiftId: 'another-afternoon' })
    state.shiftDefinitions.push({ id: 'another-afternoon', name: 'Ca Chiều', storeId: 'S1' })
    expect(context(state, 'shift-afternoon-uuid').tasks.map((task) => task.id)).toEqual(['legacy'])
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
  it('includes later manager assignments without regenerating a saved catalog snapshot', () => {
    const state = fixture()
    const night = context(state)
    state.attendance[0] = bindTaskShiftContext(state.attendance[0], night)
    const later = { id: 'later', employeeIds: ['E1'], storeId: 'S1', date: '2026-09-29', shiftId: 'ca3' }
    state.tasks = [...night.tasks, later]
    state.workCatalogItems.push({ ...state.workCatalogItems[2], id: 'new-catalog' })
    expect(context(state).tasks).toEqual([...night.tasks, later])
    state.tasks = [later]
    expect(context(state).code).toBe('TASK_CONTEXT_CHANGED')
  })
  it('offers immutable support shift metadata without inferring from its check-in', () => {
    const state = fixture()
    state.attendance[0] = { ...state.attendance[0], shiftId: 'SUPPORT_1', supportTransferId: 'TR1', shiftName: 'Ca hỗ trợ', shiftStart: '22:00', shiftEnd: '06:00' }
    expect(taskShiftChoices(state, 'S1', '2026-09-29', state.attendance[0])).toContainEqual(expect.objectContaining({ id: 'SUPPORT_1', start: '22:00', end: '06:00' }))
  })
  it('rejects generated ids occupied by foreign or retired records', () => {
    const state = fixture()
    const generated = context(state).tasks[0]
    state.tasks = [{ ...generated, employeeId: 'E2', employeeIds: ['E2'] }]
    expect(context(state).code).toBe('TASK_IDENTIFIER_COLLISION')
    state.tasks = [{ ...generated, deletedAt: '2026-09-29' }]
    expect(context(state).code).toBe('TASK_IDENTIFIER_COLLISION')
  })

  it('maps three slots to configured shifts with specificity and disables missing or ambiguous ones', () => {
    const state = fixture()
    expect(taskShiftSlots(state, 'S1', '2026-09-29').map((slot) => [slot.key, slot.status, slot.shift?.id])).toEqual([
      ['morning', 'ready', 'ca1'], ['afternoon', 'ready', 'ca2'], ['night', 'ready', 'ca3'],
    ])
    // Generic (store-less) definitions lose to the store's own; date-specific wins on its date only.
    state.shiftDefinitions.push({ id: 'global-am', name: 'Ca Sáng' }, { id: 'pm-29', storeId: 'S1', date: '2026-09-29', name: 'Ca Chiều' })
    expect(taskShiftSlots(state, 'S1', '2026-09-29').map((slot) => slot.shift?.id)).toEqual(['ca1', 'pm-29', 'ca3'])
    expect(taskShiftSlots(state, 'S1', '2026-09-30').map((slot) => slot.shift?.id)).toEqual(['ca1', 'ca2', 'ca3'])
    state.shiftDefinitions.push({ id: 'night-2', storeId: 'S1', name: 'Ca Tối' })
    expect(taskShiftSlots(state, 'S1', '2026-09-29')[2]).toMatchObject({ status: 'ambiguous', shift: null })
    state.shiftDefinitions = state.shiftDefinitions.filter((shift) => !['ca1', 'global-am'].includes(shift.id))
    state.workCatalogItems = state.workCatalogItems.filter((item) => item.shiftId !== 'ca1')
    expect(taskShiftSlots(state, 'S1', '2026-09-29')[0]).toMatchObject({ status: 'missing', shift: null })
  })
  it('selects one shift per attendance without completing work or touching the payroll shift', () => {
    const state = fixture()
    const attendance = state.attendance[0]
    const before = structuredClone(state)
    expect(attendanceTaskShiftLock(attendance).status).toBe('none')
    const result = selectAttendanceTaskShift({ state, attendance, employeeId: 'E1', selectedTaskShiftId: 'ca2', now: '2026-09-29T10:00:00.000Z' })
    expect(state).toEqual(before)
    expect(result.existing).toBe(false)
    expect(result.attendance).toMatchObject({ shiftId: 'ca3', taskShiftSelection: { shiftId: 'ca2', slot: 'afternoon', attendanceId: 'A1' },
      taskShiftContexts: [{ shiftId: 'ca2', taskIds: [result.newTasks[0].id] }] })
    expect(result.newTasks.map((task) => [task.catalogItemId, task.completedBy])).toEqual([['CAT-ca2', {}]])
    const locked = { ...state, attendance: [result.attendance], tasks: result.newTasks }
    const lock = attendanceTaskShiftLock(result.attendance)
    expect(lock).toMatchObject({ status: 'selected', shiftId: 'ca2', legacy: false })
    expect(selectAttendanceTaskShift({ state: locked, attendance: result.attendance, employeeId: 'E1', selectedTaskShiftId: 'CA2', now: 'x' }).existing).toBe(true)
    expect(selectAttendanceTaskShift({ state: locked, attendance: result.attendance, employeeId: 'E1', selectedTaskShiftId: 'ca3', now: 'x' }).code).toBe('TASK_SHIFT_ALREADY_SELECTED')
    expect(selectAttendanceTaskShift({ state, attendance: { ...attendance, checkOutAt: 'x' }, employeeId: 'E1', selectedTaskShiftId: 'ca2', now: 'x' }).code).toBe('OPEN_ATTENDANCE_REQUIRED')
    expect(selectAttendanceTaskShift({ state, attendance, employeeId: 'E2', selectedTaskShiftId: 'ca2', now: 'x' }).code).toBe('TASK_SCOPE_FORBIDDEN')
    // A configured non-slot shift (overnight custom) is valid config but not one of the three buttons.
    expect(selectAttendanceTaskShift({ state, attendance, employeeId: 'E1', selectedTaskShiftId: 'custom', now: 'x' }).code).toBe('TASK_SHIFT_INVALID')
  })
  it('treats one legacy context as the lock and keeps several legacy contexts as fixed obligations', () => {
    const single = { id: 'A', taskShiftContexts: [{ shiftId: 'ca2', taskIds: ['t2'] }] }
    const multi = { id: 'A', taskShiftContexts: [{ shiftId: 'ca2', taskIds: ['t2'] }, { shiftId: 'ca3', taskIds: ['t3'] }] }
    expect(attendanceTaskShiftLock(single)).toMatchObject({ status: 'selected', shiftId: 'ca2', legacy: true })
    expect(attendanceTaskShiftLock(multi)).toMatchObject({ status: 'legacy-multi', shiftIds: ['ca2', 'ca3'] })
    const state = fixture()
    const legacy = { ...state.attendance[0], ...multi, id: 'A1' }
    expect(selectAttendanceTaskShift({ state, attendance: legacy, employeeId: 'E1', selectedTaskShiftId: 'ca2', now: 'x' }).code).toBe('TASK_SHIFT_LEGACY_MULTI_CONTEXT')
    state.tasks = [{ id: 't2', storeId: 'S1', date: '2026-09-29', shiftId: 'ca2', employeeIds: ['E1'], required: true, completedBy: {} }]
    const adopted = selectAttendanceTaskShift({ state, attendance: { ...legacy, taskShiftContexts: single.taskShiftContexts }, employeeId: 'E1', selectedTaskShiftId: 'ca2', now: 'x' })
    expect(adopted.attendance.taskShiftContexts).toEqual(single.taskShiftContexts)
    expect(adopted.attendance.taskShiftSelection).toMatchObject({ shiftId: 'ca2', legacyContext: true })
  })
  it('owes the locked shift instead of an unselected check-in snapshot and keeps the old rule otherwise', () => {
    const snapshotTask = { id: 'snap', shiftId: 'ca3' }
    const lockedTask = { id: 'locked', shiftId: 'ca2' }
    const shiftless = { id: 'free' }
    const unlocked = { id: 'A1', shiftId: 'ca3', checklistSnapshot: { tasks: [{ id: 'snap' }] } }
    const matchesAttendanceShift = (id) => id === 'ca3'
    expect([snapshotTask, lockedTask, shiftless].map((task) => taskIsAttendanceShiftObligation({ task, attendance: unlocked, matchesAttendanceShift }))).toEqual([true, false, true])
    const locked = { ...unlocked, taskShiftSelection: { shiftId: 'ca2' }, taskShiftContexts: [{ shiftId: 'ca2', taskIds: ['locked'] }] }
    expect([snapshotTask, lockedTask, shiftless].map((task) => taskIsAttendanceShiftObligation({ task, attendance: locked, matchesAttendanceShift, lockedTaskIds: new Set(['free']) }))).toEqual([false, true, true])
    expect(taskProgressForObligations({ incompleteTaskIds: ['snap', 'locked'], incompleteReason: 'x' }, ['locked']).incompleteTaskIds).toEqual(['locked'])
  })
  it('lists the locked shift tasks including later explicit and shift-less assignments', () => {
    const state = fixture()
    const result = selectAttendanceTaskShift({ state, attendance: state.attendance[0], employeeId: 'E1', selectedTaskShiftId: 'ca2', now: 'x' })
    const later = { id: 'later', storeId: 'S1', date: '2026-09-29', shiftId: 'ca2', employeeIds: ['E1'], required: true }
    const free = { id: 'free', storeId: 'S1', date: '2026-09-29', employeeIds: ['E1'], required: true }
    const other = { id: 'other', storeId: 'S1', date: '2026-09-29', shiftId: 'ca1', employeeIds: ['E1'], required: true }
    const next = { ...state, attendance: [result.attendance], tasks: [...result.newTasks, later, free, other] }
    expect([...taskShiftLockedTaskIds({ state: next, attendance: result.attendance, employeeId: 'E1' })].toSorted())
      .toEqual([result.newTasks[0].id, 'free', 'later'].toSorted())
  })

  it('reuses a catalog row already captured for the attendance instead of generating a duplicate checklist', () => {
    const state = fixture()
    // Legacy check-in captured the afternoon item under the attendance shift id.
    state.tasks = [{ id: 'A1_CAT-ca2', checklistAttendanceId: 'A1', catalogItemId: 'CAT-ca2', catalogKind: 'FIXED_TASK',
      catalogSnapshot: { shiftId: 'ca3' }, storeId: 'S1', employeeIds: ['E1'], date: '2026-09-29', shiftId: 'ca3', required: true, completedBy: {} }]
    const selected = selectAttendanceTaskShift({ state, attendance: state.attendance[0], employeeId: 'E1', selectedTaskShiftId: 'ca2', now: 'x' })
    expect(selected.context.tasks.map((task) => task.id)).toEqual(['A1_CAT-ca2'])
    expect(selected.newTasks).toEqual([])
    expect(selected.attendance.taskShiftContexts).toEqual([{ shiftId: 'ca2', shiftName: 'Ca Chiều', taskIds: ['A1_CAT-ca2'] }])
  })
  it('places a custom configured shift by its configured start below canonical matches', () => {
    const state = fixture()
    state.shiftDefinitions.push({ id: 'flex', storeId: 'S1', name: 'Ca linh hoạt', start: '13:30', end: '20:00' })
    expect(taskShiftSlots(state, 'S1', '2026-09-29')[1].shift.id).toBe('ca2')
    state.shiftDefinitions = state.shiftDefinitions.filter((shift) => shift.id !== 'ca2')
    state.workCatalogItems = state.workCatalogItems.filter((item) => item.shiftId !== 'ca2')
    expect(taskShiftSlots(state, 'S1', '2026-09-29')[1].shift.id).toBe('flex')
  })

})
