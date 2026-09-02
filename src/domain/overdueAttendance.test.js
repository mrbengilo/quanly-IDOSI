import { describe, expect, it } from 'vitest'
import {
  isOverdueOpenAttendance,
  overdueAttendanceDate,
  overdueOpenAttendance,
} from './overdueAttendance'

describe('overdue open attendance', () => {
  it('marks a previous-day unclosed attendance as overdue after its scheduled end', () => {
    const record = {
      id: 'ATT-DAY', date: '2026-09-01', shiftStart: '08:00', shiftEnd: '17:00', checkIn: '08:00',
    }

    expect(isOverdueOpenAttendance(record, '2026-09-02T08:00:00+07:00')).toBe(true)
    expect(overdueAttendanceDate(record)).toBe('2026-09-01')
  })

  it('does not flag an overnight attendance before the scheduled next-day end', () => {
    const record = {
      id: 'ATT-NIGHT', workDate: '2026-09-01', shiftStart: '21:00', shiftEnd: '02:00', checkIn: '21:00',
    }

    expect(isOverdueOpenAttendance(record, '2026-09-02T01:30:00+07:00')).toBe(false)
    expect(isOverdueOpenAttendance(record, '2026-09-02T02:00:00+07:00')).toBe(true)
  })

  it('ignores current-day, closed, deleted, and future attendance', () => {
    const now = '2026-09-02T18:00:00+07:00'
    expect(isOverdueOpenAttendance({ date: '2026-09-02', checkIn: '08:00' }, now)).toBe(false)
    expect(isOverdueOpenAttendance({ date: '2026-09-01', checkIn: '08:00', checkOut: '17:00' }, now)).toBe(false)
    expect(isOverdueOpenAttendance({ date: '2026-09-01', checkIn: '08:00', deletedAt: now }, now)).toBe(false)
    expect(isOverdueOpenAttendance({ date: '2026-09-03', checkIn: '08:00' }, now)).toBe(false)
  })

  it('returns only overdue rows from the supplied role-scoped attendance list', () => {
    const rows = [
      { id: 'OLD-OPEN', date: '2026-09-01', checkIn: '08:00' },
      { id: 'OLD-CLOSED', date: '2026-09-01', checkIn: '08:00', checkOut: '17:00' },
      { id: 'TODAY-OPEN', date: '2026-09-02', checkIn: '08:00' },
    ]

    expect(overdueOpenAttendance(rows, '2026-09-02T08:00:00+07:00').map((row) => row.id)).toEqual(['OLD-OPEN'])
  })
})
