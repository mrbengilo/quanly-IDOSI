import { describe, expect, it } from 'vitest'
import {
  moveStoreScheduleDate,
  resolveStoreScheduleRecordShifts,
  resolveStoreScheduleShift,
  scheduleShiftDurationMinutes,
  scheduleShiftIds,
  scheduleShiftTimeLabel,
  stableScheduleShiftColor,
  storeScheduleRange,
  storeScheduleShiftColumns,
} from './scheduleView'

describe('store schedule read model', () => {
  it('uses UTC date-only arithmetic for Monday weeks, leap months and navigation', () => {
    expect(storeScheduleRange('2026-08-20', 'week')).toMatchObject({ from: '2026-08-17', to: '2026-08-23' })
    expect(storeScheduleRange('2028-02-20', 'month').dates).toHaveLength(29)
    expect(moveStoreScheduleDate('2026-01-31', 'month', 1)).toBe('2026-02-28')
    expect(moveStoreScheduleDate('2026-08-20', 'week', -1)).toBe('2026-08-13')
  })

  it('normalizes legacy single shift ids and resolves snapshot fields before same-store definitions', () => {
    const record = {
      storeId: 'S1',
      shiftId: 'NIGHT',
      shiftSnapshots: [{ id: 'NIGHT', name: 'Ca đêm lịch sử' }],
    }
    const shift = resolveStoreScheduleShift({
      record,
      shiftId: 'NIGHT',
      storeId: 'S1',
      shiftDefinitions: [
        { id: 'NIGHT', storeId: 'S2', name: 'Sai cửa hàng', start: '09:00', end: '17:00', color: '#000000' },
        { id: 'NIGHT', storeId: 'S1', name: 'Tên hiện tại', start: '22:00', end: '06:00', color: '#123456' },
      ],
    })

    expect(scheduleShiftIds(record)).toEqual(['NIGHT'])
    expect(shift).toMatchObject({
      name: 'Ca đêm lịch sử', start: '22:00', end: '06:00', color: '#123456', source: 'snapshot', snapshot: true,
    })
    expect(shift.time).toBe('22:00 - 06:00 (+1 ngày)')
    expect(shift.durationMinutes).toBe(480)
  })

  it('falls back to legacy record fields without reading an explicit other-store definition', () => {
    const record = {
      storeId: 'S1', shiftId: 'LEGACY', shiftName: 'Ca legacy', shiftStart: '07:00', shiftEnd: '11:00',
    }
    const [shift] = resolveStoreScheduleRecordShifts({
      record,
      storeId: 'S1',
      shiftDefinitions: [{ id: 'LEGACY', storeId: 'S2', name: 'Ca rò rỉ', start: '10:00', end: '18:00', color: '#ffffff' }],
    })

    expect(shift).toMatchObject({ name: 'Ca legacy', start: '07:00', end: '11:00', source: 'record' })
    expect(shift.color).toBe(stableScheduleShiftColor('S1', 'LEGACY'))
    expect(resolveStoreScheduleShift({ record, shiftId: 'LEGACY', storeId: 'S2' })).toBeNull()
  })

  it('labels overnight shifts and assigns deterministic colors independently of list order', () => {
    expect(scheduleShiftTimeLabel({ start: '23:30', end: '05:15' })).toBe('23:30 - 05:15 (+1 ngày)')
    expect(scheduleShiftDurationMinutes({ start: '23:30', end: '05:15' })).toBe(345)
    expect(stableScheduleShiftColor('S1', 'A')).toBe(stableScheduleShiftColor('S1', 'A'))
    expect([
      stableScheduleShiftColor('S1', 'A'), stableScheduleShiftColor('S1', 'B'), stableScheduleShiftColor('S1', 'C'),
    ].filter((color, index, colors) => colors.indexOf(color) === index).length).toBeGreaterThan(1)
  })

  it('keeps snapshot-only inactive shifts visible beside active day definitions', () => {
    const records = [{
      id: 'R1', storeId: 'S1', employeeId: 'E1', date: '2026-08-21', shiftId: 'OLD',
      shiftSnapshots: [{ id: 'OLD', name: 'Ca cũ', start: '21:00', end: '05:00' }],
    }]
    const columns = storeScheduleShiftColumns({
      date: '2026-08-21', records, storeId: 'S1', shiftDefinitions: [
        { id: 'NEW', name: 'Ca global trùng mã', start: '06:00', end: '10:00', active: true },
        { id: 'NEW', storeId: 'S1', name: 'Ca mới', start: '08:00', end: '12:00', active: true },
        { id: 'OLD', storeId: 'S1', name: 'Ca đã xóa', start: '20:00', end: '04:00', active: false, deletedAt: '2026-08-20T00:00:00Z' },
      ],
    })

    expect(columns.map(({ id }) => id)).toEqual(['NEW', 'OLD'])
    expect(columns[0].name).toBe('Ca mới')
    expect(columns[1]).toMatchObject({ name: 'Ca cũ', time: '21:00 - 05:00 (+1 ngày)', snapshot: true })
  })

  it('renders a missing historical definition as an explicit unresolved placeholder', () => {
    const resolved = resolveStoreScheduleRecordShifts({
      record: { id: 'HIST-MISSING', storeId: 'S1', shiftId: 'REMOVED', note: 'Giữ audit' },
      storeId: 'S1', shiftDefinitions: [],
    })
    expect(resolved).toEqual([expect.objectContaining({
      name: 'Ca không xác định', start: '', end: '', unresolved: true,
      resolutionReason: 'Thiếu dữ liệu ca', note: 'Giữ audit',
    })])
  })

  it('renders valid and unresolved shifts from the same historical record in input order', () => {
    const resolved = resolveStoreScheduleRecordShifts({
      record: { id: 'HIST-PARTIAL', storeId: 'S1', shiftIds: ['REMOVED', 'DAY'] },
      storeId: 'S1',
      shiftDefinitions: [{ id: 'DAY', storeId: 'S1', name: 'Ca ngày', start: '08:00', end: '17:00' }],
    })
    expect(resolved).toMatchObject([
      { id: 'REMOVED', shiftId: 'REMOVED', unresolved: true, start: '', end: '' },
      { id: 'DAY', name: 'Ca ngày', start: '08:00', end: '17:00' },
    ])
  })
})
