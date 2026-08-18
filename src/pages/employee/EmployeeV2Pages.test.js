import { describe, expect, it } from 'vitest'
import { ordersForOpenAttendance } from './employeeShiftOrders'

describe('store employee current-shift orders', () => {
  it('keeps only the signed-in employee orders from the open shift', () => {
    const openRecord = { id: 'ATT-01', date: '2026-08-18', shiftId: 'CA-01' }
    const rows = ordersForOpenAttendance([
      { id: 'O1', employeeId: 'NV-01', attendanceId: 'ATT-01', createdAt: '2026-08-18T08:30:00+07:00' },
      { id: 'O2', employeeId: 'NV-01', shiftId: 'CA-01', createdAt: '2026-08-18T09:30:00+07:00' },
      { id: 'O3', employeeId: 'NV-02', attendanceId: 'ATT-01', createdAt: '2026-08-18T10:30:00+07:00' },
      { id: 'O4', employeeId: 'NV-01', shiftId: 'CA-02', createdAt: '2026-08-18T11:30:00+07:00' },
      { id: 'O5', employeeId: 'NV-01', shiftId: 'CA-01', createdAt: '2026-08-17T12:30:00+07:00' },
      { id: 'O6', employeeId: 'NV-01', attendanceId: 'ATT-01', deletedAt: '2026-08-18T12:30:00+07:00' },
      { id: 'O7', employeeId: 'NV-01', attendanceId: 'ATT-OTHER', shiftId: 'CA-01', createdAt: '2026-08-18T13:30:00+07:00' },
    ], 'NV-01', openRecord)

    expect(rows.map((row) => row.id)).toEqual(['O2', 'O1'])
  })

  it('returns no rows before the employee checks in', () => {
    expect(ordersForOpenAttendance([{ id: 'O1' }], 'NV-01', null)).toEqual([])
  })
})
