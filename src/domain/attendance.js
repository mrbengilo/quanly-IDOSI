const integerAtLeastZero = (value, field) => {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new TypeError(`${field} must be a non-negative integer.`)
  return number
}

const vietnamDateTimeParts = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value: part }) => [type, part]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

const timeParts = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const local = vietnamDateTimeParts(value)
    return { minutes: local.minutes, timestamp: value.getTime() }
  }
  const source = String(value ?? '').trim()
  const match = source.match(/(?:^|T|\s)(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null
  const parsed = /\d{4}-\d{2}-\d{2}/.test(source) ? new Date(source) : null
  return {
    minutes: hour * 60 + minute,
    timestamp: parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : null,
  }
}

const signedCircularDifference = (actual, expected) => {
  let difference = actual - expected
  if (difference <= -720) difference += 1440
  if (difference > 720) difference -= 1440
  return difference
}

const differenceMinutes = (actualValue, expectedValue) => {
  const actual = timeParts(actualValue)
  const expected = timeParts(expectedValue)
  if (!actual || !expected) throw new TypeError('actualTime and shiftStart must contain valid HH:mm values.')
  if (actual.timestamp != null && expected.timestamp != null) {
    return Math.round((actual.timestamp - expected.timestamp) / 60000)
  }
  return signedCircularDifference(actual.minutes, expected.minutes)
}

const shiftTimes = (shift = {}) => {
  let start = shift.start || shift.shiftStart || shift.startTime
  let end = shift.end || shift.shiftEnd || shift.endTime
  if ((!start || !end) && shift.time) {
    const matches = String(shift.time).match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/)
    if (matches) {
      start ||= matches[1]
      end ||= matches[2]
    }
  }
  const startParts = timeParts(start)
  const endParts = timeParts(end)
  if (!startParts || !endParts) return null
  let duration = endParts.minutes - startParts.minutes
  if (duration <= 0) duration += 1440
  if (duration <= 0 || duration > 1440) return null
  return { start, end, startMinutes: startParts.minutes, endMinutes: endParts.minutes, duration }
}

const dateFrom = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return vietnamDateTimeParts(value)?.date || ''
  }
  return String(value ?? '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || ''
}

const previousDate = (value) => {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

export const ATTENDANCE_STATUS = Object.freeze({
  EARLY: 'Đi sớm',
  ON_TIME: 'Đúng giờ',
  LATE: 'Đi trễ',
})

export function classifyAttendanceArrival({ actualTime, shiftStart, toleranceMinutes = 0 } = {}) {
  const tolerance = integerAtLeastZero(toleranceMinutes, 'toleranceMinutes')
  const difference = differenceMinutes(actualTime, shiftStart)
  if (difference < 0) {
    return { status: ATTENDANCE_STATUS.EARLY, differenceMinutes: difference, earlyMinutes: Math.abs(difference), lateMinutes: 0 }
  }
  if (difference <= tolerance) {
    return { status: ATTENDANCE_STATUS.ON_TIME, differenceMinutes: difference, earlyMinutes: 0, lateMinutes: 0 }
  }
  return { status: ATTENDANCE_STATUS.LATE, differenceMinutes: difference, earlyMinutes: 0, lateMinutes: difference }
}

export function resolveShiftCandidates({ at, shifts = [], workDate, earlyWindowMinutes = 120 } = {}) {
  const earlyWindow = integerAtLeastZero(earlyWindowMinutes, 'earlyWindowMinutes')
  const actual = timeParts(at)
  if (!actual) throw new TypeError('at must contain a valid HH:mm value.')
  const targetDate = workDate || dateFrom(at)
  const priorDate = previousDate(targetDate)
  const normalized = shifts.flatMap((shift) => {
    const times = shiftTimes(shift)
    if (!times) return []
    const elapsed = (actual.minutes - times.startMinutes + 1440) % 1440
    const minutesUntilStart = (times.startMinutes - actual.minutes + 1440) % 1440
    const isCurrent = elapsed < times.duration
    const shiftDate = String(shift.date || shift.workDate || shift.effectiveDate || '').slice(0, 10)
    const isOvernight = times.endMinutes <= times.startMinutes
    const belongsToTargetDate = !targetDate || !shiftDate || shiftDate === targetDate
    const isPreviousDayOvernightContinuation = Boolean(
      targetDate
      && shiftDate
      && priorDate
      && shiftDate === priorDate
      && isOvernight
      && isCurrent,
    )
    if (!belongsToTargetDate && !isPreviousDayOvernightContinuation) return []
    return [{ ...shift, ...times, elapsedMinutes: elapsed, minutesUntilStart, isCurrent }]
  })

  const currentShift = normalized
    .filter((shift) => shift.isCurrent)
    .sort((left, right) => left.elapsedMinutes - right.elapsedMinutes)[0] || null
  const nextShift = normalized
    .filter((shift) => !shift.isCurrent && shift.minutesUntilStart > 0 && shift.minutesUntilStart <= earlyWindow)
    .sort((left, right) => left.minutesUntilStart - right.minutesUntilStart)[0] || null

  if (currentShift && nextShift) {
    return { mode: 'current-or-next', candidates: [currentShift, nextShift], currentShift, nextShift, earlyWindowMinutes: earlyWindow }
  }
  const only = currentShift || nextShift
  if (only) {
    return {
      mode: 'confirm-single',
      candidates: [only],
      currentShift,
      nextShift,
      requiresEarlyConfirmation: Boolean(nextShift && !currentShift),
      earlyWindowMinutes: earlyWindow,
    }
  }
  return { mode: 'none', candidates: [], currentShift: null, nextShift: null, earlyWindowMinutes: earlyWindow }
}

export const attendanceTimeHelpers = Object.freeze({ timeParts, differenceMinutes, shiftTimes })
