import { describe, expect, it } from 'vitest'
import { selectTaskShiftForDate, taskShiftOptionsForDate } from './taskScope'

describe('store task date scope', () => {
  const definitions = [
    { id: 'morning', name: 'Sang', storeId: 'CH001', date: '2026-08-14', active: true },
    { id: 'evening', name: 'Toi', storeId: 'CH001', date: '2026-08-15', active: true },
    { id: 'other-store', name: 'Khac', storeId: 'CH002', date: '2026-08-15', active: true },
  ]

  it('rebuilds the shift list for the newly selected date', () => {
    const options = taskShiftOptionsForDate({
      shiftDefinitions: definitions,
      fallbackShifts: [{ id: 'legacy', name: 'Legacy' }],
      storeId: 'CH001',
      date: '2026-08-15',
    })

    expect(options.map((shift) => shift.id)).toEqual(['evening'])
    expect(selectTaskShiftForDate({
      tasks: [],
      storeId: 'CH001',
      date: '2026-08-15',
      shiftOptions: options,
    })).toBe('evening')
  })

  it('never carries a stale shift into a date without a valid shift', () => {
    const options = taskShiftOptionsForDate({
      shiftDefinitions: definitions,
      fallbackShifts: [{ id: 'legacy', name: 'Legacy' }],
      storeId: 'CH001',
      date: '2026-08-16',
    })

    expect(options).toEqual([])
    expect(selectTaskShiftForDate({
      tasks: [{ storeId: 'CH001', date: '2026-08-14', shiftId: 'morning' }],
      storeId: 'CH001',
      date: '2026-08-16',
      shiftOptions: options,
    })).toBe('')
  })
})
