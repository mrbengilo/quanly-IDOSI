import { describe, expect, it } from 'vitest'
import {
  AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE,
  REVENUE_BONUS_OVERRIDE_MODE,
  calculateAutomaticRevenueBonusDay,
  calculateAutomaticRevenueBonusPeriod,
} from './automaticRevenueBonus'
import {
  REVENUE_BONUS_PROGRAM_IDS,
  TEAM_MILESTONE_PROGRAM_IDS,
} from './compensationPolicies'

const base = (overrides = {}) => ({
  storeId: 'S01',
  businessDate: '2026-09-03',
  programId: REVENUE_BONUS_PROGRAM_IDS.DOSII_DAILY,
  milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.DOSII_DAILY_REVENUE,
  employees: [
    { id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'S01' },
    { id: 'E02', name: 'Trần Bình', unit: 'store', storeId: 'S01' },
  ],
  orders: [{
    id: 'O01', storeId: 'S01', amount: 16_000_000, status: 'Hoàn tất',
    createdAt: '2026-09-03T10:00:00+07:00',
  }],
  attendance: [{
    id: 'A01', storeId: 'S01', employeeId: 'E01', workDate: '2026-09-03',
    checkInAt: '2026-09-03T01:00:00.000Z', checkOutAt: '2026-09-03T05:00:00.000Z',
    workedSeconds: 14_400,
  }, {
    id: 'A02', storeId: 'S01', employeeId: 'E02', workDate: '2026-09-03',
    checkInAt: '2026-09-03T06:00:00.000Z', checkOutAt: '2026-09-03T10:00:00.000Z',
    workedSeconds: 14_400,
  }],
  supportTransfers: [],
  overrides: [],
  nowMs: Date.parse('2026-09-03T11:00:00.000Z'),
  ...overrides,
})

const allocation = (snapshot, employeeId) => snapshot.allocations.find((row) => row.employeeId === employeeId)

describe('automatic daily revenue bonus', () => {
  it('automatically applies both the current percentage formula and the highest team milestone', () => {
    const result = calculateAutomaticRevenueBonusDay(base())

    expect(result).toMatchObject({
      revenueVnd: 16_000_000,
      percentagePoolVnd: 640_000,
      milestonePoolVnd: 250_000,
      totalPoolVnd: 890_000,
      automaticAllocatedVnd: 890_000,
      allocatedVnd: 890_000,
      unallocatedVnd: 0,
      participantCount: 2,
      overrideCount: 0,
    })
    expect(allocation(result, 'E01')).toMatchObject({
      percentagePoolVnd: 320_000,
      milestonePoolVnd: 125_000,
      automaticAmountVnd: 445_000,
      amountVnd: 445_000,
      status: 'LIVE',
    })
    expect(allocation(result, 'E02').amountVnd).toBe(445_000)
  })

  it('keeps transferred support hours in the denominator but pays that employee zero', () => {
    const result = calculateAutomaticRevenueBonusDay(base({
      programId: REVENUE_BONUS_PROGRAM_IDS.SM_DAILY,
      milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE,
      employees: [
        { id: 'A', name: 'Nhân viên A', unit: 'store', storeId: 'S01' },
        { id: 'B', name: 'Nhân viên B', unit: 'store', storeId: 'S01' },
        { id: 'C', name: 'Nhân viên hỗ trợ C', unit: 'store', storeId: 'HOME' },
      ],
      orders: [{
        id: 'O-SUPPORT', storeId: 'S01', amount: 20_000_000, status: 'Hoàn tất',
        createdAt: '2026-09-03T10:00:00+07:00',
      }],
      supportTransfers: [{
        id: 'ST-C', employeeId: 'C', fromStoreId: 'HOME', toStoreId: 'S01',
        startAt: '2026-09-03T00:00:00+07:00', endAt: '2026-09-04T00:00:00+07:00',
        status: 'Hoàn tất',
      }],
      attendance: [{
        id: 'A-A', storeId: 'S01', employeeId: 'A', workDate: '2026-09-03',
        workedSeconds: 28_800, checkOutAt: '2026-09-03T10:00:00.000Z',
      }, {
        id: 'A-B', storeId: 'S01', employeeId: 'B', workDate: '2026-09-03',
        workedSeconds: 28_800, checkOutAt: '2026-09-03T10:00:00.000Z',
      }, {
        id: 'A-C', storeId: 'S01', employeeId: 'C', workDate: '2026-09-03',
        supportTransferId: 'ST-C', workedSeconds: 14_400,
        checkOutAt: '2026-09-03T10:00:00.000Z',
      }],
    }))

    expect(result).toMatchObject({
      revenueVnd: 20_000_000,
      totalPoolVnd: 1_400_000,
      automaticAllocatedVnd: 1_120_000,
      allocatedVnd: 1_120_000,
      unallocatedVnd: 280_000,
      excludedSupportShareVnd: 280_000,
      participantCount: 3,
      eligibleParticipantCount: 2,
      supportExcludedCount: 1,
    })
    expect(allocation(result, 'A')).toMatchObject({ amountVnd: 560_000, weightPercent: 40 })
    expect(allocation(result, 'B')).toMatchObject({ amountVnd: 560_000, weightPercent: 40 })
    expect(allocation(result, 'C')).toMatchObject({
      workedSeconds: 14_400,
      weightPercent: 20,
      formulaShareVnd: 280_000,
      excludedSupportShareVnd: 280_000,
      automaticAmountVnd: 0,
      amountVnd: 0,
      supportTransferred: true,
      supportTransferIds: ['ST-C'],
      status: 'SUPPORT_EXCLUDED',
    })
  })

  it('updates an open employee weight and allocation from trusted real time without a manual action', () => {
    const input = base({
      orders: [{
        id: 'O-LIVE', storeId: 'S01', amount: 2_000_000, status: 'Hoàn tất',
        createdAt: '2026-09-03T09:00:00+07:00',
      }],
      attendance: [{
        id: 'A-LIVE-1', storeId: 'S01', employeeId: 'E01', workDate: '2026-09-03',
        checkInAt: '2026-09-03T08:00:00.000Z', checkOutAt: null, workedSeconds: 0,
      }, {
        id: 'A-LIVE-2', storeId: 'S01', employeeId: 'E02', workDate: '2026-09-03',
        checkInAt: '2026-09-03T08:00:00.000Z', checkOutAt: '2026-09-03T09:00:00.000Z', workedSeconds: 3_600,
      }],
      nowMs: Date.parse('2026-09-03T09:00:00.000Z'),
    })
    const first = calculateAutomaticRevenueBonusDay(input)
    const later = calculateAutomaticRevenueBonusDay({
      ...input,
      nowMs: Date.parse('2026-09-03T10:00:00.000Z'),
    })

    expect(first.openAttendanceCount).toBe(1)
    expect(allocation(first, 'E01').workedSeconds).toBe(3_600)
    expect(allocation(first, 'E01').amountVnd).toBe(10_000)
    expect(allocation(first, 'E02').amountVnd).toBe(10_000)
    expect(allocation(later, 'E01').workedSeconds).toBe(7_200)
    expect(allocation(later, 'E01').amountVnd).toBe(13_333)
    expect(allocation(later, 'E02').amountVnd).toBe(6_667)
  })

  it('lets an active Admin amount override replace only one employee result while preserving the formula snapshot', () => {
    const result = calculateAutomaticRevenueBonusDay(base({
      overrides: [{
        id: 'RBO-01', storeId: 'S01', businessDate: '2026-09-03', employeeId: 'E01',
        employeeName: 'Nguyễn An', mode: REVENUE_BONUS_OVERRIDE_MODE.AMOUNT,
        amountVnd: 500_000, reason: 'Điều chỉnh sau đối soát', status: 'ACTIVE', version: 1,
        createdAt: '2026-09-03T11:30:00.000Z',
      }],
    }))

    expect(allocation(result, 'E01')).toMatchObject({
      automaticAmountVnd: 445_000,
      amountVnd: 500_000,
      adminAdjustmentVnd: 55_000,
      overrideId: 'RBO-01',
      overrideReason: 'Điều chỉnh sau đối soát',
      status: 'ADMIN_ADJUSTED',
    })
    expect(allocation(result, 'E02').amountVnd).toBe(445_000)
    expect(result).toMatchObject({ allocatedVnd: 945_000, adminAdjustmentVnd: 55_000 })
  })

  it('represents an Admin deletion as a zero effective amount and keeps the row restorable', () => {
    const result = calculateAutomaticRevenueBonusDay(base({
      overrides: [{
        id: 'RBO-DELETE', storeId: 'S01', businessDate: '2026-09-03', employeeId: 'E02',
        employeeName: 'Trần Bình', mode: REVENUE_BONUS_OVERRIDE_MODE.DELETED,
        amountVnd: 0, reason: 'Không đủ điều kiện sau kiểm tra', status: 'ACTIVE', version: 2,
        updatedAt: '2026-09-03T12:00:00.000Z',
      }],
    }))

    expect(allocation(result, 'E02')).toMatchObject({
      automaticAmountVnd: 445_000,
      amountVnd: 0,
      adminAdjustmentVnd: -445_000,
      overrideMode: 'DELETED',
      status: 'ADMIN_DELETED',
    })
    expect(result.allocatedVnd).toBe(445_000)
  })

  it('represents an Admin override as the only way to pay an excluded support employee', () => {
    const result = calculateAutomaticRevenueBonusDay(base({
      employees: [
        { id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'HOME' },
      ],
      attendance: [{
        id: 'A-SUPPORT', storeId: 'S01', employeeId: 'E01', workDate: '2026-09-03',
        supportTransferId: 'ST-01', workedSeconds: 14_400,
        checkOutAt: '2026-09-03T05:00:00.000Z',
      }],
      overrides: [{
        id: 'RBO-SUPPORT', storeId: 'S01', businessDate: '2026-09-03', employeeId: 'E01',
        mode: 'AMOUNT', amountVnd: 50_000, reason: 'Admin quyết định thưởng riêng', status: 'ACTIVE',
      }],
    }))

    expect(allocation(result, 'E01')).toMatchObject({
      supportTransferred: true,
      automaticAmountVnd: 0,
      amountVnd: 50_000,
      adminAdjustmentVnd: 50_000,
      status: 'ADMIN_ADJUSTED',
    })
  })

  it('keeps an override-only employee visible after the source attendance is removed', () => {
    const result = calculateAutomaticRevenueBonusDay(base({
      attendance: [],
      overrides: [{
        id: 'RBO-ONLY', storeId: 'S01', businessDate: '2026-09-03', employeeId: 'E01',
        mode: 'AMOUNT', amountVnd: 12_000, reason: 'Ghi nhận theo đối soát', status: 'ACTIVE',
      }],
    }))

    expect(result.allocations).toHaveLength(1)
    expect(result.allocations[0]).toMatchObject({
      employeeId: 'E01', workedSeconds: 0, automaticAmountVnd: 0, amountVnd: 12_000,
      status: 'ADMIN_ADJUSTED',
    })
  })

  it('builds automatic period history only from the cutover date onward', () => {
    const period = calculateAutomaticRevenueBonusPeriod({
      ...base(),
      period: '2026-09',
      orders: [{
        id: 'BEFORE', storeId: 'S01', amount: 2_000_000, status: 'Hoàn tất',
        createdAt: '2026-09-02T10:00:00+07:00',
      }, {
        id: 'AFTER', storeId: 'S01', amount: 2_000_000, status: 'Hoàn tất',
        createdAt: `${AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE}T10:00:00+07:00`,
      }],
      attendance: [{
        id: 'AFTER-A', storeId: 'S01', employeeId: 'E01',
        workDate: AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE,
        workedSeconds: 3_600, checkOutAt: `${AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE}T11:00:00+07:00`,
      }],
    })

    expect(period.days.map((day) => day.businessDate)).toEqual([AUTOMATIC_REVENUE_BONUS_EFFECTIVE_DATE])
    expect(period.allocations).toHaveLength(1)
    expect(period.allocations[0].amountVnd).toBe(20_000)
  })

  it('reports duplicate active overrides while deterministically using the latest record', () => {
    const result = calculateAutomaticRevenueBonusDay(base({
      overrides: [{
        id: 'OLD', storeId: 'S01', businessDate: '2026-09-03', employeeId: 'E01',
        mode: 'AMOUNT', amountVnd: 100, reason: 'Cũ', status: 'ACTIVE', version: 1,
        updatedAt: '2026-09-03T10:00:00.000Z',
      }, {
        id: 'NEW', storeId: 'S01', businessDate: '2026-09-03', employeeId: 'e01',
        mode: 'AMOUNT', amountVnd: 200, reason: 'Mới', status: 'ACTIVE', version: 2,
        updatedAt: '2026-09-03T11:00:00.000Z',
      }],
    }))

    expect(result.overrideCollisions).toEqual([{ employeeId: 'e01', overrideIds: ['NEW', 'OLD'] }])
    expect(allocation(result, 'E01')).toMatchObject({ amountVnd: 200, overrideId: 'NEW' })
  })
})
