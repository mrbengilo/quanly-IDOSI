import { describe, expect, it } from 'vitest'
import {
  attendanceDailyShift,
  reconcileAttendanceShiftId,
  resolveAttendanceShiftSelection,
  resolveAttendanceWorkingTime,
} from './attendanceWorkingTime'

const profile = {
  id: 'HTKD-001',
  employmentType: 'Full-Time',
  workStart: '08:00',
  workEnd: '17:30',
  workShifts: [{ id: 'full_time', name: 'Giờ hành chính', start: '08:00', end: '17:30' }],
  workTimeSchedule: [{
    effectiveFrom: '2026-08-23',
    workStart: '08:30',
    workEnd: '17:00',
    workShifts: [{ id: 'profile_new', name: 'Giờ mới', start: '08:30', end: '17:00' }],
  }],
}

describe('canonical attendance working time', () => {
  it('prioritizes the exact employee daily schedule and emits the backend-compatible shift id', () => {
    const resolved = resolveAttendanceWorkingTime(profile, '2026-08-24', [
      { id: 'sws/daily 01', employeeId: profile.id, date: '2026-08-24', shiftName: 'Ca hôm nay', start: '8:30', end: '17:00', version: 3 },
    ])

    expect(resolved).toMatchObject({
      workStart: '08:30',
      workEnd: '17:00',
      attendanceScheduleId: 'sws/daily 01',
      attendanceWorkingTimeSource: 'support-daily-schedule',
      workShifts: [{
        id: 'sws_daily_01',
        name: 'Ca hôm nay',
        start: '08:30',
        end: '17:00',
        version: 3,
        source: 'support-daily-schedule',
      }],
    })
  })

  it('uses the effective profile schedule when the daily schedule is for another date or invalid', () => {
    const tomorrow = resolveAttendanceWorkingTime(profile, '2026-08-24', [
      { id: 'tomorrow', employeeId: profile.id, date: '2026-08-25', start: '08:30', end: '17:00' },
    ])
    const invalidToday = resolveAttendanceWorkingTime(profile, '2026-08-24', [
      { id: 'invalid', employeeId: profile.id, date: '2026-08-24', start: '17:00', end: '08:30' },
    ])

    expect(tomorrow).toMatchObject({
      workStart: '08:30',
      workEnd: '17:00',
      workTimeEffectiveFrom: '2026-08-23',
      attendanceWorkingTimeSource: 'profile-work-schedule',
    })
    expect(invalidToday).toMatchObject({
      workStart: '08:30',
      workEnd: '17:00',
      attendanceWorkingTimeSource: 'profile-work-schedule',
    })
  })

  it('matches backend validation for invalid or deleted daily schedules', () => {
    expect(attendanceDailyShift({ start: '17:00', end: '08:30' })).toBeNull()
    expect(resolveAttendanceWorkingTime(profile, '2026-08-22', [
      { id: 'deleted', employeeId: profile.id, date: '2026-08-22', start: '08:30', end: '17:00', deletedAt: '2026-08-21T00:00:00Z' },
    ])).toMatchObject({
      workStart: '08:00',
      workEnd: '17:30',
      attendanceWorkingTimeSource: 'profile-default',
    })
  })

  it('synthesizes the backend-compatible canonical shift when a profile only has default hours', () => {
    expect(resolveAttendanceWorkingTime({
      id: 'VP-LEGACY-001',
      unit: 'office',
      employmentType: 'Full-Time',
      workStart: '8:30',
      workEnd: '17:00',
    }, '2026-08-24')).toMatchObject({
      workStart: '08:30',
      workEnd: '17:00',
      attendanceWorkingTimeSource: 'profile-default',
      workShifts: [{
        id: 'full_time',
        name: 'Giờ hành chính',
        start: '08:30',
        end: '17:00',
        version: 1,
        source: 'profile-work-shift',
      }],
    })

    expect(resolveAttendanceWorkingTime({
      id: 'HTKD-LEGACY-001',
      unit: 'business_support',
      employmentType: 'Thực Tập Sinh',
    }, '2026-08-24')).toMatchObject({
      workStart: '08:00',
      workEnd: '12:00',
      workShifts: [{ id: 'work_1', name: 'Ca 1', start: '08:00', end: '12:00' }],
    })
  })

  it('keeps a valid selection, auto-selects one shift, and clears a stale multi-shift selection', () => {
    const shifts = [{ id: 'am' }, { id: 'pm' }]
    expect(reconcileAttendanceShiftId(shifts, 'pm')).toBe('pm')
    expect(reconcileAttendanceShiftId([{ id: 'only' }], 'stale')).toBe('only')
    expect(reconcileAttendanceShiftId(shifts, 'stale')).toBe('')
    expect(reconcileAttendanceShiftId([], 'stale')).toBe('')
  })

  it('resolves a stale submitted id to the sole canonical shift but requires a valid multi-shift id', () => {
    expect(resolveAttendanceShiftSelection({
      workShifts: [{ id: 'daily', start: '08:30', end: '17:00' }],
    }, 'stale')).toMatchObject({
      shiftId: 'daily',
      shift: { id: 'daily', start: '08:30', end: '17:00' },
      requiresSelection: false,
    })
    expect(resolveAttendanceShiftSelection({
      workShifts: [{ id: 'am' }, { id: 'pm' }],
    }, 'stale')).toMatchObject({
      shiftId: '',
      shift: null,
      requiresSelection: true,
    })
  })
})
