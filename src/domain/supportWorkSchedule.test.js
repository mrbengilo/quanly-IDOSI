import { describe, expect, it } from 'vitest'
import {
  supportScheduleEmploymentMode,
  supportScheduleRange,
  supportSchedulesForView,
} from './supportWorkSchedule'

describe('support work schedule', () => {
  it('uses named shifts for Part-Time and intern profiles', () => {
    expect(supportScheduleEmploymentMode({ employmentType: 'Part-Time' })).toBe('shift')
    expect(supportScheduleEmploymentMode({ employmentType: 'Thực Tập Sinh' })).toBe('shift')
    expect(supportScheduleEmploymentMode({ employmentType: 'Full-Time' })).toBe('fixed')
  })

  it('builds inclusive day, Monday-to-Sunday week, and month ranges', () => {
    expect(supportScheduleRange('2026-08-21', 'day')).toEqual({ start: '2026-08-21', end: '2026-08-21' })
    expect(supportScheduleRange('2026-08-21', 'week')).toEqual({ start: '2026-08-17', end: '2026-08-23' })
    expect(supportScheduleRange('2026-08-21', 'month')).toEqual({ start: '2026-08-01', end: '2026-08-31' })
  })

  it('returns only the selected employee and view range in chronological order', () => {
    const records = [
      { id: '3', employeeId: 'HTKD-01', date: '2026-08-23', start: '13:00' },
      { id: '1', employeeId: 'HTKD-01', date: '2026-08-17', start: '08:00' },
      { id: '2', employeeId: 'HTKD-02', date: '2026-08-21', start: '09:00' },
      { id: 'deleted', employeeId: 'HTKD-01', date: '2026-08-20', start: '08:00', deletedAt: '2026-08-21T00:00:00Z' },
      { id: 'outside', employeeId: 'HTKD-01', date: '2026-08-24', start: '08:00' },
    ]
    expect(supportSchedulesForView(records, {
      employeeId: 'HTKD-01', anchorDate: '2026-08-21', view: 'week',
    }).map(({ id }) => id)).toEqual(['1', '3'])
  })
})
