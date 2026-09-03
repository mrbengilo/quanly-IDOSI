import { describe, expect, it } from 'vitest'
import { revenueBonusEligibility } from './revenueBonusEligibility'

const shifts = [
  { id: 'morning', storeId: 'S1', name: 'Ca sáng', start: '08:00', end: '12:00', active: true },
  { id: 'evening', storeId: 'S1', name: 'Ca tối', start: '17:00', end: '21:00', active: true },
]

const schedule = [{
  id: 'SCH-1', storeId: 'S1', employeeId: 'E1', date: '2026-08-31',
  shiftIds: ['morning', 'evening'],
  shiftSnapshots: shifts.map(({ id, name, start, end }) => ({ id, name, start, end })),
}]

const afterCutoff = Date.parse('2026-08-31T14:01:00.000Z')

const closed = (overrides = {}) => ({
  id: 'ATT-1', storeId: 'S1', employeeId: 'E1', workDate: '2026-08-31',
  shiftId: 'evening', shiftName: 'Ca tối', shiftStart: '17:00', shiftEnd: '21:00',
  checkInAt: '2026-08-31T10:00:00.000Z', checkOutAt: '2026-08-31T14:00:00.000Z',
  ...overrides,
})

describe('revenueBonusEligibility', () => {
  it('keeps the calculation locked until 21:00 Vietnam time', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule, shiftDefinitions: shifts,
      attendance: [closed()], dailyRecords: [],
      nowMs: Date.parse('2026-08-31T13:59:59.999Z'),
    })).toMatchObject({
      allowed: false,
      code: 'BEFORE_DAILY_CUTOFF',
      cutoffAt: '2026-08-31T14:00:00.000Z',
    })
  })

  it('allows a previous uncalculated day after its own 21:00 cutoff', () => {
    expect(revenueBonusEligibility({
      storeId: 's1', businessDate: '2026-08-31', schedule, shiftDefinitions: shifts,
      attendance: [closed()], dailyRecords: [],
      nowMs: Date.parse('2026-09-01T03:00:00.000Z'),
    })).toMatchObject({
      allowed: true, code: 'READY', finalShiftId: 'evening', finalShiftAttendanceCount: 1,
      openAttendanceCount: 0, finalShiftEndAt: '2026-08-31T14:00:00.000Z',
    })
  })

  it('allows calculation only after the assigned final shift has attendance and every attendance is closed', () => {
    expect(revenueBonusEligibility({
      storeId: 's1', businessDate: '2026-08-31', schedule, shiftDefinitions: shifts,
      attendance: [closed()], dailyRecords: [], nowMs: afterCutoff,
    })).toMatchObject({
      allowed: true, code: 'READY', finalShiftId: 'evening', finalShiftAttendanceCount: 1,
      openAttendanceCount: 0, finalShiftEndAt: '2026-08-31T14:00:00.000Z',
    })
  })

  it('blocks the whole store while one employee is still working and identifies that employee by name', () => {
    const eligibility = revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule, shiftDefinitions: shifts,
      attendance: [closed(), closed({ id: 'ATT-2', employeeId: 'E2', checkOutAt: null })],
      employees: [{ id: 'E1', name: 'Nguyễn An' }, { id: 'E2', name: 'Trần Bình' }],
      nowMs: afterCutoff,
    })

    expect(eligibility).toMatchObject({
      allowed: false,
      code: 'ATTENDANCE_OPEN',
      openAttendanceCount: 1,
      openEmployeeNames: ['Trần Bình'],
    })
    expect(eligibility.openAttendanceIds).toEqual(['ATT-2'])
    expect(eligibility.message).toBe(
      'Nhân viên Trần Bình đang làm việc nên chưa tính thưởng được. Hãy chờ nhân viên Trần Bình kết ca mới được tính thưởng.',
    )
  })

  it('blocks before evaluating the final-shift schedule when any employee is still working', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule: [], shiftDefinitions: [],
      attendance: [closed({ employeeName: 'Nguyễn An', checkOutAt: null })], nowMs: afterCutoff,
    })).toMatchObject({
      allowed: false, code: 'ATTENDANCE_OPEN', openEmployeeNames: ['Nguyễn An'],
    })
  })

  it('blocks when nobody attended the assigned final shift', () => {
    const eligibility = revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule, shiftDefinitions: shifts,
      attendance: [closed({ shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00' })],
      nowMs: afterCutoff,
    })

    expect(eligibility).toMatchObject({ allowed: false, code: 'FINAL_SHIFT_NOT_ATTENDED', finalShiftId: 'evening' })
  })

  it('uses active store shift definitions when the day has no explicit schedule', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule: [], shiftDefinitions: shifts,
      attendance: [closed()], nowMs: afterCutoff,
    })).toMatchObject({ allowed: true, code: 'READY', finalShiftId: 'evening' })
  })

  it('places an overnight final shift end on the next calendar day', () => {
    const overnight = [{ id: 'night', storeId: 'S1', name: 'Ca đêm', start: '21:00', end: '02:00', active: true }]
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule: [], shiftDefinitions: overnight,
      attendance: [closed({ shiftId: 'night', shiftName: 'Ca đêm', shiftStart: '21:00', shiftEnd: '02:00' })],
      nowMs: Date.parse('2026-08-31T19:01:00.000Z'),
    })).toMatchObject({ allowed: true, finalShiftEndAt: '2026-08-31T19:00:00.000Z' })
  })

  it('blocks an already calculated store day before evaluating the cutoff or attendance', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule, shiftDefinitions: shifts,
      attendance: [closed({ checkOutAt: null })],
      dailyRecords: [{ id: 'RB-1', storeId: 's1', businessDate: '2026-08-31', status: 'APPROVED' }],
      nowMs: Date.parse('2026-08-31T01:00:00.000Z'),
    })).toMatchObject({ allowed: false, code: 'ALREADY_CALCULATED', existingId: 'RB-1' })
  })

  it('reports colliding effective daily records without choosing one', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule, shiftDefinitions: shifts,
      attendance: [closed()], nowMs: afterCutoff,
      dailyRecords: [
        { id: 'RB-1', storeId: 'S1', businessDate: '2026-08-31', status: 'APPROVED' },
        { id: 'RB-2', storeId: 's1', businessDate: '2026-08-31', status: 'APPROVED' },
      ],
    })).toMatchObject({ allowed: false, code: 'DATA_COLLISION', existingCount: 2 })
  })
})
