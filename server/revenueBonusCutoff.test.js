// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { revenueBonusLiveSnapshot } from './worker'

const stateFor = ({ revenueVnd = 2_000_000, overrides = [], open = true } = {}) => ({
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
    checkInAt: '2026-09-03T09:00:00.000Z',
    checkOutAt: open ? null : '2026-09-03T10:00:00.000Z',
    workedSeconds: open ? 0 : 3_600,
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
  it('waits for 22:00 and then waits for an open shift to close', () => {
    const beforeCutoff = revenueBonusLiveSnapshot({
      state: stateFor(),
      store,
      businessDate: '2026-09-03',
      now: '2026-09-03T14:59:59.000Z',
    })
    expect(beforeCutoff).toMatchObject({
      calculationMode: 'AUTOMATIC', editableByAdminOnly: true,
      revenueVnd: 2_000_000, totalPoolVnd: 0, openAttendanceCount: 1,
      participantCount: 0, status: 'WAITING_CUTOFF',
      calculationEligibility: { allowed: false, code: 'WAITING_CUTOFF' },
    })

    const waitingForClose = revenueBonusLiveSnapshot({
      state: stateFor(),
      store,
      businessDate: '2026-09-03',
      now: '2026-09-03T15:00:01.000Z',
    })
    expect(waitingForClose).toMatchObject({
      revenueVnd: 2_000_000, totalPoolVnd: 0, openAttendanceCount: 1,
      participantCount: 0, status: 'WAITING_SHIFT_CLOSE',
      calculationEligibility: { allowed: false, code: 'WAITING_SHIFT_CLOSE' },
    })
    expect(waitingForClose.allocations).toEqual([])
  })

  it('finalizes the percentage and highest milestone after 22:00 when all shifts are closed', () => {
    const snapshot = revenueBonusLiveSnapshot({
      state: stateFor({ revenueVnd: 16_000_000, open: false }),
      store,
      businessDate: '2026-09-03',
      now: '2026-09-03T15:00:01.000Z',
    })

    expect(snapshot).toMatchObject({
      percentagePoolVnd: 640_000,
      milestonePoolVnd: 250_000,
      totalPoolVnd: 890_000,
      allocatedVnd: 890_000,
      status: 'FINALIZED',
      calculationEligibility: { allowed: true, code: 'FINALIZED' },
    })
    expect(snapshot).not.toHaveProperty('milestoneStatus')
    expect(snapshot).not.toHaveProperty('pendingMilestonePoolVnd')
  })

  it('applies the latest Admin override after 22:00 while preserving the finalized automatic amount', () => {
    const snapshot = revenueBonusLiveSnapshot({
      state: stateFor({
        open: false,
        overrides: [{
          id: 'RBO-1', storeId: 'S01', businessDate: '2026-09-03', employeeId: 'E01',
          employeeName: 'Nguyễn An', mode: 'AMOUNT', amountVnd: 12_345,
          reason: 'Đối soát doanh thu', status: 'ACTIVE', version: 1,
          updatedAt: '2026-09-03T15:01:00.000Z',
        }],
      }),
      store,
      businessDate: '2026-09-03',
      now: '2026-09-03T15:02:00.000Z',
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
