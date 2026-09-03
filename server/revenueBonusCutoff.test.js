// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { revenueBonusLiveSnapshot } from './worker'

const legacyState = () => ({
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

const septemberState = (storeId) => {
  const shiftDefinitions = [
    { id: 'morning', storeId, name: 'Ca sáng', start: '08:30', end: '12:00', active: true },
    { id: 'afternoon', storeId, name: 'Ca chiều', start: '13:00', end: '17:30', active: true },
    { id: 'night', storeId, name: 'Ca tối', start: '18:00', end: '21:00', active: true },
  ]
  return {
    employees: [
      { id: `${storeId}-E01`, name: 'Nguyễn An', unit: 'store', storeId },
      { id: `${storeId}-E02`, name: 'Trần Bình', unit: 'store', storeId },
    ],
    orders: [
      {
        id: `${storeId}-O01`, storeId, employeeId: `${storeId}-E01`, amount: 1_000_000,
        status: 'Hoàn tất', createdAt: '2026-09-02T10:00:00+07:00',
      },
      {
        id: `${storeId}-O02`, storeId, employeeId: `${storeId}-E02`, amount: 1_585_000,
        status: 'Hoàn tất', createdAt: '2026-09-02T16:00:00+07:00',
      },
    ],
    attendance: [
      {
        id: `${storeId}-A01`, storeId, employeeId: `${storeId}-E01`, workDate: '2026-09-02',
        shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '08:30', shiftEnd: '12:00',
        checkInAt: '2026-09-02T01:30:00.000Z', checkOutAt: '2026-09-02T05:00:00.000Z',
        workedSeconds: 12_600,
      },
      {
        id: `${storeId}-A02`, storeId, employeeId: `${storeId}-E02`, workDate: '2026-09-02',
        shiftId: 'afternoon', shiftName: 'Ca chiều', shiftStart: '13:00', shiftEnd: '17:30',
        checkInAt: '2026-09-02T06:00:00.000Z', checkOutAt: '2026-09-02T10:30:00.000Z',
        workedSeconds: 16_200,
      },
    ],
    schedule: [{
      id: `${storeId}-SCH`, storeId, employeeId: `${storeId}-E01`, date: '2026-09-02',
      shiftSnapshots: shiftDefinitions.map(({ id, name, start, end }) => ({ id, name, start, end })),
    }],
    shiftDefinitions,
    revenueBonusDaily: [],
  }
}

describe('revenueBonusLiveSnapshot daily cutoff', () => {
  it('uses trusted server time for 21:00 and exposes the open employee name without attendance identifiers', () => {
    const beforeCutoff = revenueBonusLiveSnapshot({
      state: legacyState(),
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
      state: legacyState(),
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

  it.each([
    [{ id: 'DOSII-DI-AN', name: 'Dosii Dĩ An', code: 'DOSII-DI-AN' }],
    [{ id: 'DOSII-CAN-THO', name: 'Dosii Cần Thơ', code: 'DOSII-CAN-THO' }],
    [{ id: 'SM-TNV', name: 'SM TNV', code: 'SM-TNV', type: 'SM' }],
  ])('uses actual completed shifts for every store from 01/09/2026: $name', (store) => {
    const snapshot = revenueBonusLiveSnapshot({
      state: septemberState(store.id),
      store,
      businessDate: '2026-09-02',
      now: '2026-09-03T03:00:00.000Z',
    })

    expect(snapshot).toMatchObject({
      storeId: store.id,
      businessDate: '2026-09-02',
      revenueVnd: 2_585_000,
      orderCount: 2,
      attendanceCount: 2,
      openAttendanceCount: 0,
      participantCount: 2,
      calculationEligibility: {
        allowed: true,
        code: 'READY',
        eligibilityRule: 'ACTUAL_WORKED_SHIFTS',
        attendanceCount: 2,
        closedAttendanceCount: 2,
        workedShiftCount: 2,
        finalShiftId: 'afternoon',
        finalShiftName: 'Ca chiều',
      },
    })
    expect(snapshot.calculationEligibility).not.toHaveProperty('openAttendanceIds')
  })
})
