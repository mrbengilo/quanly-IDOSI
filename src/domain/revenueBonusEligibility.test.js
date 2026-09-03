import { describe, expect, it } from 'vitest'
import {
  REVENUE_BONUS_DAILY_CLOSE_RULE_EFFECTIVE_DATE,
  revenueBonusEligibility,
  usesRevenueBonusDailyCloseRule,
} from './revenueBonusEligibility'

const shifts = [
  { id: 'morning', storeId: 'S1', name: 'Ca sáng', start: '08:00', end: '12:00', active: true },
  { id: 'evening', storeId: 'S1', name: 'Ca tối', start: '17:00', end: '21:00', active: true },
]

const scheduleFor = (date, storeId = 'S1') => [{
  id: `SCH-${storeId}-${date}`,
  storeId,
  employeeId: 'E1',
  date,
  shiftIds: ['morning', 'evening'],
  shiftSnapshots: shifts.map(({ id, name, start, end }) => ({ id, name, start, end })),
}]

const afterLegacyCutoff = Date.parse('2026-08-31T14:01:00.000Z')
const afterSeptemberDay = Date.parse('2026-09-03T03:00:00.000Z')

const closed = (overrides = {}) => ({
  id: 'ATT-1', storeId: 'S1', employeeId: 'E1', workDate: '2026-08-31',
  shiftId: 'evening', shiftName: 'Ca tối', shiftStart: '17:00', shiftEnd: '21:00',
  checkInAt: '2026-08-31T10:00:00.000Z', checkOutAt: '2026-08-31T14:00:00.000Z',
  ...overrides,
})

describe('revenueBonusEligibility', () => {
  it('publishes the system-wide rule boundary starting on 01/09/2026', () => {
    expect(REVENUE_BONUS_DAILY_CLOSE_RULE_EFFECTIVE_DATE).toBe('2026-09-01')
    expect(usesRevenueBonusDailyCloseRule('2026-08-31')).toBe(false)
    expect(usesRevenueBonusDailyCloseRule('2026-09-01')).toBe(true)
    expect(usesRevenueBonusDailyCloseRule('2026-09-02')).toBe(true)
    expect(usesRevenueBonusDailyCloseRule('invalid')).toBe(false)
  })

  it('keeps the calculation locked until 21:00 Vietnam time', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule: scheduleFor('2026-08-31'), shiftDefinitions: shifts,
      attendance: [closed()], dailyRecords: [],
      nowMs: Date.parse('2026-08-31T13:59:59.999Z'),
    })).toMatchObject({
      allowed: false,
      code: 'BEFORE_DAILY_CUTOFF',
      cutoffAt: '2026-08-31T14:00:00.000Z',
      ruleCode: 'FINAL_SHIFT_V1',
    })
  })

  it('allows a previous uncalculated day after its own 21:00 cutoff', () => {
    expect(revenueBonusEligibility({
      storeId: 's1', businessDate: '2026-08-31', schedule: scheduleFor('2026-08-31'), shiftDefinitions: shifts,
      attendance: [closed()], dailyRecords: [],
      nowMs: Date.parse('2026-09-01T03:00:00.000Z'),
    })).toMatchObject({
      allowed: true, code: 'READY', finalShiftId: 'evening', finalShiftAttendanceCount: 1,
      openAttendanceCount: 0, finalShiftEndAt: '2026-08-31T14:00:00.000Z',
    })
  })

  it('allows the legacy rule only after the assigned final shift has attendance and every attendance is closed', () => {
    expect(revenueBonusEligibility({
      storeId: 's1', businessDate: '2026-08-31', schedule: scheduleFor('2026-08-31'), shiftDefinitions: shifts,
      attendance: [closed()], dailyRecords: [], nowMs: afterLegacyCutoff,
    })).toMatchObject({
      allowed: true, code: 'READY', finalShiftId: 'evening', finalShiftAttendanceCount: 1,
      openAttendanceCount: 0, finalShiftEndAt: '2026-08-31T14:00:00.000Z',
      ruleCode: 'FINAL_SHIFT_V1',
    })
  })

  it('blocks the whole store while one employee is still working and identifies that employee by name', () => {
    const eligibility = revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule: scheduleFor('2026-08-31'), shiftDefinitions: shifts,
      attendance: [closed(), closed({ id: 'ATT-2', employeeId: 'E2', checkOutAt: null })],
      employees: [{ id: 'E1', name: 'Nguyễn An' }, { id: 'E2', name: 'Trần Bình' }],
      nowMs: afterLegacyCutoff,
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
      storeId: 'S1', businessDate: '2026-09-02', schedule: [], shiftDefinitions: [],
      attendance: [closed({ workDate: '2026-09-02', employeeName: 'Nguyễn An', checkOutAt: null })],
      nowMs: afterSeptemberDay,
    })).toMatchObject({
      allowed: false, code: 'ATTENDANCE_OPEN', openEmployeeNames: ['Nguyễn An'], ruleCode: 'DAILY_CLOSE_V2',
    })
  })

  it('keeps the pre-September legacy requirement when nobody attended the assigned final shift', () => {
    const eligibility = revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule: scheduleFor('2026-08-31'), shiftDefinitions: shifts,
      attendance: [closed({ shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00' })],
      nowMs: afterLegacyCutoff,
    })

    expect(eligibility).toMatchObject({
      allowed: false, code: 'FINAL_SHIFT_NOT_ATTENDED', finalShiftId: 'evening', ruleCode: 'FINAL_SHIFT_V1',
    })
  })

  it('opens Dosii Dĩ An on 02/09 when worked shifts are closed even though the configured final shift was not attended', () => {
    const businessDate = '2026-09-02'
    const attendance = [
      closed({
        id: 'DIAN-MORNING', storeId: 'DOSII-DI-AN', workDate: businessDate,
        shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
        checkInAt: '2026-09-02T01:00:00.000Z', checkOutAt: '2026-09-02T05:00:00.000Z',
      }),
      closed({
        id: 'DIAN-AFTERNOON', storeId: 'DOSII-DI-AN', workDate: businessDate,
        shiftId: 'afternoon', shiftName: 'Ca chiều', shiftStart: '13:00', shiftEnd: '17:30',
        checkInAt: '2026-09-02T06:00:00.000Z', checkOutAt: '2026-09-02T10:30:00.000Z',
      }),
    ]

    expect(revenueBonusEligibility({
      storeId: 'DOSII-DI-AN',
      businessDate,
      schedule: scheduleFor(businessDate, 'DOSII-DI-AN'),
      shiftDefinitions: shifts,
      attendance,
      nowMs: afterSeptemberDay,
    })).toMatchObject({
      allowed: true,
      code: 'READY',
      attendanceCount: 2,
      openAttendanceCount: 0,
      finalShiftId: 'evening',
      finalShiftAttendanceCount: 0,
      ruleCode: 'DAILY_CLOSE_V2',
      ruleEffectiveFrom: '2026-09-01',
    })
  })

  it('applies the September daily-close rule uniformly to every store identifier', () => {
    const storeIds = ['DOSII-DI-AN', 'DOSII-CAN-THO', 'DOSII-NTL', 'SM-TNV']
    for (const storeId of storeIds) {
      const businessDate = '2026-09-02'
      const storeShifts = shifts.map((shift) => ({ ...shift, storeId }))
      const eligibility = revenueBonusEligibility({
        storeId,
        businessDate,
        schedule: scheduleFor(businessDate, storeId),
        shiftDefinitions: storeShifts,
        attendance: [closed({
          id: `${storeId}-ATT`, storeId, workDate: businessDate,
          shiftId: 'morning', shiftName: 'Ca sáng', shiftStart: '08:00', shiftEnd: '12:00',
          checkOutAt: '2026-09-02T05:00:00.000Z',
        })],
        nowMs: afterSeptemberDay,
      })

      expect(eligibility, storeId).toMatchObject({
        allowed: true,
        code: 'READY',
        finalShiftAttendanceCount: 0,
        ruleCode: 'DAILY_CLOSE_V2',
      })
    }
  })

  it('allows a closed September day even when legacy schedule data cannot resolve a final shift', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-09-02', schedule: [], shiftDefinitions: [],
      attendance: [closed({ workDate: '2026-09-02', shiftId: 'morning', shiftName: 'Ca sáng' })],
      nowMs: afterSeptemberDay,
    })).toMatchObject({
      allowed: true,
      code: 'READY',
      attendanceCount: 1,
      finalShiftId: null,
      ruleCode: 'DAILY_CLOSE_V2',
    })
  })

  it('does not create an empty September calculation when the day has no attendance', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-09-02', schedule: scheduleFor('2026-09-02'), shiftDefinitions: shifts,
      attendance: [], nowMs: afterSeptemberDay,
    })).toMatchObject({
      allowed: false,
      code: 'FINAL_SHIFT_NOT_ATTENDED',
      attendanceCount: 0,
      ruleCode: 'DAILY_CLOSE_V2',
    })
  })

  it('uses active store shift definitions when the legacy day has no explicit schedule', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule: [], shiftDefinitions: shifts,
      attendance: [closed()], nowMs: afterLegacyCutoff,
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
      storeId: 'S1', businessDate: '2026-08-31', schedule: scheduleFor('2026-08-31'), shiftDefinitions: shifts,
      attendance: [closed({ checkOutAt: null })],
      dailyRecords: [{ id: 'RB-1', storeId: 's1', businessDate: '2026-08-31', status: 'APPROVED' }],
      nowMs: Date.parse('2026-08-31T01:00:00.000Z'),
    })).toMatchObject({ allowed: false, code: 'ALREADY_CALCULATED', existingId: 'RB-1' })
  })

  it('leaves every September store-day that was already calculated locked and unchanged', () => {
    expect(revenueBonusEligibility({
      storeId: 'DOSII-DI-AN', businessDate: '2026-09-02',
      schedule: scheduleFor('2026-09-02', 'DOSII-DI-AN'), shiftDefinitions: shifts,
      attendance: [closed({ storeId: 'DOSII-DI-AN', workDate: '2026-09-02', shiftId: 'morning' })],
      dailyRecords: [{
        id: 'RB-DI-AN-0209', storeId: 'dosii-di-an', businessDate: '2026-09-02', status: 'APPROVED',
      }],
      nowMs: afterSeptemberDay,
    })).toMatchObject({
      allowed: false,
      code: 'ALREADY_CALCULATED',
      existingId: 'RB-DI-AN-0209',
      ruleCode: 'DAILY_CLOSE_V2',
    })
  })

  it('reports colliding effective daily records without choosing one', () => {
    expect(revenueBonusEligibility({
      storeId: 'S1', businessDate: '2026-08-31', schedule: scheduleFor('2026-08-31'), shiftDefinitions: shifts,
      attendance: [closed()], nowMs: afterLegacyCutoff,
      dailyRecords: [
        { id: 'RB-1', storeId: 'S1', businessDate: '2026-08-31', status: 'APPROVED' },
        { id: 'RB-2', storeId: 's1', businessDate: '2026-08-31', status: 'APPROVED' },
      ],
    })).toMatchObject({ allowed: false, code: 'DATA_COLLISION', existingCount: 2 })
  })
})
