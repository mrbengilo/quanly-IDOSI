import { describe, expect, it } from 'vitest'
import { employeeScheduleRange, employeeScheduleRows } from './employeeSchedule'

describe('employee schedule view', () => {
  it('builds day/week/month ranges and includes transfer compensation details', () => {
    expect(employeeScheduleRange('2026-08-20', 'week')).toEqual({ from: '2026-08-17', to: '2026-08-23' })
    expect(employeeScheduleRange('2026-08-20', 'month')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    const rows = employeeScheduleRows({
      employee: { id: 'E01', storeId: 'S01' },
      stores: [{ id: 'S01', name: 'Dosii NTL' }, { id: 'S02', name: 'Dosii KVC' }],
      shiftDefinitions: [{ id: 'CA-1', name: 'Ca sáng', start: '08:00', end: '12:00' }],
      schedule: [{ id: 'SCH-1', employeeId: 'E01', storeId: 'S01', date: '2026-08-20', shiftIds: ['CA-1'], note: 'Bán hàng' }],
      supportTransfers: [{ id: 'TR-1', employeeId: 'E01', toStoreId: 'S02', startAt: '2026-08-21T07:00:00+07:00', endAt: '2026-08-21T11:00:00+07:00', hourlySupportRate: 29_000, allowance: 50_000, status: 'Đã duyệt' }],
      range: { from: '2026-08-17', to: '2026-08-23' },
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: 'schedule', storeName: 'Dosii NTL', shiftName: 'Ca sáng' })
    expect(rows[1]).toMatchObject({ kind: 'support', storeName: 'Dosii KVC', hourlyRate: 29_000, allowance: 50_000 })
  })

  it('keeps unresolved historical shifts renderable beside valid rows', () => {
    const rows = employeeScheduleRows({
      employee: { id: 'E01', storeId: 'S01' },
      schedule: [
        { id: 'VALID', employeeId: 'E01', storeId: 'S01', date: '2026-08-20', shiftId: 'DAY' },
        { id: 'ORPHAN', employeeId: 'E01', storeId: 'S01', date: '2026-08-21', shiftId: 'REMOVED', note: 'Audit' },
      ],
      shiftDefinitions: [{ id: 'DAY', storeId: 'S01', name: 'Ca ngày', start: '08:00', end: '17:00' }],
      range: { from: '2026-08-20', to: '2026-08-21' },
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ shiftName: 'Ca ngày', start: '08:00', end: '17:00', unresolved: false })
    expect(rows[1]).toMatchObject({ shiftName: 'Ca không xác định', start: '', end: '', unresolved: true,
      resolutionNote: 'Thiếu dữ liệu ca', note: 'Audit' })
  })

  it('renders legacy employeeCode rows with normalized single-digit clocks', () => {
    const rows = employeeScheduleRows({
      employee: { id: 'E01', employeeCode: 'LEGACY-01', storeId: 'S01' },
      schedule: [{ id: 'LEGACY', employeeCode: 'LEGACY-01', storeId: 'S01', date: '2026-08-20', start: '8:30', end: '9:05' }],
      range: { from: '2026-08-20', to: '2026-08-20' },
    })
    expect(rows).toMatchObject([{ start: '08:30', end: '09:05', unresolved: false }])
  })
})
