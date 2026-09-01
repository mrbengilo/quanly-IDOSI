const normalizeIdentifier = (value) => String(value ?? '').trim().toLocaleLowerCase('vi-VN')

const recordDate = (record = {}) => String(
  record.businessDate || record.workDate || record.date || record.attendanceDate || '',
).slice(0, 10)

const timeParts = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/u)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null
  return { label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, minuteOfDay: (hour * 60) + minute }
}

const nextCalendarDate = (date) => {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return ''
  parsed.setUTCDate(parsed.getUTCDate() + 1)
  return parsed.toISOString().slice(0, 10)
}

const activeDailyRecord = (record, storeId, businessDate) => (
  normalizeIdentifier(record?.storeId) === normalizeIdentifier(storeId)
  && recordDate(record) === businessDate
  && !record?.deletedAt
  && !record?.voidedAt
  && !record?.supersededAt
  && !['VOID', 'VOIDED', 'SUPERSEDED', 'CANCELLED'].includes(String(record?.status || '').trim().toUpperCase())
)

const shiftTimeRange = (record = {}) => {
  let start = record.start || record.shiftStart || record.startTime
  let end = record.end || record.shiftEnd || record.endTime
  if ((!start || !end) && record.time) {
    const match = String(record.time).match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/u)
    if (match) {
      start ||= match[1]
      end ||= match[2]
    }
  }
  const startParts = timeParts(start)
  const endParts = timeParts(end)
  if (!startParts || !endParts) return null
  return { start: startParts.label, end: endParts.label, startMinute: startParts.minuteOfDay, endMinute: endParts.minuteOfDay }
}

const shiftIdentifier = (record = {}) => String(record.id || record.shiftId || record.shift || '').trim()

const scheduleShiftCandidates = ({ schedule = [], shiftDefinitions = [], storeId, businessDate }) => {
  const scopedDefinitions = shiftDefinitions.filter((definition) => (
    !definition?.deletedAt
    && definition?.active !== false
    && (!definition?.storeId || normalizeIdentifier(definition.storeId) === normalizeIdentifier(storeId))
    && (!definition?.date || recordDate(definition) === businessDate)
  ))
  const definitionsById = new Map()
  for (const definition of scopedDefinitions) {
    const key = normalizeIdentifier(shiftIdentifier(definition))
    if (!key) continue
    const current = definitionsById.get(key)
    if (!current || (!current.storeId && definition.storeId)) definitionsById.set(key, definition)
  }
  const daySchedule = schedule.filter((assignment) => (
    !assignment?.deletedAt
    && normalizeIdentifier(assignment?.storeId) === normalizeIdentifier(storeId)
    && recordDate(assignment) === businessDate
  ))
  if (!daySchedule.length) return scopedDefinitions

  return daySchedule.flatMap((assignment) => {
    const snapshots = Array.isArray(assignment.shiftSnapshots) ? assignment.shiftSnapshots.filter(Boolean) : []
    if (snapshots.length) return snapshots
    const ids = [
      ...(Array.isArray(assignment.shiftIds) ? assignment.shiftIds : []),
      assignment.shiftId,
      assignment.shift,
    ].filter(Boolean)
    return ids.map((id) => definitionsById.get(normalizeIdentifier(id))).filter(Boolean)
  })
}

const shiftEndTimestamp = (businessDate, shift) => {
  const range = shiftTimeRange(shift)
  if (!range) return null
  const endDate = range.endMinute <= range.startMinute ? nextCalendarDate(businessDate) : businessDate
  const timestamp = Date.parse(`${endDate}T${range.end}:00+07:00`)
  return Number.isFinite(timestamp) ? { ...range, timestamp, endAt: new Date(timestamp).toISOString() } : null
}

const attendanceMatchesShift = (attendance, shift) => {
  const attendanceId = normalizeIdentifier(shiftIdentifier(attendance))
  const targetId = normalizeIdentifier(shiftIdentifier(shift))
  if (attendanceId && targetId && attendanceId === targetId) return true
  const attendanceRange = shiftTimeRange(attendance)
  const targetRange = shiftTimeRange(shift)
  return Boolean(attendanceRange && targetRange
    && attendanceRange.start === targetRange.start
    && attendanceRange.end === targetRange.end)
}

const result = (code, details) => ({
  allowed: code === 'READY',
  code,
  ...details,
})

export const REVENUE_BONUS_ELIGIBILITY_MESSAGES = Object.freeze({
  READY: 'Ca cuối cùng trong ngày đã kết thúc. Có thể tính thưởng doanh thu.',
  ALREADY_CALCULATED: 'Thưởng doanh thu của ngày này đã được tính và không thể tính lại.',
  DATA_COLLISION: 'Ngày này có nhiều kết quả thưởng đang hiệu lực; cần xử lý dữ liệu trùng.',
  FINAL_SHIFT_UNRESOLVED: 'Chưa xác định được ca cuối cùng của ngày từ lịch phân ca.',
  FINAL_SHIFT_NOT_ATTENDED: 'Chưa có nhân viên điểm danh vào ca cuối cùng của ngày.',
  ATTENDANCE_OPEN: 'Vẫn còn nhân viên chưa kết ca trong ngày.',
})

export function revenueBonusEligibility({
  storeId = '',
  businessDate = '',
  schedule = [],
  shiftDefinitions = [],
  attendance = [],
  dailyRecords = [],
} = {}) {
  const normalizedStoreId = normalizeIdentifier(storeId)
  if (!normalizedStoreId || !/^\d{4}-\d{2}-\d{2}$/u.test(String(businessDate))) {
    throw new TypeError('storeId and businessDate are required.')
  }
  const common = {
    message: '',
    existingId: null,
    attendanceCount: 0,
    finalShiftAttendanceCount: 0,
    openAttendanceCount: 0,
    finalShiftId: null,
    finalShiftName: null,
    finalShiftEndAt: null,
  }
  const effectiveDaily = dailyRecords.filter((record) => activeDailyRecord(record, storeId, businessDate))
  if (effectiveDaily.length > 1) {
    return result('DATA_COLLISION', {
      ...common,
      message: REVENUE_BONUS_ELIGIBILITY_MESSAGES.DATA_COLLISION,
      existingCount: effectiveDaily.length,
      conflictingIds: effectiveDaily.map((record) => String(record.id || '')).filter(Boolean),
    })
  }
  if (effectiveDaily.length === 1) {
    return result('ALREADY_CALCULATED', {
      ...common,
      message: REVENUE_BONUS_ELIGIBILITY_MESSAGES.ALREADY_CALCULATED,
      existingCount: 1,
      existingId: String(effectiveDaily[0].id || ''),
    })
  }

  const candidates = scheduleShiftCandidates({ schedule, shiftDefinitions, storeId, businessDate })
    .map((shift) => ({ shift, end: shiftEndTimestamp(businessDate, shift) }))
    .filter((candidate) => candidate.end)
  if (!candidates.length) {
    return result('FINAL_SHIFT_UNRESOLVED', {
      ...common,
      message: REVENUE_BONUS_ELIGIBILITY_MESSAGES.FINAL_SHIFT_UNRESOLVED,
      existingCount: 0,
    })
  }
  const finalEndTimestamp = Math.max(...candidates.map((candidate) => candidate.end.timestamp))
  const finalCandidates = candidates.filter((candidate) => candidate.end.timestamp === finalEndTimestamp)
  const finalShift = finalCandidates[0]
  const dayAttendance = attendance.filter((record) => (
    !record?.deletedAt
    && normalizeIdentifier(record?.storeId) === normalizedStoreId
    && recordDate(record) === businessDate
  ))
  const finalAttendance = dayAttendance.filter((record) => (
    finalCandidates.some((candidate) => attendanceMatchesShift(record, candidate.shift))
  ))
  const openAttendance = dayAttendance.filter((record) => !record.checkOutAt && !record.checkOut)
  const details = {
    ...common,
    existingCount: 0,
    attendanceCount: dayAttendance.length,
    finalShiftAttendanceCount: finalAttendance.length,
    openAttendanceCount: openAttendance.length,
    finalShiftId: shiftIdentifier(finalShift.shift) || null,
    finalShiftName: String(finalShift.shift.name || finalShift.shift.shiftName || '').trim() || null,
    finalShiftEndAt: finalShift.end.endAt,
  }
  if (!finalAttendance.length) {
    return result('FINAL_SHIFT_NOT_ATTENDED', {
      ...details,
      message: REVENUE_BONUS_ELIGIBILITY_MESSAGES.FINAL_SHIFT_NOT_ATTENDED,
    })
  }
  if (openAttendance.length) {
    return result('ATTENDANCE_OPEN', {
      ...details,
      message: REVENUE_BONUS_ELIGIBILITY_MESSAGES.ATTENDANCE_OPEN,
      openAttendanceIds: openAttendance.map((record) => String(record.id || '')).filter(Boolean),
    })
  }
  return result('READY', {
    ...details,
    message: REVENUE_BONUS_ELIGIBILITY_MESSAGES.READY,
  })
}

