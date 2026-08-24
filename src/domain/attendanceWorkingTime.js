import { resolveEffectiveWorkingTime } from './workTimeSchedule'

const shiftTime = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/u)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return {
    label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    minuteOfDay: (hour * 60) + minute,
  }
}

const employeeKey = (employee = {}) => String(employee.id || employee.code || '')

const profileShiftId = (value, index) => {
  const safe = String(value || '').trim().replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80)
  return safe || `work_${index + 1}`
}

const partTimeEmployment = (value) => {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .trim()
    .toLocaleLowerCase('vi-VN')
  return normalized.includes('part') || normalized.includes('thuc tap')
}

const attendanceProfileShifts = (effective = {}) => {
  const rawShifts = Array.isArray(effective.workShifts) && effective.workShifts.length
    ? effective.workShifts
    : Array.isArray(effective.workingTime?.shifts) && effective.workingTime.shifts.length
      ? effective.workingTime.shifts
      : null
  if (rawShifts) {
    const normalized = rawShifts.map((rawShift, index) => {
      const start = shiftTime(rawShift?.start)
      const end = shiftTime(rawShift?.end)
      if (!start || !end || end.minuteOfDay <= start.minuteOfDay) return null
      return {
        id: profileShiftId(rawShift?.id, index),
        name: String(rawShift?.name || `Ca ${index + 1}`).trim().slice(0, 80),
        start: start.label,
        end: end.label,
        version: 1,
        source: 'profile-work-shift',
        ...(effective.workTimeEffectiveFrom ? { effectiveFrom: effective.workTimeEffectiveFrom } : {}),
      }
    })
    if (normalized.every(Boolean)) return normalized
  }

  const partTime = partTimeEmployment(effective.employmentType || effective.workTimeType)
  const start = shiftTime(effective.workStart || '08:00')
  const end = shiftTime(effective.workEnd || (partTime ? '12:00' : '17:30'))
  if (!start || !end || end.minuteOfDay <= start.minuteOfDay) return []
  return [{
    id: partTime ? 'work_1' : 'full_time',
    name: partTime ? 'Ca 1' : 'Giờ hành chính',
    start: start.label,
    end: end.label,
    version: 1,
    source: 'profile-work-shift',
    ...(effective.workTimeEffectiveFrom ? { effectiveFrom: effective.workTimeEffectiveFrom } : {}),
  }]
}

export const attendanceDailySchedule = (employee = {}, workDate, schedules = []) => {
  const employeeId = employeeKey(employee)
  if (!employeeId || !workDate) return null
  return (Array.isArray(schedules) ? schedules : []).find((record) => (
    !record?.deletedAt
    && String(record?.employeeId || '') === employeeId
    && String(record?.date || '') === String(workDate)
  )) || null
}

export const attendanceDailyShift = (schedule = {}) => {
  const start = shiftTime(schedule.start)
  const end = shiftTime(schedule.end)
  if (!start || !end || end.minuteOfDay <= start.minuteOfDay) return null
  return {
    id: String(schedule.id || `SUPPORT_${schedule.employeeId}_${schedule.date}`)
      .replace(/[^A-Za-z0-9_-]/gu, '_')
      .slice(0, 80),
    name: String(schedule.shiftName || schedule.name || 'Lịch làm việc').trim().slice(0, 80),
    start: start.label,
    end: end.label,
    version: Number(schedule.version || 1),
    source: 'support-daily-schedule',
  }
}

export const resolveAttendanceWorkingTime = (employee = {}, workDate, schedules = []) => {
  const effective = resolveEffectiveWorkingTime(employee, workDate)
  const profileShifts = attendanceProfileShifts(effective)
  const canonicalEffective = profileShifts.length
    ? {
        ...effective,
        workStart: profileShifts[0].start,
        workEnd: profileShifts[0].end,
        workShifts: profileShifts,
      }
    : effective
  const dailySchedule = attendanceDailySchedule(employee, workDate, schedules)
  const dailyShift = dailySchedule ? attendanceDailyShift(dailySchedule) : null
  if (!dailyShift) {
    return {
      ...canonicalEffective,
      attendanceWorkingTimeSource: effective.workTimeEffectiveFrom ? 'profile-work-schedule' : 'profile-default',
    }
  }
  return {
    ...canonicalEffective,
    workStart: dailyShift.start,
    workEnd: dailyShift.end,
    workShifts: [dailyShift],
    attendanceScheduleId: dailySchedule.id,
    attendanceWorkingTimeSource: dailyShift.source,
  }
}

export const reconcileAttendanceShiftId = (shifts = [], selectedShiftId = '') => {
  const selectedId = String(selectedShiftId || '')
  const available = Array.isArray(shifts) ? shifts : []
  if (selectedId && available.some((shift) => String(shift?.id || '') === selectedId)) return selectedId
  return available.length === 1 ? String(available[0]?.id || '') : ''
}

export const resolveAttendanceShiftSelection = (workingTime = {}, selectedShiftId = '') => {
  const shifts = Array.isArray(workingTime.workShifts) ? workingTime.workShifts : []
  const shiftId = reconcileAttendanceShiftId(shifts, selectedShiftId)
  const shift = shifts.find((candidate) => String(candidate?.id || '') === shiftId) || null
  return {
    shifts,
    shift,
    shiftId,
    requiresSelection: shifts.length > 1 && !shift,
  }
}
