import { describe, expect, it } from 'vitest'
import {
  displayScheduleRecordShifts,
  requireResolvedScheduleRecord,
  resolveCanonicalScheduleRecord,
  resolveCanonicalScheduleRecordResult,
  resolveScheduleRecordOwnership,
  ScheduleResolutionError,
} from './scheduleResolution'

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
    ['single-digit inline', { storeId: 'S01', start: '8:30', end: '9:05' }, {}, [['08:30', '09:05']]],
    ['single-digit overnight', { storeId: 'S01', start: '9:00', end: '1:00' }, {}, [['09:00', '01:00']]],
  ])('%s resolves every shift', (_name, record, extra, expected) => {
    const result = resolveCanonicalScheduleRecord({ record, shiftDefinitions: definitions, selectedStoreId: 'S01', ...extra })
    expect(result.map(({ start, end }) => [start, end])).toEqual(expected)
  })

  it.each([
    ['explicit cross-store', { storeId: 'S02', shiftId: 'SAME' }, ''],
    ['storeless cross-store owner', { employeeId: 'E02', shiftId: 'SAME' }, 'S02'],
    ['unresolved id', { storeId: 'S01', shiftId: 'MISSING' }, ''],
    ['one malformed row', { storeId: 'S01', start: '25:00', end: '17:00' }, ''],
    ['malformed minute', { storeId: 'S01', start: '8:3', end: '17:00' }, ''],
  ])('%s fails closed', (_name, record, employeeStoreId) => {
    expect(() => resolveCanonicalScheduleRecord({ record, shiftDefinitions: definitions, selectedStoreId: 'S01', employeeStoreId }))
      .toThrow(ScheduleResolutionError)
  })

  it('uses canonical destination eligibility instead of vetoing with the home store', () => {
    const result = resolveCanonicalScheduleRecord({
      record: { id: 'TRANSFERRED', storeId: 'S02', employeeId: 'E01', shiftId: 'SAME' },
      shiftDefinitions: definitions,
      selectedStoreId: 'S02',
      employeeStoreId: 'S01',
      employeeWorksAtSelectedStore: true,
      effectiveEmployeeStoreId: 'S02',
    })
    expect(result).toMatchObject([{ storeId: 'S02', start: '10:00', end: '18:00' }])
  })

  it('uses explicit ownership while rejecting storeless rows without canonical evidence', () => {
    expect(resolveCanonicalScheduleRecord({
      record: { storeId: 'S02', start: '08:00', end: '09:00' }, selectedStoreId: 'S02',
      employeeStoreId: 'S01', employeeWorksAtSelectedStore: false,
    })).toMatchObject([{ storeId: 'S02', start: '08:00', end: '09:00' }])
    expect(() => resolveCanonicalScheduleRecord({
      record: { employeeId: 'E01', start: '08:00', end: '09:00' }, selectedStoreId: 'S02',
      employeeStoreId: 'S01', employeeWorksAtSelectedStore: true, effectiveEmployeeStoreId: '',
    })).toThrow(ScheduleResolutionError)
  })

  it('returns typed ownership without assigning other-store or orphan rows to every store', () => {
    expect(resolveScheduleRecordOwnership({ record: { storeId: 'S02' }, selectedStoreId: 'S01' }))
      .toMatchObject({ status: 'other', storeId: 'S02' })
    expect(resolveScheduleRecordOwnership({
      record: { employeeId: 'E02' }, selectedStoreId: 'S01', employeeWorksAtSelectedStore: false,
      effectiveEmployeeStoreId: 'S02',
    })).toMatchObject({ status: 'other', storeId: 'S02' })
    expect(resolveScheduleRecordOwnership({
      record: { employeeId: 'ORPHAN' }, selectedStoreId: 'S01', employeeWorksAtSelectedStore: false,
    })).toMatchObject({ status: 'unresolved', code: 'EMPLOYEE_STORE_UNRESOLVED' })
  })

  it('keeps strict payroll and tolerant display policies independent', () => {
    const options = { record: { id: 'HIST-1', storeId: 'S01', shiftId: 'MISSING', note: 'audit' }, selectedStoreId: 'S01' }
    expect(resolveCanonicalScheduleRecordResult(options)).toMatchObject({ status: 'unresolved', shiftId: 'MISSING' })
    expect(() => requireResolvedScheduleRecord(options)).toThrow(ScheduleResolutionError)
    expect(displayScheduleRecordShifts(options)).toEqual([expect.objectContaining({
      name: 'Ca không xác định', start: '', end: '', unresolved: true, resolutionReason: 'Thiếu dữ liệu ca', note: 'audit',
    })])
    const fallback = displayScheduleRecordShifts({
      ...options, record: { ...options.record, shiftStart: '08:00', shiftEnd: '17:00' },
    })
    expect(fallback).toEqual([expect.objectContaining({ start: '08:00', end: '17:00' })])
    expect(fallback[0]).not.toHaveProperty('unresolved')
  })

  it.each([
    ['orphan first', ['MISSING-A', 'SAME', 'LATE']],
    ['orphan middle', ['SAME', 'MISSING-A', 'LATE']],
    ['orphan last', ['SAME', 'LATE', 'MISSING-A']],
  ])('preserves resolved shifts when an %s reference is unresolved', (_name, shiftIds) => {
    const options = { record: { id: 'PARTIAL', storeId: 'S01', shiftIds }, shiftDefinitions: definitions,
      selectedStoreId: 'S01' }
    const result = resolveCanonicalScheduleRecordResult(options)
    expect(result).toMatchObject({
      status: 'partial',
      shifts: [{ id: 'SAME' }, { id: 'LATE' }],
      unresolvedShifts: [{ shiftId: 'MISSING-A', code: 'SHIFT_UNRESOLVED' }],
      record: { id: 'PARTIAL' },
    })
    expect(displayScheduleRecordShifts(options).map((shift) => shift.id)).toEqual(shiftIds)
    expect(displayScheduleRecordShifts(options).filter((shift) => shift.unresolved)).toEqual([
      expect.objectContaining({ id: 'MISSING-A', shiftId: 'MISSING-A', resolutionReason: 'Thiếu dữ liệu ca' }),
    ])
    expect(() => requireResolvedScheduleRecord(options)).toThrow(ScheduleResolutionError)
  })

  it('keeps stable order for two valid and two unresolved references without duplicating snapshot-backed shifts', () => {
    const options = {
      record: { id: 'MIXED', storeId: 'S01', shiftIds: ['SAME', 'LOST-1', 'LATE', 'LOST-2'],
        shiftSnapshots: [{ id: 'SAME', name: 'Ca snapshot', start: '07:30', end: '15:30' }] },
      shiftDefinitions: definitions,
      selectedStoreId: 'S01',
    }
    const result = resolveCanonicalScheduleRecordResult(options)
    expect(result.entries.map((entry) => entry.status === 'resolved' ? entry.shift.id : entry.shiftId))
      .toEqual(['SAME', 'LOST-1', 'LATE', 'LOST-2'])
    expect(result.shifts).toHaveLength(2)
    expect(result.unresolvedShifts).toHaveLength(2)
    expect(displayScheduleRecordShifts(options)).toMatchObject([
      { id: 'SAME', name: 'Ca snapshot', start: '07:30' },
      { id: 'LOST-1', unresolved: true },
      { id: 'LATE', start: '16:00' },
      { id: 'LOST-2', unresolved: true },
    ])
  })

  it('renders one explicit placeholder per reference when every shift is unresolved', () => {
    const shifts = displayScheduleRecordShifts({
      record: { id: 'ALL-LOST', storeId: 'S01', shiftIds: ['LOST-1', 'LOST-2'] }, selectedStoreId: 'S01',
    })
    expect(shifts).toMatchObject([
      { id: 'LOST-1', shiftId: 'LOST-1', unresolved: true, start: '', end: '' },
      { id: 'LOST-2', shiftId: 'LOST-2', unresolved: true, start: '', end: '' },
    ])
  })

  it('does not hide unexpected resolver errors in display policy', () => {
    const record = { storeId: 'S01', shiftId: 'BROKEN' }
    Object.defineProperty(record, 'shiftSnapshots', { get: () => { throw new TypeError('programming error') } })
    expect(() => displayScheduleRecordShifts({ record, selectedStoreId: 'S01' })).toThrow(TypeError)
  })
})
