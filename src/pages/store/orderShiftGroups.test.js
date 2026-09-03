import { describe, expect, it } from 'vitest'
import { groupOrdersForDisplay } from './orderShiftGroups'

const order = ({ id, date = '2026-08-22', shiftId, shiftName, shiftStart, createdAt, amount = 100_000 }) => ({
  id,
  code: id,
  storeId: 'S01',
  date,
  shiftId,
  shiftName,
  shiftStart,
  amount,
  createdAt: createdAt || `${date}T${shiftStart || '09:00'}:00+07:00`,
})

describe('groupOrdersForDisplay', () => {
  it('sorts shift groups by newest business day and newest shift first', () => {
    const groups = groupOrdersForDisplay([
      order({ id: 'MORNING', shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '08:00' }),
      order({ id: 'NIGHT', shiftId: 'night', shiftName: 'Ca tối', shiftStart: '18:00' }),
      order({ id: 'AFTERNOON', shiftId: 'afternoon', shiftName: 'Ca chiều', shiftStart: '13:00' }),
      order({ id: 'PREVIOUS-NIGHT', date: '2026-08-21', shiftId: 'night', shiftName: 'Ca tối', shiftStart: '18:00' }),
    ], 'shift')

    expect(groups.map(([, rows]) => [rows[0].date, rows[0].shiftName])).toEqual([
      ['2026-08-22', 'Ca tối'],
      ['2026-08-22', 'Ca chiều'],
      ['2026-08-22', 'Ca sáng'],
      ['2026-08-21', 'Ca tối'],
    ])
  })

  it('uses Vietnamese shift names as a deterministic fallback when legacy rows have no start time', () => {
    const groups = groupOrdersForDisplay([
      order({ id: 'LEGACY-MORNING', shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '' }),
      order({ id: 'LEGACY-NIGHT', shiftId: 'night', shiftName: 'Ca tối', shiftStart: '' }),
      order({ id: 'LEGACY-AFTERNOON', shiftId: 'afternoon', shiftName: 'Ca chiều', shiftStart: '' }),
    ], 'shift')

    expect(groups.map(([, rows]) => rows[0].shiftName)).toEqual(['Ca tối', 'Ca chiều', 'Ca sáng'])
  })

  it('keeps legacy shifts without IDs in separate groups by name and time', () => {
    const groups = groupOrdersForDisplay([
      order({ id: 'LEGACY-MORNING-NO-ID', shiftId: '', shiftName: 'Ca sáng', shiftStart: '08:00' }),
      order({ id: 'LEGACY-NIGHT-NO-ID', shiftId: '', shiftName: 'Ca tối', shiftStart: '18:00' }),
    ], 'shift')

    expect(groups.map(([, rows]) => rows[0].shiftName)).toEqual(['Ca tối', 'Ca sáng'])
  })

  it('sorts orders inside each shift from newest to oldest', () => {
    const groups = groupOrdersForDisplay([
      order({ id: 'OLDER', shiftId: 'night', shiftName: 'Ca tối', shiftStart: '18:00', createdAt: '2026-08-22T18:10:00+07:00' }),
      order({ id: 'NEWER', shiftId: 'night', shiftName: 'Ca tối', shiftStart: '18:00', createdAt: '2026-08-22T20:15:00+07:00' }),
    ], 'shift')

    expect(groups[0][1].map(({ id }) => id)).toEqual(['NEWER', 'OLDER'])
  })
})
