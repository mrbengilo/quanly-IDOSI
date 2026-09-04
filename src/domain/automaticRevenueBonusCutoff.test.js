import { describe, expect, it } from 'vitest'
import { calculateAutomaticRevenueBonusDay } from './automaticRevenueBonus'
import { REVENUE_BONUS_PROGRAM_IDS, TEAM_MILESTONE_PROGRAM_IDS } from './compensationPolicies'

const input = (overrides = {}) => ({
  storeId: 'S01', businessDate: '2026-09-02',
  programId: REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY,
  milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE,
  orders: [{ id: 'O1', storeId: 'S01', amount: 2_000_000, status: 'Hoàn tất', createdAt: '2026-09-02T10:00:00+07:00' }],
  employees: [{ id: 'E1', name: 'Nhân viên', storeId: 'S01', unit: 'store' }],
  attendance: [{ id: 'A1', storeId: 'S01', employeeId: 'E1', workDate: '2026-09-02', workedSeconds: 28_800, checkOutAt: '2026-09-02T10:00:00.000Z' }],
  ...overrides,
})

describe('automatic revenue 22:00 finalization gate', () => {
  it('does not calculate revenue bonus before 22:00 Vietnam time', () => {
    const result = calculateAutomaticRevenueBonusDay(input({ nowMs: Date.parse('2026-09-02T14:59:59.000Z') }))
    expect(result).toMatchObject({
      status: 'WAITING_CUTOFF', revenueVnd: 2_000_000, totalPoolVnd: 0, allocations: [],
      calculationEligibility: { allowed: false, code: 'WAITING_CUTOFF', cutoffAt: '2026-09-02T15:00:00.000Z' },
    })
  })

  it('does not create an empty result after 22:00 without attendance', () => {
    const result = calculateAutomaticRevenueBonusDay(input({
      attendance: [], nowMs: Date.parse('2026-09-02T15:00:01.000Z'),
    }))
    expect(result).toMatchObject({
      status: 'NO_ATTENDANCE', attendanceCount: 0, totalPoolVnd: 0, allocations: [],
      calculationEligibility: { allowed: false, code: 'NO_ATTENDANCE' },
    })
  })
})


describe('automatic revenue pre-cutover compatibility', () => {
  it('keeps stored historical hours and live status before 01/09/2026', () => {
    const result = calculateAutomaticRevenueBonusDay(input({
      businessDate: '2026-08-30',
      orders: [{
        id: 'O-LEGACY', storeId: 'S01', amount: 2_000_000, status: 'Hoàn tất',
        createdAt: '2026-08-30T10:00:00+07:00',
      }],
      attendance: [{
        id: 'A-LEGACY', storeId: 'S01', employeeId: 'E1', workDate: '2026-08-30',
        workedSeconds: 3_600, checkInAt: '2026-08-30T08:00:00.000Z', checkOutAt: null,
      }],
      nowMs: Date.parse('2026-08-31T05:00:00.000Z'),
    }))
    expect(result).toMatchObject({
      status: 'LIVE', totalWorkedSeconds: 3_600, openAttendanceCount: 1,
      allocations: [{ employeeId: 'E1', workedSeconds: 3_600 }],
    })
    expect(result).not.toHaveProperty('calculationEligibility')
  })
})
