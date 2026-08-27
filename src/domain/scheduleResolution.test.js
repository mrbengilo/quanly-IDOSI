import { describe, expect, it } from 'vitest'
import { resolveCanonicalScheduleRecord, ScheduleResolutionError } from './scheduleResolution'

const definitions = [
  { id: 'SAME', storeId: 'S01', start: '08:00', end: '16:00', active: false },
  { id: 'SAME', storeId: 'S02', start: '10:00', end: '18:00', deletedAt: '2026-08-01' },
  { id: 'LATE', storeId: 'S01', start: '16:00', end: '00:30' },
]

describe('canonical schedule resolution invariants', () => {
  it.each([
    ['store row', { storeId: 'S01', shiftId: 'SAME' }, {}, [['08:00', '16:00']]],
    ['storeless owned row', { employeeId: 'E01', shiftId: 'SAME' }, { employeeStoreId: 'S01' }, [['08:00', '16:00']]],
    ['empty shiftIds fallback', { storeId: 'S01', shiftIds: [], shiftId: 'SAME' }, {}, [['08:00', '16:00']]],
    ['partial snapshot', { storeId: 'S01', shiftIds: ['SAME', 'LATE'], shiftSnapshots: [{ id: 'SAME', start: '07:00', end: '15:00' }] }, {}, [['07:00', '15:00'], ['16:00', '00:30']]],
    ['legacy inline', { storeId: 'S01', shiftStart: '21:00', shiftEnd: '05:00' }, {}, [['21:00', '05:00']]],
    ['id-less inline', { storeId: 'S01', start: '09:00', end: '17:00' }, {}, [['09:00', '17:00']]],
  ])('%s resolves every shift', (_name, record, extra, expected) => {
    const result = resolveCanonicalScheduleRecord({ record, shiftDefinitions: definitions, selectedStoreId: 'S01', ...extra })
    expect(result.map(({ start, end }) => [start, end])).toEqual(expected)
  })

  it.each([
    ['explicit cross-store', { storeId: 'S02', shiftId: 'SAME' }, ''],
    ['storeless cross-store owner', { employeeId: 'E02', shiftId: 'SAME' }, 'S02'],
    ['unresolved id', { storeId: 'S01', shiftId: 'MISSING' }, ''],
    ['one malformed row', { storeId: 'S01', start: '25:00', end: '17:00' }, ''],
  ])('%s fails closed', (_name, record, employeeStoreId) => {
    expect(() => resolveCanonicalScheduleRecord({ record, shiftDefinitions: definitions, selectedStoreId: 'S01', employeeStoreId }))
      .toThrow(ScheduleResolutionError)
  })
})
