import { describe, expect, it } from 'vitest'
import {
  editableOfficeWorkdayTarget,
  isOfficeProfile,
  officeAdjustmentTotals,
  officeAttendanceRows,
  officeAttendanceStats,
  officeLocationLabel,
  officePayrollSummary,
  officeSalaryAdjustments,
  requiredOfficeWorkingDays,
} from './officeAttendance'

describe('office employee attendance helpers', () => {
  it('recognizes Office profiles from the session or employee record', () => {
    expect(isOfficeProfile({ storeId: 'OFFICE' }, {})).toBe(true)
    expect(isOfficeProfile({}, { unit: 'office' })).toBe(true)
    expect(isOfficeProfile({ storeId: 'CH001' }, { unit: 'store' })).toBe(false)
  })

  it('formats GPS objects safely for attendance tables', () => {
    expect(officeLocationLabel({ latitude: 10.8231, longitude: 106.6297 })).toBe('10.82310, 106.62970')
    expect(officeLocationLabel({ label: 'Văn phòng IDOSI' })).toBe('Văn phòng IDOSI')
  })

  it('scopes attendance to the signed-in employee and calculates punctuality totals', () => {
    const rows = officeAttendanceRows([
      { id: 'a1', employeeId: 'VP001', date: '2026-08-01', checkIn: '07:50', shiftStart: '08:00', arrivalTag: 'Đi sớm' },
      { id: 'a2', employeeId: 'VP001', date: '2026-08-02', checkIn: '08:04', shiftStart: '08:00', arrivalTag: 'Đi đúng giờ' },
      { id: 'a3', employeeId: 'VP001', date: '2026-08-03', checkIn: '08:17', shiftStart: '08:00', arrivalTag: 'Đi trễ', minutesLate: 17 },
      { id: 'other', employeeId: 'VP002', date: '2026-08-04', checkIn: '08:30', shiftStart: '08:00', arrivalTag: 'Đi trễ' },
    ], { id: 'VP001' })

    expect(rows.map((row) => row.id)).toEqual(['a3', 'a2', 'a1'])
    expect(officeAttendanceStats(rows, { improveMinLateCount: 3, improveMinLateMinutes: 30 })).toMatchObject({
      total: 3,
      early: 1,
      onTime: 1,
      late: 1,
      earlyMinutes: 10,
      lateMinutes: 17,
      rating: 'Cần duy trì',
    })
  })

  it('uses per-employee work hours and monthly workday targets', () => {
    const records = [
      { employeeId: 'VP001', date: '2026-07-01', checkIn: '08:00', checkOut: '17:00', workdayCredit: 1, standardWorkDaysSnapshot: 24, monthlySalarySnapshot: 12_000_000 },
      { employeeId: 'VP001', date: '2026-07-02', checkIn: '08:00', checkOut: '17:00', workdayCredit: 1, standardWorkDaysSnapshot: 24, monthlySalarySnapshot: 12_000_000 },
      { employeeId: 'VP001', date: '2026-07-03', checkIn: '08:00', workdayCredit: 0, standardWorkDaysSnapshot: 24, monthlySalarySnapshot: 12_000_000 },
    ]
    const employeeA = { salary: 10_000_000, workStart: '08:00', workEnd: '17:00', monthlyWorkdayTargets: { '2026-07': 22 } }
    const employeeB = { salary: 10_000_000, workStart: '09:00', workEnd: '18:00', monthlyWorkdayTargets: { '2026-07': 20 } }
    expect(requiredOfficeWorkingDays({ records, employee: employeeA, period: '2026-07' })).toEqual({ days: 22, source: 'monthly-target' })
    expect(requiredOfficeWorkingDays({ records, employee: employeeB, period: '2026-07' })).toEqual({ days: 20, source: 'monthly-target' })
    expect(officePayrollSummary({ records, employee: employeeA, period: '2026-07', historical: true })).toMatchObject({
      actualDays: 2,
      requiredDays: 22,
      monthlySalary: 12_000_000,
      basePay: 1_090_909,
    })
    const profileStats = officeAttendanceStats([
      { checkIn: '08:30', shiftStart: employeeA.workStart },
      { checkIn: '08:30', shiftStart: employeeB.workStart },
    ])
    expect(profileStats).toMatchObject({ early: 1, late: 1, earlyMinutes: 30, lateMinutes: 30 })
  })

  it('falls back from monthly target to snapshot, employee default, then 26 days', () => {
    expect(requiredOfficeWorkingDays({ records: [{ standardWorkDaysSnapshot: 24 }], employee: {}, period: '2026-06' })).toEqual({ days: 24, source: 'snapshot' })
    expect(requiredOfficeWorkingDays({ employee: { standardWorkDays: 25 }, period: '2026-06' })).toEqual({ days: 25, source: 'employee' })
    expect(requiredOfficeWorkingDays({ employee: {}, period: '2026-06' })).toEqual({ days: 26, source: 'fallback' })
    expect(officePayrollSummary({
      records: [{ date: '2026-06-01', checkIn: '08:00', checkOut: '17:00' }],
      employee: { salary: 10_000_000, monthlyWorkdayTargets: { '2026-06': 24 } },
      period: '2026-06',
    }).basePay).toBe(416_666)
  })

  it('loads the selected month target in the Admin form without carrying another month value', () => {
    const employee = {
      standardWorkDays: 22,
      standardWorkDaysPeriod: '2026-08',
      monthlyWorkdayTargets: { '2026-08': 22, '2026-09': 24 },
    }
    expect(editableOfficeWorkdayTarget({ employee, period: '2026-09' })).toBe(24)
    expect(editableOfficeWorkdayTarget({ employee, period: '2026-10' })).toBe(26)
    expect(editableOfficeWorkdayTarget({ employee, period: '2026-08' })).toBe(22)
  })

  it('classifies a clean month as good attendance and threshold breaches as needing improvement', () => {
    const good = officeAttendanceStats([{ checkIn: '08:00', shiftStart: '08:00', arrivalTag: 'Đi đúng giờ' }])
    expect(good.rating).toBe('Chuyên cần tốt')
    const poor = officeAttendanceStats([
      { checkIn: '08:20', shiftStart: '08:00', arrivalTag: 'Đi trễ', minutesLate: 20 },
      { checkIn: '08:20', shiftStart: '08:00', arrivalTag: 'Đi trễ', minutesLate: 20 },
    ], { improveMinLateCount: 3, improveMinLateMinutes: 30 })
    expect(poor.rating).toBe('Cần cải thiện')
  })

  it('applies the maintain threshold and normalizes improve count above it', () => {
    const records = [
      { checkIn: '08:10', shiftStart: '08:00', arrivalTag: 'Đi trễ', minutesLate: 10 },
      { checkIn: '08:10', shiftStart: '08:00', arrivalTag: 'Đi trễ', minutesLate: 10 },
    ]
    const maintain = officeAttendanceStats(records, {
      maintainMaxLateCount: 2,
      improveMinLateCount: 5,
      improveMinLateMinutes: 50,
    })
    expect(maintain.rating).toBe('Cần duy trì')
    expect(maintain.thresholds.improveLateCount).toBe(5)

    const improve = officeAttendanceStats(records, {
      maintainMaxLateCount: 1,
      improveMinLateCount: 1,
      improveMinLateMinutes: 50,
    })
    expect(improve.thresholds.improveLateCount).toBe(2)
    expect(improve.rating).toBe('Cần cải thiện')
  })

  it('uses salary adjustments as primary and deduplicates the legacy Office fallback', () => {
    const items = officeSalaryAdjustments({
      employeeId: 'VP001',
      period: '2026-08',
      salaryAdjustments: [
        { id: 'new-1', employeeId: 'VP001', period: '2026-08', type: 'Thưởng khác', amount: 500_000, note: 'Hoàn thành tốt' },
        { id: 'cancelled', employeeId: 'VP001', period: '2026-08', type: 'Phụ cấp khác', amount: 900_000, note: 'Không tính', status: 'cancelled' },
      ],
      legacyAdjustments: [
        { id: 'old-copy', employeeId: 'VP001', date: '2026-08-10', type: 'Thưởng', amount: 500_000, content: 'Hoàn thành tốt' },
        { id: 'old-2', employeeId: 'VP001', date: '2026-08-11', type: 'Phụ cấp', amount: 200_000, content: 'Gửi xe' },
      ],
    })
    expect(items).toHaveLength(2)
    expect(officeAdjustmentTotals(items)).toEqual({ bonus: 500_000, allowance: 200_000, deduction: 0, net: 700_000 })
  })

  it('treats a closed payroll row as authoritative', () => {
    const summary = officePayrollSummary({
      records: [{ date: '2026-08-01', checkIn: '08:00' }],
      employee: { salary: 10_000_000 },
      period: '2026-08',
      payrollRow: {
        employeeId: 'VP001',
        workedDays: 20,
        requiredWorkingDays: 24,
        baseSalary: 10_000_000,
        gross: 10_700_000,
        salarySnapshot: { monthlySalary: 12_000_000, standardWorkDays: 24 },
      },
    })
    expect(summary).toMatchObject({ authoritative: true, actualDays: 20, requiredDays: 24, basePay: 10_000_000, gross: 10_700_000 })
  })
})
