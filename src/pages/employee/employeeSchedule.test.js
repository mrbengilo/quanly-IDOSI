import { describe, expect, it } from 'vitest'
import { employeeScheduleRange, employeeScheduleRows } from './employeeSchedule'

describe('employee schedule view', () => {
  it('builds day/week/month ranges', () => {
    expect(employeeScheduleRange('2026-08-20', 'week')).toEqual({ from: '2026-08-17', to: '2026-08-23' })
    expect(employeeScheduleRange('2026-08-20', 'month')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(employeeScheduleRange('2026-08-20', 'day')).toEqual({ from: '2026-08-20', to: '2026-08-20' })
  })

  it('creates one support row from an assigned 08:00–12:00 shift inside an 08:00–14:00 grant', () => {
    const rows = employeeScheduleRows({
      employee: { id: 'E01', storeId: 'S01' },
      stores: [{ id: 'S02', name: 'Dosii KVC' }],
      shiftDefinitions: [{ id: 'CA-1', storeId: 'S02', name: 'Ca hỗ trợ sáng', start: '08:00', end: '12:00' }],
      schedule: [{ id: 'SCH-1', employeeId: 'E01', storeId: 'S02', date: '2026-08-20', shiftIds: ['CA-1'] }],
      supportTransfers: [{
        id: 'TR-1', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02', startAt: '2026-08-20T08:00', endAt: '2026-08-20T14:00',
        hourlySupportRate: 29_000, allowance: 50_000, status: 'Đã duyệt',
      }],
      range: { from: '2026-08-20', to: '2026-08-20' },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'support', storeName: 'Dosii KVC', shiftName: 'Ca hỗ trợ sáng', start: '08:00', end: '12:00',
      startAt: '2026-08-20T08:00', endAt: '2026-08-20T14:00', hourlyRate: 29_000, allowance: 50_000,
    })
  })

  it('does not create a row from a transfer without a schedule assignment', () => {
    expect(employeeScheduleRows({
      employee: { id: 'E01', storeId: 'S01' },
      schedule: [],
      supportTransfers: [{
        id: 'TR-ONLY', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02', startAt: '2026-08-20T08:00', endAt: '2026-08-20T14:00',
        hourlySupportRate: 29_000, allowance: 50_000, status: 'Đã duyệt',
      }],
      range: { from: '2026-08-20', to: '2026-08-20' },
    })).toEqual([])
  })

  it('keeps adjacent home and support shifts and resolves colliding shift ids by store', () => {
    const rows = employeeScheduleRows({
      employee: { id: 'E01', storeId: 'S01' },
      stores: [{ id: 'S01', name: 'Dosii NTL' }, { id: 'S02', name: 'Dosii KVC' }],
      shiftDefinitions: [
        { id: 'CA-CHUNG', storeId: 'S02', name: 'Ca cửa hàng hỗ trợ', start: '12:00', end: '16:00' },
        { id: 'CA-CHUNG', storeId: 'S01', name: 'Ca cửa hàng chính', start: '08:00', end: '12:00' },
      ],
      schedule: [
        { id: 'SCH-HOME', employeeId: 'E01', storeId: 'S01', date: '2026-08-20', shiftIds: ['CA-CHUNG'] },
        { id: 'SCH-SUPPORT', employeeId: 'E01', storeId: 'S02', date: '2026-08-20', shiftIds: ['CA-CHUNG'] },
      ],
      supportTransfers: [{
        id: 'TR-1', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02', startAt: '2026-08-20T12:00', endAt: '2026-08-20T16:00',
        hourlySupportRate: 45_000, allowance: 180_000, status: 'Đã duyệt',
      }],
      range: { from: '2026-08-20', to: '2026-08-20' },
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      kind: 'home', storeId: 'S01', shiftName: 'Ca cửa hàng chính', start: '08:00', end: '12:00',
    })
    expect(rows[0].hourlyRate).toBeUndefined()
    expect(rows[1]).toMatchObject({
      kind: 'support', storeId: 'S02', shiftName: 'Ca cửa hàng hỗ trợ', start: '12:00', end: '16:00',
      hourlyRate: 45_000, allowance: 180_000,
    })
  })

  it('fails closed for ambiguous grants and uses an explicit transfer id only within the assigned window', () => {
    const base = {
      employee: { id: 'E01', storeId: 'S01' },
      shiftDefinitions: [{ id: 'HOST', storeId: 'S02', name: 'Ca hỗ trợ', start: '08:00', end: '12:00' }],
      supportTransfers: [
        { id: 'TR-A', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02', startAt: '2026-08-20T08:00', endAt: '2026-08-20T14:00', hourlySupportRate: 29_000, status: 'Đã duyệt' },
        { id: 'TR-B', employeeId: 'E01', fromStoreId: 'S01', toStoreId: 'S02', startAt: '2026-08-20T08:00', endAt: '2026-08-20T14:00', hourlySupportRate: 45_000, status: 'Hoàn tất' },
      ],
      range: { from: '2026-08-20', to: '2026-08-20' },
    }
    const assignment = { id: 'SCH-1', employeeId: 'E01', storeId: 'S02', date: '2026-08-20', shiftIds: ['HOST'] }

    expect(employeeScheduleRows({ ...base, schedule: [assignment] })[0]).toMatchObject({ kind: 'other' })
    expect(employeeScheduleRows({
      ...base,
      schedule: [{ ...assignment, supportTransferId: 'TR-B' }],
    })[0]).toMatchObject({ kind: 'support', supportTransferId: 'TR-B', hourlyRate: 45_000 })

    expect(employeeScheduleRows({
      ...base,
      schedule: [assignment],
      supportTransfers: [{ ...base.supportTransfers[0], toStoreId: 'S99' }],
    })[0]).toMatchObject({ kind: 'other' })
  })

  it('keeps completed support history after the employee current store changes and honors id/code aliases', () => {
    const shared = {
      employee: { id: 'EMP-UUID', code: 'E01', employeeCode: 'LEGACY-E01', storeId: 'S02' },
      stores: [{ id: 'S02', name: 'Cửa hàng hỗ trợ cũ' }],
      shiftDefinitions: [{ id: 'HOST', storeId: 'S02', name: 'Ca hỗ trợ đã làm', start: '08:00', end: '12:00' }],
      supportTransfers: [{
        id: 'TR-DONE', employeeId: 'legacy-e01', fromStoreId: 'S01', toStoreId: 'S02',
        fromDate: '2026-08-20', toDate: '2026-08-20', status: 'Hoàn tất',
        hourlySupportRate: 45_000, allowance: 100_000,
      }],
      range: { from: '2026-08-20', to: '2026-08-20' },
    }
    const linked = employeeScheduleRows({
      ...shared,
      schedule: [{
        id: 'SCH-DONE', employeeId: 'emp-uuid', storeId: 'S02', date: '2026-08-20',
        shiftIds: ['HOST'], supportTransferId: 'tr-done',
      }],
    })
    expect(linked).toHaveLength(1)
    expect(linked[0]).toMatchObject({
      kind: 'support', supportTransferId: 'TR-DONE', storeId: 'S02',
      hourlyRate: 45_000, allowance: 100_000, status: 'Hoàn tất',
    })

    const afterMovingElsewhere = employeeScheduleRows({
      ...shared,
      employee: { ...shared.employee, storeId: 'S03' },
      schedule: [{ id: 'SCH-DONE', employeeCode: 'E01', storeId: 'S02', date: '2026-08-20', shiftIds: ['HOST'] }],
    })
    expect(afterMovingElsewhere[0]).toMatchObject({ kind: 'support', supportTransferId: 'TR-DONE' })
  })
})
