import { describe, expect, it } from 'vitest'
import { scheduleConflict, scheduleWindows, scheduledCheckInChoices, supportForScheduledWindow, shiftWindow } from './supportScheduling'

const employee = { id: 'E1', storeId: 'A' }
const transfer = { id: 'T1', employeeId: 'E1', fromStoreId: 'A', toStoreId: 'B', startAt: '2026-09-07T08:00+07:00', endAt: '2026-09-07T17:00+07:00' }
const assignment = (id, storeId, start, end, date = '2026-09-07') => ({
  id, employeeId: 'E1', storeId, date, shiftIds: [id], shiftSnapshots: [{ id, start, end }],
})
const stateFor = (schedule) => ({ employees: [employee], supportTransfers: [transfer], schedule })

describe('shared support scheduling', () => {
  it.each([['08:00', '12:00'], ['10:00', '14:00'], ['09:00', '11:00']])('rejects overlapping %s–%s across stores', (start, end) => {
    const a = assignment('s1', 'A', '08:00', '12:00')
    const b = assignment('s2', 'B', start, end)
    expect(scheduleConflict(stateFor([a, b]), [b])?.code).toBe('SCHEDULE_TIME_OVERLAP')
    expect(scheduleConflict(stateFor([a, b]), [a])?.code).toBe('SCHEDULE_TIME_OVERLAP')
  })
  it('allows adjacent shifts and keeps home scheduling available inside a transfer window', () => {
    const a = assignment('s1', 'A', '08:00', '12:00')
    const b = assignment('s2', 'B', '12:00', '16:00')
    expect(scheduleConflict(stateFor([a, b]), [a, b])).toBeNull()
  })
  it('rejects partial support-window coverage and operationally stopped support', () => {
    const b = assignment('s2', 'B', '16:00', '18:00')
    expect(scheduleConflict(stateFor([b]), [b])?.code).toBe('SUPPORT_SCHEDULE_OUTSIDE_WINDOW')
    const state = stateFor([assignment('s2', 'B', '12:00', '16:00')])
    state.supportTransfers = [{ ...transfer, schedulingClosedAt: '2026-09-07T01:00:00Z' }]
    expect(supportForScheduledWindow(state, scheduleWindows(state)[0])).toBeNull()
  })
  it('rejects impossible calendar dates while accepting leap days', () => {
    expect(shiftWindow('2026-02-30', { start: '08:00', end: '12:00' })).toBeNull()
    expect(shiftWindow('2028-02-29', { start: '08:00', end: '12:00' })).not.toBeNull()
  })
  it('uses snapshots and checks overnight boundaries', () => {
    const a = assignment('s1', 'A', '22:00', '02:00')
    const b = assignment('s2', 'A', '01:00', '05:00', '2026-09-08')
    const state = { ...stateFor([a, b]), shiftDefinitions: [{ id: 's1', start: '12:00', end: '15:00' }] }
    expect(scheduleConflict(state, [b])?.code).toBe('SCHEDULE_TIME_OVERLAP')
    expect(shiftWindow('2026-09-07', a.shiftSnapshots[0]).endAt).toBe('2026-09-07T19:00:00.000Z')
  })
  it('requires a real assigned shift and excludes completed shifts', () => {
    expect(scheduledCheckInChoices(stateFor([]), 'E1', '2026-09-07T05:00:00Z', 120)).toEqual([])
    const b = assignment('s2', 'B', '12:00', '16:00')
    const state = stateFor([b])
    expect(scheduledCheckInChoices(state, 'E1', '2026-09-07T05:00:00Z', 120)).toHaveLength(1)
    state.attendance = [{ employeeId: 'e1', storeId: 'B', shiftId: 's2', date: b.date, checkOut: '13:00' }]
    expect(scheduledCheckInChoices(state, 'E1', '2026-09-07T06:00:00Z', 120)).toEqual([])
  })
  it('resolves a legacy name-only snapshot using the unique store definition', () => {
    const state = stateFor([{ ...assignment('s1', 'A', '08:00', '12:00'), shiftSnapshots: [{ id: 's1', name: 'Ca cũ' }] }])
    state.shiftDefinitions = [{ id: 's1', storeId: 'A', start: '08:00', end: '12:00' }]
    expect(scheduleWindows(state)[0]).toMatchObject({ invalid: false, start: '08:00', end: '12:00', shift: { name: 'Ca cũ' } })
  })
  it('honors the configured early allowance but never starts support outside its grant', () => {
    const state = stateFor([assignment('s2', 'B', '08:00', '12:00')])
    expect(scheduledCheckInChoices(state, 'E1', '2026-09-07T00:30:00Z', 120)).toEqual([])
    expect(scheduledCheckInChoices(state, 'E1', '2026-09-07T01:00:00Z', 120)).toHaveLength(1)
    expect(scheduledCheckInChoices(state, 'E1', '2026-09-07T05:00:00Z', 120)).toEqual([])
  })
})
