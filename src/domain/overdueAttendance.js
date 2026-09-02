import { businessDate } from '../utils'

const attendanceDate = (record = {}) => businessDate(
  record.businessDate
  || record.workDate
  || record.date
  || record.attendanceDate
  || record.checkInAt
  || record.createdAt,
)

const timeOfDay = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/u)
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

const scheduledEndTimestamp = (record = {}) => {
  const date = attendanceDate(record)
  const start = timeOfDay(record.shiftStart || record.start || record.startTime)
  const end = timeOfDay(record.shiftEnd || record.end || record.endTime)
  if (!date || !start || !end) return null
  const endDate = end.minuteOfDay <= start.minuteOfDay ? nextCalendarDate(date) : date
  const timestamp = Date.parse(`${endDate}T${end.label}:00+07:00`)
  return Number.isFinite(timestamp) ? timestamp : null
}

export const isAttendanceOpen = (record = {}) => Boolean(
  record
  && !record.deletedAt
  && !record.voidedAt
  && !record.supersededAt
  && !record.checkOut
  && !record.checkOutAt,
)

export function isOverdueOpenAttendance(record = {}, now = new Date()) {
  if (!isAttendanceOpen(record)) return false
  const current = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(current.getTime())) return false
  const date = attendanceDate(record)
  const currentDate = businessDate(current)
  if (!date || !currentDate || date >= currentDate) return false

  const scheduledEnd = scheduledEndTimestamp(record)
  return scheduledEnd == null || current.getTime() >= scheduledEnd
}

export const overdueOpenAttendance = (records = [], now = new Date()) => (
  (Array.isArray(records) ? records : []).filter((record) => isOverdueOpenAttendance(record, now))
)

export const overdueAttendanceDate = attendanceDate

