const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const vietnamDate = (date) => {
  const parts = Object.fromEntries(VIETNAM_DATE_FORMATTER.formatToParts(date).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const recordBusinessDate = (record = {}) => {
  const explicitDate = String(record.workDate || record.attendanceDate || record.date || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(explicitDate)) return explicitDate
  const source = String(record.occurredAt || record.createdAt || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/u.test(source)) return source
  const timestamp = Date.parse(source)
  return Number.isFinite(timestamp) ? vietnamDate(new Date(timestamp)) : source.slice(0, 10)
}

export const isNonNegativeSafeIntegerAmount = (value) => {
  const amount = Number(value)
  return Number.isSafeInteger(amount) && amount >= 0
}

export const scheduleShiftIds = (record = {}) => {
  const values = Array.isArray(record.shiftIds) && record.shiftIds.length
    ? record.shiftIds
    : record.shiftId ? [record.shiftId] : []
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}
