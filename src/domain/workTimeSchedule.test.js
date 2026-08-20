import { describe, expect, it } from 'vitest'
import {
  normalizeWorkTimeEffectiveDate,
  resolveEffectiveWorkingTime,
  upsertEffectiveWorkingTime,
  workTimeScheduleEntries,
} from './workTimeSchedule'

const profile = {
  id: 'VP-001',
  employmentType: 'Full-Time',
  startDate: '2026-08-01',
  workTimeType: 'Full-Time',
  workStart: '08:00',
  workEnd: '17:30',
  workShifts: [{ id: 'full_time', name: 'Giờ hành chính', start: '08:00', end: '17:30' }],
  workingTime: { type: 'Full-Time', mode: 'fixed', shifts: [{ id: 'full_time', name: 'Giờ hành chính', start: '08:00', end: '17:30' }] },
}

describe('effective-dated working time', () => {
  it('keeps a legacy baseline and carries the latest setting forward without changing earlier dates', () => {
    const workTimeSchedule = upsertEffectiveWorkingTime(profile, '2026-08-20', {
      employmentType: 'Full-Time',
      workTimeType: 'Full-Time',
      workStart: '09:00',
      workEnd: '18:00',
      workShifts: [{ id: 'full_time', name: 'Giờ mới', start: '09:00', end: '18:00' }],
      workingTime: { type: 'Full-Time', mode: 'fixed', shifts: [{ id: 'full_time', name: 'Giờ mới', start: '09:00', end: '18:00' }] },
    })
    const scheduled = { ...profile, workTimeSchedule }

    expect(workTimeScheduleEntries(scheduled).map(({ effectiveFrom }) => effectiveFrom)).toEqual(['2026-08-01', '2026-08-20'])
    expect(resolveEffectiveWorkingTime(scheduled, '2026-08-19')).toMatchObject({ workStart: '08:00', workEnd: '17:30', workTimeEffectiveFrom: '2026-08-01' })
    expect(resolveEffectiveWorkingTime(scheduled, '2026-08-20')).toMatchObject({ workStart: '09:00', workEnd: '18:00', workTimeEffectiveFrom: '2026-08-20' })
    expect(resolveEffectiveWorkingTime(scheduled, '2026-09-30')).toMatchObject({ workStart: '09:00', workEnd: '18:00', workTimeEffectiveFrom: '2026-08-20' })
  })

  it('replaces a setting on the same effective date and supports flexible intern shifts', () => {
    const intern = { ...profile, employmentType: 'Thực Tập Sinh' }
    const first = upsertEffectiveWorkingTime(intern, '2026-08-20', {
      employmentType: 'Thực Tập Sinh',
      workTimeType: 'Part-Time',
      workStart: '08:00',
      workEnd: '12:00',
      workShifts: [{ id: 'am', name: 'Ca sáng', start: '08:00', end: '12:00' }],
    })
    const replaced = upsertEffectiveWorkingTime({ ...intern, workTimeSchedule: first }, '2026-08-20', {
      employmentType: 'Thực Tập Sinh',
      workTimeType: 'Part-Time',
      workStart: '13:00',
      workEnd: '17:30',
      workShifts: [{ id: 'pm', name: 'Ca chiều', start: '13:00', end: '17:30' }],
    })

    expect(replaced.filter(({ effectiveFrom }) => effectiveFrom === '2026-08-20')).toHaveLength(1)
    expect(resolveEffectiveWorkingTime({ ...intern, workTimeSchedule: replaced }, '2026-08-21').workShifts)
      .toEqual([{ id: 'pm', name: 'Ca chiều', start: '13:00', end: '17:30' }])
  })

  it('accepts only real strict calendar dates', () => {
    expect(normalizeWorkTimeEffectiveDate('2026-08-20')).toBe('2026-08-20')
    expect(normalizeWorkTimeEffectiveDate('2026-02-30')).toBe('')
    expect(normalizeWorkTimeEffectiveDate('20/08/2026')).toBe('')
  })
})
