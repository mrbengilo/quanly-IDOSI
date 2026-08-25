const rawDateOnly = (value) => String(value || '').slice(0, 10)

export const SUPPORT_SCHEDULE_PRESETS = Object.freeze([
  Object.freeze({ id: 'morning', name: 'Ca sáng', start: '08:00', end: '12:00' }),
  Object.freeze({ id: 'afternoon', name: 'Ca chiều', start: '13:00', end: '17:30' }),
  Object.freeze({ id: 'office-hours', name: 'Giờ hành chính', start: '08:00', end: '17:30' }),
])

const parseCalendarDate = (value) => {
  const text = rawDateOnly(value)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])) return null
  return date
}

const formatCalendarDate = (date) => date?.toISOString().slice(0, 10) || ''

export const supportScheduleDate = (value) => formatCalendarDate(parseCalendarDate(value))

export const supportScheduleEmploymentMode = (employee = {}) => {
  const normalized = String(employee.employmentType || employee.workTimeType || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  return normalized.includes('part') || normalized.includes('thuc tap') ? 'shift' : 'fixed'
}

export const supportScheduleRange = (anchorDate, view = 'day') => {
  const anchor = parseCalendarDate(anchorDate)
  if (!anchor) return { start: '', end: '' }
  const start = new Date(anchor)
  const end = new Date(anchor)
  if (view === 'week') {
    end.setUTCDate(start.getUTCDate() + 6)
  } else if (view === 'month') {
    start.setUTCDate(1)
    end.setUTCMonth(start.getUTCMonth() + 1, 0)
  }
  return { start: formatCalendarDate(start), end: formatCalendarDate(end) }
}

export const supportScheduleDays = (anchorDate, view = 'day') => {
  const { start, end } = supportScheduleRange(anchorDate, view)
  if (!start || !end) return []
  const cursor = parseCalendarDate(start)
  const last = parseCalendarDate(end)
  const dates = []
  while (cursor <= last) {
    dates.push(formatCalendarDate(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export const shiftSupportScheduleAnchor = (anchorDate, view = 'day', direction = 1) => {
  const anchor = parseCalendarDate(anchorDate)
  if (!anchor || !Number.isFinite(Number(direction))) return ''
  const amount = Number(direction)
  if (view === 'month') {
    const targetMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + amount, 1))
    const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate()
    targetMonth.setUTCDate(Math.min(anchor.getUTCDate(), lastDay))
    return formatCalendarDate(targetMonth)
  }
  anchor.setUTCDate(anchor.getUTCDate() + amount * (view === 'week' ? 7 : 1))
  return formatCalendarDate(anchor)
}

export const supportSchedulesForView = (records = [], {
  employeeId,
  targetUnit,
  anchorDate,
  view = 'day',
} = {}) => {
  const { start, end } = supportScheduleRange(anchorDate, view)
  if (!start || !end) return []
  return records.filter((record) => (
    !record.deletedAt
    && (!employeeId || String(record.employeeId || '') === String(employeeId))
    && (!targetUnit || String(record.targetUnit || '') === String(targetUnit))
    && supportScheduleDate(record.date) >= start
    && supportScheduleDate(record.date) <= end
  )).sort((left, right) => (
    `${supportScheduleDate(left.date)} ${left.start || ''} ${left.id || ''}`
      .localeCompare(`${supportScheduleDate(right.date)} ${right.start || ''} ${right.id || ''}`)
  ))
}
