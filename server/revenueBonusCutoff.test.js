// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { revenueBonusLiveSnapshot } from './worker'

const stateFor = ({ revenueVnd = 2_000_000, overrides = [] } = {}) => ({
  stores: [{ id: 'S01', name: 'Dosii S01', code: 'DOSII-S01' }],
  employees: [
    { id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'S01' },
    { id: 'E02', name: 'Trần Bình', unit: 'store', storeId: 'S01' },
  ],
  orders: [{
    id: 'O01', storeId: 'S01', employeeId: 'E01', amount: revenueVnd,
    status: 'Hoàn tất', createdAt: '2026-09-03T10:00:00+07:00',
  }],
  attendance: [{
    id: 'A01', storeId: 'S01', employeeId: 'E01', workDate: '2026-09-03',
    checkInAt: '2026-09-03T10:00:00.000Z', checkOutAt: null, workedSeconds: 0,
  }, {
    id: 'A02', storeId: 'S01', employeeId: 'E02', workDate: '2026-09-03',
    checkInAt: '2026-09-03T09:00:00.000Z', checkOutAt: '2026-09-03T10:00:00.000Z',
    workedSeconds: 3_600,
  }],
  revenueBonusDaily: [],
  revenueBonusAllocations: [],
  revenueBonusOverrides: overrides,
})

const store = { id: 'S01', name: 'Dosii S01', code: 'DOSII-S01' }
const allocation = (snapshot, employeeId) => snapshot.allocations.find((row) => row.employeeId === employeeId)

describe('revenueBonusLiveSnapshot automatic calculation', () => {
  it('calculates before the former 21:00 cutoff and projects an open shift from trusted server time', () => {
    const snapshot = revenueBonusLiveSnapshot({
      state: stateFor(),
      store,
      businessDate: '2026-09-03',
      now: '2026-09-03T11:00:00.000Z',
    })

    expect(snapshot).toMatchObject({
      calculationMode: 'AUTOMATIC',
      editableByAdminOnly: true,
      revenueVnd: 2_000_000,
      totalPoolVnd: 20_000,
      openAttendanceCount: 1,
      participantCount: 2,
    })
    expect(snapshot).not.toHaveProperty('calculationEligibility')
    expect(allocation(snapshot, 'E01').workedSeconds).toBe(3_600)
    expect(snapshot.allocations.reduce((sum, row) => sum + row.amountVnd, 0)).toBe(20_000)
  })

  it('automatically applies the highest milestone without creating a pending approval', () => {
    const snapshot = revenueBonusLiveSnapshot({
      state: stateFor({ revenueVnd: 16_000_000 }),
      store,
      businessDate: '2026-09-03',
      now: '2026-09-03T11:00:00.000Z',
    })

    expect(snapshot).toMatchObject({
      percentagePoolVnd: 640_000,
      milestonePoolVnd: 250_000,
      totalPoolVnd: 890_000,
      allocatedVnd: 890_000,
      status: 'LIVE',
    })
    expect(snapshot).not.toHaveProperty('milestoneStatus')
    expect(snapshot).not.toHaveProperty('pendingMilestonePoolVnd')
  })

  it('applies the latest Admin override to one employee while preserving the automatic amount', () => {
    const snapshot = revenueBonusLiveSnapshot({
      state: stateFor({
        overrides: [{
          id: 'RBO-1', storeId: 'S01', businessDate: '2026-09-03', employeeId: 'E01',
          employeeName: 'Nguyễn An', mode: 'AMOUNT', amountVnd: 12_345,
          reason: 'Đối soát doanh thu', status: 'ACTIVE', version: 1,
          updatedAt: '2026-09-03T11:01:00.000Z',
        }],
      }),
      store,
      businessDate: '2026-09-03',
      now: '2026-09-03T11:00:00.000Z',
    })

    expect(allocation(snapshot, 'E01')).toMatchObject({
      automaticAmountVnd: 10_000,
      amountVnd: 12_345,
      adminAdjustmentVnd: 2_345,
      overrideId: 'RBO-1',
      status: 'ADMIN_ADJUSTED',
    })
    expect(allocation(snapshot, 'E02').amountVnd).toBe(10_000)
  })
})
