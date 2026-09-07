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
  it('rejects overlapping support shifts across two destination stores, including folded identifiers', () => {
    const b = assignment('s2', 'B', '08:00', '12:00')
    const c = { ...assignment('s3', 'C', '10:00', '14:00'), employeeId: 'e1' }
    const state = {
      employees: [employee],
      supportTransfers: [
        transfer,
        { ...transfer, id: 'T2', toStoreId: 'C' },
      ],
      schedule: [b, c],
    }
    expect(scheduleConflict(state, [c])?.code).toBe('SCHEDULE_TIME_OVERLAP')
  })
  it('uses the whole inclusive Vietnam calendar day for date-only transfer grants', () => {
    const late = assignment('s2', 'B', '20:00', '23:30')
    const state = {
      employees: [employee],
      supportTransfers: [{
        id: 'T-DATE', employeeId: 'E1', fromStoreId: 'A', toStoreId: 'B',
        fromDate: '2026-09-07', toDate: '2026-09-07', status: 'Đã duyệt',
      }],
      schedule: [late],
    }
    expect(scheduleConflict(state, [late])).toBeNull()
    expect(scheduledCheckInChoices(state, 'E1', '2026-09-07T13:00:00Z', 0)).toHaveLength(1)
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
  it('canonicalizes a unique employee id/code alias for legacy support schedules and attendance', () => {
    const legacyAssignment = {
      id: 'legacy-support', employee_code: 'DT-003', storeId: 'B', date: '2026-09-08',
      shiftIds: ['support-am'], shiftSnapshots: [{ id: 'support-am', start: '08:00', end: '12:00' }],
    }
    const aliasState = {
      employees: [{ id: 'emp-uuid', code: 'DT-003', storeId: 'A' }],
      supportTransfers: [{
        id: 'alias-transfer', employeeId: 'emp-uuid', fromStoreId: 'A', toStoreId: 'B',
        fromDate: '2026-09-08', toDate: '2026-09-08', status: 'Đã duyệt',
      }],
      schedule: [legacyAssignment],
      attendance: [],
    }

    expect(scheduleConflict(aliasState, [legacyAssignment])).toBeNull()
    expect(scheduledCheckInChoices(aliasState, 'emp-uuid', '2026-09-08T02:00:00.000Z', 120)).toHaveLength(1)

    aliasState.attendance = [{
      id: 'canonical-attendance', employeeId: 'emp-uuid', storeId: 'B',
      shiftId: 'support-am', date: '2026-09-08', checkOut: '12:00',
    }]
    expect(scheduledCheckInChoices(aliasState, 'emp-uuid', '2026-09-08T02:00:00.000Z', 120)).toEqual([])
  })
  it('detects overlap when one schedule uses the employee id and another uses its legacy code', () => {
    const home = {
      id: 'home-by-id', employeeId: 'emp-uuid', storeId: 'A', date: '2026-09-08',
      shiftIds: ['home-am'], shiftSnapshots: [{ id: 'home-am', start: '08:00', end: '12:00' }],
    }
    const host = {
      id: 'host-by-code', employeeId: 'DT-003', storeId: 'B', date: '2026-09-08',
      shiftIds: ['host-am'], shiftSnapshots: [{ id: 'host-am', start: '10:00', end: '14:00' }],
    }
    const aliasState = {
      employees: [{ id: 'emp-uuid', code: 'DT-003', storeId: 'A' }],
      supportTransfers: [{
        id: 'alias-transfer', employeeId: 'emp-uuid', fromStoreId: 'A', toStoreId: 'B',
        fromDate: '2026-09-08', toDate: '2026-09-08', status: 'Đã duyệt',
      }],
      schedule: [home, host],
    }

    expect(scheduleConflict(aliasState, [host])?.code).toBe('SCHEDULE_TIME_OVERLAP')
  })
  it.each([
    { status: 'ĐÃ HỦY' },
    { status: ' cancelled ' },
    { status: 'VoIdEd' },
    { canceledAt: '2026-09-07T00:00:00.000Z' },
  ])('excludes cancelled schedule variants from every derived window: %j', (cancelled) => {
    const record = { ...assignment('cancelled', 'A', '08:00', '12:00'), ...cancelled }
    expect(scheduleWindows(stateFor([record]))).toEqual([])
    expect(scheduledCheckInChoices(stateFor([record]), 'E1', '2026-09-07T01:00:00Z')).toEqual([])
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
