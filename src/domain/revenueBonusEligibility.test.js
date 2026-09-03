import { describe, expect, it } from 'vitest'
import {
  REVENUE_BONUS_ACTUAL_ATTENDANCE_EFFECTIVE_DATE,
  REVENUE_BONUS_ELIGIBILITY_RULES,
  revenueBonusEligibility,
} from './revenueBonusEligibility'

const shifts = [
  { id: 'morning', storeId: 'S1', name: 'Ca sáng', start: '08:00', end: '12:00', active: true },
  { id: 'evening', storeId: 'S1', name: 'Ca tối', start: '17:00', end: '21:00', active: true },
]

const schedule = [{
  id: 'SCH-1', storeId: 'S1', employeeId: 'E1', date: '2026-08-31',
  shiftIds: ['morning', 'evening'],
  shiftSnapshots: shifts.map(({ id, name, start, end }) => ({ id, name, start, end })),
}]

const afterLegacyCutoff = Date.parse('2026-08-31T14:01:00.000Z')
const afterSeptemberCutoff = Date.parse('2026-09-02T14:01:00.000Z')

const closed = (overrides = {}) => ({
  id: 'ATT-1', storeId: 'S1', employeeId: 'E1', workDate: '2026-08-31',
  shiftId: 'evening', shiftName: 'Ca tối', shiftStart: '17:00', shiftEnd: '21:00',
  checkInAt: '2026-08-31T10:00:00.000Z', checkOutAt: '2026-08-31T14:00:00.000Z',
  workedSeconds: 14_400,
  ...overrides,
})

const septemberAttendance = (overrides = {}) => closed({
  id: 'ATT-SEP-1',
  storeId: 'S-DIAN',
  employeeId: 'E-DIAN-1',
  workDate: '2026-09-02',
  shiftId: 'afternoon',
  shiftName: 'Ca chiều',
  shiftStart: '13:00',
  shiftEnd: '17:30',
  checkInAt: '2026-09-02T06:00:00.000Z',
  checkOutAt: '2026-09-02T10:30:00.000Z',
  workedSeconds: 16_200,
  ...overrides,
})

describe('revenueBonusEligibility', () => {
  it('publishes the effective date of the actual worked-shift rule', () => {
    expect(REVENUE_BONUS_ACTUAL_ATTENDANCE_EFFECTIVE_DATE).toBe('2026-09-01')
  })

  it('keeps the calculation locked until 21:00 Vietnam time', () => {
    expect(revenueBonusEligibility({
      storeId: 'S-DIAN', businessDate: '2026-09-02',
      attendance: [septemberAttendance()], dailyRecords: [],
      nowMs: Date.parse('2026-09-02T13:59:59.999Z'),
    })).toMatchObject({
      allowed: false,
      code: 'BEFORE_DAILY_CUTOFF',
      eligibilityRule: REVENUE_BONUS_ELIGIBILITY_RULES.ACTUAL_WORKED_SHIFTS,
      cutoffAt: '2026-09-02T14:00:00.000Z',
    })
  })

  it('allows a previous uncalculated day at any later time after its own cutoff', () => {
    expect(revenueBonusEligibility({
      storeId: 'S-DIAN', businessDate: '2026-09-02',
      attendance: [septemberAttendance()], dailyRecords: [],
      nowMs: Date.parse('2026-09-03T03:00:00.000Z'),
    })).toMatchObject({
      allowed: true,
      code: 'READY',
      eligibilityRule: REVENUE_BONUS_ELIGIBILITY_RULES.ACTUAL_WORKED_SHIFTS,
      attendanceCount: 1,
      closedAttendanceCount: 1,
      openAttendanceCount: 0,
    })
  })

  it('allows Dosii Dĩ An when all actual shifts are closed even if a later configured shift was not worked', () => {
    const storeId = 'S-DIAN'
    const configuredShifts = [
      { id: 'morning', storeId, name: 'Ca sáng', start: '08:30', end: '12:00', active: true },
      { id: 'afternoon', storeId, name: 'Ca chiều', start: '13:00', end: '17:30', active: true },
      { id: 'night', storeId, name: 'Ca tối', start: '18:00', end: '21:00', active: true },
    ]
    const daySchedule = [{
      id: 'SCH-DIAN', storeId, employeeId: 'E-DIAN-1', date: '2026-09-02',
      shiftSnapshots: configuredShifts.map(({ id, name, start, end }) => ({ id, name, start, end })),
    }]
    const attendance = [
      septemberAttendance({
        id: 'ATT-DIAN-MORNING', shiftId: 'morning', shiftName: 'Ca sáng',
        shiftStart: '08:30', shiftEnd: '12:00', workedSeconds: 12_600,
      }),
      septemberAttendance({ id: 'ATT-DIAN-AFTERNOON' }),
    ]

    expect(revenueBonusEligibility({
      storeId,
      businessDate: '2026-09-02',
      schedule: daySchedule,
      shiftDefinitions: configuredShifts,
      attendance,
      dailyRecords: [],
      nowMs: Date.parse('2026-09-03T03:00:00.000Z'),
    })).toMatchObject({
      allowed: true,
      code: 'READY',
      eligibilityRule: REVENUE_BONUS_ELIGIBILITY_RULES.ACTUAL_WORKED_SHIFTS,
      attendanceCount: 2,
      closedAttendanceCount: 2,
      workedShiftCount: 2,
      finalShiftId: 'afternoon',
      finalShiftName: 'Ca chiều',
      finalShiftAttendanceCount: 1,
      finalShiftEndAt: '2026-09-02T10:30:00.000Z',
    })
  })

  it.each([
    ['DOSII-DI-AN', 'Dosii Dĩ An'],
    ['DOSII-CAN-THO', 'Dosii Cần Thơ'],
    ['SM-TNV', 'SM TNV'],
  ])('applies the September rule consistently to every store type: %s', (storeId) => {
    const attendance = [septemberAttendance({ storeId, employeeId: `${storeId}-E1` })]
    expect(revenueBonusEligibility({
      storeId,
      businessDate: '2026-09-02',
      schedule: [],
      shiftDefinitions: [],
      attendance,
      dailyRecords: [],
      nowMs: afterSeptemberCutoff,
    })).toMatchObject({
      allowed: true,
      code: 'READY',
      eligibilityRule: REVENUE_BONUS_ELIGIBILITY_RULES.ACTUAL_WORKED_SHIFTS,
    })
  })

  it('blocks a September day that has no attendance instead of creating an empty allocation', () => {
    expect(revenueBonusEligibility({
      storeId: 'S-DIAN', businessDate: '2026-09-02', attendance: [], dailyRecords: [],
      nowMs: afterSeptemberCutoff,
    })).toMatchObject({
      allowed: false,
      code: 'NO_ATTENDANCE',
      attendanceCount: 0,
      eligibilityRule: REVENUE_BONUS_ELIGIBILITY_RULES.ACTUAL_WORKED_SHIFTS,
    })
  })

  it('blocks the whole store while one employee is still working and identifies that employee by name', () => {
    const eligibility = revenueBonusEligibility({
      storeId: 'S-DIAN', businessDate: '2026-09-02',
      attendance: [
        septemberAttendance(),
        septemberAttendance({ id: 'ATT-SEP-2', employeeId: 'E-DIAN-2', checkOutAt: null }),
      ],
      employees: [
        { id: 'E-DIAN-1', name: 'Nguyễn An' },
        { id: 'E-DIAN-2', name: 'Trần Bình' },
      ],
      nowMs: afterSeptemberCutoff,
    })

    expect(eligibility).toMatchObject({
      allowed: false,
      code: 'ATTENDANCE_OPEN',
      openAttendanceCount: 1,
      openEmployeeNames: ['Trần Bình'],
      eligibilityRule: REVENUE_BONUS_ELIGIBILITY_RULES.ACTUAL_WORKED_SHIFTS,
    })
    expect(eligibility.openAttendanceIds).toEqual(['ATT-SEP-2'])
    expect(eligibility.message).toBe(
      'Nhân viên Trần Bình đang làm việc nên chưa tính thưởng được. Hãy chờ nhân viên Trần Bình kết ca mới được tính thưởng.',
    )
  })

  it('preserves the assigned-final-shift rule for dates before 01/09/2026', () => {
    const eligibility = revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule, shiftDefinitions: shifts,
      attendance: [closed({ shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00' })],
      nowMs: afterLegacyCutoff,
    })

    expect(eligibility).toMatchObject({
      allowed: false,
      code: 'FINAL_SHIFT_NOT_ATTENDED',
      finalShiftId: 'evening',
      eligibilityRule: REVENUE_BONUS_ELIGIBILITY_RULES.ASSIGNED_FINAL_SHIFT,
    })
  })

  it('matches a legacy final shift by shiftId even when attendance has no time snapshot', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule, shiftDefinitions: shifts,
      attendance: [closed({ shiftStart: null, shiftEnd: null })],
      nowMs: afterLegacyCutoff,
    })).toMatchObject({
      allowed: true,
      code: 'READY',
      finalShiftId: 'evening',
      finalShiftAttendanceCount: 1,
    })
  })

  it('uses active store shift definitions for the legacy rule when the day has no explicit schedule', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule: [], shiftDefinitions: shifts,
      attendance: [closed()], nowMs: afterLegacyCutoff,
    })).toMatchObject({
      allowed: true,
      code: 'READY',
      finalShiftId: 'evening',
      eligibilityRule: REVENUE_BONUS_ELIGIBILITY_RULES.ASSIGNED_FINAL_SHIFT,
    })
  })

  it('places an overnight legacy final shift end on the next calendar day', () => {
    const overnight = [{ id: 'night', storeId: 'S1', name: 'Ca đêm', start: '21:00', end: '02:00', active: true }]
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule: [], shiftDefinitions: overnight,
      attendance: [closed({ shiftId: 'night', shiftName: 'Ca đêm', shiftStart: '21:00', shiftEnd: '02:00' })],
      nowMs: Date.parse('2026-08-31T19:01:00.000Z'),
    })).toMatchObject({ allowed: true, finalShiftEndAt: '2026-08-31T19:00:00.000Z' })
  })

  it('blocks an already calculated store day before evaluating the cutoff or attendance', () => {
    expect(revenueBonusEligibility({
      storeId: 'S-DIAN', businessDate: '2026-09-02',
      attendance: [septemberAttendance({ checkOutAt: null })],
      dailyRecords: [{ id: 'RB-1', storeId: 's-dian', businessDate: '2026-09-02', status: 'APPROVED' }],
      nowMs: Date.parse('2026-09-02T01:00:00.000Z'),
    })).toMatchObject({ allowed: false, code: 'ALREADY_CALCULATED', existingId: 'RB-1' })
  })

  it('reports colliding effective daily records without choosing one', () => {
    expect(revenueBonusEligibility({
      storeId: 'S-DIAN', businessDate: '2026-09-02',
      attendance: [septemberAttendance()], nowMs: afterSeptemberCutoff,
      dailyRecords: [
        { id: 'RB-1', storeId: 'S-DIAN', businessDate: '2026-09-02', status: 'APPROVED' },
        { id: 'RB-2', storeId: 's-dian', businessDate: '2026-09-02', status: 'APPROVED' },
      ],
    })).toMatchObject({ allowed: false, code: 'DATA_COLLISION', existingCount: 2 })
  })
})
