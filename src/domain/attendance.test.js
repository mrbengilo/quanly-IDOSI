import { describe, expect, it } from 'vitest'
import { ATTENDANCE_STATUS, classifyAttendanceArrival, resolveShiftCandidates } from './attendance'

describe('attendance rules', () => {
  it.each([
    ['06:59', '07:00', 10, ATTENDANCE_STATUS.EARLY, 0],
    ['07:00', '07:00', 10, ATTENDANCE_STATUS.ON_TIME, 0],
    ['07:10', '07:00', 10, ATTENDANCE_STATUS.ON_TIME, 0],
    ['07:11', '07:00', 10, ATTENDANCE_STATUS.LATE, 11],
  ])('classifies %s against %s with tolerance %s', (actualTime, shiftStart, toleranceMinutes, status, lateMinutes) => {
    expect(classifyAttendanceArrival({ actualTime, shiftStart, toleranceMinutes })).toMatchObject({ status, lateMinutes })
  })

  it('counts all minutes from shift start when late, not only minutes beyond tolerance', () => {
    const result = classifyAttendanceArrival({ actualTime: '08:17', shiftStart: '08:00', toleranceMinutes: 10 })
    expect(result.status).toBe('Đi trễ')
    expect(result.lateMinutes).toBe(17)
  })

  it('handles a shift start around midnight', () => {
    expect(classifyAttendanceArrival({ actualTime: '00:10', shiftStart: '23:00', toleranceMinutes: 5 })).toMatchObject({
      status: 'Đi trễ',
      lateMinutes: 70,
    })
    expect(classifyAttendanceArrival({ actualTime: '22:59', shiftStart: '23:00', toleranceMinutes: 5 }).status).toBe('Đi sớm')
  })

  const shifts = [
    { id: 'ca1', start: '07:00', end: '12:00' },
    { id: 'ca2', start: '12:00', end: '17:00' },
    { id: 'ca3', start: '17:00', end: '21:00' },
  ]

  it('offers the current and next shift when the next starts within 120 minutes', () => {
    const result = resolveShiftCandidates({ at: '15:30', shifts })
    expect(result.mode).toBe('current-or-next')
    expect(result.candidates.map((shift) => shift.id)).toEqual(['ca2', 'ca3'])
  })

  it('allows early confirmation at exactly 120 minutes but not at 121 minutes', () => {
    const allowed = resolveShiftCandidates({ at: '05:00', shifts, earlyWindowMinutes: 120 })
    expect(allowed.mode).toBe('confirm-single')
    expect(allowed.candidates[0].id).toBe('ca1')
    expect(allowed.requiresEarlyConfirmation).toBe(true)

    expect(resolveShiftCandidates({ at: '04:59', shifts, earlyWindowMinutes: 120 }).mode).toBe('none')
  })

  it('handles overnight shifts as currently in progress', () => {
    const result = resolveShiftCandidates({ at: '01:00', shifts: [{ id: 'night', start: '23:00', end: '02:00' }] })
    expect(result.mode).toBe('confirm-single')
    expect(result.currentShift.id).toBe('night')
  })

  it('keeps a dated overnight shift current after midnight on the following date', () => {
    const result = resolveShiftCandidates({
      at: '2026-08-24T01:00:00+07:00',
      workDate: '2026-08-24',
      shifts: [
        { id: 'night', date: '2026-08-23', start: '23:00', end: '02:00' },
        { id: 'next-night', date: '2026-08-24', start: '23:00', end: '02:00' },
      ],
    })
    expect(result.mode).toBe('confirm-single')
    expect(result.currentShift.id).toBe('night')
    expect(result.candidates.map((shift) => shift.id)).toEqual(['night'])
  })

  it('filters day-specific shift definitions without changing historical days', () => {
    const result = resolveShiftCandidates({
      at: '2026-08-14T07:00:00+07:00',
      workDate: '2026-08-14',
      shifts: [
        { id: 'old', date: '2026-08-13', start: '07:00', end: '12:00' },
        { id: 'today', date: '2026-08-14', start: '07:00', end: '12:00' },
      ],
    })
    expect(result.candidates.map((shift) => shift.id)).toEqual(['today'])
  })
})
