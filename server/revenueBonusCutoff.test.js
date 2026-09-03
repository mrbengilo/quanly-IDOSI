// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { revenueBonusLiveSnapshot } from './worker'

const state = () => ({
  employees: [{ id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'S01' }],
  orders: [{
    id: 'O01', storeId: 'S01', employeeId: 'E01', amount: 1_000_000,
    status: 'Hoàn tất', createdAt: '2026-08-26T10:00:00+07:00',
  }],
  attendance: [{
    id: 'A01', storeId: 'S01', employeeId: 'E01', workDate: '2026-08-26',
    shiftId: 'night', shiftName: 'Ca tối', shiftStart: '18:00', shiftEnd: '21:00',
    checkInAt: '2026-08-26T11:00:00.000Z', checkOutAt: null, workedSeconds: 10_800,
  }],
  schedule: [],
  shiftDefinitions: [{ id: 'night', storeId: 'S01', name: 'Ca tối', start: '18:00', end: '21:00', active: true }],
  revenueBonusDaily: [],
})

describe('revenueBonusLiveSnapshot daily cutoff', () => {
  it('uses trusted server time for 21:00 and exposes the open employee name without attendance identifiers', () => {
    const beforeCutoff = revenueBonusLiveSnapshot({
      state: state(),
      store: { id: 'S01', name: 'Dosii S01', code: 'DOSII-S01' },
      businessDate: '2026-08-26',
      now: '2026-08-26T13:59:59.000Z',
    })
    expect(beforeCutoff.calculationEligibility).toMatchObject({
      allowed: false,
      code: 'BEFORE_DAILY_CUTOFF',
      cutoffAt: '2026-08-26T14:00:00.000Z',
    })

    const afterCutoff = revenueBonusLiveSnapshot({
      state: state(),
      store: { id: 'S01', name: 'Dosii S01', code: 'DOSII-S01' },
      businessDate: '2026-08-26',
      now: '2026-08-26T14:00:01.000Z',
    })
    expect(afterCutoff.calculationEligibility).toMatchObject({
      allowed: false,
      code: 'ATTENDANCE_OPEN',
      openEmployeeNames: ['Nguyễn An'],
      message: 'Nhân viên Nguyễn An đang làm việc nên chưa tính thưởng được. Hãy chờ nhân viên Nguyễn An kết ca mới được tính thưởng.',
    })
    expect(afterCutoff.calculationEligibility).not.toHaveProperty('openAttendanceIds')
  })
})
