import { describe, expect, it } from 'vitest'
import {
  formatOfficeTime24,
  officeAttendanceStatsByEmployee,
  officeAttendanceSummary,
  officeAttendanceViewRows,
} from './officeAttendanceView'

const employees = [
  { id: 'VP-001', code: 'VP-001', name: 'Nguyễn Văn A', workStart: '08:00', workEnd: '17:00' },
  { id: 'VP-002', code: 'VP-002', name: 'Trần Văn B', workStart: '09:00', workEnd: '18:00' },
]

const records = [
  {
    id: 'CC-001', employeeId: 'VP-001', date: '2026-08-10', shift: 'office-a', shiftName: 'Ca hành chính A',
    checkInAt: '2026-08-10T00:45:00.000Z', checkOutAt: '2026-08-10T09:30:00.000Z',
    arrivalTag: 'Đi sớm', departureTag: 'Ra đúng giờ',
    checkInLocation: { label: 'Văn phòng tầng 1' }, checkOutLocation: { label: 'Văn phòng tầng 2' },
  },
  {
    id: 'CC-002', employeeId: 'VP-001', date: '2026-08-11', shiftName: 'Ca hành chính A', shiftStart: '08:00', shiftEnd: '17:00',
    checkIn: '08:00', checkOut: '17:00', arrivalTag: 'Đi đúng giờ', departureTag: 'Ra đúng giờ',
  },
  {
    id: 'CC-003', employeeId: 'VP-002', date: '2026-08-12', shiftName: 'Ca hành chính B', shiftStart: '09:00', shiftEnd: '18:00',
    checkIn: '09:20', checkOut: '18:00', arrivalTag: 'Đi trễ', departureTag: 'Ra đúng giờ', minutesLate: 20,
  },
]

describe('office attendance management view', () => {
  it('projects full shift, 24-hour time, locations, tags, and worked hours', () => {
    const rows = officeAttendanceViewRows({ records, employees })
    const row = rows.find((item) => item.id === 'CC-001')

    expect(formatOfficeTime24('2026-08-10T00:45:00.000Z')).toBe('07:45')
    expect(row).toMatchObject({
      employeeId: 'VP-001',
      shiftName: 'Ca hành chính A',
      shiftStart: '08:00',
      shiftEnd: '17:00',
      checkIn: '07:45',
      checkOut: '16:30',
      arrivalStatus: 'Đi sớm',
      departureStatus: 'Ra đúng giờ',
      earlyMinutes: 15,
      lateMinutes: 0,
      workedHours: 8.75,
      checkInLocation: { label: 'Văn phòng tầng 1' },
      checkOutLocation: { label: 'Văn phòng tầng 2' },
    })
  })

  it('filters by inclusive dates and employee before calculating punctuality totals', () => {
    const rows = officeAttendanceViewRows({
      records,
      employees,
      fromDate: '2026-08-11',
      toDate: '2026-08-12',
      employeeId: 'VP-002',
    })
    expect(rows.map((row) => row.id)).toEqual(['CC-003'])
    expect(officeAttendanceSummary(rows, { improveMinLateMinutes: 15 })).toMatchObject({
      total: 1,
      early: 0,
      onTime: 0,
      late: 1,
      earlyMinutes: 0,
      lateMinutes: 20,
      rating: 'Cần cải thiện',
    })
  })

  it('evaluates every selected employee, including profiles without attendance', () => {
    const rows = officeAttendanceViewRows({ records: records.slice(0, 2), employees })
    const stats = officeAttendanceStatsByEmployee({ rows, employees })

    expect(stats).toHaveLength(2)
    expect(stats[0]).toMatchObject({ total: 2, early: 1, onTime: 1, late: 0, earlyMinutes: 15, rating: 'Chuyên cần tốt' })
    expect(stats[1]).toMatchObject({ total: 0, rating: 'Chưa có dữ liệu' })
  })
})
