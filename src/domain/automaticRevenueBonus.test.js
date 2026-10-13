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
import { REVENUE_BONUS_CONFIG_INVALID } from './revenueBonusConfig'

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
  nowMs: Date.parse('2026-09-03T15:01:00.000Z'),
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
      status: 'FINALIZED',
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


  it('records 1,400,000 VND payable from a 2,100,000 VND SM pool when one of three equal workers is support', () => {
    const result = calculateAutomaticRevenueBonusDay(base({
      programId: REVENUE_BONUS_PROGRAM_IDS.SM_DAILY,
      milestoneProgramId: TEAM_MILESTONE_PROGRAM_IDS.SM_DAILY_REVENUE,
      employees: [
        { id: 'A', name: 'Nhân viên A', unit: 'store', storeId: 'S01' },
        { id: 'B', name: 'Nhân viên B', unit: 'store', storeId: 'S01' },
        { id: 'C', name: 'Nhân viên hỗ trợ C', unit: 'store', storeId: 'HOME' },
      ],
      orders: [{
        id: 'O-SUPPORT-EXACT', storeId: 'S01', amount: 25_000_001, status: 'Hoàn tất',
        createdAt: '2026-09-03T10:00:00+07:00',
      }],
      supportTransfers: [{
        id: 'ST-C-EXACT', employeeId: 'C', fromStoreId: 'HOME', toStoreId: 'S01',
        startAt: '2026-09-03T00:00:00+07:00', endAt: '2026-09-04T00:00:00+07:00',
        status: 'ACTIVE',
      }],
      attendance: [{
        id: 'A-A-EXACT', storeId: 'S01', employeeId: 'A', workDate: '2026-09-03',
        workedSeconds: 28_800, checkOutAt: '2026-09-03T10:00:00.000Z',
      }, {
        id: 'A-B-EXACT', storeId: 'S01', employeeId: 'B', workDate: '2026-09-03',
        workedSeconds: 28_800, checkOutAt: '2026-09-03T10:00:00.000Z',
      }, {
        id: 'A-C-EXACT', storeId: 'S01', employeeId: 'C', workDate: '2026-09-03',
        supportTransferId: 'ST-C-EXACT', workedSeconds: 28_800,
        checkOutAt: '2026-09-03T10:00:00.000Z',
      }],
    }))

    expect(result).toMatchObject({
      percentagePoolVnd: 1_750_000,
      milestonePoolVnd: 350_000,
      totalPoolVnd: 2_100_000,
      formulaAllocatedVnd: 2_100_000,
      automaticAllocatedVnd: 1_400_000,
      allocatedVnd: 1_400_000,
      unallocatedVnd: 700_000,
      excludedSupportShareVnd: 700_000,
      totalWorkedSeconds: 86_400,
      participantCount: 3,
      eligibleParticipantCount: 2,
      supportExcludedCount: 1,
    })
    expect(allocation(result, 'A')).toMatchObject({
      workedSeconds: 28_800,
      formulaShareVnd: 700_000,
      automaticAmountVnd: 700_000,
      amountVnd: 700_000,
    })
    expect(allocation(result, 'B')).toMatchObject({
      formulaShareVnd: 700_000,
      automaticAmountVnd: 700_000,
      amountVnd: 700_000,
    })
    expect(allocation(result, 'C')).toMatchObject({
      formulaShareVnd: 700_000,
      excludedSupportShareVnd: 700_000,
      automaticAmountVnd: 0,
      amountVnd: 0,
      supportTransferred: true,
      status: 'SUPPORT_EXCLUDED',
    })
  })

  it('preserves the historical calculation before 1 September 2026', () => {
  const historical = calculateAutomaticRevenueBonusDay(base({
    businessDate: '2026-08-31',
    orders: [{
      id: 'O-HISTORY', storeId: 'S01', amount: 2_000_000, status: 'Hoàn tất',
      createdAt: '2026-08-31T10:00:00+07:00',
    }],
    attendance: [{
      id: 'A-HISTORY', storeId: 'S01', employeeId: 'E01', workDate: '2026-08-31',
      checkInAt: '2026-08-31T08:00:00+07:00', checkOutAt: null, workedSeconds: 3_600,
    }],
    nowMs: Date.parse('2026-09-01T08:00:00+07:00'),
  }))

  expect(historical).toMatchObject({
    status: 'LIVE', revenueVnd: 2_000_000, totalWorkedSeconds: 3_600,
    openAttendanceCount: 1, allocatedVnd: 20_000,
  })
  expect(historical).not.toHaveProperty('finalizedAt')
  expect(allocation(historical, 'E01')).toMatchObject({
    workedSeconds: 3_600, amountVnd: 20_000, status: 'LIVE',
  })
})

  it('waits after 22:00 while any attendance remains open and finalizes only closed stored hours', () => {
    const waiting = calculateAutomaticRevenueBonusDay(base({
      attendance: [{
        id: 'A-OPEN', storeId: 'S01', employeeId: 'E01', workDate: '2026-09-03',
        checkInAt: '2026-09-03T08:00:00.000Z', checkOutAt: null, workedSeconds: 3_600,
      }],
      nowMs: Date.parse('2026-09-03T15:05:00.000Z'),
    }))
    expect(waiting).toMatchObject({
      status: 'WAITING_SHIFT_CLOSE', openAttendanceCount: 1, allocatedVnd: 0, allocations: [],
      calculationEligibility: { allowed: false, code: 'WAITING_SHIFT_CLOSE' },
    })

    const finalized = calculateAutomaticRevenueBonusDay(base({
      attendance: [{
        id: 'A-CLOSED', storeId: 'S01', employeeId: 'E01', workDate: '2026-09-03',
        checkInAt: '2026-09-03T08:00:00.000Z', checkOutAt: '2026-09-03T10:00:00.000Z', workedSeconds: 7_200,
      }],
      nowMs: Date.parse('2026-09-03T15:05:00.000Z'),
    }))
    expect(finalized).toMatchObject({
      status: 'FINALIZED', openAttendanceCount: 0, totalWorkedSeconds: 7_200,
      calculationEligibility: { allowed: true, code: 'FINALIZED' },
    })
    expect(allocation(finalized, 'E01').workedSeconds).toBe(7_200)
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

    expect(period.days.map((day) => day.businessDate)).toEqual(['2026-09-01', '2026-09-02'])
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

describe('automatic daily revenue bonus with Admin configuration', () => {
  // Test-only tables; they differ from the legacy tables on purpose.
  const dosiiConfig = (overrides = {}) => ({
    id: 'rbc-dosii-1', storePolicy: 'DOSII', effectiveFrom: '2026-10-20', version: 1, status: 'ACTIVE',
    tiers: [{ thresholdVnd: 1_000_000, rateBasisPoints: 125 }, { thresholdVnd: 3_000_000, rateBasisPoints: 250 }],
    ...overrides,
  })
  const smConfig = {
    id: 'rbc-sm-1', storePolicy: 'SM_TNV', effectiveFrom: '2026-10-20', version: 1, status: 'ACTIVE',
    tiers: [{ thresholdVnd: 2_000_000, rateBasisPoints: 300 }, { thresholdVnd: 5_000_000, rateBasisPoints: 450 }],
  }
  const day = (businessDate, amount, overrides = {}) => base({
    businessDate,
    orders: [{ id: `O-${businessDate}`, storeId: 'S01', amount, status: 'Hoàn tất', createdAt: `${businessDate}T10:00:00+07:00` }],
    attendance: [{
      id: `A-${businessDate}`, storeId: 'S01', employeeId: 'E01', workDate: businessDate,
      checkInAt: `${businessDate}T08:00:00+07:00`, checkOutAt: `${businessDate}T12:00:00+07:00`, workedSeconds: 14_400,
    }],
    nowMs: Date.parse(`${businessDate}T23:00:00+07:00`),
    ...overrides,
  })

  it('uses the configuration effective on the business date and stores a snapshot of it', () => {
    const configs = [dosiiConfig(), smConfig]
    const before = calculateAutomaticRevenueBonusDay(day('2026-10-19', 3_000_000, { revenueBonusConfigs: configs }))
    const after = calculateAutomaticRevenueBonusDay(day('2026-10-20', 3_000_000, { revenueBonusConfigs: configs }))

    expect(before).toMatchObject({ rateBasisPoints: 200, percentagePoolVnd: 60_000, revenueBonusConfig: { source: 'LEGACY', configId: null } })
    expect(after).toMatchObject({
      status: 'FINALIZED',
      tierId: 'rbc-dosii-1.tier.1',
      rateBasisPoints: 125,
      ratePercent: 1.25,
      percentagePoolVnd: 37_500,
      revenueBonusConfig: { source: 'ADMIN_CONFIG', configId: 'rbc-dosii-1', version: 1, storePolicy: 'DOSII', effectiveFrom: '2026-10-20' },
    })
    expect(after.revenueBonusConfig.tiers).toHaveLength(2)
  })

  it('keeps the team milestone component unchanged by the percentage configuration', () => {
    const legacy = calculateAutomaticRevenueBonusDay(day('2026-10-20', 16_000_000))
    const configured = calculateAutomaticRevenueBonusDay(day('2026-10-20', 16_000_000, { revenueBonusConfigs: [dosiiConfig()] }))
    expect(configured.milestonePoolVnd).toBe(legacy.milestonePoolVnd)
    expect(configured.milestoneId).toBe(legacy.milestoneId)
    expect(configured.percentagePoolVnd).toBe(400_000)
    expect(configured.totalPoolVnd).toBe(400_000 + legacy.milestonePoolVnd)
  })

  it('keeps the legacy result byte-for-byte when no configuration exists', () => {
    const withoutConfig = calculateAutomaticRevenueBonusDay(base())
    const emptyConfig = calculateAutomaticRevenueBonusDay(base({ revenueBonusConfigs: [] }))
    expect(emptyConfig).toEqual(withoutConfig)
    expect(withoutConfig).toMatchObject({ percentagePoolVnd: 640_000, revenueBonusConfig: { source: 'LEGACY' } })
  })

  it('exposes the configured table on waiting snapshots and fails closed on corrupt configuration', () => {
    const waiting = calculateAutomaticRevenueBonusDay(day('2026-10-20', 3_000_000, {
      revenueBonusConfigs: [dosiiConfig()],
      nowMs: Date.parse('2026-10-20T21:00:00+07:00'),
    }))
    expect(waiting).toMatchObject({ status: 'WAITING_CUTOFF', revenueBonusConfig: { configId: 'rbc-dosii-1' } })
    expect(() => calculateAutomaticRevenueBonusDay(day('2026-10-20', 3_000_000, {
      revenueBonusConfigs: [dosiiConfig({ tiers: [] })],
    }))).toThrow(expect.objectContaining({ code: REVENUE_BONUS_CONFIG_INVALID }))
  })

  it('resolves every day of a period separately, across a month boundary and several versions', () => {
    const configs = [
      dosiiConfig({ effectiveFrom: '2026-10-30' }),
      dosiiConfig({ id: 'rbc-dosii-2', version: 2, effectiveFrom: '2026-11-02', tiers: [{ thresholdVnd: 1_000_000, rateBasisPoints: 500 }] }),
    ]
    const dates = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']
    const orders = dates.map((date) => ({ id: `O-${date}`, storeId: 'S01', amount: 2_000_000, status: 'Hoàn tất', createdAt: `${date}T10:00:00+07:00` }))
    const attendance = dates.map((date) => ({
      id: `A-${date}`, storeId: 'S01', employeeId: 'E01', workDate: date,
      checkInAt: `${date}T08:00:00+07:00`, checkOutAt: `${date}T12:00:00+07:00`, workedSeconds: 14_400,
    }))
    const input = { ...base(), orders, attendance, revenueBonusConfigs: configs, nowMs: Date.parse('2026-11-03T08:00:00+07:00') }
    const october = calculateAutomaticRevenueBonusPeriod({ ...input, period: '2026-10' })
    const november = calculateAutomaticRevenueBonusPeriod({ ...input, period: '2026-11' })
    expect(october.days.map((entry) => [entry.businessDate, entry.rateBasisPoints, entry.percentagePoolVnd, entry.revenueBonusConfig.version]))
      .toEqual([['2026-10-29', 100, 20_000, null], ['2026-10-30', 125, 25_000, 1], ['2026-10-31', 125, 25_000, 1]])
    expect(november.days.map((entry) => [entry.businessDate, entry.rateBasisPoints, entry.revenueBonusConfig.version]))
      .toEqual([['2026-11-01', 125, 1], ['2026-11-02', 500, 2]])
  })

  it('uses the business date of a late catch-up run, not the time the job executes', () => {
    const configs = [dosiiConfig({ effectiveFrom: '2026-10-21' })]
    const lateRun = calculateAutomaticRevenueBonusDay(day('2026-10-20', 3_000_000, {
      revenueBonusConfigs: configs,
      nowMs: Date.parse('2026-10-25T09:00:00+07:00'),
    }))
    expect(lateRun).toMatchObject({ status: 'FINALIZED', rateBasisPoints: 200, revenueBonusConfig: { source: 'LEGACY' } })
  })
})
