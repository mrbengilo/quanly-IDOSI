import { describe, expect, it } from 'vitest'
import {
  SUPPORT_SCHEDULE_PRESETS,
  canConfigureSupportSchedulePresets,
  normalizeSupportSchedulePresets,
  supportScheduleDays,
  supportSchedulePresetsEqual,
  shiftSupportScheduleAnchor,
  supportScheduleEmploymentMode,
  supportScheduleRange,
  supportSchedulesForView,
  validateSupportSchedulePresets,
} from './supportWorkSchedule'

describe('support work schedule', () => {
  it('provides the configured default quick-select work periods without removing custom schedules', () => {
    expect(SUPPORT_SCHEDULE_PRESETS).toEqual([
      { id: 'morning', name: 'Ca sáng', start: '08:30', end: '12:00' },
      { id: 'afternoon', name: 'Ca chiều', start: '13:00', end: '17:30' },
      { id: 'office-hours', name: 'Giờ hành chính', start: '08:30', end: '17:30' },
    ])
    expect(Object.isFrozen(SUPPORT_SCHEDULE_PRESETS)).toBe(true)
    expect(SUPPORT_SCHEDULE_PRESETS.every(Object.isFrozen)).toBe(true)
  })

  it('normalizes persisted presets in the fixed display order and falls back safely for invalid rows', () => {
    expect(normalizeSupportSchedulePresets([
      { id: 'office-hours', name: 'Tên không được tin cậy', start: '09:00', end: '18:00', version: 2 },
      { id: 'morning', start: '09:15', end: '12:15' },
      { id: 'afternoon', start: '18:00', end: '13:00' },
    ])).toEqual([
      { id: 'morning', name: 'Ca sáng', start: '09:15', end: '12:15' },
      { id: 'afternoon', name: 'Ca chiều', start: '13:00', end: '17:30' },
      { id: 'office-hours', name: 'Giờ hành chính', start: '09:00', end: '18:00', version: 2 },
    ])
  })

  it('validates all three periods and compares only their effective times', () => {
    const submitted = [
      { id: 'morning', name: 'Ca sáng', start: '08:45', end: '12:00' },
      { id: 'afternoon', name: 'Ca chiều', start: '13:15', end: '17:30' },
      { id: 'office-hours', name: 'Giờ hành chính', start: '08:45', end: '17:45' },
    ]
    expect(validateSupportSchedulePresets(submitted)).toEqual({ ok: true, presets: submitted })
    expect(validateSupportSchedulePresets(submitted.map((preset) => (
      preset.id === 'morning' ? { ...preset, end: '08:30' } : preset
    )))).toMatchObject({ ok: false })
    expect(validateSupportSchedulePresets(submitted.slice(0, 2))).toMatchObject({ ok: false })
    expect(supportSchedulePresetsEqual(submitted, submitted.map((preset) => ({ ...preset, version: 99 })))).toBe(true)
    expect(supportSchedulePresetsEqual(submitted, SUPPORT_SCHEDULE_PRESETS)).toBe(false)
  })

  it('authorizes Admin, HTKD and Office employees but blocks store accounts', () => {
    expect(canConfigureSupportSchedulePresets({ role: 'admin' })).toBe(true)
    expect(canConfigureSupportSchedulePresets({ role: 'business_support' })).toBe(true)
    expect(canConfigureSupportSchedulePresets({ role: 'employee', employee: { unit: 'office' } })).toBe(true)
    expect(canConfigureSupportSchedulePresets({ role: 'employee', employee: { department: 'Khối văn phòng' } })).toBe(true)
    expect(canConfigureSupportSchedulePresets({ role: 'employee', employee: { unit: 'store' } })).toBe(false)
    expect(canConfigureSupportSchedulePresets({ role: 'manager' })).toBe(true)
    expect(canConfigureSupportSchedulePresets({ role: 'store_manager' })).toBe(false)
  })

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
