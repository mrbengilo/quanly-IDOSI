// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { revenueBonusPeriodSnapshot } from './worker'

const store = { id: 'S01', name: 'SM TNV', code: 'SM-TNV', type: 'SM' }
const state = {
  stores: [store],
  employees: [
    { id: 'A', name: 'Nhân viên A', unit: 'store', storeId: 'S01' },
    { id: 'B', name: 'Nhân viên B', unit: 'store', storeId: 'S01' },
    { id: 'C', name: 'Nhân viên hỗ trợ C', unit: 'store', storeId: 'HOME' },
  ],
  orders: [{
    id: 'O01', storeId: 'S01', amount: 20_000_000, status: 'Hoàn tất',
    createdAt: '2026-09-03T10:00:00+07:00',
  }],
  attendance: [{
    id: 'AA', storeId: 'S01', employeeId: 'A', workDate: '2026-09-03',
    workedSeconds: 28_800, checkOutAt: '2026-09-03T10:00:00.000Z',
  }, {
    id: 'AB', storeId: 'S01', employeeId: 'B', workDate: '2026-09-03',
    workedSeconds: 28_800, checkOutAt: '2026-09-03T10:00:00.000Z',
  }, {
    id: 'AC', storeId: 'S01', employeeId: 'C', workDate: '2026-09-03',
    supportTransferId: 'ST-C', workedSeconds: 14_400,
    checkOutAt: '2026-09-03T10:00:00.000Z',
  }],
  supportTransfers: [{
    id: 'ST-C', employeeId: 'C', fromStoreId: 'HOME', toStoreId: 'S01',
    startAt: '2026-09-03T00:00:00+07:00', endAt: '2026-09-04T00:00:00+07:00',
    status: 'Hoàn tất',
  }],
  revenueBonusOverrides: [],
}

const allocation = (period, employeeId) => period.allocations.find((row) => row.employeeId === employeeId)

describe('server automatic revenue period projection', () => {
  it('uses complete server data and keeps support hours only in the denominator', () => {
    const period = revenueBonusPeriodSnapshot({
      state,
      store,
      period: '2026-09',
      now: '2026-09-03T15:05:00.000Z',
      canViewAllAllocations: true,
      includeAdminDetails: true,
    })

    expect(period).toMatchObject({
      storeId: 'S01',
      period: '2026-09',
      totalPoolVnd: 1_400_000,
      automaticAllocatedVnd: 1_120_000,
      allocatedVnd: 1_120_000,
      unallocatedVnd: 280_000,
      excludedSupportShareVnd: 280_000,
      dayCount: 1,
    })
    expect(allocation(period, 'A').amountVnd).toBe(560_000)
    expect(allocation(period, 'B').amountVnd).toBe(560_000)
    expect(allocation(period, 'C')).toMatchObject({
      amountVnd: 0,
      formulaShareVnd: 280_000,
      supportTransferred: true,
      status: 'SUPPORT_EXCLUDED',
    })
    expect(period.days[0]).toMatchObject({
      totalWorkedSeconds: 72_000,
      supportExcludedCount: 1,
      excludedSupportShareVnd: 280_000,
    })
    expect(period.days[0]).not.toHaveProperty('allocations')
  })

  it('returns only the requesting employee allocation while preserving the full-team denominator', () => {
    const period = revenueBonusPeriodSnapshot({
      state,
      store,
      period: '2026-09',
      now: '2026-09-03T15:05:00.000Z',
      canViewAllAllocations: false,
      viewerEmployeeIds: ['B'],
      includeAdminDetails: false,
    })

    expect(period.allocations).toHaveLength(1)
    expect(period.allocations[0]).toMatchObject({
      employeeId: 'B',
      amountVnd: 560_000,
      weightPercent: 40,
    })
    expect(period.visibleAllocatedVnd).toBe(560_000)
    expect(period.days[0].totalWorkedSeconds).toBe(72_000)
  })
})
