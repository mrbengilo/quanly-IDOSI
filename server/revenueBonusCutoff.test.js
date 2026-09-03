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

const dianSeptemberState = ({ calculated = false } = {}) => ({
  employees: [
    { id: 'E01', name: 'Nguyễn An', unit: 'store', storeId: 'DOSII-DI-AN' },
    { id: 'E02', name: 'Trần Bình', unit: 'store', storeId: 'DOSII-DI-AN' },
  ],
  orders: [{
    id: 'DIAN-O01', storeId: 'DOSII-DI-AN', employeeId: 'E01', amount: 2_585_000,
    status: 'Hoàn tất', createdAt: '2026-09-02T16:00:00+07:00',
  }],
  attendance: [
    {
      id: 'DIAN-A01', storeId: 'DOSII-DI-AN', employeeId: 'E01', workDate: '2026-09-02',
      shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
      checkInAt: '2026-09-02T01:00:00.000Z', checkOutAt: '2026-09-02T05:00:00.000Z', workedSeconds: 14_400,
    },
    {
      id: 'DIAN-A02', storeId: 'DOSII-DI-AN', employeeId: 'E02', workDate: '2026-09-02',
      shiftId: 'afternoon', shiftName: 'Ca chiều', shiftStart: '13:00', shiftEnd: '17:30',
      checkInAt: '2026-09-02T06:00:00.000Z', checkOutAt: '2026-09-02T10:30:00.000Z', workedSeconds: 16_200,
    },
  ],
  schedule: [{
    id: 'DIAN-SCHEDULE', storeId: 'DOSII-DI-AN', employeeId: 'E01', date: '2026-09-02',
    shiftIds: ['morning', 'evening'],
    shiftSnapshots: [
      { id: 'morning', name: 'Ca sáng', start: '08:00', end: '12:00' },
      { id: 'evening', name: 'Ca tối', start: '18:00', end: '21:00' },
    ],
  }],
  shiftDefinitions: [
    { id: 'morning', storeId: 'DOSII-DI-AN', name: 'Ca sáng', start: '08:00', end: '12:00', active: true },
    { id: 'evening', storeId: 'DOSII-DI-AN', name: 'Ca tối', start: '18:00', end: '21:00', active: true },
  ],
  revenueBonusDaily: calculated ? [{
    id: 'DIAN-RB-0209', storeId: 'DOSII-DI-AN', businessDate: '2026-09-02', status: 'APPROVED',
  }] : [],
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

  it('opens Dosii Dĩ An 02/09 across the server contract without requiring attendance in the configured final shift', () => {
    const snapshot = revenueBonusLiveSnapshot({
      state: dianSeptemberState(),
      store: { id: 'DOSII-DI-AN', name: 'Dosii Dĩ An', code: 'DOSII-DI-AN' },
      businessDate: '2026-09-02',
      now: '2026-09-03T03:00:00.000Z',
    })

    expect(snapshot).toMatchObject({
      storeId: 'DOSII-DI-AN',
      businessDate: '2026-09-02',
      revenueVnd: 2_585_000,
      attendanceCount: 2,
      openAttendanceCount: 0,
      participantCount: 2,
    })
    expect(snapshot.calculationEligibility).toMatchObject({
      allowed: true,
      code: 'READY',
      attendanceCount: 2,
      finalShiftId: 'evening',
      finalShiftAttendanceCount: 0,
      ruleCode: 'DAILY_CLOSE_V2',
      ruleEffectiveFrom: '2026-09-01',
    })
  })

  it('keeps a September store-day that was already calculated locked', () => {
    const snapshot = revenueBonusLiveSnapshot({
      state: dianSeptemberState({ calculated: true }),
      store: { id: 'DOSII-DI-AN', name: 'Dosii Dĩ An', code: 'DOSII-DI-AN' },
      businessDate: '2026-09-02',
      now: '2026-09-03T03:00:00.000Z',
    })

    expect(snapshot.calculationEligibility).toMatchObject({
      allowed: false,
      code: 'ALREADY_CALCULATED',
      ruleCode: 'DAILY_CLOSE_V2',
    })
    expect(snapshot.calculationEligibility).not.toHaveProperty('existingId')
  })
})
