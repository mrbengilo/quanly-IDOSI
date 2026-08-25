import { describe, expect, it } from 'vitest'
import {
  supportScheduleDays,
  shiftSupportScheduleAnchor,
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

  it('builds inclusive day, selected seven-day week, and month ranges', () => {
    expect(supportScheduleRange('2026-08-21', 'day')).toEqual({ start: '2026-08-21', end: '2026-08-21' })
    expect(supportScheduleRange('2026-08-21', 'week')).toEqual({ start: '2026-08-21', end: '2026-08-27' })
    expect(supportScheduleRange('2026-08-21', 'month')).toEqual({ start: '2026-08-01', end: '2026-08-31' })
    expect(supportScheduleDays('2026-08-21', 'day')).toEqual(['2026-08-21'])
    expect(supportScheduleDays('2026-08-21', 'week')).toEqual([
      '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24',
      '2026-08-25', '2026-08-26', '2026-08-27',
    ])
    expect(supportScheduleDays('2026-02-14', 'month')).toHaveLength(28)
    expect(supportScheduleDays('2028-02-14', 'month')).toHaveLength(29)
    expect(shiftSupportScheduleAnchor('2026-01-31', 'month', 1)).toBe('2026-02-28')
    expect(shiftSupportScheduleAnchor('2026-08-21', 'week', -1)).toBe('2026-08-14')
  })

  it('returns only the selected employee and view range in chronological order', () => {
    const records = [
      { id: '3', employeeId: 'HTKD-01', date: '2026-08-23', start: '13:00' },
      { id: '1', employeeId: 'HTKD-01', date: '2026-08-21', start: '08:00' },
      { id: '2', employeeId: 'HTKD-02', date: '2026-08-21', start: '09:00' },
      { id: 'deleted', employeeId: 'HTKD-01', date: '2026-08-20', start: '08:00', deletedAt: '2026-08-21T00:00:00Z' },
      { id: 'outside', employeeId: 'HTKD-01', date: '2026-08-28', start: '08:00' },
    ]
    expect(supportSchedulesForView(records, {
      employeeId: 'HTKD-01', anchorDate: '2026-08-21', view: 'week',
    }).map(({ id }) => id)).toEqual(['1', '3'])
  })

  it('filters the aggregate by target unit without mixing Office and Business Support rows', () => {
    const records = [
      { id: 'support', employeeId: 'HTKD-01', targetUnit: 'business_support', date: '2026-08-21', start: '08:00' },
      { id: 'office', employeeId: 'VP-01', targetUnit: 'office', date: '2026-08-21', start: '08:30' },
      { id: 'legacy-other', employeeId: 'HTKD-02', date: '2026-08-21', start: '09:00' },
      { id: 'invalid-date', employeeId: 'VP-02', targetUnit: 'office', date: '2026-02-30', start: '09:00' },
    ]

    expect(supportSchedulesForView(records, {
      targetUnit: 'office', anchorDate: '2026-08-21', view: 'day',
    }).map(({ id }) => id)).toEqual(['office'])
    expect(supportSchedulesForView(records, {
      targetUnit: 'business_support', anchorDate: '2026-08-21', view: 'day',
    }).map(({ id }) => id)).toEqual(['support'])
  })
})
